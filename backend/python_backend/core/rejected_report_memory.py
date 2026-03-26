from __future__ import annotations

import json
import logging
import math
import re
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor

from core.config import settings
from core.document_processing import normalize_tipo_parecer
from core.semantic_memory import EmbedderService

logger = logging.getLogger(__name__)

_embedder = EmbedderService()

_TYPE_SQL = """
CASE
  WHEN lower(COALESCE(reap.tipo_parecer, reap.response_data->>'tipo_parecer', reap.response_data->'dadosCabecalho'->>'tipo_parecer', '')) IN ('personal', 'pessoal') THEN 'pessoal'
  WHEN lower(COALESCE(reap.tipo_parecer, reap.response_data->>'tipo_parecer', reap.response_data->'dadosCabecalho'->>'tipo_parecer', '')) IN ('fiscal') THEN 'fiscal'
  WHEN lower(COALESCE(reap.tipo_parecer, reap.response_data->>'tipo_parecer', reap.response_data->'dadosCabecalho'->>'tipo_parecer', '')) IN ('accounting', 'contabil', 'contábil') THEN 'contabil'
  WHEN lower(COALESCE(reap.tipo_parecer, reap.response_data->>'tipo_parecer', reap.response_data->'dadosCabecalho'->>'tipo_parecer', '')) IN ('support', 'atendimento') THEN 'atendimento'
  WHEN lower(COALESCE(reap.tipo_parecer, reap.response_data->>'tipo_parecer', reap.response_data->'dadosCabecalho'->>'tipo_parecer', '')) IN ('generic', 'generico', 'genérico') THEN 'generico'
  WHEN trim(COALESCE(reap.tipo_parecer, reap.response_data->>'tipo_parecer', reap.response_data->'dadosCabecalho'->>'tipo_parecer', '')) = '' THEN 'desconhecido'
  ELSE lower(COALESCE(reap.tipo_parecer, reap.response_data->>'tipo_parecer', reap.response_data->'dadosCabecalho'->>'tipo_parecer', ''))
END
"""


def _collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _normalize_lookup_text(value: str) -> str:
    return _collapse_whitespace(value).upper()


def _append_unique(items: list[str], value: str | None) -> None:
    candidate = _collapse_whitespace(value or "")
    if candidate and candidate not in items:
        items.append(candidate)


