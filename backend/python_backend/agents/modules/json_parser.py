"""
JSON_PARSER - Extrai JSON estruturado de respostas do LLM

Trata:
- Respostas com markdown (```json ... ```)
- Respostas com múltiplos JSONs
- Fallback para parsing robuto
- Validação de schema
"""

import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)


def extract_json_from_response(response_text: str) -> Optional[dict]:
    """
    Extrai JSON estruturado de resposta do LLM.

    Trata:
    1. JSON em bloco markdown (```json ... ```)
    2. JSON bruto direto
    3. JSON com texto antes/depois
    4. Múltiplos JSONs (retorna o primeiro válido)

    Returns:
        dict com dados estruturados ou None se parsing falhar
    """
    if not response_text:
        return None

    # Tentativa 1: Bloco markdown
    json_block_pattern = r'```(?:json)?\s*([\s\S]*?)\s*```'
    matches = re.findall(json_block_pattern, response_text)

    if matches:
        for match in matches:
            try:
                return json.loads(match.strip())
            except json.JSONDecodeError:
                continue

    # Tentativa 2: JSON direto (começa com { ou [)
    # Encontra primeira { ou [ e tenta parsear daí até o fim
    for start_char in ['{', '[']:
        idx = response_text.find(start_char)
        if idx != -1:
            # Tenta extrair JSON válido a partir deste ponto
            for end_idx in range(len(response_text), idx, -1):
                try:
                    json_str = response_text[idx:end_idx]
                    data = json.loads(json_str)
                    return data
                except json.JSONDecodeError:
                    continue

    # Tentativa 3: Busca por padrão {}
    json_pattern = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
    matches = re.findall(json_pattern, response_text)

    for match in matches:
        try:
            return json.loads(match)
        except json.JSONDecodeError:
            continue

    logger.warning("Não foi possível extrair JSON válido da resposta do LLM")
    return None


def validate_json_schema(data: dict, required_fields: list[str]) -> tuple[bool, list[str]]:
    """
    Valida se JSON contém campos obrigatórios.

    Args:
        data: dict com dados extraídos
        required_fields: lista de campos obrigatórios (suporta nested com '.')

    Returns:
        (is_valid, missing_fields)
    """
    missing = []

    for field_path in required_fields:
        # Suporta nested: "dados.fiscal.receita"
        parts = field_path.split('.')
        current = data

        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                missing.append(field_path)
                break

    return len(missing) == 0, missing


def merge_json_responses(responses: list[dict]) -> dict:
    """
    Mescla múltiplas respostas JSON estruturadas.

    Usado quando múltiplas chamadas ao LLM geram partes diferentes
    do resultado esperado.

    Args:
        responses: lista de dicts com dados extraídos

    Returns:
        dict mesclado
    """
    merged = {}

    for response in responses:
        if not response:
            continue

        for key, value in response.items():
            if key not in merged:
                merged[key] = value
            elif isinstance(value, dict) and isinstance(merged[key], dict):
                merged[key].update(value)
            elif isinstance(value, list) and isinstance(merged[key], list):
                merged[key].extend(value)
            # Último valor ganha em caso de tipo mismatch
            else:
                merged[key] = value

    return merged


def apply_defaults(data: dict, defaults: dict) -> dict:
    """
    Aplica valores padrão para campos faltantes.

    Args:
        data: dict com dados extraídos
        defaults: dict com valores padrão

    Returns:
        dict com defaults aplicados
    """
    result = {**defaults}

    for key, value in data.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = apply_defaults(value, result[key])
        else:
            result[key] = value

    return result


def format_json_for_response(data: dict, indent: int = 2) -> str:
    """Formata JSON para resposta HTTP."""
    return json.dumps(data, ensure_ascii=False, indent=indent)


# ═══════════════════════════════════════════════════════════════════════════
# PARSERS ESPECÍFICOS POR TIPO DE RELATÓRIO
# ═══════════════════════════════════════════════════════════════════════════

def parse_fiscal_response(llm_response: str) -> dict:
    """Parse específico para resposta fiscal."""
    data = extract_json_from_response(llm_response) or {}

    required_fields = [
        "regime_tributario",
        "receita_bruta",
        "impostos",
        "validacao_erros"
    ]

    is_valid, missing = validate_json_schema(data, required_fields)

    if not is_valid:
        logger.warning(f"Campos faltantes na resposta fiscal: {missing}")

    # Aplicar defaults
    defaults = {
        "regime_tributario": None,
        "receita_bruta": {"valor": 0, "formatado": "R$ 0,00"},
        "impostos": {"devido": 0, "pago": 0, "diferenca": 0},
        "validacao_erros": missing if not is_valid else [],
        "alertas": []
    }

    return apply_defaults(data, defaults)


def parse_accounting_response(llm_response: str) -> dict:
    """Parse específico para resposta contábil."""
    data = extract_json_from_response(llm_response) or {}

    required_fields = [
        "dados_empresa",
        "balanco",
        "demonstracao_resultado"
    ]

    is_valid, missing = validate_json_schema(data, required_fields)

    defaults = {
        "dados_empresa": {"cnpj": "", "razao_social": ""},
        "balanco": {"ativo": {}, "passivo": {}, "patrimonio_liquido": 0},
        "demonstracao_resultado": {
            "receita_bruta": 0,
            "receita_liquida": 0,
            "resultado_liquido": 0
        },
        "indicadores": {},
        "validacao_erros": missing if not is_valid else []
    }

    return apply_defaults(data, defaults)


def parse_personal_response(llm_response: str) -> dict:
    """Parse específico para resposta pessoal/privacidade."""
    data = extract_json_from_response(llm_response) or {}

    required_fields = [
        "dados_pessoais",
        "compliance"
    ]

    is_valid, missing = validate_json_schema(data, required_fields)

    defaults = {
        "dados_pessoais": {
            "nome_completo": "***",
            "cpf": "***.***.***-**",
            "email": "***@***",
            "telefone": "***"
        },
        "compliance": {
            "gdpr": False,
            "lgpd": False,
            "data_minimization": True,
            "anonymization_level": "High"
        },
        "masking_rules_applied": [],
        "validacao_erros": missing if not is_valid else []
    }

    return apply_defaults(data, defaults)


def parse_support_response(llm_response: str) -> dict:
    """Parse específico para resposta de suporte."""
    data = extract_json_from_response(llm_response) or {}

    required_fields = [
        "ticket",
        "problema"
    ]

    is_valid, missing = validate_json_schema(data, required_fields)

    defaults = {
        "ticket": {
            "id": "",
            "titulo": "",
            "prioridade": "media"
        },
        "problema": {
            "tipo": "duvida",
            "componente": ""
        },
        "solucoes": [],
        "validacao_erros": missing if not is_valid else []
    }

    return apply_defaults(data, defaults)


# Mapa de parsers
PARSER_MAP = {
    "fiscal": parse_fiscal_response,
    "accounting": parse_accounting_response,
    "personal": parse_personal_response,
    "support": parse_support_response,
}


def parse_response_by_type(llm_response: str, report_type: str) -> dict:
    """Faz parse da resposta usando parser específico do tipo."""
    parser = PARSER_MAP.get(report_type)

    if not parser:
        logger.warning(f"Parser desconhecido para tipo: {report_type}")
        return extract_json_from_response(llm_response) or {}

    return parser(llm_response)
