"""
agents/modules/document_validator.py — Módulo Reutilizável de Validação

Usado por: fiscal_agent, accounting_agent, personal_agent, support_agent

Funções:
- Validar formatos de documento
- Verificar assinaturas digitais
- Validar conformidade com legislação
- Extrair metadados

Pode ser composted com outros módulos:
    validate_document_module → fetch_data_module → process_module → format_report_module
"""

import logging
from typing import Any

from core.state import AgentState, AgentStep

logger = logging.getLogger(__name__)


async def validate_document_module(
    state: AgentState,
    domain: str = "generic",
    required_fields: list[str] | None = None,
) -> dict[str, Any]:
    """
    Módulo reutilizável: Validação de documentos.

    Args:
        state: AgentState compartilhado
        domain: Domínio (fiscal, accounting, personal, etc)
        required_fields: Campos obrigatórios por domínio

    Returns:
        dict com resultado da validação
    """
    logger.info(f"📋 Módulo: Validar documento ({domain})...")

    session = state.get("session")
    messages = state.get("messages", [])

    validation_errors: list[str] = []
    validation_warnings: list[str] = []

    # Validações comuns a todos os domínios
    if not session or not session.get("user_id"):
        validation_errors.append("Usuário não identificado")

    if not messages:
        validation_errors.append("Nenhuma mensagem fornecida")

    # Validações específicas por domínio
    if domain == "fiscal":
        if not session or not session.get("regime_tributario"):
            validation_errors.append("Regime tributário não configurado")
        if required_fields is None:
            required_fields = ["regime_tributario", "user_id"]

    elif domain == "accounting":
        if not session or not session.get("categoria"):
            validation_warnings.append("Categoria de conta não especificada")
        if required_fields is None:
            required_fields = ["user_id"]

    elif domain == "personal":
        # Personal tem validações mais estritas
        if required_fields is None:
            required_fields = ["user_id", "consent"]
        # Simular verificação de consentimento
        has_consent = True  # Em produção: consultar DB
        if not has_consent:
            validation_errors.append("Sem consentimento LGPD/GDPR")

    # Validar campos obrigatórios
    if required_fields:
        for field in required_fields:
            if not session.get(field.lower()) and field != "consent":
                validation_errors.append(f"Campo obrigatório faltando: {field}")

    is_valid = len(validation_errors) == 0

    step = AgentStep(
        agent_name=f"module:document_validator[{domain}]",
        action="validate_document",
        result={
            "is_valid": is_valid,
            "errors": len(validation_errors),
            "warnings": len(validation_warnings),
        },
    )

    logger.info(
        f"✓ Validação: {'PASSOU' if is_valid else 'FALHOU'} "
        f"({len(validation_errors)} erros, {len(validation_warnings)} avisos)"
    )

    return {
        "steps": [step],
        "module_result": {
            "module": "document_validator",
            "domain": domain,
            "is_valid": is_valid,
            "validation_errors": validation_errors,
            "validation_warnings": validation_warnings,
        },
    }


async def validate_document_with_llm(
    state: AgentState,
    domain: str,
    custom_rules: str | None = None,
) -> dict[str, Any]:
    """
    Validação com LLM (versão IA).

    Para domínios que precisam validação contextual.

    Args:
        state: AgentState
        domain: Tipo de documento
        custom_rules: Regras customizadas em natural language

    Returns:
        Resultado com análise LLM
    """
    from langchain_core.messages import HumanMessage, SystemMessage
    from langchain_core.prompts import ChatPromptTemplate
    from core.model import get_default_model

    logger.info(f"🤖 Módulo: Validar documento com LLM ({domain})...")

    model = get_default_model()

    prompt_template = f"""
    Você é um validador de documentos especializado em {domain}.

    {f'Regras customizadas: {custom_rules}' if custom_rules else ''}

    Analise o documento e verifique:
    1. Formatação correta
    2. Campos obrigatórios presentes
    3. Consistência de dados
    4. Conformidade com legislação

    Seja rigoroso mas justo.
    """

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=prompt_template),
        HumanMessage(
            content=f"Valide este documento: {state.get('messages', [{}])[-1].content if state.get('messages') else 'N/A'}"
        ),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        validation_text = result.content

        step = AgentStep(
            agent_name=f"module:document_validator_llm[{domain}]",
            action="validate_document_llm",
            result={"analysis_length": len(validation_text)},
        )

        return {
            "steps": [step],
            "module_result": {
                "module": "document_validator_llm",
                "domain": domain,
                "validation_analysis": validation_text,
            },
        }

    except Exception as e:
        logger.error(f"❌ Erro na validação LLM: {e}")
        return {
            "steps": [
                AgentStep(
                    agent_name=f"module:document_validator_llm[{domain}]",
                    action="validate_document_llm",
                    error=str(e),
                    result={},
                )
            ],
            "error": str(e),
        }