def _safe_json(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _flatten_strings(value: Any, limit: int = 24) -> list[str]:
    items: list[str] = []

    def walk(node: Any) -> None:
        if len(items) >= limit:
            return
        if isinstance(node, str):
            candidate = _collapse_whitespace(node)
            if candidate:
                items.append(candidate)
            return
        if isinstance(node, list):
            for child in node:
                walk(child)
            return
        if isinstance(node, dict):
            for child in node.values():
                walk(child)

    walk(value)
    return items[:limit]


def _extract_report_signals(report_data: dict[str, Any]) -> list[str]:
    signals: list[str] = []
    for key in (
        "validation_errors",
        "validacao_erros",
        "risks_identified",
        "missing_required_documents",
        "documentos_sem_texto",
        "recommendations",
    ):
        for item in _flatten_strings(report_data.get(key), limit=12):
            _append_unique(signals, item)

    for item in _flatten_strings(report_data.get("pontosAtencao"), limit=12):
        _append_unique(signals, item)
    for item in _flatten_strings(report_data.get("avisosPendencias"), limit=12):
        _append_unique(signals, item)
    for item in _flatten_strings(report_data.get("controleJornada"), limit=12):
        _append_unique(signals, item)
    for item in _flatten_strings(report_data.get("eventosDP"), limit=12):
        _append_unique(signals, item)
    for item in _flatten_strings(report_data.get("dadosSecao8"), limit=12):
        _append_unique(signals, item)
    for item in _flatten_strings(report_data.get("comentarios"), limit=6):
        _append_unique(signals, item)

    return signals[:18]


def _build_query_text(
    *,
    report_type: str,
    client_name: str | None,
    competencia: str | None,
    cliente_cnpj: str | None,
    current_report: dict[str, Any],
) -> str:
    parts = [
        f"tipo_parecer={report_type}",
        f"cliente={client_name or ''}",
        f"competencia={competencia or ''}",
        f"cnpj={cliente_cnpj or ''}",
    ]
    parts.extend(_extract_report_signals(current_report))
    return "\n".join(part for part in parts if _collapse_whitespace(part))


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    if size == 0:
        return 0.0
    dot = sum(left[index] * right[index] for index in range(size))
    left_norm = math.sqrt(sum(left[index] * left[index] for index in range(size)))
    right_norm = math.sqrt(sum(right[index] * right[index] for index in range(size)))
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def _keyword_overlap(query_text: str, candidate_text: str) -> float:
    query_tokens = {
        token for token in re.findall(r"[A-Z0-9À-Ü]{3,}", _normalize_lookup_text(query_text))
    }
    candidate_tokens = {
        token for token in re.findall(r"[A-Z0-9À-Ü]{3,}", _normalize_lookup_text(candidate_text))
    }
    if not query_tokens or not candidate_tokens:
        return 0.0
    return len(query_tokens & candidate_tokens) / len(query_tokens)


def _infer_guardrails(matches: list[dict[str, Any]], report_type: str) -> list[str]:
    guardrails: list[str] = []

    for match in matches:
        haystack = _normalize_lookup_text(
            " ".join([match.get("motivo") or "", *match.get("signals", [])])
        )

        if report_type == "pessoal":
            if (
                "LIQUIDO GERAL" in haystack
                or "DUPLA CONTAGEM" in haystack
                or "DUPLA CONTAGEM" in _normalize_lookup_text(match.get("motivo") or "")
            ):
                _append_unique(
                    guardrails,
                    "Nao somar o liquido geral da folha com os liquidos individuais ao montar os pagamentos.",
                )
            if "PONTO" in haystack and "FOLHA" in haystack:
                _append_unique(
                    guardrails,
                    "Conferir colaborador por colaborador entre ponto e folha antes de consolidar jornada, eventos e pendencias.",
                )
            if "FERIAS" in haystack:
                _append_unique(
                    guardrails,
                    "So registrar ferias quando houver evidencia documental explicita para o mesmo colaborador.",
                )
            if "SEM TEXTO EXTRAIVEL" in haystack or "PDF SEM TEXTO" in haystack:
                _append_unique(
                    guardrails,
                    "Marcar PDFs sem texto extraivel como pendencia e evitar inferencias fortes a partir deles.",
                )
            if "JORNADA" in haystack or "COLABORADORA INCORRETA" in haystack:
                _append_unique(
                    guardrails,
                    "Nao incluir colaborador em jornada sem evidencia de ponto ou apontamento equivalente.",
                )
        else:
            if "CANCELAD" in haystack:
                _append_unique(
                    guardrails,
                    "Desconsiderar documentos fiscais cancelados na receita exigivel e explicitar o impacto.",
                )
            if "DAS" in haystack and "PAGAMENTO" in haystack:
                _append_unique(
                    guardrails,
                    "Nao marcar imposto como pago sem comprovante bancario ou evidencia documental de quitacao.",
                )
            if "FATOR R" in haystack:
                _append_unique(
                    guardrails,
                    "Revalidar fator R, anexo e base de folha quando houver divergencia documental ou historica.",
                )
            if "MOVIMENTO" in haystack and "RECEITA" in haystack:
                _append_unique(
                    guardrails,
                    "Conciliar movimento financeiro com a receita declarada antes de concluir o parecer fiscal.",
                )

    if not guardrails:
        for match in matches[:2]:
            _append_unique(
                guardrails,
                f"Evitar recorrencia do reprovado {match['id']}: {match.get('motivo') or 'motivo nao informado'}.",
            )

    return guardrails[:5]


def _fetch_rejected_report_rows(
    report_type: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    rows_query = f"""
        WITH rejected AS (
            SELECT
                rr.id,
                rr.created_at,
                rr.file_name,
                rr.user_name,
                rr.user_email,
                rr.competencia,
                COALESCE(
                    to_jsonb(rr)->>'motivo_rejeicao',
                    to_jsonb(rr)->>'justificativa',
                    to_jsonb(rr)->>'motivo',
                    ''
                ) AS motivo,
                COALESCE(reap.cliente_nome, '') AS cliente_nome,
                {_TYPE_SQL} AS tipo_parecer,
                reap.request_id,
                reap.response_data
            FROM public.relatorios_reprovados rr
            LEFT JOIN public.relatorios_em_aprovacao reap
                ON reap.id::text = COALESCE(
                    to_jsonb(rr)->>'relatorio_id',
                    to_jsonb(rr)->>'relatorio_original_id',
                    rr.id::text
                )
        )
        SELECT *
        FROM rejected
        WHERE (%s IS NULL OR tipo_parecer = %s)
        ORDER BY created_at DESC
        LIMIT %s
    """
    groups_query = f"""
        SELECT
            {_TYPE_SQL} AS tipo_parecer,
            COUNT(*)::int AS quantidade
        FROM public.relatorios_reprovados rr
        LEFT JOIN public.relatorios_em_aprovacao reap
            ON reap.id::text = COALESCE(
                to_jsonb(rr)->>'relatorio_id',
                to_jsonb(rr)->>'relatorio_original_id',
                rr.id::text
            )
        GROUP BY 1
        ORDER BY quantidade DESC, tipo_parecer ASC
    """

    connection = None
    try:
        connection = psycopg2.connect(settings.database_url, connect_timeout=5)
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(rows_query, (report_type, report_type, limit))
            rows = [dict(row) for row in cursor.fetchall()]
            cursor.execute(groups_query)
            groups = [dict(row) for row in cursor.fetchall()]
            return {
                "rows": rows,
                "type_groups": groups,
            }
    except Exception as exc:
        logger.warning("Falha ao consultar relatórios reprovados para memória semântica: %s", exc)
        return {"rows": [], "type_groups": []}
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                logger.debug("Falha ao fechar conexão de relatórios reprovados", exc_info=True)


async def search_rejected_report_guardrails(
    *,
    report_type: str,
    client_name: str | None,
    competencia: str | None,
    cliente_cnpj: str | None,
    current_report: dict[str, Any],
    max_results: int = 3,
) -> dict[str, Any]:
    normalized_type = normalize_tipo_parecer(report_type) or report_type
    corpus = _fetch_rejected_report_rows(normalized_type)
    rows = corpus.get("rows", [])
    type_groups = corpus.get("type_groups", [])
    if not rows:
        return {
            "query": "",
            "matches": [],
            "guardrails": [],
            "type_groups": type_groups,
            "corpus_type": normalized_type,
            "corpus_size": 0,
        }

    query_text = _build_query_text(
        report_type=normalized_type,
        client_name=client_name,
        competencia=competencia,
        cliente_cnpj=cliente_cnpj,
        current_report=current_report,
    )
    query_embedding = await _embedder.embed(query_text)
    ranked: list[dict[str, Any]] = []

    for row in rows:
        candidate_type = normalize_tipo_parecer(row.get("tipo_parecer"))

        response_data = _safe_json(row.get("response_data"))
        signals = _extract_report_signals(response_data)
        candidate_text = "\n".join(
            part
            for part in [
                f"cliente={row.get('cliente_nome') or ''}",
                f"competencia={row.get('competencia') or ''}",
                f"tipo_parecer={candidate_type or normalized_type}",
                row.get("motivo") or "",
                *signals,
            ]
            if _collapse_whitespace(str(part))
        )
        candidate_embedding = await _embedder.embed(candidate_text)
        cosine_score = _cosine_similarity(query_embedding, candidate_embedding)
        overlap_score = _keyword_overlap(query_text, candidate_text)
        score = (cosine_score * 0.65) + (overlap_score * 0.35)

        if _normalize_lookup_text(row.get("cliente_nome") or "") == _normalize_lookup_text(client_name or ""):
            score += 0.08
        if _collapse_whitespace(row.get("competencia") or "") == _collapse_whitespace(competencia or ""):
            score += 0.04
        if cliente_cnpj and cliente_cnpj in candidate_text:
            score += 0.04

        ranked.append(
            {
                "id": row.get("id"),
                "score": round(score, 4),
                "cliente_nome": row.get("cliente_nome"),
                "competencia": row.get("competencia"),
                "tipo_parecer": candidate_type or normalized_type,
                "motivo": row.get("motivo") or "",
                "signals": signals[:8],
                "request_id": row.get("request_id"),
                "created_at": (
                    row.get("created_at").isoformat()
                    if hasattr(row.get("created_at"), "isoformat")
                    else row.get("created_at")
                ),
            }
        )

    ranked.sort(key=lambda item: item["score"], reverse=True)
    matches = [item for item in ranked[:max_results] if item["score"] > 0.2]
    return {
        "query": query_text,
        "matches": matches,
        "guardrails": _infer_guardrails(matches, normalized_type),
        "type_groups": type_groups,
        "corpus_type": normalized_type,
        "corpus_size": len(rows),
    }
