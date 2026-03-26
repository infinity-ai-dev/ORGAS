from __future__ import annotations

import base64
import io
import logging
import os
import re
import shutil
import subprocess
import tempfile
from collections import Counter, OrderedDict
from datetime import datetime, timezone
from typing import Any
from unicodedata import normalize

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover - fallback para ambientes sem dependência instalada
    PdfReader = None

logger = logging.getLogger(__name__)

MAX_TEXT_PER_DOCUMENT = 12000
VALUE_TOKEN_PATTERN = r"\d{1,3}(?:\.\d{3})*,\d{2}"

MONTH_ALIASES = {
    "janeiro": "01",
    "fevereiro": "02",
    "marco": "03",
    "março": "03",
    "abril": "04",
    "maio": "05",
    "junho": "06",
    "julho": "07",
    "agosto": "08",
    "setembro": "09",
    "outubro": "10",
    "novembro": "11",
    "dezembro": "12",
}

MONTH_SHORT_LABELS = {
    1: "Jan",
    2: "Fev",
    3: "Mar",
    4: "Abr",
    5: "Mai",
    6: "Jun",
    7: "Jul",
    8: "Ago",
    9: "Set",
    10: "Out",
    11: "Nov",
    12: "Dez",
}

SIMPLES_NACIONAL_TABLES: dict[str, list[dict[str, float]]] = {
    "I": [
        {"limite": 180000, "aliquota_nominal": 4.0, "deducao": 0},
        {"limite": 360000, "aliquota_nominal": 7.3, "deducao": 5940},
        {"limite": 720000, "aliquota_nominal": 9.5, "deducao": 13860},
        {"limite": 1800000, "aliquota_nominal": 10.7, "deducao": 22500},
        {"limite": 3600000, "aliquota_nominal": 14.3, "deducao": 87300},
        {"limite": 4800000, "aliquota_nominal": 19.0, "deducao": 378000},
    ],
    "II": [
        {"limite": 180000, "aliquota_nominal": 4.5, "deducao": 0},
        {"limite": 360000, "aliquota_nominal": 7.8, "deducao": 5940},
        {"limite": 720000, "aliquota_nominal": 10.0, "deducao": 13860},
        {"limite": 1800000, "aliquota_nominal": 11.2, "deducao": 22500},
        {"limite": 3600000, "aliquota_nominal": 14.7, "deducao": 85500},
        {"limite": 4800000, "aliquota_nominal": 30.0, "deducao": 720000},
    ],
    "III": [
        {"limite": 180000, "aliquota_nominal": 6.0, "deducao": 0},
        {"limite": 360000, "aliquota_nominal": 11.2, "deducao": 9360},
        {"limite": 720000, "aliquota_nominal": 13.5, "deducao": 17640},
        {"limite": 1800000, "aliquota_nominal": 16.0, "deducao": 35640},
        {"limite": 3600000, "aliquota_nominal": 21.0, "deducao": 125640},
        {"limite": 4800000, "aliquota_nominal": 33.0, "deducao": 648000},
    ],
    "IV": [
        {"limite": 180000, "aliquota_nominal": 4.5, "deducao": 0},
        {"limite": 360000, "aliquota_nominal": 9.0, "deducao": 8100},
        {"limite": 720000, "aliquota_nominal": 10.2, "deducao": 12420},
        {"limite": 1800000, "aliquota_nominal": 14.0, "deducao": 39780},
        {"limite": 3600000, "aliquota_nominal": 22.0, "deducao": 183780},
        {"limite": 4800000, "aliquota_nominal": 33.0, "deducao": 828000},
    ],
    "V": [
        {"limite": 180000, "aliquota_nominal": 15.5, "deducao": 0},
        {"limite": 360000, "aliquota_nominal": 18.0, "deducao": 4500},
        {"limite": 720000, "aliquota_nominal": 19.5, "deducao": 9900},
        {"limite": 1800000, "aliquota_nominal": 20.5, "deducao": 17100},
        {"limite": 3600000, "aliquota_nominal": 23.0, "deducao": 62100},
        {"limite": 4800000, "aliquota_nominal": 30.5, "deducao": 540000},
    ],
}


def normalize_tipo_parecer(value: str | None) -> str | None:
    raw = (value or "").strip().lower()
    if not raw:
        return None

    aliases = {
        "personal": "pessoal",
        "pessoal": "pessoal",
        "fiscal": "fiscal",
        "accounting": "contabil",
        "contabil": "contabil",
        "contábil": "contabil",
        "support": "atendimento",
        "atendimento": "atendimento",
        "generic": "generico",
        "generico": "generico",
        "genérico": "generico",
    }
    return aliases.get(raw, raw)


def normalize_document(document: dict[str, Any], index: int) -> dict[str, Any]:
    filename = (
        document.get("name")
        or document.get("filename")
        or document.get("fileName")
        or f"documento_{index + 1}"
    )
    mime_type = (
        document.get("mimeType")
        or document.get("mime_type")
        or document.get("contentType")
        or "application/octet-stream"
    )
    base64_content = (
        document.get("content")
        or document.get("base64")
        or document.get("data")
        or ""
    )
    document_type = (
        document.get("documentoTipo")
        or document.get("document_type")
        or document.get("tipo")
        or ""
    )

    return {
        "filename": str(filename),
        "mime_type": str(mime_type),
        "base64": str(base64_content),
        "document_type": str(document_type),
        "size": document.get("size"),
    }


def _decode_base64_payload(payload: str) -> bytes:
    cleaned = payload.split(",", 1)[1] if "," in payload else payload
    return base64.b64decode(cleaned, validate=False)


def _extract_pdf_text_with_pdftotext(data: bytes, *, layout: bool = False) -> str:
    pdftotext_path = shutil.which("pdftotext")
    if not pdftotext_path:
        return ""

    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_file:
            temp_file.write(data)
            temp_path = temp_file.name

        command = [pdftotext_path]
        if layout:
            command.append("-layout")
        command.extend([temp_path, "-"])

        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
        return (result.stdout or "").strip()
    except Exception as exc:
        logger.debug("Falha no pdftotext: %s", exc)
        return ""
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except OSError:
                logger.debug("Falha ao remover arquivo temporário %s", temp_path)


def _extract_pdf_text(data: bytes) -> str:
    extracted_with_poppler = _extract_pdf_text_with_pdftotext(data)
    if extracted_with_poppler:
        return extracted_with_poppler

    if PdfReader is None:
        raise RuntimeError("Dependência pypdf não instalada")

    reader = PdfReader(io.BytesIO(data))
    pages: list[str] = []

    for page in reader.pages:
        page_text = page.extract_text() or ""
        if page_text.strip():
            pages.append(page_text)

    return "\n\n".join(pages)


def extract_text_from_document(document: dict[str, Any], index: int) -> dict[str, Any]:
    normalized = normalize_document(document, index)
    base64_payload = normalized["base64"]

    if not base64_payload:
        return {
            **normalized,
            "text": "",
            "text_length": 0,
            "extraction_error": "Documento sem conteúdo base64",
        }

    try:
        raw_bytes = _decode_base64_payload(base64_payload)
        mime_type = normalized["mime_type"].lower()
        filename = normalized["filename"].lower()

        if "pdf" in mime_type or filename.endswith(".pdf"):
            text = _extract_pdf_text(raw_bytes)
        elif "xml" in mime_type or filename.endswith(".xml"):
            text = raw_bytes.decode("utf-8", errors="ignore")
        elif mime_type.startswith("text/") or filename.endswith(".txt"):
            text = raw_bytes.decode("utf-8", errors="ignore")
        else:
            text = raw_bytes.decode("utf-8", errors="ignore")

        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if len(text) > MAX_TEXT_PER_DOCUMENT:
            text = text[:MAX_TEXT_PER_DOCUMENT] + "\n\n[conteudo truncado]"

        return {
            **normalized,
            "text": text,
            "text_length": len(text),
            "extraction_error": None,
        }
    except Exception as exc:
        logger.warning("Falha ao extrair texto de %s: %s", normalized["filename"], exc)
        return {
            **normalized,
            "text": "",
            "text_length": 0,
            "extraction_error": str(exc),
        }


