"""
agents/personal_agent.py — Sub-grafo Especializado em Departamento Pessoal

Neste produto, "parecer pessoal" significa análise de DP:
- folha de pagamento
- IRRF/encargos
- controle de jornada
- eventos do mês (férias, admissões, desligamentos, afastamentos)

O agente legado tratava esse domínio como LGPD/privacidade e por isso gerava
saídas irreais. Este sub-grafo lê os documentos enviados pelo frontend,
saneia PII básica antes do LLM e produz um resumo técnico baseado nos anexos.
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Any

from langgraph.graph import END, START, StateGraph

from core.document_processing import (
    build_personal_report_payload,
    build_document_prompt_context,
    extract_text_from_document,
    infer_cnpj_from_documents,
    infer_competencia_from_documents,
    sanitize_sensitive_text,
)
from core.rejected_report_memory import search_rejected_report_guardrails
from core.state import AgentState, AgentStep

logger = logging.getLogger(__name__)

REQUIRED_DOCUMENT_TYPES = {
    "folha_pagamento": "Folha de Pagamento",
    "irrf": "Encargos de IRRF",
    "ponto": "Controle de Jornada",
}


def _normalize_issue_key(value: Any) -> str:
    text = " ".join(str(value or "").strip().lower().split())
    if not text:
        return ""

    if text.startswith("não foi possível extrair texto de:"):
        filename = text.split("não foi possível extrair texto de:", 1)[1]
        filename = filename.split(". se necessário", 1)[0].strip()
        return f"ocr:{filename}"

    if text.startswith("documento sem texto extraível:"):
        filename = text.split("documento sem texto extraível:", 1)[1].strip()
        return f"ocr:{filename}"

    if text.startswith("documento obrigatório ausente:"):
        missing_doc = text.split("documento obrigatório ausente:", 1)[1].strip()
        return f"missing:{missing_doc}"

    return text


def _merge_summary_issues(pendencias: list[Any], alertas: list[Any]) -> list[str]:
    merged: list[str] = []
    seen_keys: set[str] = set()

    for raw_item in [*pendencias, *alertas]:
        item = str(raw_item or "").strip()
        if not item:
            continue
        issue_key = _normalize_issue_key(item)
        if issue_key and issue_key in seen_keys:
            continue
        if issue_key:
            seen_keys.add(issue_key)
        merged.append(item)

    return merged


def _get_session_metadata(state: AgentState) -> tuple[dict[str, Any], dict[str, Any]]:
    session = state.get("session") or {}
    metadata = session.get("metadata") or {}
    return session, metadata


async def validate_personal_context(state: AgentState) -> dict[str, Any]:
    logger.info("📋 Nó 1: Validando contexto de Departamento Pessoal...")

    documents = state.get("documents") or []
    validation_errors: list[str] = []

    if not documents:
        validation_errors.append("Nenhum documento enviado para o parecer pessoal")

    if not state.get("messages"):
        validation_errors.append("Nenhuma instrução foi enviada ao agente")

    is_valid = len(validation_errors) == 0

    step = AgentStep(
        agent_name="personal_agent",
        action="validate_personal_context",
        result={
            "is_valid": is_valid,
            "validation_errors": validation_errors,
            "documents_received": len(documents),
        },
    )

    return {
        "steps": [step],
        "domain_data": {
            "step": "validate_personal_context",
            "is_valid": is_valid,
            "validation_errors": validation_errors,
            "documents_received": len(documents),
        },
    }


async def fetch_personal_data(state: AgentState) -> dict[str, Any]:
    logger.info("🔍 Nó 2: Extraindo conteúdo dos documentos de DP...")

    session, metadata = _get_session_metadata(state)
    documents = state.get("documents") or []
    extracted_documents = [
        extract_text_from_document(document, index)
        for index, document in enumerate(documents)
    ]

    extracted_with_text = [doc for doc in extracted_documents if doc.get("text")]
    extracted_without_text = [doc for doc in extracted_documents if not doc.get("text")]
    document_type_counts = Counter(
        (doc.get("document_type") or "sem_tipo").lower()
        for doc in extracted_documents
    )
    missing_required = [
        label
        for key, label in REQUIRED_DOCUMENT_TYPES.items()
        if document_type_counts.get(key, 0) == 0
    ]

    step = AgentStep(
        agent_name="personal_agent",
        action="fetch_personal_data",
        result={
            "documents_received": len(documents),
            "documents_with_text": len(extracted_with_text),
            "document_types": dict(document_type_counts),
        },
    )

    logger.info(
        "✓ Documentos DP extraídos: %s com texto / %s totais",
        len(extracted_with_text),
        len(documents),
    )

    inferred_competencia = metadata.get("competencia") or infer_competencia_from_documents(
        extracted_documents
    )
    inferred_cliente_cnpj = metadata.get("cliente_cnpj") or infer_cnpj_from_documents(
        extracted_documents
    )
    documentos_sem_texto = [
        doc.get("filename") for doc in extracted_without_text if doc.get("filename")
    ]
    structured_report = build_personal_report_payload(
        extracted_documents,
        cliente_nome=session.get("client_name"),
        competencia=inferred_competencia,
        cliente_cnpj=inferred_cliente_cnpj,
        missing_required=missing_required,
        documentos_sem_texto=documentos_sem_texto,
    )
    rejected_report_insights = await search_rejected_report_guardrails(
        report_type="pessoal",
        client_name=session.get("client_name"),
        competencia=inferred_competencia,
        cliente_cnpj=inferred_cliente_cnpj,
        current_report=structured_report,
    )

    return {
        "steps": [step],
        "domain_data": {
            **state.get("domain_data", {}),
            "step": "fetch_personal_data",
            "_documents_extracted": extracted_documents,
            "_metadata": {
                "competencia": inferred_competencia,
                "cliente_cnpj": inferred_cliente_cnpj,
                "cliente_nome": session.get("client_name"),
            },
            "data_sources": ["uploaded_documents"],
            "documentos_recebidos": [
                {
                    "nome": doc.get("filename"),
                    "tipo": doc.get("document_type") or "sem_tipo",
                    "mime_type": doc.get("mime_type"),
                    "texto_extraido": bool(doc.get("text")),
                    "erro_extracao": doc.get("extraction_error"),
                }
                for doc in extracted_documents
            ],
            "documentos_por_tipo": dict(document_type_counts),
            "documentos_sem_texto": documentos_sem_texto,
            "missing_required_documents": missing_required,
            "_rejected_report_insights": rejected_report_insights,
            "rejected_report_guardrails": rejected_report_insights.get("guardrails", []),
            "_personal_report": structured_report,
        },
    }


async def anonymize_personal_data(state: AgentState) -> dict[str, Any]:
    logger.info("🔐 Nó 3: Sanitizando PII básica antes da análise do LLM...")

    domain_data = state.get("domain_data", {})
    extracted_documents = domain_data.get("_documents_extracted", [])

    masking_rules_applied: list[str] = []
    sanitized_documents: list[dict[str, Any]] = []

    for document in extracted_documents:
        original_text = document.get("text") or ""
        sanitized_text = sanitize_sensitive_text(original_text)
        if sanitized_text != original_text:
            masking_rules_applied.append(f"PII mascarada em {document.get('filename')}")

        sanitized_documents.append({
            **document,
            "text": sanitized_text,
        })

    sanitized_context = build_document_prompt_context(sanitized_documents)

    step = AgentStep(
        agent_name="personal_agent",
        action="anonymize_personal_data",
        result={
            "documents_sanitized": len(sanitized_documents),
            "masking_rules_applied": len(masking_rules_applied),
        },
    )

    return {
        "steps": [step],
        "domain_data": {
            **domain_data,
            "step": "anonymize_personal_data",
            "_sanitized_document_context": sanitized_context,
            "masking_rules_applied": sorted(set(masking_rules_applied)),
        },
    }


async def generate_personal_summary(state: AgentState) -> dict[str, Any]:
    logger.info("📄 Nó 4: Gerando parecer pessoal baseado nos anexos...")

    domain_data = state.get("domain_data", {})
    metadata = domain_data.get("_metadata", {})
    prompt_context = (domain_data.get("_sanitized_document_context") or "").strip()
    missing_required = domain_data.get("missing_required_documents", [])
    documentos_recebidos = domain_data.get("documentos_recebidos", [])
    documentos_por_tipo = domain_data.get("documentos_por_tipo", {})
    documentos_sem_texto = domain_data.get("documentos_sem_texto", [])
    structured_report = domain_data.get("_personal_report", {}) or {}
    rejected_report_insights = domain_data.get("_rejected_report_insights", {}) or {}
    rejected_report_guardrails = list(rejected_report_insights.get("guardrails", []))
    is_valid = bool(prompt_context) and not domain_data.get("validation_errors")

    if not prompt_context:
        step = AgentStep(
            agent_name="personal_agent",
            action="generate_personal_summary",
            result={"summary_length": 0, "documents_processed": len(documentos_recebidos)},
            error="Nenhum texto extraído dos documentos enviados",
        )
        return {
            "steps": [step],
            "domain_data": {
                "step": "generate_personal_summary",
                "agent": "personal",
                "status": "error",
                "tipo_parecer": "pessoal",
                "is_valid": False,
                "personal_summary": "Nenhum texto pôde ser extraído dos documentos enviados.",
                "alertas": ["Nenhum texto pôde ser extraído dos arquivos enviados."],
                "documentos_recebidos": documentos_recebidos,
                "documentos_por_tipo": documentos_por_tipo,
                "documentos_analisados": len(documentos_recebidos),
                "missing_required_documents": missing_required,
                "masking_rules_applied": domain_data.get("masking_rules_applied", []),
                "competencia": metadata.get("competencia"),
                "cliente_cnpj": metadata.get("cliente_cnpj"),
            },
        }

    try:
        cabecalho = structured_report.get("dadosCabecalho", {})
        valores_pagamento = structured_report.get("valoresPagamento", {})
        controle_jornada = structured_report.get("controleJornada", {})
        eventos_dp = structured_report.get("eventosDP", {})
        pontos_atencao = structured_report.get("pontosAtencao", {})
        avisos_pendencias = structured_report.get("avisosPendencias", {})
        parecer_tecnico = structured_report.get("parecerTecnico", {})

        pagamentos = valores_pagamento.get("itens", [])
        jornadas = controle_jornada.get("jornadas", [])
        ferias = eventos_dp.get("ferias", [])
        admissoes = eventos_dp.get("admissoes", [])
        desligamentos = eventos_dp.get("desligamentos", [])
        afastamentos = eventos_dp.get("afastamentos", [])
        alerts = list(pontos_atencao.get("itens", []))
        if missing_required:
            alerts.extend([f"Documento obrigatório ausente: {item}" for item in missing_required])
        if documentos_sem_texto:
            alerts.extend(
                [
                    f"Não foi possível extrair texto de: {filename}. Se necessário, reenviar em PDF pesquisável."
                    for filename in documentos_sem_texto
                ]
            )

        recommendations = list(parecer_tecnico.get("recomendacoes", []))
        if not recommendations:
            recommendations = [
                "Conferir se os totais de folha, IRRF e jornada estão conciliados entre os anexos.",
                "Registrar como pendência qualquer evento de DP não evidenciado documentalmente.",
                "Manter anexados os relatórios-base utilizados para cálculo de folha e encargos.",
            ]
        for item in rejected_report_guardrails[:3]:
            recommendations.append(f"Evitar recorrência observada em reprovados similares: {item}")

        blocking_issues = bool(missing_required or documentos_sem_texto)
        if any(
            "aparece no controle de jornada" in str(item).lower()
            or "documento sem texto extraível" in str(item).lower()
            for item in [*alerts, *avisos_pendencias.get("itens", [])]
        ):
            blocking_issues = True
        if rejected_report_guardrails and (alerts or avisos_pendencias.get("itens")):
            blocking_issues = True

        summary_lines = [
            "**PARECER PESSOAL**",
            "",
            f"**Cliente:** {cabecalho.get('clienteNome') or metadata.get('cliente_nome') or 'N/D'}",
            f"**Competência:** {cabecalho.get('competencia') or metadata.get('competencia') or 'N/D'}",
            f"**CNPJ:** {cabecalho.get('clienteCnpj') or metadata.get('cliente_cnpj') or 'N/D'}",
            "",
            "**1. Resumo Executivo**",
            f"- Documentos analisados: {len(documentos_recebidos)}.",
            f"- Pagamentos/encargos estruturados: {len(pagamentos)} item(ns).",
            f"- Jornada estruturada: {len(jornadas)} colaborador(es).",
            f"- Eventos identificados: {len(ferias) + len(admissoes) + len(desligamentos) + len(afastamentos)}.",
            "",
            "**2. Achados de Folha e Encargos**",
            f"- {valores_pagamento.get('observacoes') or 'Sem consolidação financeira adicional.'}",
            f"- {valores_pagamento.get('conferenciaIRRF') or 'Sem apontamentos adicionais de IRRF.'}",
        ]

        if jornadas:
            jornada_resumo = controle_jornada.get("resumo", {})
            summary_lines.extend(
                [
                    "",
                    "**3. Achados de Jornada / Ponto**",
                    (
                        f"- Total de horas mapeadas: {jornada_resumo.get('totalHorasTrabalhadas') or '0:00'}; "
                        f"horas extras: {jornada_resumo.get('totalHorasExtras') or '0:00'}."
                    ),
                    f"- Método de controle: {controle_jornada.get('metodo') or 'não identificado'}.",
                ]
            )

        pendencias = list(avisos_pendencias.get("itens", []))
        summary_issues = _merge_summary_issues(pendencias, alerts)
        if summary_issues:
            summary_lines.extend(["", "**4. Pendências e Inconsistências**"])
            for item in summary_issues[:6]:
                summary_lines.append(f"- {item}")

        if recommendations:
            summary_lines.extend(["", "**5. Recomendações Objetivas**"])
            for item in recommendations[:4]:
                summary_lines.append(f"- {item}")

        summary_lines.extend(
            [
                "",
                "**6. Conclusão**",
                parecer_tecnico.get("conclusao")
                or "Os documentos permitem compor o parecer pessoal, mas os pontos de atenção destacados devem ser conciliados antes da aprovação final.",
            ]
        )
        summary_text = "\n".join(summary_lines).strip()

        step = AgentStep(
            agent_name="personal_agent",
            action="generate_personal_summary",
            result={
                "summary_length": len(summary_text),
                "documents_processed": len(documentos_recebidos),
            },
        )

        structured_report["comentarios"] = {
            **structured_report.get("comentarios", {}),
            "agente": summary_text,
        }
        structured_report["auditoriaReprovados"] = {
            "casosSimilares": rejected_report_insights.get("matches", []),
            "guardrails": rejected_report_guardrails,
            "gruposPorTipo": rejected_report_insights.get("type_groups", []),
            "tipoConsulta": rejected_report_insights.get("corpus_type"),
            "quantidadeCorpus": rejected_report_insights.get("corpus_size", 0),
            "revisaoObrigatoria": blocking_issues,
        }

        return {
            "steps": [step],
            "domain_data": {
                **structured_report,
                "step": "generate_personal_summary",
                "agent": "personal",
                "status": "pending" if blocking_issues else "complete",
                "tipo_parecer": "pessoal",
                "is_valid": is_valid,
                "personal_summary": summary_text,
                "recommendations": recommendations,
                "alertas": alerts,
                "documentos_recebidos": documentos_recebidos,
                "documentos_por_tipo": documentos_por_tipo,
                "documentos_sem_texto": documentos_sem_texto,
                "documentos_analisados": len(documentos_recebidos),
                "missing_required_documents": missing_required,
                "rejected_report_guardrails": rejected_report_guardrails,
                "rejected_report_matches": rejected_report_insights.get("matches", []),
                "rejected_report_type_groups": rejected_report_insights.get("type_groups", []),
                "masking_rules_applied": domain_data.get("masking_rules_applied", []),
                "competencia": cabecalho.get("competencia") or metadata.get("competencia"),
                "cliente_cnpj": cabecalho.get("clienteCnpj") or metadata.get("cliente_cnpj"),
            },
        }
    except Exception as exc:
        logger.error("❌ Erro ao gerar parecer pessoal: %s", exc)
        step = AgentStep(
            agent_name="personal_agent",
            action="generate_personal_summary",
            error=str(exc),
            result={},
        )
        return {
            "steps": [step],
            "domain_data": {
                "step": "generate_personal_summary",
                "agent": "personal",
                "status": "error",
                "tipo_parecer": "pessoal",
                "is_valid": False,
                "personal_summary": f"Erro ao gerar parecer pessoal: {exc}",
                "recommendations": [],
                "alertas": [str(exc)],
                "documentos_recebidos": documentos_recebidos,
                "documentos_por_tipo": documentos_por_tipo,
                "documentos_sem_texto": documentos_sem_texto,
                "documentos_analisados": len(documentos_recebidos),
                "missing_required_documents": missing_required,
                "rejected_report_guardrails": rejected_report_guardrails,
                "rejected_report_matches": rejected_report_insights.get("matches", []),
                "rejected_report_type_groups": rejected_report_insights.get("type_groups", []),
                "masking_rules_applied": domain_data.get("masking_rules_applied", []),
                "competencia": metadata.get("competencia"),
                "cliente_cnpj": metadata.get("cliente_cnpj"),
                "comentarios": {"agente": f"Erro ao gerar parecer pessoal: {exc}"},
            },
        }


def build_personal_subgraph() -> Any:
    graph = StateGraph(AgentState)
    graph.add_node("validate", validate_personal_context)
    graph.add_node("fetch", fetch_personal_data)
    graph.add_node("anonymize", anonymize_personal_data)
    graph.add_node("summary", generate_personal_summary)

    graph.add_edge(START, "validate")
    graph.add_edge("validate", "fetch")
    graph.add_edge("fetch", "anonymize")
    graph.add_edge("anonymize", "summary")
    graph.add_edge("summary", END)

    logger.info("🔨 Sub-grafo pessoal compilado para Departamento Pessoal")
    return graph.compile()


_personal_subgraph = None


async def get_personal_subgraph() -> Any:
    global _personal_subgraph
    if _personal_subgraph is None:
        _personal_subgraph = build_personal_subgraph()
    return _personal_subgraph
