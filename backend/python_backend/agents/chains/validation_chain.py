"""
agents/chains/validation_chain.py -- Chain Reutilizavel de Validacao de Entrada

Valida dados de entrada antes de processar em qualquer agente.
Usa schema Pydantic para input/output e RunnableLambda para logica.

Uso:
    from agents.chains import create_validation_chain, ValidationInput

    chain = create_validation_chain(domain="fiscal")
    result = await chain.ainvoke(ValidationInput(
        user_id="user-123",
        messages=[HumanMessage(content="Analise meu imposto")],
        session_data={"regime_tributario": "lucro_real"},
    ))

    if result.is_valid:
        # prosseguir com processamento
    else:
        # tratar erros em result.errors
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# --- Input/Output Schemas ---------------------------------------------------

class ValidationInput(BaseModel):
    """Schema de entrada para a chain de validacao."""
    user_id: str | None = None
    messages: list[Any] = Field(default_factory=list)
    session_data: dict[str, Any] = Field(default_factory=dict)
    domain: str = "generic"
    required_fields: list[str] = Field(default_factory=list)


class ValidationOutput(BaseModel):
    """Schema de saida da chain de validacao."""
    is_valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    domain: str = "generic"
    validated_data: dict[str, Any] = Field(default_factory=dict)


# --- Domain-specific validation rules ----------------------------------------

DOMAIN_REQUIRED_FIELDS: dict[str, list[str]] = {
    "fiscal": ["user_id", "regime_tributario"],
    "accounting": ["user_id"],
    "personal": ["user_id"],
    "support": ["user_id"],
    "generic": ["user_id"],
}

DOMAIN_VALIDATION_RULES: dict[str, list[tuple[str, str]]] = {
    "fiscal": [
        ("regime_tributario", "Regime tributario nao configurado"),
    ],
    "personal": [
        ("consent", "Sem consentimento LGPD/GDPR para dados pessoais"),
    ],
    "accounting": [
        ("categoria", "Categoria contabil nao especificada"),
    ],
}


# --- Core validation logic ---------------------------------------------------

def _validate(input_data: ValidationInput) -> ValidationOutput:
    """Logica de validacao pura (sincrona, testavel)."""
    errors: list[str] = []
    warnings: list[str] = []

    # 1. Validacoes universais
    if not input_data.user_id:
        errors.append("Usuario nao identificado")

    if not input_data.messages:
        errors.append("Nenhuma mensagem fornecida")

    # 2. Campos obrigatorios por dominio
    domain = input_data.domain
    required = input_data.required_fields or DOMAIN_REQUIRED_FIELDS.get(domain, [])
    session = input_data.session_data

    for field in required:
        if field == "user_id":
            continue  # ja verificado acima
        if not session.get(field):
            errors.append(f"Campo obrigatorio faltando: {field}")

    # 3. Regras de validacao especificas por dominio
    domain_rules = DOMAIN_VALIDATION_RULES.get(domain, [])
    for field, error_msg in domain_rules:
        if field not in required and not session.get(field):
            warnings.append(error_msg)

    is_valid = len(errors) == 0

    logger.info(
        f"Validation [{domain}]: {'PASSED' if is_valid else 'FAILED'} "
        f"({len(errors)} errors, {len(warnings)} warnings)"
    )

    return ValidationOutput(
        is_valid=is_valid,
        errors=errors,
        warnings=warnings,
        domain=domain,
        validated_data={
            "user_id": input_data.user_id,
            "session": session,
            "message_count": len(input_data.messages),
        },
    )


async def _avalidate(input_data: dict | ValidationInput) -> dict:
    """Wrapper async que aceita dict ou ValidationInput, retorna dict."""
    if isinstance(input_data, dict):
        input_data = ValidationInput(**input_data)
    result = _validate(input_data)
    return result.model_dump()


# --- Chain Factory -----------------------------------------------------------

def create_validation_chain(
    domain: str = "generic",
    required_fields: list[str] | None = None,
) -> RunnableLambda:
    """
    Cria uma chain de validacao configurada para um dominio.

    Args:
        domain: Dominio de validacao (fiscal, accounting, personal, etc.)
        required_fields: Campos obrigatorios customizados (override do default)

    Returns:
        RunnableLambda que aceita dict/ValidationInput e retorna dict

    Exemplo:
        chain = create_validation_chain(domain="fiscal")
        result = await chain.ainvoke({
            "user_id": "user-123",
            "messages": [msg],
            "session_data": {"regime_tributario": "lucro_real"},
        })
    """

    async def _run(input_data: dict | ValidationInput) -> dict:
        if isinstance(input_data, dict):
            input_data.setdefault("domain", domain)
            if required_fields:
                input_data.setdefault("required_fields", required_fields)
            input_data = ValidationInput(**input_data)
        else:
            if input_data.domain == "generic" and domain != "generic":
                input_data.domain = domain
            if required_fields and not input_data.required_fields:
                input_data.required_fields = required_fields
        return await _avalidate(input_data)

    return RunnableLambda(_run).with_config({"run_name": f"validation_chain[{domain}]"})