def sanitize_sensitive_text(text: str) -> str:
    sanitized = text or ""
    patterns = [
        (r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b", "[CPF]"),
        (r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b", "[CNPJ]"),
        (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "[EMAIL]"),
        (r"\(\d{2}\)\s*\d{4,5}-\d{4}\b", "[TELEFONE]"),
    ]
    for pattern, replacement in patterns:
        sanitized = re.sub(pattern, replacement, sanitized)
    return sanitized


def build_document_prompt_context(documents: list[dict[str, Any]]) -> str:
    chunks: list[str] = []
    for document in documents:
        excerpt = (document.get("text") or "").strip()
        if not excerpt:
            continue
        label = document.get("document_type") or "SEM_TIPO"
        chunks.append(
            "\n".join(
                [
                    f"[DOCUMENTO] {document.get('filename')}",
                    f"[TIPO] {label}",
                    "[CONTEUDO]",
                    excerpt,
                ]
            )
        )
    return "\n\n".join(chunks).strip()


def _strip_accents(value: str) -> str:
    return "".join(
        char for char in normalize("NFD", value or "") if not re.match(r"[\u0300-\u036f]", char)
    )


def _collapse_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _normalize_lookup_text(value: str) -> str:
    return _collapse_whitespace(_strip_accents(value)).upper()


def _parse_br_number(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = str(value or "").replace("R$", "").replace(".", "").replace(",", ".").strip()
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _format_br_number(value: float) -> str:
    return f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _format_br_currency(value: float) -> str:
    return f"R$ {_format_br_number(value)}"


def _format_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _format_hour_token(value: str | None) -> str:
    token = str(value or "").strip()
    if not token:
        return ""
    if ":" in token:
        parts = token.split(":", 1)
        return f"{int(parts[0])}:{parts[1].zfill(2)}" if parts[0].isdigit() else token
    if re.fullmatch(r"\d{1,4},\d{2}", token):
        hours, minutes = token.split(",", 1)
        return f"{int(hours)}:{minutes.zfill(2)}"
    return token


def _hours_token_to_minutes(value: str | None) -> int:
    token = _format_hour_token(value)
    if not token:
        return 0
    if ":" in token:
        hours_raw, minutes_raw = token.split(":", 1)
        try:
            return int(hours_raw) * 60 + int(minutes_raw)
        except ValueError:
            return 0
    return int(round(_parse_br_number(token) * 60))


def _format_minutes_as_hours(total_minutes: int) -> str:
    if total_minutes <= 0:
        return "0:00"
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours}:{minutes:02d}"


def _normalize_person_name(value: str) -> str:
    normalized = _collapse_whitespace(value)
    if not normalized:
        return ""
    return " ".join(part.capitalize() for part in normalized.split(" "))


def _append_unique(items: list[str], value: str | None):
    candidate = _collapse_whitespace(value or "")
    if candidate and candidate not in items:
        items.append(candidate)


def _resolve_employee_name(candidate: str, known_names: list[str]) -> str:
    normalized_candidate = _normalize_lookup_text(candidate)
    if not normalized_candidate:
        return candidate

    for existing in known_names:
        normalized_existing = _normalize_lookup_text(existing)
        if normalized_existing == normalized_candidate:
            return existing

    for existing in known_names:
        normalized_existing = _normalize_lookup_text(existing)
        if normalized_existing.startswith(f"{normalized_candidate} "):
            return existing
        if normalized_candidate.startswith(f"{normalized_existing} "):
            return existing

    candidate_tokens = normalized_candidate.split()
    if candidate_tokens:
        first_token = candidate_tokens[0]
        for existing in known_names:
            normalized_existing = _normalize_lookup_text(existing)
            if normalized_existing.split() and normalized_existing.split()[0] == first_token:
                return existing

    return candidate


def _employee_matches_non_jornada_profile(employee: dict[str, Any]) -> bool:
    lookup = " ".join(
        [
            _normalize_lookup_text(employee.get("cargo") or ""),
            _normalize_lookup_text(employee.get("vinculo") or ""),
        ]
    )
    return any(
        token in lookup
        for token in ("PRO-LABORE", "PRO LABORE", "DIRETOR", "SOCIO", "SOCIO ADMINISTRADOR")
    )


def _employee_has_jornada_evidence(
    employee: dict[str, Any] | None,
    point_flags: list[str] | None = None,
) -> bool:
    employee = employee or {}
    point_flags = point_flags or []

    if point_flags:
        return True

    if _employee_matches_non_jornada_profile(employee):
        return False

    return bool(
        employee.get("horas_mes")
        or employee.get("horas_extras")
        or employee.get("dias_trabalhados")
    )


def _should_include_payroll_ferias(employee: dict[str, Any]) -> bool:
    if not employee.get("ferias_periodo"):
        return False
    return not _employee_matches_non_jornada_profile(employee)


def _format_cnpj(raw_value: str) -> str | None:
    digits = re.sub(r"\D", "", raw_value or "")
    if len(digits) != 14:
        return None
    return f"{digits[:2]}.{digits[2:5]}.{digits[5:8]}/{digits[8:12]}-{digits[12:]}"


def infer_cnpj_from_documents(documents: list[dict[str, Any]]) -> str | None:
    candidates: list[str] = []
    patterns = [
        r"\b\d{2}\s*[.\s]?\s*\d{3}\s*[.\s]?\s*\d{3}\s*[/\s]?\s*\d{4}\s*[-\s]?\s*\d{2}\b",
        r"\b\d{14}\b",
    ]

    for document in documents:
        haystacks = [
            document.get("text") or "",
            _normalize_lookup_text(document.get("text") or ""),
            document.get("filename") or "",
            _normalize_lookup_text(document.get("filename") or ""),
        ]
        for haystack in haystacks:
            for pattern in patterns:
                for match in re.findall(pattern, haystack):
                    formatted = _format_cnpj(match)
                    if formatted:
                        candidates.append(formatted)

    if not candidates:
        return None

    return Counter(candidates).most_common(1)[0][0]


def _normalize_competencia(month: str, year: str) -> str | None:
    month_num = re.sub(r"\D", "", month or "").zfill(2)
    year_num = re.sub(r"\D", "", year or "")
    if len(year_num) == 2:
        year_num = f"20{year_num}"
    if len(month_num) != 2 or len(year_num) != 4:
        return None
    if not ("01" <= month_num <= "12"):
        return None
    return f"{month_num}/{year_num}"


def _parse_competencia_parts(value: str | None) -> tuple[int, int] | None:
    normalized = _normalize_competencia(*(str(value or "").split("/", 1))) if value and value.count("/") == 1 else value
    candidate = normalized or value or ""
    match = re.fullmatch(r"(?P<mes>\d{2})/(?P<ano>\d{4})", str(candidate).strip())
    if not match:
        return None
    return int(match.group("ano")), int(match.group("mes"))


def _format_competencia_label(value: str | None) -> str:
    parts = _parse_competencia_parts(value)
    if not parts:
        return value or ""
    year, month = parts
    return f"{MONTH_SHORT_LABELS.get(month, str(month).zfill(2))}/{year}"


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    total_months = year * 12 + (month - 1) + delta
    shifted_year = total_months // 12
    shifted_month = total_months % 12 + 1
    return shifted_year, shifted_month


def _month_key(year: int, month: int) -> str:
    return f"{month:02d}/{year:04d}"


def _parse_month_value_pairs(section: str) -> OrderedDict[str, float]:
    parsed: OrderedDict[str, float] = OrderedDict()
    if not section:
        return parsed

    for match in re.finditer(rf"(?P<mes>\d{{2}}/\d{{4}})\s+(?P<valor>{VALUE_TOKEN_PATTERN})", section):
        parsed[match.group("mes")] = _parse_br_number(match.group("valor"))

    return parsed


def _calculate_simples_progressive_rate(anexo: str, rbt12: float) -> dict[str, Any]:
    table = SIMPLES_NACIONAL_TABLES.get((anexo or "").upper())
    if not table or rbt12 <= 0:
        return {
            "sucesso": False,
            "aliquota_efetiva": 0.0,
            "aliquota_nominal": 0.0,
            "faixa_numero": 0,
            "deducao": 0.0,
        }

    faixa_encontrada = table[-1]
    for faixa in table:
        if rbt12 <= faixa["limite"]:
            faixa_encontrada = faixa
            break

    aliquota_nominal = faixa_encontrada["aliquota_nominal"]
    imposto_calculado = rbt12 * (aliquota_nominal / 100.0) - faixa_encontrada["deducao"]
    aliquota_efetiva = (imposto_calculado / rbt12) * 100 if rbt12 else 0.0

    return {
        "sucesso": True,
        "aliquota_efetiva": aliquota_efetiva,
        "aliquota_nominal": aliquota_nominal,
        "faixa_numero": table.index(faixa_encontrada) + 1,
        "deducao": faixa_encontrada["deducao"],
    }


def _calculate_rbt12_preceding_month(target_month: str, receitas_historicas: dict[str, float]) -> float | None:
    parts = _parse_competencia_parts(target_month)
    if not parts:
        return None

    year, month = parts
    total = 0.0
    meses_encontrados = 0
    for delta in range(12, 0, -1):
        prev_year, prev_month = _shift_month(year, month, -delta)
        key = _month_key(prev_year, prev_month)
        if key not in receitas_historicas:
            continue
        total += receitas_historicas[key]
        meses_encontrados += 1

    if meses_encontrados == 0:
        return None

    return total


def infer_competencia_from_documents(documents: list[dict[str, Any]]) -> str | None:
    candidates: list[str] = []
    numeric_patterns = [
        r"(?<!\d)(0?[1-9]|1[0-2])\s*[./-]\s*(\d{2,4})(?!\d)",
        r"(?<!\d)(\d{4})\s*[./-]\s*(0?[1-9]|1[0-2])(?!\d)",
    ]
    textual_pattern = re.compile(
        r"\b("
        + "|".join(MONTH_ALIASES.keys())
        + r")\b[\s/.-]*(de\s*)?(\d{2,4})",
        re.IGNORECASE,
    )

    for document in documents:
        haystacks = [
            document.get("text") or "",
            _normalize_lookup_text(document.get("text") or ""),
            document.get("filename") or "",
            _normalize_lookup_text(document.get("filename") or ""),
        ]
        for haystack in haystacks:
            for idx, pattern in enumerate(numeric_patterns):
                for match in re.findall(pattern, haystack):
                    if idx == 0:
                        normalized = _normalize_competencia(match[0], match[1])
                    else:
                        normalized = _normalize_competencia(match[1], match[0])
                    if normalized:
                        candidates.append(normalized)

            for month_name, _, year in textual_pattern.findall(haystack):
                month_num = MONTH_ALIASES.get(month_name.lower())
                normalized = _normalize_competencia(month_num or "", year)
                if normalized:
                    candidates.append(normalized)

    if not candidates:
        return None

    return Counter(candidates).most_common(1)[0][0]


def _extract_company_name_from_documents(documents: list[dict[str, Any]]) -> str | None:
    patterns = [
        re.compile(r"EMPRESA\s*:\s*\d+\s*-\s*(?P<nome>.+?)(?:PAGINA|CNPJ)", re.IGNORECASE | re.DOTALL),
        re.compile(r"NOME/RAZAO SOCIAL DO EMPREGADOR\s+(?P<nome>.+?)(?:PAGAR ESTE DOCUMENTO|VALOR A RECOLHER)", re.IGNORECASE | re.DOTALL),
        re.compile(r"NOME EMPRESARIAL\s*:\s*(?P<nome>[A-Z0-9 .&/\-]+)", re.IGNORECASE),
        re.compile(r"RAZAO SOCIAL\s*(?P<nome>[A-Z0-9 .&/\-]+)", re.IGNORECASE),
    ]

    candidates: list[str] = []
    for document in documents:
        haystacks = [document.get("text") or "", document.get("filename") or ""]
        for haystack in haystacks:
            for pattern in patterns:
                match = pattern.search(haystack)
                if not match:
                    continue
                candidate = _collapse_whitespace(match.group("nome"))
                if candidate:
                    candidates.append(candidate)

    if not candidates:
        return None

    return Counter(candidates).most_common(1)[0][0]


def _build_anexo_list(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    anexos: list[dict[str, Any]] = []
    for document in documents:
        anexos.append({
            "nome": document.get("filename"),
            "tipo": document.get("document_type") or "sem_tipo",
            "mimeType": document.get("mime_type"),
        })
    return anexos


def _parse_periodo_apuracao(documents: list[dict[str, Any]]) -> str | None:
    preferred_patterns = [
        re.compile(r"PERIODO\s*:\s*(\d{2}/\d{2}/\d{4})\s+A\s*(\d{2}/\d{2}/\d{4})", re.IGNORECASE),
    ]
    fallback_patterns = [
        re.compile(r"DATA\s*:\s*(\d{4}-\d{2}-\d{2})\s*[~\-]\s*(\d{4}-\d{2}-\d{2})", re.IGNORECASE),
    ]

    for patterns in (preferred_patterns, fallback_patterns):
        for document in documents:
            text = document.get("text") or ""
            normalized = _normalize_lookup_text(text)
            for pattern in patterns:
                match = pattern.search(normalized)
                if not match:
                    continue
                start, end = match.groups()
                if "-" in start:
                    start = "/".join(reversed(start.split("-")))
                    end = "/".join(reversed(end.split("-")))
                return f"{start} a {end}"
    return None


def _slice_text_between(text: str, start_pattern: str, end_pattern: str | None = None) -> str:
    start_match = re.search(start_pattern, text, re.IGNORECASE)
    if not start_match:
        return ""

    sliced = text[start_match.end():]
    if not end_pattern:
        return sliced

    end_match = re.search(end_pattern, sliced, re.IGNORECASE)
    if not end_match:
        return sliced

    return sliced[:end_match.start()]


def _extract_first_currency_after_label(
    text: str,
    label_patterns: list[str],
    *,
    window: int = 240,
) -> float:
    for label_pattern in label_patterns:
        match = re.search(
            rf"{label_pattern}[\s\S]{{0,{window}}}?(?P<value>{VALUE_TOKEN_PATTERN})",
            text,
            re.IGNORECASE,
        )
        if match:
            return _parse_br_number(match.group("value"))
    return 0.0


def _extract_first_integer_after_label(
    text: str,
    label_patterns: list[str],
    *,
    window: int = 240,
) -> int:
    for label_pattern in label_patterns:
        match = re.search(
            rf"{label_pattern}[\s\S]{{0,{window}}}?(?P<value>\d+)",
            text,
            re.IGNORECASE,
        )
        if match:
            return int(match.group("value"))
    return 0


def _extract_labeled_numeric_block(text: str, start_pattern: str, end_pattern: str | None = None) -> dict[str, str]:
    section = _slice_text_between(text, start_pattern, end_pattern)
    if not section:
        return {}

    labels: list[str] = []
    values: list[str] = []
    for raw_line in section.splitlines():
        line = _collapse_whitespace(raw_line)
        if not line:
            continue
        if line.endswith(":"):
            labels.append(line[:-1])
            continue
        if re.fullmatch(VALUE_TOKEN_PATTERN, line) or re.fullmatch(r"\d+", line):
            values.append(line)

    return {
        _normalize_lookup_text(label): value
        for label, value in zip(labels, values)
    }


def _pick_block_value(block: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        normalized_key = _normalize_lookup_text(key)
        if normalized_key in block:
            return block[normalized_key]
    return None


def _parse_payroll_rubrica_summary(text: str) -> dict[str, dict[str, Any]]:
    section = _slice_text_between(
        text,
        r"Resumo\s+por\s+Rubrica",
        r"(?:Sistema licenciado|L[ií]quido Geral:|Empresa:)",
    )
    if not section:
        return {}

    groups: list[list[str]] = []
    current_group: list[str] = []
    for raw_line in section.splitlines():
        line = _collapse_whitespace(raw_line)
        if not line:
            if current_group:
                groups.append(current_group)
                current_group = []
            continue
        current_group.append(line)
    if current_group:
        groups.append(current_group)

    if len(groups) < 3:
        return {}

    names = [line for line in groups[0] if re.match(r"^\d{3,4}\s+", line)]
    quantities = [line for line in groups[1] if re.fullmatch(VALUE_TOKEN_PATTERN, line)]
    values = [
        line for line in groups[2]
        if re.fullmatch(rf"{VALUE_TOKEN_PATTERN}\s+[PD]", line, re.IGNORECASE)
    ]

    summary: dict[str, dict[str, Any]] = {}
    for name_line, quantity, value_line in zip(names, quantities, values):
        code_match = re.match(r"^(?P<codigo>\d{3,4})\s+(?P<descricao>.+)$", name_line)
        value_match = re.match(rf"^(?P<valor>{VALUE_TOKEN_PATTERN})\s+(?P<natureza>[PD])$", value_line, re.IGNORECASE)
        if not code_match or not value_match:
            continue
        descricao = _collapse_whitespace(code_match.group("descricao"))
        summary[_normalize_lookup_text(descricao)] = {
            "codigo": code_match.group("codigo"),
            "descricao": descricao,
            "quantidade": quantity,
            "valor": _parse_br_number(value_match.group("valor")),
            "natureza": value_match.group("natureza").upper(),
        }

    return summary


def _parse_payroll_layout_metrics(text: str) -> dict[str, dict[str, Any]]:
    if not text:
        return {}

    header_pattern = re.compile(
        r"(?m)^(?:Empr\.|Contr):\s+\d+\s+(?P<nome>[A-ZÀ-Ü][A-ZÀ-Ü\s]+?)\s+Situa(?:ção|cao):"
    )
    matches = list(header_pattern.finditer(text))
    metrics: dict[str, dict[str, Any]] = {}

    for index, match in enumerate(matches):
        block_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.start():block_end]
        metrics_block = block.split("\nND:", 1)[0]
        nome = _normalize_person_name(match.group("nome"))

        horas_extras_match = re.search(
            rf"(?m)^\s*150\s+HORAS EXTRAS\s+(?P<quantidade>\d{{1,3}},\d{{2}})\s+(?P<valor>{VALUE_TOKEN_PATTERN})\s+P\b",
            metrics_block,
            re.IGNORECASE,
        )
        dias_trabalhados_match = re.search(
            rf"(?m)^\s*(?:8781\s+DIAS NORMAIS|9380\s+PRO-LABORE DIAS)\s+(?P<quantidade>\d{{1,3}},\d{{2}})\s+{VALUE_TOKEN_PATTERN}\s+P\b",
            metrics_block,
            re.IGNORECASE,
        )

        horas_extras = _format_hour_token(horas_extras_match.group("quantidade")) if horas_extras_match else ""
        horas_extras_min = _hours_token_to_minutes(horas_extras)
        valor_extras = _parse_br_number(horas_extras_match.group("valor")) if horas_extras_match else 0.0

        metrics[nome] = {
            "horas_extras": horas_extras,
            "vencimento_hora_extra": valor_extras,
            "valor_hora_extra": valor_extras / (horas_extras_min / 60) if horas_extras_min else 0.0,
            "dias_trabalhados": (
                int(round(_parse_br_number(dias_trabalhados_match.group("quantidade"))))
                if dias_trabalhados_match
                else ""
            ),
        }

    return metrics


def _parse_payroll_layout_ferias_periods(text: str) -> dict[str, tuple[str, str]]:
    if not text:
        return {}

    header_pattern = re.compile(
        r"(?m)^(?:Empr\.|Contr):\s+\d+\s+(?P<nome>[A-ZÀ-Ü][A-ZÀ-Ü\s]+?)\s+Situa(?:ção|cao):"
    )
    matches = list(header_pattern.finditer(text))
    periods: dict[str, tuple[str, str]] = {}

    for index, match in enumerate(matches):
        block_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.start():block_end]
        ferias_period_match = re.search(
            r"FERIAS DE\s*(?P<inicio>\d{2}/\d{2}/\d{4})\s*-\s*(?P<fim>\d{2}/\d{2}/\d{4})",
            _normalize_lookup_text(block),
            re.IGNORECASE,
        )
        if not ferias_period_match:
            continue
        periods[_normalize_person_name(match.group("nome"))] = ferias_period_match.groups()

    return periods


def _parse_payroll_employee_blocks(text: str, layout_text: str = "") -> list[dict[str, Any]]:
    header_pattern = re.compile(
        r"(?m)^(?P<codigo>\d+)\s+(?P<nome>[A-ZÀ-Ü][A-ZÀ-Ü\s]+)\n(?P<vinculo>[A-Za-zÀ-ÿ ]+)\n\d+\s+(?P<cargo>[A-ZÀ-Ü0-9 ()/&.\-]+)$"
    )
    detail_pattern = re.compile(
        rf"(?P<admissao>\d{{2}}/\d{{2}}/\d{{4}})\s+"
        rf"(?:(?P<horas>\d{{1,3}},\d{{2}})\s+)?"
        rf"(?P<salario>{VALUE_TOKEN_PATTERN})\s+"
        rf"(?P<deducoes>(?:{VALUE_TOKEN_PATTERN}\s+D\s+)+)"
        rf"(?P<liquido>{VALUE_TOKEN_PATTERN})\s+"
        rf"(?P<base_irrf>{VALUE_TOKEN_PATTERN})",
        re.MULTILINE,
    )

    header_matches = list(header_pattern.finditer(text))
    detail_matches = list(detail_pattern.finditer(text))
    rubrica_summary = _parse_payroll_rubrica_summary(text)
    horas_extras_resumo = rubrica_summary.get(_normalize_lookup_text("HORAS EXTRAS"))
    horas_extras_token = _format_hour_token(horas_extras_resumo.get("quantidade")) if horas_extras_resumo else ""
    valor_extras_resumo = horas_extras_resumo.get("valor", 0.0) if horas_extras_resumo else 0.0
    layout_metrics = _parse_payroll_layout_metrics(layout_text)
    layout_ferias_periods = _parse_payroll_layout_ferias_periods(layout_text)

    employees: list[dict[str, Any]] = []
    for index, header_match in enumerate(header_matches):
        detail_match = detail_matches[index] if index < len(detail_matches) else None
        block_end = header_matches[index + 1].start() if index + 1 < len(header_matches) else len(text)
        block = text[header_match.start():block_end]
        employee_name = _normalize_person_name(header_match.group("nome"))
        employee_layout_metrics = layout_metrics.get(employee_name, {})

        ferias_period_match = re.search(
            r"FERIAS DE\s*(?P<inicio>\d{2}/\d{2}/\d{4})\s*-\s*(?P<fim>\d{2}/\d{2}/\d{4})",
            _normalize_lookup_text(block),
            re.IGNORECASE,
        )
        situacao_match = re.search(r"Situa(?:ção|cao)\s*:\s*(?P<valor>[A-Za-zÀ-ÿ ]+)", block, re.IGNORECASE)
        proventos_match = re.search(
            rf"Proventos:\s*(?P<valor>{VALUE_TOKEN_PATTERN})",
            block,
            re.IGNORECASE | re.DOTALL,
        )
        descontos_match = re.search(
            rf"Descontos:\s*(?P<valor>{VALUE_TOKEN_PATTERN})",
            block,
            re.IGNORECASE | re.DOTALL,
        )
        base_inss_match = re.search(
            rf"Base INSS:\s*(?P<valor>{VALUE_TOKEN_PATTERN})",
            block,
            re.IGNORECASE | re.DOTALL,
        )
        horas_extras_match = re.search(
            rf"(?m)^\s*150\s+HORAS EXTRAS\s+(?P<quantidade>\d{{1,3}},\d{{2}})\s+(?P<valor>{VALUE_TOKEN_PATTERN})\s+P\b",
            block,
            re.IGNORECASE,
        )
        dias_trabalhados_match = re.search(
            rf"(?m)^\s*(?:8781\s+DIAS NORMAIS|9380\s+PRO-LABORE DIAS)\s+(?P<quantidade>\d{{1,3}},\d{{2}})\s+{VALUE_TOKEN_PATTERN}\s+P\b",
            block,
            re.IGNORECASE,
        )
        valor_fgts_match = re.search(
            rf"Valor FGTS:\s*(?P<valor>{VALUE_TOKEN_PATTERN})",
            block,
            re.IGNORECASE | re.DOTALL,
        )
        base_fgts_match = re.search(
            rf"Base FGTS:\s*(?P<valor>{VALUE_TOKEN_PATTERN})",
            block,
            re.IGNORECASE | re.DOTALL,
        )

        horas_mes = _format_hour_token(detail_match.group("horas")) if detail_match else ""
        salario_base = _parse_br_number(detail_match.group("salario")) if detail_match else 0.0
        horas_extras = (
            _format_hour_token(horas_extras_match.group("quantidade"))
            if horas_extras_match
            else (employee_layout_metrics.get("horas_extras") or (horas_extras_token if len(header_matches) <= 1 else ""))
        )
        horas_extras_min = _hours_token_to_minutes(horas_extras)
        valor_extras = (
            _parse_br_number(horas_extras_match.group("valor"))
            if horas_extras_match
            else (
                employee_layout_metrics.get("vencimento_hora_extra", 0.0)
                or (valor_extras_resumo if len(header_matches) <= 1 else 0.0)
            )
        )
        valor_hora_base = salario_base / _parse_br_number(detail_match.group("horas") or 0) if detail_match and _parse_br_number(detail_match.group("horas") or 0) else 0.0
        valor_hora_extra = (
            employee_layout_metrics.get("valor_hora_extra", 0.0)
            or (valor_extras / (horas_extras_min / 60) if horas_extras_min else 0.0)
        )
        dias_trabalhados = (
            int(round(_parse_br_number(dias_trabalhados_match.group("quantidade"))))
            if dias_trabalhados_match
            else employee_layout_metrics.get("dias_trabalhados", "")
        )
        descontos = (
            sum(_parse_br_number(token) for token in re.findall(VALUE_TOKEN_PATTERN, detail_match.group("deducoes")))
            if detail_match
            else 0.0
        )

        employees.append({
            "codigo": header_match.group("codigo"),
            "nome": employee_name,
            "cargo": _collapse_whitespace(header_match.group("cargo")),
            "situacao": _collapse_whitespace(situacao_match.group("valor")) if situacao_match else "",
            "vinculo": _collapse_whitespace(header_match.group("vinculo")),
            "admissao": detail_match.group("admissao") if detail_match else "",
            "horas_mes": horas_mes,
            "salario_base_mensal": salario_base,
            "valor_hora_base": valor_hora_base,
            "horas_extras": horas_extras,
            "valor_hora_extra": valor_hora_extra,
            "vencimento_hora_extra": valor_extras,
            "dias_trabalhados": dias_trabalhados,
            "proventos": _parse_br_number(proventos_match.group("valor")) if proventos_match else salario_base,
            "descontos": descontos if detail_match else (_parse_br_number(descontos_match.group("valor")) if descontos_match else 0.0),
            "liquido": _parse_br_number(detail_match.group("liquido")) if detail_match else 0.0,
            "base_inss": _parse_br_number(base_inss_match.group("valor")) if base_inss_match else 0.0,
            "base_fgts": _parse_br_number(base_fgts_match.group("valor")) if base_fgts_match else 0.0,
            "valor_fgts": _parse_br_number(valor_fgts_match.group("valor")) if valor_fgts_match else 0.0,
            "base_irrf": _parse_br_number(detail_match.group("base_irrf")) if detail_match else 0.0,
            "ferias_periodo": layout_ferias_periods.get(employee_name) or (ferias_period_match.groups() if ferias_period_match else None),
        })

    return employees


def _parse_payroll_summary(text: str) -> dict[str, Any]:
    total_proventos = _extract_first_currency_after_label(
        text,
        [r"Total\s+Geral\s+Proventos\s*:"],
        window=120,
    )

    descontos_section = _slice_text_between(
        text,
        r"Total\s+Geral\s+Descontos\s*:",
        r"Resumo\s+por\s+Rubrica",
    )
    descontos_section_values = re.findall(VALUE_TOKEN_PATTERN, descontos_section)
    total_descontos = _parse_br_number(descontos_section_values[-2]) if len(descontos_section_values) >= 2 else 0.0
    liquido_geral = _parse_br_number(descontos_section_values[-1]) if descontos_section_values else 0.0

    inss_block = _extract_labeled_numeric_block(
        text,
        r"(?m)^INSS\s*$",
        r"(?m)^IRRF\s+conforme\s+compet[eê]ncia\s+do\s+c[aá]lculo\s*$",
    )
    irrf_calc_block = _extract_labeled_numeric_block(
        text,
        r"(?m)^IRRF\s+conforme\s+compet[eê]ncia\s+do\s+c[aá]lculo\s*$",
        r"(?m)^IRRF\s+conforme\s+compet[eê]ncia\s+do\s+pagamento\s*$",
    )

    total_inss = _parse_br_number(_pick_block_value(inss_block, "Total INSS") or 0)
    total_fgts_candidates = [
        _parse_br_number(_pick_block_value(irrf_calc_block, "Valor do FGTS") or 0),
        _extract_first_currency_after_label(
            text,
            [
                r"Valor\s+do\s+FGTS\s*:",
                r"Valor\s+FGTS\s*:",
                r"Total\s+FGTS\s*:",
                r"Valor\s+a\s+recolher",
                r"Total\s+da\s+Guia\s*:",
            ],
            window=120,
        ),
    ]
    total_irrf = _parse_br_number(_pick_block_value(irrf_calc_block, "Valor Total do IRRF") or 0)
    empregados = max(
        _extract_first_integer_after_label(text, [r"No\.\s*Empregados\s*:"], window=200),
        int(_pick_block_value(irrf_calc_block, "No. Empregados") or 0),
    )
    contribuintes = _extract_first_integer_after_label(
        text,
        [r"No\.\s*Contribuintes\s*:"],
        window=200,
    )
    rubrica_summary = _parse_payroll_rubrica_summary(text)
    horas_extras_item = rubrica_summary.get(_normalize_lookup_text("HORAS EXTRAS"))

    return {
        "total_proventos": total_proventos,
        "total_descontos": total_descontos,
        "liquido_geral": liquido_geral,
        "total_inss": total_inss,
        "total_fgts": max(total_fgts_candidates),
        "total_irrf": total_irrf,
        "empregados": empregados,
        "contribuintes": contribuintes,
        "total_horas_extras": _format_hour_token(horas_extras_item.get("quantidade")) if horas_extras_item else "",
        "total_valor_horas_extras": horas_extras_item.get("valor", 0.0) if horas_extras_item else 0.0,
    }


def _parse_irrf_bases(text: str) -> dict[str, Any]:
    bases: OrderedDict[str, list[str]] = OrderedDict()
    name_type_patterns = [
        re.compile(
            r"(?m)^\s*\d+\s+(?P<nome>[A-ZÀ-Ü\s]+?)\s*$\n(?P<tipo>Mensal\s+\d{2}/\d{2}|F[eé]rias|13o\s+Integral)\s*$",
            re.IGNORECASE,
        ),
        re.compile(
            r"(?m)^\s*\d+\s+(?P<nome>[A-ZÀ-Ü\s]+?)\s+(?P<tipo>Mensal\s+\d{2}/\d{2}|F[eé]rias|13o\s+Integral)\s*$",
            re.IGNORECASE,
        ),
    ]
    for pattern in name_type_patterns:
        for match in pattern.finditer(text):
            nome = _normalize_person_name(match.group("nome"))
            item = _collapse_whitespace(match.group("tipo"))
            bases.setdefault(nome, []).append(item)

    base_total = 0.0
    total_geral_match = re.search(
        rf"Total\s+Geral\s*:.*?(?P<valor>{VALUE_TOKEN_PATTERN})",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if total_geral_match:
        base_total = _parse_br_number(total_geral_match.group("valor"))
    if base_total == 0.0:
        total_values = [
            _parse_br_number(match)
            for match in re.findall(rf"Total\s*:\s*({VALUE_TOKEN_PATTERN})", text, re.IGNORECASE | re.DOTALL)
        ]
        if total_values:
            base_total = max(total_values)
    if base_total == 0.0:
        all_values = [_parse_br_number(match) for match in re.findall(VALUE_TOKEN_PATTERN, text)]
        if all_values:
            base_total = max(all_values)

    return {
        "por_funcionario": {nome: itens for nome, itens in bases.items()},
        "base_total": base_total,
    }


def _parse_point_documents(text: str) -> dict[str, Any]:
    statuses_by_employee: OrderedDict[str, list[str]] = OrderedDict()
    period_match = re.search(
        r"Data\s*:\s*(\d{4}-\d{2}-\d{2})\s*[~\-]\s*(\d{4}-\d{2}-\d{2})",
        text,
        re.IGNORECASE,
    )

    raw_lines = [_collapse_whitespace(line) for line in text.splitlines()]
    candidate_indices: list[tuple[int, str]] = []
    status_tokens = {
        "SABADO",
        "DOMINGO",
        "FERIADO",
        "ATESTADO",
        "FERIAS",
        "COLETIVAS",
        "RECESSO",
    }
    ignored_exact = {
        "NOME :",
        "DEPT. :",
        "REGISTO DE COMPAREC.",
        "TRA. NO. :",
    }

    def is_valid_employee_line(line: str) -> bool:
        normalized_line = _normalize_lookup_text(line)
        tokens = [token for token in normalized_line.split() if token]
        if not line or normalized_line in ignored_exact:
            return False
        if any(char.isdigit() for char in line):
            return False
        if line.upper().startswith(("CNPJ", "DATA", "UROPELV", "NOT SET")):
            return False
        if not re.fullmatch(r"[A-Za-zÀ-ÿ\s]+", line):
            return False
        if len(line.split()) > 4:
            return False
        if tokens and all(token in status_tokens for token in tokens):
            return False
        return True

    seen_indexes: set[int] = set()
    for index, line in enumerate(raw_lines):
        if not _normalize_lookup_text(line).startswith("NOME"):
            continue
        for offset in range(1, 6):
            candidate_index = index + offset
            if candidate_index >= len(raw_lines):
                break
            candidate_line = raw_lines[candidate_index]
            if not is_valid_employee_line(candidate_line):
                continue
            candidate_indices.append((candidate_index, _normalize_person_name(candidate_line)))
            seen_indexes.add(candidate_index)
            break

    for index, line in enumerate(raw_lines):
        if index in seen_indexes or not is_valid_employee_line(line):
            continue
        candidate_indices.append((index, _normalize_person_name(line)))

    candidate_indices.sort(key=lambda item: item[0])

    for current_index, (line_index, nome) in enumerate(candidate_indices):
        next_index = candidate_indices[current_index + 1][0] if current_index + 1 < len(candidate_indices) else len(raw_lines)
        block_text = "\n".join(raw_lines[line_index:next_index])
        statuses: list[str] = []
        normalized_block = _normalize_lookup_text(block_text)
        if "ATESTADO" in normalized_block:
            _append_unique(statuses, "Atestado")
        if "FERIAS" in normalized_block or "COLETIVAS" in normalized_block:
            _append_unique(statuses, "Férias coletivas")
        if "RECESSO" in normalized_block:
            _append_unique(statuses, "Recesso")
        statuses_by_employee[nome] = statuses

    periodo = None
    if period_match:
        start, end = period_match.groups()
        periodo = f"{'/'.join(reversed(start.split('-')))} a {'/'.join(reversed(end.split('-')))}"

    return {
        "employees": statuses_by_employee,
        "periodo": periodo,
    }


def _parse_ferias_programacao(text: str) -> list[str]:
    events: list[str] = []
    for raw_line in text.splitlines():
        line = _collapse_whitespace(raw_line)
        if not line:
            continue
        normalized = _normalize_lookup_text(line)
        if not re.match(r"^\d+\s+[A-Z\s]+\s+\d{2}/\d{2}/\d{4}", normalized):
            continue
        match = re.search(
            r"^\d+\s+(?P<nome>[A-Z\s]+?)\s+\d{2}/\d{2}/\d{4}\s+\d{2}/\d{2}/\d{4}.*?\s(?P<dias_dir>\d+)\s+(?P<dias_goz>\d+)\s+(?P<dias_rest>\d+)\s+(?P<limite>\d{2}/\d{2}/\d{4})",
            normalized,
            re.IGNORECASE,
        )
        if not match:
            continue
        nome = _normalize_person_name(match.group("nome"))
        events.append(
            f"{nome} - {match.group('dias_goz')} dia(s) de férias gozados e {match.group('dias_rest')} restante(s); limite para gozo em {match.group('limite')}"
        )
    return events


def _normalize_regime_tributario_label(value: str | None) -> str:
    normalized = _normalize_lookup_text(value or "")
    if not normalized:
        return "Não informado"
    if "SIMPLES" in normalized and "FATOR" in normalized:
        return "Simples Nacional - Fator R"
    if "SIMPLES" in normalized:
        return "Simples Nacional"
    if "PRESUMIDO" in normalized:
        return "Lucro Presumido"
    if "REAL" in normalized:
        return "Lucro Real"
    return _collapse_whitespace(value or "")


def _parse_fiscal_pgdas_document(text: str) -> dict[str, Any]:
    company_match = re.search(r"Nome\s+Empresarial:\s*(?P<nome>.+)", text, re.IGNORECASE)
    competencia_match = re.search(r"Per[ií]odo de Apura[cç][aã]o\s*\(PA\)\s*:\s*(?P<periodo>\d{2}/\d{4})", text, re.IGNORECASE)
    fator_match = re.search(r"Fator\s+r\s*=\s*(?P<fator>[\d.,]+)\s*-\s*Anexo\s*(?P<anexo>[IVX]+)", text, re.IGNORECASE)
    estabelecimento_match = re.search(r"CNPJ Estabelecimento:\s*(?P<cnpj>[\d./-]+)", text, re.IGNORECASE)
    municipio_match = re.search(r"Munic[ií]pio:\s*(?P<municipio>[A-ZÀ-Ü\s]+?)\s+UF:", text, re.IGNORECASE)
    tributos_section = _slice_text_between(
        text,
        r"Valor do D[eé]bito por Tributo para a Atividade",
        r"Parcela\s+1",
    )
    tributos: OrderedDict[str, float] = OrderedDict()
    tax_labels = {
        "IRPJ",
        "CSLL",
        "COFINS",
        "PIS/PASEP",
        "INSS/CPP",
        "ICMS",
        "IPI",
        "ISS",
        "TOTAL",
    }
    tributos_lines = [_collapse_whitespace(line) for line in tributos_section.splitlines() if _collapse_whitespace(line)]
    for index, line in enumerate(tributos_lines[:-1]):
        normalized_line = _normalize_lookup_text(line)
        if normalized_line not in tax_labels:
            continue
        next_line = tributos_lines[index + 1]
        if not re.fullmatch(VALUE_TOKEN_PATTERN, next_line):
            continue
        tributos[line] = _parse_br_number(next_line)

    receitas_section = _slice_text_between(
        text,
        r"2\.1\s+Discriminativo de Receitas",
        r"2\.2\)",
    )
    receitas_values = re.findall(VALUE_TOKEN_PATTERN, receitas_section)
    receita_bruta_mes = _parse_br_number(receitas_values[0]) if len(receitas_values) >= 1 else 0.0
    rbt12 = _parse_br_number(receitas_values[3]) if len(receitas_values) >= 4 else 0.0
    rba = _extract_first_currency_after_label(
        text,
        [r"Receita\s+bruta\s+acumulada\s+no\s+ano-calend[aá]rio\s+corrente\s*\(RBA\)"],
        window=120,
    )

    receitas_historicas = _parse_month_value_pairs(
        _slice_text_between(
            text,
            r"2\.2\.1\)\s+Mercado Interno",
            r"2\.2\.2\)",
        )
    )
    folhas_historicas = _parse_month_value_pairs(
        _slice_text_between(
            text,
            r"2\.3\)\s+Folha\s+de\s+Sal[aá]rios\s+Anteriores\s*\(R\$\)",
            r"2\.3\.1\)",
        )
    )
    folha_anteriores = _extract_first_currency_after_label(
        text,
        [r"Total de Folhas de Sal[aá]rios Anteriores\s*\(R\$\)"],
        window=160,
    )

    return {
        "cliente_nome": _collapse_whitespace(company_match.group("nome")) if company_match else "",
        "competencia": competencia_match.group("periodo") if competencia_match else "",
        "receita_bruta_mes": receita_bruta_mes,
        "rbt12": rbt12,
        "rba": rba,
        "folha_total_12m": folha_anteriores,
        "fator_r": _parse_br_number(fator_match.group("fator")) if fator_match else 0.0,
        "anexo": fator_match.group("anexo").upper() if fator_match else "",
        "estabelecimento_cnpj": _format_cnpj(estabelecimento_match.group("cnpj")) if estabelecimento_match else None,
        "municipio": _collapse_whitespace(municipio_match.group("municipio")) if municipio_match else "",
        "receitas_historicas": receitas_historicas,
        "folhas_historicas": folhas_historicas,
        "tributos": tributos,
        "total": tributos.get("Total", 0.0),
    }


def _parse_fiscal_das_document(text: str) -> dict[str, Any]:
    header_match = re.search(
        r"CNPJ\s+Raz[aã]o Social\s+(?P<cnpj>\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})\s+(?P<nome>[A-Z0-9 .&/\-]+)\s+Per[ií]odo de Apura[cç][aã]o",
        _collapse_whitespace(text),
        re.IGNORECASE,
    )
    competencia_match = re.search(r"Per[ií]odo de Apura[cç][aã]o\s+(?P<competencia>[A-Za-zÀ-ÿ]+/\d{4})", _collapse_whitespace(text), re.IGNORECASE)
    collapsed = _collapse_whitespace(text)
    vencimento_match = re.search(r"Data de Vencimento\s+(?P<data>\d{2}/\d{2}/\d{4})", collapsed, re.IGNORECASE)
    if not vencimento_match:
        vencimento_match = re.search(r"Pagar este documento at[eé]\s+(?:Observa[cç][oõ]es\s+)?(?P<data>\d{2}/\d{2}/\d{4})", collapsed, re.IGNORECASE)
    vencimento = vencimento_match.group("data") if vencimento_match else ""
    if not vencimento:
        all_dates = re.findall(r"\d{2}/\d{2}/\d{4}", text)
        if all_dates:
            vencimento = all_dates[0]
    total_documento_match = re.search(r"Valor Total do Documento\s+(?P<valor>[\d.,]+)", collapsed, re.IGNORECASE)

    breakdown: OrderedDict[str, float] = OrderedDict()
    for match in re.finditer(
        rf"(?P<tributo>IRPJ|CSLL|COFINS|PIS|INSS|ISS)\s+-\s+SIMPLES\s+NACIONAL\s+(?P<valor>{VALUE_TOKEN_PATTERN})",
        text,
        re.IGNORECASE,
    ):
        label = match.group("tributo").upper()
        normalized_label = "INSS/CPP" if label == "INSS" else "PIS/PASEP" if label == "PIS" else label
        breakdown[normalized_label] = _parse_br_number(match.group("valor"))

    competencia = ""
    if competencia_match:
        month_name, year = competencia_match.group("competencia").split("/")
        competencia = _normalize_competencia(MONTH_ALIASES.get(month_name.strip().lower(), month_name), year) or ""

    return {
        "cliente_nome": _collapse_whitespace(header_match.group("nome")) if header_match else "",
        "competencia": competencia,
        "vencimento": vencimento,
        "valor_total": _parse_br_number(total_documento_match.group("valor")) if total_documento_match else 0.0,
        "breakdown": breakdown,
    }


def _parse_fiscal_iss_book(text: str) -> dict[str, Any]:
    total_registros_match = re.search(r"Total Registros:\s*(?P<valor>\d+)", text, re.IGNORECASE)
    resumo_section = _slice_text_between(
        text,
        r"Quadro Resumo - Total Per[ií]odo Informado",
        r"Quadro Resumo Agosto/\d{4}",
    )
    total_docs_values = [
        _parse_br_number(match)
        for match in re.findall(r"Total Valor Docs\.\s*\(R\$\)\s*(?:R\$\s*[\d.,]+\s*){0,2}(R\$\s*[\d.,]+)?", resumo_section, re.IGNORECASE)
        if match
    ]
    all_currency_values = re.findall(r"R\$\s*([\d.,]+)", resumo_section, re.IGNORECASE)
    currency_numbers = [_parse_br_number(value) for value in all_currency_values]

    notas: list[dict[str, Any]] = []
    for raw_line in text.splitlines():
        line = _collapse_whitespace(raw_line)
        if "Nota Fiscal" not in line:
            continue
        match = re.search(
            rf"(?P<data>\d{{2}}/\d{{2}}/\d{{4}})\s+Nota Fiscal.*?\s+(?P<numero>\d+)\s+\d{{2}}\.\d{{3}}\.\d{{3}}/\d{{4}}-\d{{2}}\s+(?P<natureza>Exig[ií]vel|Cancelada)\s+R\$\s*(?P<valor>{VALUE_TOKEN_PATTERN}).*?R\$\s*(?P<imposto>{VALUE_TOKEN_PATTERN})\s*$",
            line,
            re.IGNORECASE,
        )
        if not match:
            continue
        notas.append({
            "numero": match.group("numero"),
            "data_emissao": match.group("data"),
            "natureza": _collapse_whitespace(match.group("natureza")),
            "valor": _parse_br_number(match.group("valor")),
            "imposto": _parse_br_number(match.group("imposto")),
        })

    notas_canceladas = [item for item in notas if "CANCELADA" in _normalize_lookup_text(item["natureza"])]
    notas_exigiveis = [item for item in notas if "EXIGIVEL" in _normalize_lookup_text(item["natureza"])]
    receita_cancelada = sum(item["valor"] for item in notas_canceladas)
    receita_exigivel = sum(item["valor"] for item in notas_exigiveis)
    total_documentos = sum(item["valor"] for item in notas)
    iss_exigivel = sum(item["imposto"] for item in notas_exigiveis)
    total_imposto = sum(item["imposto"] for item in notas)

    return {
        "total_registros": int(total_registros_match.group("valor")) if total_registros_match else len(notas),
        "total_imposto": total_imposto,
        "total_documentos": total_documentos,
        "base_total": total_documentos,
        "receita_exigivel": receita_exigivel,
        "iss_exigivel": iss_exigivel,
        "receita_cancelada": receita_cancelada,
        "notas": notas,
        "notas_canceladas": notas_canceladas,
        "notas_exigiveis": notas_exigiveis,
    }


def _parse_fiscal_bank_statement(text: str) -> dict[str, Any]:
    bank_match = re.search(r"Institui[cç][aã]o:\s*(?P<banco>[^,]+)", text, re.IGNORECASE)
    cnpj_match = re.search(r"CPF/CNPJ:\s*(?P<cnpj>\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2})", text, re.IGNORECASE)
    periodo_match = re.search(
        r"Per[ií]odo:\s*(?P<inicio>\d{2}/\d{2}/\d{4})\s+a\s+(?P<fim>\d{2}/\d{2}/\d{4})",
        text,
        re.IGNORECASE,
    )

    pix = 0.0
    transferencias = 0.0
    depositos = 0.0
    vendas_cartao = 0.0
    outros_creditos = 0.0
    qtd_pix = 0
    qtd_transferencias = 0
    qtd_depositos = 0
    qtd_cartao = 0
    pagamentos_identificados: list[dict[str, Any]] = []

    card_tokens = (
        "STONE",
        "CIELO",
        "REDE",
        "GETNET",
        "PAGBANK",
        "PAGSEGURO",
        "MERCADO PAGO",
        "MERCADOPAGO",
        "SUMUP",
        "CARTAO",
    )

    for raw_line in text.splitlines():
        line = _collapse_whitespace(raw_line)
        if not line:
            continue
        normalized = _normalize_lookup_text(line)
        if line.startswith("R$ ") or "SALDO DO DIA" in normalized or "SALDO DISPONIVEL" in normalized:
            continue

        amount_match = re.search(r"(?P<sign>-?)R\$\s*(?P<valor>[\d.,]+)", line)
        if not amount_match:
            continue

        signed_value = _parse_br_number(amount_match.group("valor"))
        is_outgoing = amount_match.group("sign") == "-"

        if is_outgoing:
            if any(token in normalized for token in ("SIMPLES NACIONAL", "DOCUMENTO DE ARRECADACAO", "DAS", "DARF")):
                pagamentos_identificados.append({
                    "descricao": line,
                    "valor": signed_value,
                })
            continue

        if "PIX RECEB" in normalized:
            pix += signed_value
            qtd_pix += 1
        elif any(token in normalized for token in ("TRANSFERENCIA RECEBIDA", "TED RECEBIDA", "DOC RECEBIDA")):
            transferencias += signed_value
            qtd_transferencias += 1
        elif "DEPOSITO" in normalized:
            depositos += signed_value
            qtd_depositos += 1
        elif any(token in normalized for token in card_tokens):
            vendas_cartao += signed_value
            qtd_cartao += 1
        else:
            outros_creditos += signed_value

    if outros_creditos > 0:
        depositos += outros_creditos
        qtd_depositos += 1

    total_movimento = vendas_cartao + pix + transferencias + depositos

    return {
        "banco": _collapse_whitespace(bank_match.group("banco")) if bank_match else "Não identificado",
        "cnpj": cnpj_match.group("cnpj") if cnpj_match else "",
        "periodo": (
            f"{periodo_match.group('inicio')} a {periodo_match.group('fim')}"
            if periodo_match
            else ""
        ),
        "movimento": {
            "vendas_cartao": vendas_cartao,
            "pix": pix,
            "transferencias": transferencias,
            "depositos": depositos,
            "total": total_movimento,
            "qtd_pix": qtd_pix,
            "qtd_transferencias": qtd_transferencias,
            "qtd_depositos": qtd_depositos,
            "qtd_cartao": qtd_cartao,
        },
        "pagamentos_identificados": pagamentos_identificados,
    }


def _build_fiscal_history(
    *,
    competencia: str,
    anexo: str,
    receita_bruta_mes: float,
    imposto_devido: float,
    payroll_competencia: float,
    receitas_historicas: OrderedDict[str, float],
    folhas_historicas: OrderedDict[str, float],
) -> dict[str, Any]:
    competencia_parts = _parse_competencia_parts(competencia)
    if not competencia_parts:
        return {
            "meses": [],
            "totais": {},
            "indicadores": {},
            "alertas": [{
                "tipo": "SEM_DADOS_HISTORICOS",
                "mensagem": "Competência não identificada para montagem da tabela mensal.",
                "nivel": "error",
            }],
        }

    year, current_month = competencia_parts
    receitas_base = OrderedDict(receitas_historicas)
    receitas_base[competencia] = receita_bruta_mes

    meses_processados: list[dict[str, Any]] = []
    alertas: list[dict[str, Any]] = []

    total_faturamento = 0.0
    total_impostos = 0.0
    total_folha = 0.0
    total_compras = 0.0
    total_lucro = 0.0

    for month in range(1, current_month + 1):
        month_key = _month_key(year, month)
        faturamento = receitas_base.get(month_key, 0.0)
        if month_key == competencia:
            faturamento = receita_bruta_mes
        if faturamento <= 0:
            continue

        rbt12_movel = _calculate_rbt12_preceding_month(month_key, receitas_base)
        calculo = _calculate_simples_progressive_rate(anexo, rbt12_movel or 0.0)
        aliquota_mes = calculo["aliquota_efetiva"] if calculo["sucesso"] else 0.0
        imposto_mes = faturamento * (aliquota_mes / 100.0) if calculo["sucesso"] else 0.0
        fonte_imposto = "calculado" if calculo["sucesso"] else "naoCalculavel"

        if month_key == competencia and imposto_devido > 0 and not calculo["sucesso"]:
            imposto_mes = imposto_devido
            fonte_imposto = "real"
            aliquota_mes = (imposto_mes / faturamento) * 100 if faturamento else aliquota_mes

        imposto_mes = round(imposto_mes, 2)
        folha_mes = payroll_competencia if month_key == competencia and payroll_competencia > 0 else folhas_historicas.get(month_key, 0.0)
        compras_mes = 0.0
        lucro_mes = round(faturamento - imposto_mes - folha_mes - compras_mes, 2)

        total_faturamento += faturamento
        total_impostos += imposto_mes
        total_folha += folha_mes
        total_compras += compras_mes
        total_lucro += lucro_mes

        mes_item = {
            "mes": _format_competencia_label(month_key),
            "receita": {
                "valor": faturamento,
                "valorFormatado": _format_br_currency(faturamento),
            },
            "faturamento": {
                "valor": faturamento,
                "valorFormatado": _format_br_currency(faturamento),
            },
            "imposto": {
                "valor": imposto_mes,
                "valorFormatado": _format_br_currency(imposto_mes),
                "aliquota": f"{aliquota_mes:.2f}%".replace(".", ","),
                "fonte": fonte_imposto,
            },
            "impostos": {
                "valor": imposto_mes,
                "valorFormatado": _format_br_currency(imposto_mes),
                "aliquota": f"{aliquota_mes:.2f}%".replace(".", ","),
                "fonte": fonte_imposto,
            },
            "folha": {
                "valor": folha_mes,
                "valorFormatado": _format_br_currency(folha_mes),
            },
            "compras": {
                "valor": compras_mes,
                "valorFormatado": _format_br_currency(compras_mes),
            },
            "lucro": {
                "valor": lucro_mes,
                "valorFormatado": _format_br_currency(lucro_mes),
                "ehPositivo": lucro_mes >= 0,
                "cor": "#10b981" if lucro_mes >= 0 else "#dc2626",
            },
        }
        meses_processados.append(mes_item)

    if not meses_processados:
        alertas.append({
            "tipo": "SEM_DADOS_HISTORICOS",
            "mensagem": "Dados históricos não disponíveis para preencher a tabela mensal.",
            "nivel": "error",
        })

    total_faturamento = round(total_faturamento, 2)
    total_impostos = round(total_impostos, 2)
    total_folha = round(total_folha, 2)
    total_compras = round(total_compras, 2)
    total_lucro = round(total_lucro, 2)
    aliquota_media = (total_impostos / total_faturamento) * 100 if total_faturamento else 0.0

    return {
        "meses": meses_processados,
        "totais": {
            "receita": _format_br_currency(total_faturamento),
            "imposto": _format_br_currency(total_impostos),
            "folha": _format_br_currency(total_folha),
            "compras": _format_br_currency(total_compras),
            "lucro": _format_br_currency(total_lucro),
            "faturamento": {
                "valor": total_faturamento,
                "valorFormatado": _format_br_currency(total_faturamento),
            },
            "impostos": {
                "valor": total_impostos,
                "valorFormatado": _format_br_currency(total_impostos),
                "aliquotaMedia": f"{aliquota_media:.2f}%".replace(".", ","),
            },
            "folhaDetalhe": {
                "valor": total_folha,
                "valorFormatado": _format_br_currency(total_folha),
            },
            "comprasDetalhe": {
                "valor": total_compras,
                "valorFormatado": _format_br_currency(total_compras),
            },
            "lucroDetalhe": {
                "valor": total_lucro,
                "valorFormatado": _format_br_currency(total_lucro),
                "ehPositivo": total_lucro >= 0,
                "cor": "#10b981" if total_lucro >= 0 else "#dc2626",
                "margemLiquida": f"{((total_lucro / total_faturamento) * 100):.2f}%".replace(".", ",") if total_faturamento else "0,00%",
            },
        },
        "indicadores": {
            "ticketMedio": _format_br_currency(total_faturamento / len(meses_processados)) if meses_processados else "R$ 0,00",
            "margemLiquida": f"{((total_lucro / total_faturamento) * 100):.2f}%".replace(".", ",") if total_faturamento else "0,00%",
            "custoFolhaPercentual": f"{((total_folha / total_faturamento) * 100):.2f}%".replace(".", ",") if total_faturamento else "0,00%",
        },
        "alertas": alertas,
    }


def _build_fiscal_regime_comparison(
    *,
    anexo_atual: str,
    receita_bruta_mes: float,
    rbt12: float,
    folha_total_12m: float,
    imposto_atual: float,
) -> dict[str, Any] | None:
    anexo_atual = (anexo_atual or "").upper()
    if anexo_atual in {"I", "II"}:
        return None

    fator_r = (folha_total_12m / rbt12) if rbt12 else 0.0
    anexo_iii = _calculate_simples_progressive_rate("III", rbt12)
    anexo_v = _calculate_simples_progressive_rate("V", rbt12)

    aliquota_iii = anexo_iii["aliquota_efetiva"] if anexo_iii["sucesso"] else 0.0
    aliquota_v = anexo_v["aliquota_efetiva"] if anexo_v["sucesso"] else 0.0
    imposto_iii = receita_bruta_mes * (aliquota_iii / 100.0)
    imposto_v = receita_bruta_mes * (aliquota_v / 100.0)

    lucro_presumido_base = receita_bruta_mes * 0.32
    irpj = lucro_presumido_base * 0.15
    csll = lucro_presumido_base * 0.09
    pis = receita_bruta_mes * 0.0065
    cofins = receita_bruta_mes * 0.03
    iss = receita_bruta_mes * 0.05
    imposto_lp = irpj + csll + pis + cofins + iss
    aliquota_lp = (imposto_lp / receita_bruta_mes) * 100 if receita_bruta_mes else 0.0

    regimes = [
        {"nome": "Simples Nacional Anexo III", "imposto": imposto_iii, "ehAtual": anexo_atual == "III"},
        {"nome": "Simples Nacional Anexo V", "imposto": imposto_v, "ehAtual": anexo_atual == "V"},
        {"nome": "Lucro Presumido", "imposto": imposto_lp, "ehAtual": False},
    ]
    ranking = sorted(regimes, key=lambda item: item["imposto"])
    regime_mais_vantajoso = ranking[0]
    economia = imposto_atual - regime_mais_vantajoso["imposto"]

    return {
        "temDadosSuficientes": receita_bruta_mes > 0 and rbt12 > 0,
        "fatorR": {
            "valor": fator_r,
            "valorFormatado": f"{(fator_r * 100):.2f}%".replace(".", ","),
            "aplicaAnexoIII": fator_r >= 0.28,
            "textoExplicativo": (
                "Fator R >= 28%: empresa enquadrada no Anexo III"
                if fator_r >= 0.28
                else "Fator R < 28%: empresa tende ao Anexo V"
            ),
        },
        "receitaBruta12Meses": {
            "valor": rbt12,
            "valorFormatado": _format_br_currency(rbt12),
        },
        "folhaAnual": {
            "valor": folha_total_12m,
            "valorFormatado": _format_br_currency(folha_total_12m),
        },
        "simplesNacionalAnexoIII": {
            "imposto": imposto_iii,
            "impostoFormatado": _format_br_currency(imposto_iii),
            "aliquota": aliquota_iii,
            "aliquotaFormatada": f"{aliquota_iii:.2f}%".replace(".", ","),
            "anexo": "III",
            "ehRegimeAtual": anexo_atual == "III",
            "bordaDestaque": "3px solid #0284c7" if anexo_atual == "III" else "1px solid #cbd5e1",
            "textoDestaque": "✓ Regime Atual" if anexo_atual == "III" else "",
            "corDestaque": "#0284c7",
            "faixaAtual": (
                f"Faixa {anexo_iii['faixa_numero']} (Nominal: {anexo_iii['aliquota_nominal']:.1f}%, Efetiva: {aliquota_iii:.2f}%)"
                if anexo_iii["sucesso"]
                else ""
            ),
        },
        "simplesNacionalAnexoV": {
            "imposto": imposto_v,
            "impostoFormatado": _format_br_currency(imposto_v),
            "aliquota": aliquota_v,
            "aliquotaFormatada": f"{aliquota_v:.2f}%".replace(".", ","),
            "anexo": "V",
            "ehRegimeAtual": anexo_atual == "V",
            "bordaDestaque": "3px solid #0284c7" if anexo_atual == "V" else "1px solid #cbd5e1",
            "textoDestaque": "⚠️ Aplicável se Fator R < 28%" if fator_r < 0.28 else "",
            "corDestaque": "#f59e0b",
            "diferencaAnexoIII": imposto_v - imposto_iii,
            "diferencaFormatada": _format_br_currency(abs(imposto_v - imposto_iii)),
            "ehMaisCaro": imposto_v > imposto_iii,
        },
        "lucroPresumido": {
            "imposto": imposto_lp,
            "impostoFormatado": _format_br_currency(imposto_lp),
            "aliquotaEfetiva": aliquota_lp,
            "aliquotaEfetivaFormatada": f"{aliquota_lp:.2f}%".replace(".", ","),
            "presuncao": "32%",
            "composicao": "IRPJ (15%) + CSLL (9%) + PIS (0,65%) + COFINS (3%) + ISS (5%)",
            "ehMaisCaro": imposto_lp > imposto_iii,
            "diferencaSimples": imposto_lp - imposto_iii,
            "diferencaFormatada": _format_br_currency(abs(imposto_lp - imposto_iii)),
            "detalhamento": {
                "lucroPresumido": {
                    "valor": lucro_presumido_base,
                    "valorFormatado": _format_br_currency(lucro_presumido_base),
                    "calculo": f"{_format_br_currency(receita_bruta_mes)} × 32%",
                },
                "irpj": {
                    "valor": irpj,
                    "valorFormatado": _format_br_currency(irpj),
                    "aliquota": "15%",
                    "calculo": f"{_format_br_currency(lucro_presumido_base)} × 15%",
                },
                "csll": {
                    "valor": csll,
                    "valorFormatado": _format_br_currency(csll),
                    "aliquota": "9%",
                    "calculo": f"{_format_br_currency(lucro_presumido_base)} × 9%",
                },
                "pis": {
                    "valor": pis,
                    "valorFormatado": _format_br_currency(pis),
                    "aliquota": "0,65%",
                },
                "cofins": {
                    "valor": cofins,
                    "valorFormatado": _format_br_currency(cofins),
                    "aliquota": "3%",
                },
                "iss": {
                    "valor": iss,
                    "valorFormatado": _format_br_currency(iss),
                    "aliquota": "5%",
                },
            },
        },
        "analise": {
            "regimeMaisVantajoso": regime_mais_vantajoso["nome"],
            "impostoMaisVantajoso": regime_mais_vantajoso["imposto"],
            "impostoMaisVantajosoFormatado": _format_br_currency(regime_mais_vantajoso["imposto"]),
            "regimeAtual": next((item["nome"] for item in regimes if item["ehAtual"]), "Simples Nacional Anexo III"),
            "impostoAtual": imposto_atual,
            "impostoAtualFormatado": _format_br_currency(imposto_atual),
            "economia": economia,
            "economiaFormatada": _format_br_currency(abs(economia)),
            "economiaAnual": economia * 12,
            "economiaAnualFormatada": _format_br_currency(abs(economia * 12)),
            "jEstaMelhorRegime": abs(economia) < 10,
            "mensagem": (
                f"✓ A empresa já está no regime mais vantajoso ({regime_mais_vantajoso['nome']})."
                if abs(economia) < 10
                else (
                    f"⚠️ Há potencial de economia de {_format_br_currency(economia)}/mês ao migrar para {regime_mais_vantajoso['nome']}."
                    if economia > 0
                    else "✓ O regime atual já é o mais vantajoso."
                )
            ),
            "recomendacao": (
                "Manter regime tributário atual."
                if abs(economia) < 10
                else (
                    "Recomenda-se análise detalhada com contador para avaliar eventual troca de regime."
                    if economia > 50
                    else "Diferença pequena. Considerar também os impactos operacionais."
                )
            ),
        },
        "ranking": [
            {
                "posicao": index + 1,
                "regime": item["nome"],
                "imposto": item["imposto"],
                "impostoFormatado": _format_br_currency(item["imposto"]),
                "ehAtual": item["ehAtual"],
                "ehMaisVantajoso": index == 0,
            }
            for index, item in enumerate(ranking)
        ],
    }


def build_personal_report_payload(
    documents: list[dict[str, Any]],
    *,
    cliente_nome: str | None = None,
    competencia: str | None = None,
    cliente_cnpj: str | None = None,
    missing_required: list[str] | None = None,
    documentos_sem_texto: list[str] | None = None,
) -> dict[str, Any]:
    missing_required = missing_required or []
    documentos_sem_texto = documentos_sem_texto or []
    attachments = _build_anexo_list(documents)

    resolved_cliente_nome = cliente_nome or _extract_company_name_from_documents(documents) or "Cliente"
    resolved_competencia = competencia or infer_competencia_from_documents(documents) or ""
    resolved_cliente_cnpj = cliente_cnpj or infer_cnpj_from_documents(documents) or ""
    periodo_apuracao = _parse_periodo_apuracao(documents)

    payroll_employees: OrderedDict[str, dict[str, Any]] = OrderedDict()
    pagamentos: list[dict[str, Any]] = []
    ferias: list[str] = []
    admissoes: list[str] = []
    desligamentos: list[str] = []
    afastamentos: list[str] = []
    variaveis: list[str] = []
    pontos_atencao: list[str] = []
    pendencias: list[str] = []
    point_statuses: OrderedDict[str, list[str]] = OrderedDict()
    metodo_jornada = ""
    jornada_periodo = None
    irrf_base_summary: dict[str, Any] = {"por_funcionario": {}, "base_total": 0.0}
    total_inss = 0.0
    total_fgts = 0.0
    total_irrf = 0.0
    total_liquido = 0.0
    qtd_empregados = 0
    qtd_contribuintes = 0
    resumo_horas_extras_min = 0

    for document in documents:
        text = document.get("text") or ""
        if not text:
            continue

        filename = str(document.get("filename") or "")
        doc_type = str(document.get("document_type") or "").lower()
        lookup = _normalize_lookup_text(text)
        payroll_layout_text = ""

        if doc_type == "folha_pagamento" or "EXTRATO MENSAL" in lookup:
            base64_payload = str(document.get("base64") or "")
            if base64_payload and ("pdf" in str(document.get("mime_type") or "").lower() or filename.lower().endswith(".pdf")):
                try:
                    payroll_layout_text = _extract_pdf_text_with_pdftotext(
                        _decode_base64_payload(base64_payload),
                        layout=True,
                    )
                except Exception:
                    payroll_layout_text = ""

            for employee in _parse_payroll_employee_blocks(text, payroll_layout_text):
                payroll_employees[employee["nome"]] = employee

            payroll_summary = _parse_payroll_summary(text)
            total_inss = max(total_inss, payroll_summary["total_inss"])
            total_fgts = max(total_fgts, payroll_summary["total_fgts"])
            total_irrf = max(total_irrf, payroll_summary["total_irrf"])
            total_liquido = max(total_liquido, payroll_summary["liquido_geral"])
            qtd_empregados = max(qtd_empregados, payroll_summary["empregados"])
            qtd_contribuintes = max(qtd_contribuintes, payroll_summary["contribuintes"])
            resumo_horas_extras_min = max(
                resumo_horas_extras_min,
                _hours_token_to_minutes(payroll_summary.get("total_horas_extras")),
            )

        if "RELACAO DAS BASES DO IRRF" in lookup:
            parsed_irrf = _parse_irrf_bases(text)
            if parsed_irrf["base_total"] > 0:
                irrf_base_summary = parsed_irrf

        if doc_type == "consignado" or "FGTS DIGITAL" in lookup:
            fgts_total = _extract_first_currency_after_label(
                text,
                [
                    r"Valor\s+a\s+recolher",
                    r"Total\s+da\s+Guia\s*:",
                    r"Total\s+FGTS\s*:",
                ],
                window=120,
            )
            due_date_match = re.search(
                r"PAGAR ESTE DOCUMENTO ATE.*?(?P<data>\d{2}/\d{2}/\d{4})",
                lookup,
                re.IGNORECASE | re.DOTALL,
            )
            total_fgts = max(total_fgts, fgts_total)
            pagamentos.append({
                "descricao": "FGTS Digital",
                "valor": _format_br_currency(total_fgts),
                "vencimento": due_date_match.group("data") if due_date_match else "",
                "fonte": filename,
            })
            if "NAO HA INFORMACOES DE RECOLHIMENTOS DO CONSIGNADO" in lookup:
                _append_unique(pontos_atencao, "Guia do FGTS Digital sem registros de consignado.")

        if doc_type == "irrf" or "DOCUMENTO DE ARRECADACAO" in lookup:
            darf_value_match = re.search(r"VALOR TOTAL DO DOCUMENTO\s*(?P<valor>[\d.,]+)", lookup, re.IGNORECASE)
            darf_due_match = re.search(
                r"(?:PAGAR ESTE DOCUMENTO ATE|VENCIMENTO:)\s*(?P<data>\d{2}/\d{2}/\d{4})",
                lookup,
                re.IGNORECASE,
            )
            darf_total = _parse_br_number(darf_value_match.group("valor")) if darf_value_match else 0.0
            if darf_total > 0:
                total_inss = max(total_inss, darf_total)
                pagamentos.append({
                    "descricao": "DARF INSS / IRRF",
                    "valor": _format_br_currency(darf_total),
                    "vencimento": darf_due_match.group("data") if darf_due_match else "",
                    "fonte": filename,
                })

        if doc_type == "ponto" or "REGISTO DE COMPAREC" in lookup:
            metodo_jornada = metodo_jornada or "cartão de ponto"
            parsed_point = _parse_point_documents(text)
            jornada_periodo = jornada_periodo or parsed_point["periodo"]
            for raw_name, statuses in parsed_point["employees"].items():
                name = _resolve_employee_name(raw_name, list(payroll_employees.keys()))
                existing = point_statuses.get(name, [])
                for status in statuses:
                    _append_unique(existing, status)
                point_statuses[name] = existing

        if doc_type == "eventos" or "PROGRAMACAO DE FERIAS" in lookup:
            for event in _parse_ferias_programacao(text):
                _append_unique(ferias, event)

    if point_statuses:
        resolved_point_statuses: OrderedDict[str, list[str]] = OrderedDict()
        for raw_name, statuses in point_statuses.items():
            resolved_name = _resolve_employee_name(raw_name, list(payroll_employees.keys()))
            existing = resolved_point_statuses.get(resolved_name, [])
            for status in statuses:
                _append_unique(existing, status)
            resolved_point_statuses[resolved_name] = existing
        point_statuses = resolved_point_statuses

    for employee in payroll_employees.values():
        pagamentos.append({
            "descricao": f"Líquido {employee['nome']}",
            "valor": _format_br_currency(employee["liquido"]),
            "fonte": "Folha / Extrato mensal",
        })

        if employee["horas_extras"]:
            _append_unique(
                variaveis,
                f"{employee['nome']} - horas extras {employee['horas_extras']} ({_format_br_currency(employee['vencimento_hora_extra'])})",
            )

        if _should_include_payroll_ferias(employee):
            inicio, fim = employee["ferias_periodo"]
            _append_unique(ferias, f"{employee['nome']} - férias de {inicio} a {fim}")

    jornadas: list[dict[str, Any]] = []
    all_names: list[str] = []
    for name, employee in payroll_employees.items():
        if _employee_has_jornada_evidence(employee, point_statuses.get(name, [])):
            all_names.append(name)
    for name in point_statuses.keys():
        if name not in all_names:
            all_names.append(name)

    total_hours_minutes = 0
    total_extra_minutes = 0

    for name in all_names:
        payroll_data = payroll_employees.get(name, {})
        point_flags = point_statuses.get(name, [])
        if not _employee_has_jornada_evidence(payroll_data, point_flags):
            continue
        horas_trabalhadas = payroll_data.get("horas_mes") or ""
        horas_extras = payroll_data.get("horas_extras") or ""

        total_hours_minutes += _hours_token_to_minutes(horas_trabalhadas)
        total_extra_minutes += _hours_token_to_minutes(horas_extras)

        observacoes: list[str] = []
        for flag in point_flags:
            _append_unique(observacoes, flag)
        if payroll_data.get("situacao"):
            _append_unique(observacoes, f"Situação: {payroll_data['situacao']}")
        if payroll_data.get("vinculo"):
            _append_unique(observacoes, f"Vínculo: {payroll_data['vinculo']}")
        if payroll_data.get("admissao"):
            admission_competencia = payroll_data["admissao"][3:10]
            if resolved_competencia and admission_competencia == resolved_competencia:
                _append_unique(admissoes, f"{name} - admissão em {payroll_data['admissao']}")

        jornadas.append({
            "funcionario": name,
            "cargo": payroll_data.get("cargo") or "",
            "diasTrabalhados": payroll_data.get("dias_trabalhados") or 0,
            "horasTrabalhadas": horas_trabalhadas,
            "horasExtras": horas_extras,
            "atrasos": "",
            "faltas": "",
            "salarioBaseMensal": _format_br_number(payroll_data.get("salario_base_mensal", 0.0)) if payroll_data.get("salario_base_mensal") else "",
            "valorHoraBase": _format_br_number(payroll_data.get("valor_hora_base", 0.0)) if payroll_data.get("valor_hora_base") else "",
            "valorHoraExtra": _format_br_number(payroll_data.get("valor_hora_extra", 0.0)) if payroll_data.get("valor_hora_extra") else "",
            "vencimentoHoraExtra": _format_br_number(payroll_data.get("vencimento_hora_extra", 0.0)) if payroll_data.get("vencimento_hora_extra") else "",
            "observacoes": "; ".join(observacoes),
        })

        if point_flags:
            if "Atestado" in point_flags:
                _append_unique(afastamentos, f"{name} - atestado identificado no controle de jornada")
            if "Férias coletivas" in point_flags and not any(name in event for event in ferias):
                _append_unique(ferias, f"{name} - férias coletivas registradas no espelho de ponto")

        if name in point_statuses and name not in payroll_employees:
            _append_unique(
                pontos_atencao,
                f"{name} aparece no controle de jornada, mas não foi localizado na folha/extrato mensal da competência.",
            )

    if qtd_empregados == 0:
        qtd_empregados = len([item for item in jornadas if item.get("cargo")])
    if qtd_contribuintes == 0 and payroll_employees:
        qtd_contribuintes = len(
            [
                employee for employee in payroll_employees.values()
                if "CELETISTA" not in _normalize_lookup_text(employee.get("vinculo", ""))
            ]
        )
    if qtd_empregados == 0 and payroll_employees:
        qtd_empregados = len(payroll_employees) - qtd_contribuintes

    if total_irrf == 0 and irrf_base_summary["base_total"] > 0:
        _append_unique(
            pontos_atencao,
            f"Base total de IRRF identificada em {_format_br_currency(irrf_base_summary['base_total'])}, sem valor de IRRF recolhido no período.",
        )

    for filename in documentos_sem_texto:
        _append_unique(pendencias, f"Documento sem texto extraível: {filename}")

    for item in missing_required:
        _append_unique(pendencias, f"Documento obrigatório ausente: {item}")

    if jornada_periodo and not periodo_apuracao:
        periodo_apuracao = jornada_periodo
    if total_extra_minutes == 0 and resumo_horas_extras_min > 0:
        total_extra_minutes = resumo_horas_extras_min

    pagamentos_dedup: list[dict[str, Any]] = []
    seen_payments: set[tuple[str, str, str]] = set()
    for item in pagamentos:
        key = (
            str(item.get("descricao") or "").strip().lower(),
            str(item.get("valor") or "").strip(),
            str(item.get("vencimento") or "").strip(),
        )
        if key in seen_payments:
            continue
        seen_payments.add(key)
        pagamentos_dedup.append(item)

    analise_linhas = [
        f"Foram analisados {len(documents)} documento(s) da competência {resolved_competencia or 'não identificada'}.",
        (
            f"A folha mensal indica {qtd_empregados or len(payroll_employees)} empregado(s) "
            f"e {qtd_contribuintes} contribuinte(s), com líquido geral de {_format_br_currency(total_liquido)}."
            if total_liquido > 0
            else "Não foi possível consolidar o líquido geral da folha a partir dos anexos."
        ),
        (
            f"Encargos identificados: INSS/DARF {_format_br_currency(total_inss)}, "
            f"FGTS {_format_br_currency(total_fgts)} e IRRF {_format_br_currency(total_irrf)}."
            if (total_inss or total_fgts or total_irrf)
            else "Não foram identificados valores consolidados de encargos nos anexos."
        ),
    ]

    if ferias:
        analise_linhas.append(f"Eventos de férias identificados: {', '.join(ferias[:3])}.")
    if variaveis:
        analise_linhas.append(f"Variações relevantes da folha: {', '.join(variaveis[:3])}.")
    if pontos_atencao:
        analise_linhas.append(f"Pontos de atenção: {', '.join(pontos_atencao[:3])}.")

    recommendations = [
        "Conferir a conciliação entre folha mensal, DARF previdenciário e FGTS Digital da competência.",
        "Validar se todos os colaboradores presentes no ponto constam na folha e nos encargos do mês.",
        "Revisar os lançamentos de férias e horas extras antes da aprovação final do parecer.",
    ]
    if documentos_sem_texto:
        recommendations.append(
            "Reenviar os documentos sem camada de texto em PDF pesquisável para evitar perda de evidências na análise."
        )

    return {
        "tipo": "PARECER_PESSOAL",
        "competencia": resolved_competencia or None,
        "cliente_cnpj": resolved_cliente_cnpj or None,
        "dadosCabecalho": {
            "clienteNome": resolved_cliente_nome,
            "clienteCnpj": resolved_cliente_cnpj,
            "competencia": resolved_competencia,
            "periodoApuracao": periodo_apuracao or resolved_competencia,
            "dataEmissao": _format_iso_now(),
            "tipo_parecer": "pessoal",
        },
        "valoresPagamento": {
            "itens": pagamentos_dedup,
            "observacoes": (
                f"Total líquido da competência: {_format_br_currency(total_liquido)}. "
                f"INSS/DARF: {_format_br_currency(total_inss)}. FGTS: {_format_br_currency(total_fgts)}."
                if total_liquido or total_inss or total_fgts
                else ""
            ),
            "conferenciaIRRF": (
                f"Valor total de IRRF identificado na competência: {_format_br_currency(total_irrf)}."
                if irrf_base_summary["base_total"] or total_irrf
                else ""
            ),
            "conferenciaIRRFBases": (
                f"Base total de IRRF mapeada: {_format_br_currency(irrf_base_summary['base_total'])}."
                if irrf_base_summary["base_total"]
                else ""
            ),
            "analiseIA": "",
        },
        "controleJornada": {
            "metodo": metodo_jornada or "documentação de jornada",
            "documentosRecebidos": [doc["nome"] for doc in attachments if doc.get("tipo") == "ponto"],
            "pendencias": pendencias,
            "alertas": "; ".join(pontos_atencao),
            "jornadas": jornadas,
            "resumo": {
                "totalFuncionarios": len(jornadas),
                "totalHorasTrabalhadas": _format_minutes_as_hours(total_hours_minutes),
                "totalHorasExtras": _format_minutes_as_hours(total_extra_minutes),
                "totalAtrasos": "",
                "totalFaltas": "",
            },
        },
        "alteracoesMes": {
            "comparativo": {
                "mesAnterior": "",
                "mesAtual": resolved_competencia,
                "variacaoPercentual": "",
            },
            "eventos": ferias + afastamentos,
            "variaveis": variaveis,
            "observacoes": "",
        },
        "eventosDP": {
            "ferias": ferias,
            "desligamentos": desligamentos,
            "admissoes": admissoes,
            "afastamentos": afastamentos,
        },
        "consignado": {
            "temConsignado": False,
            "contratos": [],
            "observacoes": "Guia do FGTS Digital sem informações de recolhimentos do consignado.",
        },
        "pontosAtencao": {
            "itens": pontos_atencao,
            "observacoes": "",
        },
        "avisosPendencias": {
            "itens": pendencias,
            "observacoes": "",
        },
        "anexos": {
            "documentos": attachments,
        },
        "comentarios": {
            "agente": "",
            "analista": "",
        },
        "parecerTecnico": {
            "cabecalho": f"Parecer pessoal de {resolved_cliente_nome} - competência {resolved_competencia or 'N/D'}",
            "escopo": f"Análise de {len(documents)} documento(s) enviados para Departamento Pessoal.",
            "analise": analise_linhas,
            "conclusao": (
                "Os anexos permitem identificar folha, encargos e eventos principais da competência, "
                "mas os pontos de atenção listados devem ser conciliados antes da aprovação."
                if pontos_atencao or pendencias
                else "Os anexos permitem identificar folha, encargos e eventos principais sem pendências críticas aparentes."
            ),
            "recomendacoes": recommendations,
            "conformidade": {
                "status": "atencao" if pontos_atencao or pendencias else "ok",
                "itens": [
                    f"Documentos analisados: {len(documents)}",
                    f"Empregados identificados: {qtd_empregados or len(payroll_employees)}",
                    f"Contribuintes identificados: {qtd_contribuintes}",
                ],
            },
        },
        "metrics": {
            "total_liquido": total_liquido,
            "total_inss": total_inss,
            "total_fgts": total_fgts,
            "total_irrf": total_irrf,
            "base_irrf_total": irrf_base_summary["base_total"],
        },
    }


def build_fiscal_report_payload(
    documents: list[dict[str, Any]],
    *,
    cliente_nome: str | None = None,
    competencia: str | None = None,
    cliente_cnpj: str | None = None,
    regime_tributario: str | None = None,
    missing_required: list[str] | None = None,
    documentos_sem_texto: list[str] | None = None,
) -> dict[str, Any]:
    missing_required = missing_required or []
    documentos_sem_texto = documentos_sem_texto or []
    attachments = _build_anexo_list(documents)

    parsed_pgdas: dict[str, Any] = {}
    parsed_das: dict[str, Any] = {}
    parsed_iss: dict[str, Any] = {}
    parsed_folha: dict[str, Any] = {}
    parsed_banco: dict[str, Any] = {}

    for document in documents:
        text = document.get("text") or ""
        if not text:
            continue

        parser_text = text
        base64_payload = str(document.get("base64") or "")
        mime_type = str(document.get("mime_type") or "").lower()
        filename = str(document.get("filename") or "").lower()
        if base64_payload and ("pdf" in mime_type or filename.endswith(".pdf")):
            try:
                layout_text = _extract_pdf_text_with_pdftotext(
                    _decode_base64_payload(base64_payload),
                    layout=True,
                )
                if layout_text:
                    parser_text = layout_text
            except Exception:
                parser_text = text

        lookup = _normalize_lookup_text(parser_text)
        if "EXTRATO DO SIMPLES NACIONAL" in lookup:
            parsed_pgdas = _parse_fiscal_pgdas_document(parser_text)
        elif "DOCUMENTO DE ARRECADACAO DO SIMPLES NACIONAL" in lookup:
            parsed_das = _parse_fiscal_das_document(parser_text)
        elif "LIVRO DE REGISTRO ISSQN" in lookup:
            parsed_iss = _parse_fiscal_iss_book(parser_text)
        elif "EXTRATO MENSAL" in lookup:
            parsed_folha = {
                "employees": _parse_payroll_employee_blocks(text, parser_text),
                "summary": _parse_payroll_summary(parser_text),
            }
        elif "INSTITUICAO:" in lookup and "SALDO TOTAL" in lookup:
            parsed_banco = _parse_fiscal_bank_statement(parser_text)

    resolved_cliente_nome = (
        cliente_nome
        or parsed_pgdas.get("cliente_nome")
        or parsed_das.get("cliente_nome")
        or _extract_company_name_from_documents(documents)
        or "Cliente"
    )
    resolved_competencia = (
        competencia
        or parsed_pgdas.get("competencia")
        or parsed_das.get("competencia")
        or infer_competencia_from_documents(documents)
        or ""
    )
    resolved_cliente_cnpj = (
        cliente_cnpj
        or parsed_pgdas.get("estabelecimento_cnpj")
        or parsed_banco.get("cnpj")
        or infer_cnpj_from_documents(documents)
        or ""
    )
    resolved_regime = _normalize_regime_tributario_label(regime_tributario or ("Simples Nacional" if parsed_pgdas or parsed_das else None))

    receita_bruta = parsed_pgdas.get("receita_bruta_mes") or parsed_iss.get("receita_exigivel") or 0.0
    imposto_devido = parsed_das.get("valor_total") or parsed_pgdas.get("total") or parsed_iss.get("total_imposto") or 0.0
    rbt12 = parsed_pgdas.get("rbt12") or 0.0
    folha_total_12m = parsed_pgdas.get("folha_total_12m") or 0.0
    fator_r_valor = parsed_pgdas.get("fator_r") or 0.0
    fator_r_resolvido = (folha_total_12m / rbt12) if rbt12 and folha_total_12m else fator_r_valor
    anexo = parsed_pgdas.get("anexo") or ""
    vencimento = parsed_das.get("vencimento") or ""
    payroll_summary = parsed_folha.get("summary", {})
    payroll_employees = parsed_folha.get("employees", [])
    inss_folha = payroll_summary.get("total_inss") or sum(
        employee.get("descontos", 0.0) for employee in payroll_employees
    )
    tributos = parsed_das.get("breakdown") or parsed_pgdas.get("tributos") or {}
    banco = parsed_banco.get("banco") or "Não identificado"
    movimento_bancario = parsed_banco.get("movimento") or {}
    total_movimento = movimento_bancario.get("total", 0.0)
    divergencia_valor = receita_bruta - total_movimento if receita_bruta or total_movimento else 0.0
    divergencia_percentual = (divergencia_valor / receita_bruta) if receita_bruta else 0.0
    pagamentos_identificados = parsed_banco.get("pagamentos_identificados") or []
    imposto_pago = 0.0
    for pagamento in pagamentos_identificados:
        valor_pagamento = _parse_br_number(pagamento.get("valor"))
        if imposto_devido and abs(valor_pagamento - imposto_devido) <= 5:
            imposto_pago = max(imposto_pago, valor_pagamento)
    diferenca = imposto_devido - imposto_pago
    rba = parsed_pgdas.get("rba") or 0.0

    aliquota_result = _calculate_simples_progressive_rate(anexo, rbt12)
    aliquota_efetiva = (
        aliquota_result["aliquota_efetiva"]
        if aliquota_result["sucesso"]
        else (round((imposto_devido / receita_bruta) * 100, 2) if receita_bruta and imposto_devido else 0.0)
    )
    aliquota_final = (diferenca / receita_bruta) * 100 if receita_bruta else aliquota_efetiva

    historico = _build_fiscal_history(
        competencia=resolved_competencia,
        anexo=anexo or "III",
        receita_bruta_mes=receita_bruta,
        imposto_devido=imposto_devido,
        payroll_competencia=payroll_summary.get("total_proventos", 0.0),
        receitas_historicas=parsed_pgdas.get("receitas_historicas") or OrderedDict(),
        folhas_historicas=parsed_pgdas.get("folhas_historicas") or OrderedDict(),
    )
    dados_secao7 = _build_fiscal_regime_comparison(
        anexo_atual=anexo,
        receita_bruta_mes=receita_bruta,
        rbt12=rbt12,
        folha_total_12m=folha_total_12m,
        imposto_atual=imposto_devido,
    )

    notas_canceladas = [str(item.get("numero")) for item in parsed_iss.get("notas_canceladas", []) if item.get("numero")]
    notas_canceladas_texto = ", ".join(notas_canceladas)
    status_nfse = (
        f"REGULAR - {len(notas_canceladas)} nota(s) cancelada(s): {notas_canceladas_texto}"
        if notas_canceladas
        else ("REGULAR" if parsed_iss.get("total_registros") else "SEM MOVIMENTO")
    )
    interpretacao_movimento = (
        "Movimento financeiro em conformidade com o faturamento declarado."
        if abs(divergencia_valor) <= 50
        else (
            "O movimento financeiro ficou abaixo da receita declarada e exige conciliação."
            if divergencia_valor > 0
            else "O movimento financeiro superou a receita declarada e exige conciliação."
        )
    )

    obrigacoes_acessorias: list[str] = []
    if parsed_pgdas:
        _append_unique(obrigacoes_acessorias, f"PGDAS-D {resolved_competencia}")
    if parsed_das:
        _append_unique(obrigacoes_acessorias, f"DAS {resolved_competencia}")
    if parsed_iss:
        _append_unique(obrigacoes_acessorias, f"Livro ISSQN {resolved_competencia}")
    if parsed_folha:
        _append_unique(obrigacoes_acessorias, f"Folha / pró-labore {resolved_competencia}")
    if parsed_banco:
        _append_unique(obrigacoes_acessorias, f"Extrato bancário {resolved_competencia}")

    validation_errors: list[str] = []
    if not receita_bruta:
        validation_errors.append("Receita bruta não identificada nos documentos fiscais.")
    if not imposto_devido:
        validation_errors.append("Valor do DAS/imposto devido não identificado nos anexos.")
    for item in missing_required:
        validation_errors.append(f"Documento obrigatório ausente: {item}")
    for item in documentos_sem_texto:
        validation_errors.append(f"Documento sem texto extraível: {item}")

    risks_identified: list[str] = []
    if imposto_devido > 0 and imposto_pago == 0:
        risks_identified.append("Não foi localizado comprovante de pagamento do DAS; valor pago foi mantido em R$ 0,00.")
    if parsed_iss.get("receita_cancelada", 0) > 0:
        risks_identified.append(
            f"Foram identificados { _format_br_currency(parsed_iss['receita_cancelada']) } em notas canceladas no livro fiscal."
        )
    if fator_r_resolvido and fator_r_resolvido < 0.28:
        risks_identified.append("O fator R está abaixo da faixa usual do Anexo III e merece conferência.")
    if not tributos:
        risks_identified.append("O detalhamento por tributo do Simples Nacional não pôde ser consolidado integralmente.")
    if total_movimento and abs(divergencia_valor) > 0.01:
        risks_identified.append(
            f"Há divergência de {_format_br_currency(abs(divergencia_valor))} entre o movimento financeiro e a receita declarada."
        )

    recommendations = [
        "Conferir o DARF/DAS com o comprovante bancário antes da aprovação final do parecer.",
        "Validar a conciliação entre a receita exigível do livro ISSQN e a receita declarada no PGDAS-D.",
        "Revisar o fator R e a base de folha utilizada para manter o enquadramento tributário correto.",
    ]
    if documentos_sem_texto:
        recommendations.append(
            "Reenviar os anexos sem camada de texto em PDF pesquisável para garantir rastreabilidade da análise."
        )

    analise_linhas = [
        f"Receita bruta declarada na competência {resolved_competencia or 'N/D'}: {_format_br_currency(receita_bruta)}.",
        (
            f"O DAS emitido para a competência soma {_format_br_currency(imposto_devido)} com vencimento em {vencimento}."
            if imposto_devido and vencimento
            else f"O imposto apurado na competência soma {_format_br_currency(imposto_devido)}."
        ),
        (
            f"O extrato bancário do {banco} apresenta movimento de entrada de {_format_br_currency(total_movimento)}, "
            f"com PIX de {_format_br_currency(movimento_bancario.get('pix', 0.0))} e transferências de {_format_br_currency(movimento_bancario.get('transferencias', 0.0))}."
            if total_movimento
            else "Não foi possível consolidar o movimento financeiro do extrato bancário enviado."
        ),
        (
            f"O PGDAS-D indica RBT12 de {_format_br_currency(rbt12)} e fator R de {((fator_r_resolvido or 0.0) * 100):.2f}% ({anexo})."
            if rbt12 or fator_r_resolvido
            else "Os anexos fiscais não trouxeram RBT12/fator R suficientes para comparação."
        ),
        (
            f"O livro fiscal apresenta receita exigível de {_format_br_currency(parsed_iss.get('receita_exigivel', 0.0))} "
            f"e ISS de {_format_br_currency(parsed_iss.get('iss_exigivel', 0.0))}."
            if parsed_iss
            else "Não foi localizado livro fiscal com resumo de ISS no pacote analisado."
        ),
    ]
    if payroll_summary.get("total_proventos"):
        analise_linhas.append(
            f"A folha/pró-labore da competência totaliza {_format_br_currency(payroll_summary['total_proventos'])}, "
            f"com INSS de {_format_br_currency(inss_folha)}."
        )
    if risks_identified:
        analise_linhas.append(f"Pontos de atenção: {', '.join(risks_identified[:3])}.")

    conclusao = (
        "Os documentos fiscais permitem recompor a apuração da competência, mas a aprovação deve considerar os alertas de conciliação e pagamento listados."
        if risks_identified or validation_errors
        else "Os anexos permitem recompor a apuração fiscal da competência sem inconsistências materiais aparentes."
    )
    compliance_analysis = " ".join(analise_linhas)
    fiscal_opinion = "\n".join(
        [
            f"Parecer fiscal de {resolved_cliente_nome} - competência {resolved_competencia or 'N/D'}",
            f"Receita bruta: {_format_br_currency(receita_bruta)}.",
            f"Imposto devido (DAS): {_format_br_currency(imposto_devido)}.",
            f"Fator R / anexo: {(f'{(fator_r_resolvido * 100):.2f}%' if fator_r_resolvido else 'N/D')} {f' - Anexo {anexo}' if anexo else ''}.",
            conclusao,
        ]
    ).strip()

    estabelecimentos = [
        {
            "descricao": parsed_pgdas.get("municipio") or "Matriz",
            "cnpj": parsed_pgdas.get("estabelecimento_cnpj") or resolved_cliente_cnpj,
            "receita": receita_bruta,
            "aliquota": aliquota_efetiva,
            "imposto": imposto_devido,
        }
    ] if receita_bruta or imposto_devido else []

    documentos_acompanham = [
        {
            "nome": doc.get("filename"),
            "descricao": doc.get("filename"),
            "enviado": True,
            "icone": "✓",
        }
        for doc in documents
    ]
    documentos_analisados = [
        {
            "numero": index + 1,
            "nome": doc.get("filename"),
            "analisado": bool(doc.get("text")),
            "icone": "✓" if doc.get("text") else "✗",
            "cor": "#10b981" if doc.get("text") else "#dc2626",
        }
        for index, doc in enumerate(documents)
    ]

    observacao_partes = [
        f"A empresa {resolved_cliente_nome} é optante pelo {resolved_regime}",
    ]
    if anexo:
        observacao_partes.append(f"enquadrada no Anexo {anexo}")
    if fator_r_valor:
        observacao_partes.append("e sujeita ao Fator R")
    observacao_texto = " ".join(observacao_partes).strip()
    observacao_texto = observacao_texto.rstrip(".") + "."
    if total_movimento:
        forma_movimento: list[str] = []
        if movimento_bancario.get("vendas_cartao", 0) > 0:
            forma_movimento.append("vendas por cartão")
        if movimento_bancario.get("pix", 0) > 0:
            forma_movimento.append("PIX")
        if movimento_bancario.get("transferencias", 0) > 0:
            forma_movimento.append("transferências")
        if movimento_bancario.get("depositos", 0) > 0:
            forma_movimento.append("depósitos")
        if forma_movimento:
            if movimento_bancario.get("vendas_cartao", 0) <= 0:
                observacao_texto += f" O extrato bancário ({banco}) não detalha vendas por cartão, sendo o movimento de entrada identificado por {', '.join(forma_movimento)}."
            else:
                observacao_texto += f" O extrato bancário ({banco}) demonstra entradas por {', '.join(forma_movimento)}."
    if notas_canceladas:
        observacao_texto += f" A(s) NFSe {notas_canceladas_texto} foi(foram) cancelada(s) no período."
    if abs(divergencia_valor) > 0.01:
        observacao_texto += f" Há divergência de {_format_br_currency(abs(divergencia_valor))} entre o movimento financeiro e a receita declarada."
    if imposto_devido > 0 and imposto_pago == 0:
        observacao_texto += f" O DAS da competência {resolved_competencia or 'informada'} está pendente de comprovação de pagamento."

    return {
        "tipo": "PARECER_FISCAL",
        "competencia": resolved_competencia or None,
        "periodo": resolved_competencia or None,
        "cliente_cnpj": resolved_cliente_cnpj or None,
        "regime_tributario": resolved_regime,
        "dadosCabecalho": {
            "razaoSocial": resolved_cliente_nome,
            "cnpj": resolved_cliente_cnpj,
            "periodo": resolved_competencia,
            "regimeTributario": resolved_regime,
            "dataGeracao": _format_iso_now(),
            "dataGeracaoFormatada": _format_iso_now(),
            "tipo_parecer": "fiscal",
        },
        "receita_bruta": {
            "valor": receita_bruta,
            "formatado": _format_br_currency(receita_bruta),
            "periodo": resolved_competencia,
        },
        "impostos": {
            "devido": imposto_devido,
            "pago": imposto_pago,
            "diferenca": diferenca,
            "aliquota_efetiva": aliquota_efetiva,
            "vencimento": vencimento,
            "detalhamento": [
                {"tributo": nome, "valor": valor, "valor_formatado": _format_br_currency(valor)}
                for nome, valor in tributos.items()
            ],
        },
        "obrigacoes_acessorias": obrigacoes_acessorias,
        "dados_estabelecimentos": estabelecimentos,
        "fiscal_data": {
            "regime_tributario": resolved_regime,
            "competencia": resolved_competencia,
            "periodo": resolved_competencia,
            "receita_bruta": {
                "valor": receita_bruta,
                "formatado": _format_br_currency(receita_bruta),
                "periodo": resolved_competencia,
            },
            "receita_bruta_mes": receita_bruta,
            "simples_valor_devido": imposto_devido,
            "imposto_devido": imposto_devido,
            "imposto_pago": imposto_pago,
            "diferenca": diferenca,
            "obrigacoes_acessorias": obrigacoes_acessorias,
            "rbt12": rbt12,
            "rba": rba,
            "fator_r": fator_r_resolvido,
            "simples_anexo": anexo,
            "folha_total_12m": folha_total_12m,
            "folha_competencia": payroll_summary.get("total_proventos", 0.0),
            "inss_folha": inss_folha,
            "iss_livro": parsed_iss.get("total_imposto", 0.0),
            "documentos_fiscais": parsed_iss.get("total_registros", 0),
            "receita_cancelada": parsed_iss.get("receita_cancelada", 0.0),
            "movimento_financeiro": {
                "banco": banco,
                "total": total_movimento,
                "pix": movimento_bancario.get("pix", 0.0),
                "transferencias": movimento_bancario.get("transferencias", 0.0),
                "depositos": movimento_bancario.get("depositos", 0.0),
                "vendas_cartao": movimento_bancario.get("vendas_cartao", 0.0),
            },
        },
        "dadosSecao1": {
            "anexo": anexo,
            "totais": {
                "imposto": _format_br_currency(imposto_devido),
                "faturamento": _format_br_currency(receita_bruta),
            },
            "grafico": {
                "faturamentoAltura": 100,
                "faturamentoLabel": "100%",
                "impostoAltura": max(10, aliquota_efetiva),
                "impostoLabel": f"{aliquota_efetiva:.2f}%".replace(".", ",") if aliquota_efetiva else "0,00%",
                "aliquotaEfetivaAltura": max(10, aliquota_efetiva),
                "aliquotaEfetivaLabel": f"{aliquota_efetiva:.2f}%".replace(".", ",") if aliquota_efetiva else "0,00%",
                "aliquotaEfetivaTitulo": "Alíq. Efetiva",
                "aliquotaFinalAltura": max(10, aliquota_final),
                "aliquotaFinalLabel": f"{aliquota_final:.2f}%".replace(".", ",") if aliquota_final else "0,00%",
                "aliquotaFinalTitulo": "Alíq. Final",
                "mostrarDuasAliquotas": diferenca > 0 and abs(aliquota_final - aliquota_efetiva) > 0.01,
            },
            "imposto": {
                "valor": imposto_devido,
                "valorFormatado": _format_br_currency(imposto_devido),
                "aliquotaEfetiva": aliquota_efetiva,
                "aliquotaEfetivaFormatada": f"{aliquota_efetiva:.2f}%".replace(".", ",") if aliquota_efetiva else "0,00%",
                "aliquotaFinal": f"{aliquota_final:.2f}".replace(".", ","),
                "aliquotaFinalFormatada": f"{aliquota_final:.2f}%".replace(".", ","),
                "impostoPagar": diferenca,
                "impostoPagarFormatado": _format_br_currency(diferenca),
                "retencoes": {
                    "iss": 0,
                    "irrf": 0,
                    "pis": 0,
                    "cofins": 0,
                    "total": 0,
                },
                "totalRetido": 0,
                "totalRetidoFormatado": "R$ 0,00",
                "temRetencao": False,
            },
            "faturamento": {
                "descricao": "Receita Bruta do PA",
                "valor": receita_bruta,
                "valorFormatado": _format_br_currency(receita_bruta),
            },
            "aplicouFatorR": bool(fator_r_valor),
            "dataVencimento": vencimento,
            "estabelecimentos": [
                {
                    "descricao": estabelecimento["descricao"],
                    "cnpj": estabelecimento["cnpj"],
                    "receita": _format_br_currency(estabelecimento["receita"]),
                    "aliquota": f"{estabelecimento['aliquota']:.2f}%".replace(".", ",") if estabelecimento["aliquota"] else "0,00%",
                    "imposto": _format_br_currency(estabelecimento["imposto"]),
                    "dataVencimento": vencimento,
                }
                for estabelecimento in estabelecimentos
            ],
        },
        "dadosSecao2": {
            "temMovimento": total_movimento > 0,
            "banco": banco,
            "movimento": {
                "total": {"valor": total_movimento, "valorFormatado": _format_br_currency(total_movimento)},
                "vendasCartao": {"valor": movimento_bancario.get("vendas_cartao", 0.0), "valorFormatado": _format_br_currency(movimento_bancario.get("vendas_cartao", 0.0))},
                "pix": {
                    "valor": movimento_bancario.get("pix", 0.0),
                    "valorFormatado": _format_br_currency(movimento_bancario.get("pix", 0.0)),
                    "quantidade": movimento_bancario.get("qtd_pix", 0),
                },
                "transferencias": {
                    "valor": movimento_bancario.get("transferencias", 0.0),
                    "valorFormatado": _format_br_currency(movimento_bancario.get("transferencias", 0.0)),
                    "quantidade": movimento_bancario.get("qtd_transferencias", 0),
                },
                "depositos": {
                    "valor": movimento_bancario.get("depositos", 0.0),
                    "valorFormatado": _format_br_currency(movimento_bancario.get("depositos", 0.0)),
                    "quantidade": movimento_bancario.get("qtd_depositos", 0),
                },
            },
            "faturamentoDeclarado": {
                "valor": receita_bruta,
                "valorFormatado": _format_br_currency(receita_bruta),
            },
            "divergencia": {
                "valor": divergencia_valor,
                "valorFormatado": _format_br_currency(abs(divergencia_valor)),
                "porcentagem": divergencia_percentual,
                "porcentagemFormatada": f"{(divergencia_percentual * 100):.2f}%".replace(".", ","),
                "corTexto": "#dc2626" if divergencia_valor > 0 else "#10b981",
                "ehNegativa": divergencia_valor > 0,
            },
            "interpretacao": interpretacao_movimento,
        },
        "dadosSecao3": {
            "notasDuplicadas": {
                "mensagem": "Não foram identificadas notas fiscais duplicadas no período analisado.",
                "encontradas": False,
            },
            "notasCanceladas": notas_canceladas,
            "documentosFiscais": {
                "nfse": {
                    "quantidade": parsed_iss.get("total_registros", 0),
                    "valorFormatado": _format_br_currency(parsed_iss.get("receita_exigivel", 0.0)),
                    "valorTotalFormatado": _format_br_currency(parsed_iss.get("total_documentos", 0.0)),
                    "status": status_nfse,
                    "regular": True,
                    "notasCanceladas": notas_canceladas,
                    "quantidadeCanceladas": len(notas_canceladas),
                    "canceladas": len(notas_canceladas),
                    "observacoes": (
                        f"Foram desconsideradas {len(notas_canceladas)} nota(s) cancelada(s) do faturamento exigível."
                        if notas_canceladas
                        else "Não foram identificadas notas fiscais canceladas."
                    ),
                },
                "nfe": {"quantidade": 0, "valorFormatado": "R$ 0,00", "status": "SEM MOVIMENTO", "regular": True, "gaps": []},
                "nfce": {"quantidade": 0, "valorFormatado": "R$ 0,00", "status": "SEM MOVIMENTO", "regular": True},
                "cte": {"quantidade": 0, "valorFormatado": "R$ 0,00", "status": "SEM MOVIMENTO", "regular": True},
            },
        },
        "dadosSecao4": {
            "meses": historico.get("meses", []),
            "totais": historico.get("totais", {}),
            "alertas": [*historico.get("alertas", []), *risks_identified],
            "temDados": bool(historico.get("meses")),
            "indicadores": {
                **historico.get("indicadores", {}),
                "fatorR": f"{(fator_r_valor * 100):.2f}%".replace(".", ",") if fator_r_valor else "",
                "anexo": anexo,
            },
            "quantidadeMeses": len(historico.get("meses", [])),
        },
        "dadosSecao5": {
            "documentos": documentos_acompanham,
        },
        "dadosSecao6": {
            "resumo": {
                "total": len(documents),
                "analisados": len(documents) - len(documentos_sem_texto),
                "naoAnalisados": len(documentos_sem_texto),
            },
            "documentos": documentos_analisados,
            "rbt12": _format_br_currency(rbt12) if rbt12 else "",
            "fatorR": f"{(fator_r_resolvido * 100):.2f}%".replace(".", ",") if fator_r_resolvido else "0,00%",
        },
        "dadosSecao7": dados_secao7,
        "dadosSecao8": {
            "detalhes": {
                "empresa": resolved_cliente_nome,
                "regime": resolved_regime,
                "anexo": anexo,
                "aplicaFatorR": bool(fator_r_valor),
                "banco": banco,
                "temVendasCartao": movimento_bancario.get("vendas_cartao", 0.0) > 0,
                "notasCanceladas": notas_canceladas,
                "quantidadeNotasCanceladas": len(notas_canceladas),
                "divergenciaFinanceira": {
                    "existe": abs(divergencia_valor) > 0.01,
                    "valor": divergencia_valor,
                    "valorAbsoluto": abs(divergencia_valor),
                },
                "dasPendente": imposto_devido > 0 and imposto_pago == 0,
                "periodo": resolved_competencia,
            },
            "observacao": observacao_texto,
            "observacoes": observacao_texto,
            "categoriaParecer": "Fiscal",
            "entidades": {
                "nomes": [resolved_cliente_nome],
                "datas": [item for item in [resolved_competencia, vencimento] if item],
                "valores": [
                    _format_br_currency(receita_bruta),
                    _format_br_currency(imposto_devido),
                    _format_br_currency(parsed_iss.get("total_imposto", 0.0)),
                ],
                "ativos": [],
            },
            "recomendacoes": recommendations,
            "conformidade": {
                "status": "atencao" if risks_identified or validation_errors else "ok",
                "itens": [
                    f"Documentos analisados: {len(documents)}",
                    f"RBT12 identificado: {_format_br_currency(rbt12)}" if rbt12 else "RBT12 não identificado",
                    f"Fator R identificado: {(fator_r_resolvido * 100):.2f}%".replace(".", ",") if fator_r_resolvido else "Fator R não identificado",
                ],
            },
            "validacao": {
                "erros": validation_errors,
                "avisos": risks_identified,
                "ok": not validation_errors,
            },
            "estrutura": {
                "cabecalho": f"Parecer fiscal de {resolved_cliente_nome} - competência {resolved_competencia or 'N/D'}",
                "escopo": f"Análise de {len(documents)} documento(s) fiscais enviados.",
                "analise": analise_linhas,
                "conclusao": conclusao,
            },
        },
        "validation_errors": validation_errors,
        "validacao_erros": validation_errors,
        "risks_identified": risks_identified,
        "alertas": [{"tipo": "fiscal", "nivel": "atencao", "mensagem": item} for item in risks_identified],
        "recommendations": recommendations,
        "compliance_analysis": compliance_analysis,
        "fiscal_opinion": fiscal_opinion,
        "documentos_recebidos": [
            {
                "nome": doc.get("filename"),
                "tipo": doc.get("document_type") or "sem_tipo",
                "mime_type": doc.get("mime_type"),
                "texto_extraido": bool(doc.get("text")),
                "erro_extracao": doc.get("extraction_error"),
            }
            for doc in documents
        ],
        "documentos_sem_texto": documentos_sem_texto,
        "documentos_analisados": len(documents),
        "missing_required_documents": missing_required,
        "anexos": {"documentos": attachments},
    }
