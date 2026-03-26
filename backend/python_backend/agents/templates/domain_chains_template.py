"""
agents/templates/domain_chains_template.py -- Template de Chains por Dominio

INSTRUCOES:
    1. Copie para agents/chains/<dominio>_chains.py
    2. Substitua 'example' pelo nome do dominio
    3. Ajuste prompts e logica por dominio
    4. Exporte em agents/chains/__init__.py

Este template mostra como:
    - Pre-configurar chains genericas para um dominio
    - Criar chains especificas com prompts de dominio
    - Compor chains em pipelines

Referencia real: agents/chains/fiscal_chains.py
"""

from __future__ import annotations

import logging

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda

# Chains genericas reutilizaveis
from agents.chains.validation_chain import create_validation_chain
from agents.chains.rag_chain import create_rag_chain
from agents.chains.llm_fallback_chain import create_llm_with_fallback

logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURACAO DO DOMINIO
# =============================================================================

DOMAIN = "example"  # <-- MUDAR

# =============================================================================
# 1. VALIDATION (pre-configurada)
# =============================================================================

example_validation = create_validation_chain(
    domain=DOMAIN,
    required_fields=["user_id"],  # <-- MUDAR: campos do dominio
)

# =============================================================================
# 2. RAG (pre-configurada)
# =============================================================================

example_rag = create_rag_chain(
    domain=DOMAIN,
    sources=["database"],  # <-- MUDAR: fontes de dados
)

# =============================================================================
# 3. ANALYSIS CHAIN (especifica do dominio)
# =============================================================================

_ANALYSIS_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(
        content=(
            # <-- MUDAR: prompt especializado
            "Voce e um especialista em {domain}. "
            "Analise os dados fornecidos e identifique pontos criticos."
        ).format(domain=DOMAIN)
    ),
    ("human", "Analise os dados:\n{context}"),
])


async def _analyze(input_data: dict) -> dict:
    """Analise especifica do dominio."""
    context = input_data.get("context", "")

    llm = create_llm_with_fallback()
    chain = _ANALYSIS_PROMPT | llm | StrOutputParser()

    try:
        analysis = await chain.ainvoke({"context": context})
        return {
            "analysis": analysis,
            "status": "complete",
        }
    except Exception as e:
        logger.error(f"{DOMAIN} analysis error: {e}")
        return {
            "analysis": f"Erro: {str(e)}",
            "status": "error",
            "error": str(e),
        }


example_analysis_chain = RunnableLambda(_analyze).with_config(
    {"run_name": f"{DOMAIN}_analysis_chain"}
)

# =============================================================================
# 4. OUTPUT CHAIN (especifica do dominio)
# =============================================================================

_OUTPUT_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(
        content=(
            # <-- MUDAR: prompt de saida
            "Gere um parecer executivo baseado na analise."
        )
    ),
    ("human", "Analise:\n{analysis}\n\nGere o parecer."),
])


async def _generate_output(input_data: dict) -> dict:
    """Gera saida formatada do dominio."""
    analysis = input_data.get("analysis", "")

    llm = create_llm_with_fallback()
    chain = _OUTPUT_PROMPT | llm | StrOutputParser()

    try:
        output = await chain.ainvoke({"analysis": analysis})
        return {
            "output": output,
            "status": "complete",
        }
    except Exception as e:
        logger.error(f"{DOMAIN} output error: {e}")
        return {
            "output": f"Erro: {str(e)}",
            "status": "error",
            "error": str(e),
        }


example_output_chain = RunnableLambda(_generate_output).with_config(
    {"run_name": f"{DOMAIN}_output_chain"}
)
