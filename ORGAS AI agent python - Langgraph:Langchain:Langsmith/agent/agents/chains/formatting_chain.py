"""
agents/chains/formatting_chain.py -- Chain Reutilizavel de Formatacao de Saida

Formata dados de analise em relatorios estruturados usando LLM.
Usa LCEL: PromptTemplate | LLM | StrOutputParser.

Uso:
    from agents.chains import create_formatting_chain, FormattingInput

    chain = create_formatting_chain(domain="fiscal")
    result = await chain.ainvoke(FormattingInput(
        domain="fiscal",
        data={"analysis": "...", "risks": [...]},
        output_format="markdown",
        include_summary=True,
    ))

    report = result["formatted_report"]
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, Field

from core.model import get_default_model

logger = logging.getLogger(__name__)


# --- Input/Output Schemas ---------------------------------------------------

class FormattingInput(BaseModel):
    """Schema de entrada para a chain de formatacao."""
    domain: str = "generic"
    data: dict[str, Any] = Field(default_factory=dict)
    output_format: Literal["json", "markdown", "html", "text"] = "markdown"
    include_summary: bool = True
    include_recommendations: bool = True


class FormattingOutput(BaseModel):
    """Schema de saida da chain de formatacao."""
    formatted_report: str = ""
    output_format: str = "markdown"
    domain: str = "generic"


# --- Domain-specific system prompts ------------------------------------------

DOMAIN_SYSTEM_PROMPTS: dict[str, str] = {
    "fiscal": (
        "Voce e um consultor fiscal senior. "
        "Formate os dados como um parecer fiscal executivo com: "
        "1. Resumo do status fiscal "
        "2. Principais achados "
        "3. Recomendacoes prioritarias (max 5) "
        "4. Proximos passos. "
        "Use tom profissional e conclusivo."
    ),
    "accounting": (
        "Voce e um analista contabil. "
        "Formate os dados como um relatorio contabil com: "
        "1. Resumo executivo "
        "2. Analise de conformidade IFRS/CPC "
        "3. Riscos identificados "
        "4. Recomendacoes."
    ),
    "personal": (
        "Voce e um especialista em protecao de dados (LGPD/GDPR). "
        "Formate os dados como um relatorio de privacidade. "
        "Nunca mencione dados sensiveis desmascarados. "
        "Foque em boas praticas de privacidade."
    ),
    "support": (
        "Voce e um gestor de suporte. "
        "Formate os dados como um relatorio de atendimento com: "
        "1. Categorizacao do ticket "
        "2. Prioridade "
        "3. Resolucao "
        "4. SLA."
    ),
    "generic": (
        "Voce e um assistente profissional. "
        "Formate os dados de forma clara e estruturada."
    ),
}


# --- Core formatting logic ---------------------------------------------------

async def _format(input_data: dict | FormattingInput) -> dict:
    """Logica de formatacao usando LLM."""
    if isinstance(input_data, dict):
        input_data = FormattingInput(**input_data)

    domain = input_data.domain
    system_prompt = DOMAIN_SYSTEM_PROMPTS.get(domain, DOMAIN_SYSTEM_PROMPTS["generic"])

    data_str = json.dumps(input_data.data, ensure_ascii=False, indent=2, default=str)
    # Limitar tamanho para evitar tokens excessivos
    if len(data_str) > 2000:
        data_str = data_str[:2000] + "\n... (truncado)"

    sections = []
    if input_data.include_summary:
        sections.append("Inclua um resumo executivo conciso.")
    if input_data.include_recommendations:
        sections.append("Inclua recomendacoes principais.")
    sections_text = " ".join(sections)

    format_instruction = (
        f"Formato de saida: {input_data.output_format}. "
        f"{sections_text}"
    )

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=f"{system_prompt}\n{format_instruction}"),
        HumanMessage(content=f"Formate estes dados em um relatorio:\n{data_str}"),
    ])

    model = get_default_model()
    chain = prompt | model | StrOutputParser()

    try:
        formatted_report = await chain.ainvoke({})

        logger.info(
            f"Formatting [{domain}]: {len(formatted_report)} chars, "
            f"format={input_data.output_format}"
        )

        return FormattingOutput(
            formatted_report=formatted_report,
            output_format=input_data.output_format,
            domain=domain,
        ).model_dump()

    except Exception as e:
        logger.error(f"Formatting [{domain}] error: {e}")
        # Fallback: retornar dados brutos formatados
        fallback_report = f"# Relatorio {domain.title()}\n\n```json\n{data_str}\n```"
        return FormattingOutput(
            formatted_report=fallback_report,
            output_format=input_data.output_format,
            domain=domain,
        ).model_dump()


# --- Chain Factory -----------------------------------------------------------

def create_formatting_chain(
    domain: str = "generic",
    output_format: Literal["json", "markdown", "html", "text"] = "markdown",
) -> RunnableLambda:
    """
    Cria uma chain de formatacao configurada para um dominio.

    Args:
        domain: Dominio de formatacao (fiscal, accounting, personal, etc.)
        output_format: Formato padrao de saida

    Returns:
        RunnableLambda composivel com outras chains

    Exemplo:
        chain = create_formatting_chain(domain="fiscal")
        result = await chain.ainvoke({
            "data": {"analysis": "...", "risks": [...]},
            "include_summary": True,
        })
    """

    async def _run(input_data: dict | FormattingInput) -> dict:
        if isinstance(input_data, dict):
            input_data.setdefault("domain", domain)
            input_data.setdefault("output_format", output_format)
            input_data = FormattingInput(**input_data)
        else:
            if input_data.domain == "generic" and domain != "generic":
                input_data.domain = domain
        return await _format(input_data)

    return RunnableLambda(_run).with_config(
        {"run_name": f"formatting_chain[{domain}]"}
    )
