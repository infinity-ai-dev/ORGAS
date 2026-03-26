"""
agents/chains/fiscal_chains.py -- Chains Especificas do Dominio Fiscal

Chains pre-configuradas para o dominio fiscal que compoem as chains
genericas com parametros especificos.

Este arquivo serve como TEMPLATE/EXEMPLO para criar chains de outros dominios.
Para criar chains de "accounting", copie este arquivo e ajuste:
1. Domain = "accounting"
2. Prompts especificos do dominio
3. Campos obrigatorios do dominio

Uso:
    from agents.chains.fiscal_chains import (
        fiscal_validation,
        fiscal_rag,
        fiscal_analysis_chain,
        fiscal_opinion_chain,
    )

    # Validar
    val = await fiscal_validation.ainvoke({...})

    # Buscar dados
    data = await fiscal_rag.ainvoke({...})

    # Analisar conformidade
    analysis = await fiscal_analysis_chain.ainvoke({"context": "..."})

    # Gerar parecer
    opinion = await fiscal_opinion_chain.ainvoke({"analysis": "...", "risks": [...]})
"""

from __future__ import annotations

import logging

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda

from agents.chains.validation_chain import create_validation_chain
from agents.chains.rag_chain import create_rag_chain
from agents.chains.llm_fallback_chain import create_llm_with_fallback

logger = logging.getLogger(__name__)


# =============================================================================
# 1. Validation Chain (pre-configurada para fiscal)
# =============================================================================

fiscal_validation = create_validation_chain(
    domain="fiscal",
    required_fields=["user_id", "regime_tributario"],
)
"""Chain de validacao configurada para dominio fiscal.
Verifica: user_id, messages, regime_tributario."""


# =============================================================================
# 2. RAG Chain (pre-configurada para fiscal)
# =============================================================================

fiscal_rag = create_rag_chain(
    domain="fiscal",
    sources=["database", "rag"],
)
"""Chain de RAG configurada para dominio fiscal.
Busca: database (dados fiscais) + rag (legislacao fiscal)."""


# =============================================================================
# 3. Fiscal Analysis Chain (especifica do dominio)
# =============================================================================

_ANALYSIS_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(
        content=(
            "Voce e um analista fiscal especializado em legislacao tributaria brasileira. "
            "Analise os dados fiscais fornecidos e:\n"
            "1. Identifique conformidade com legislacao brasileira\n"
            "2. Aponte riscos fiscais com nivel de severidade\n"
            "3. Sugira acoes corretivas prioritarias\n"
            "4. Avalie exposicao fiscal total\n"
            "Seja tecnico mas compreensivel. Use valores em R$."
        )
    ),
    ("human", "Analise os seguintes dados fiscais:\n{context}"),
])


def _build_fiscal_context(data: dict) -> str:
    """Formata dados fiscais para o prompt de analise."""
    fiscal = data.get("fiscal_data", data)
    lines = [
        f"Regime Tributario: {fiscal.get('regime_tributario', 'N/A')}",
        f"Receita Bruta 2024: R$ {fiscal.get('receita_bruta_2024', 0):,.2f}",
        f"Despesas Dedutivas: R$ {fiscal.get('despesas_dedutivas_2024', 0):,.2f}",
        f"Imposto Devido: R$ {fiscal.get('imposto_devido_2024', 0):,.2f}",
        f"Imposto Pago: R$ {fiscal.get('imposto_pago_2024', 0):,.2f}",
        f"Diferenca: R$ {fiscal.get('diferenca', 0):,.2f}",
    ]
    obrigacoes = fiscal.get("obrigacoes_acessorias", [])
    if obrigacoes:
        lines.append(f"Obrigacoes Acessorias: {', '.join(obrigacoes)}")
    return "\n".join(lines)


async def _analyze_fiscal(input_data: dict) -> dict:
    """Executa analise de conformidade fiscal via LLM."""
    context = input_data.get("context", "")
    if not context and "fiscal_data" in input_data:
        context = _build_fiscal_context(input_data)

    llm = create_llm_with_fallback()
    chain = _ANALYSIS_PROMPT | llm | StrOutputParser()

    try:
        analysis_text = await chain.ainvoke({"context": context})

        risks = []
        lower = analysis_text.lower()
        if "diferenca" in lower or "diferença" in lower:
            risks.append("Diferenca entre imposto devido e pago")
        if "acessoria" in lower or "acessória" in lower:
            risks.append("Verificar cumprimento de obrigacoes acessorias")
        if "risco" in lower:
            risks.append("Riscos fiscais identificados na analise")

        logger.info(f"Fiscal analysis: {len(risks)} risks, {len(analysis_text)} chars")

        return {
            "compliance_analysis": analysis_text,
            "risks_identified": risks,
            "risks_count": len(risks),
        }

    except Exception as e:
        logger.error(f"Fiscal analysis error: {e}")
        return {
            "compliance_analysis": f"Erro na analise: {str(e)}",
            "risks_identified": [],
            "risks_count": 0,
            "error": str(e),
        }


fiscal_analysis_chain = RunnableLambda(_analyze_fiscal).with_config(
    {"run_name": "fiscal_analysis_chain"}
)
"""Chain de analise de conformidade fiscal.
Input: {"context": str} ou {"fiscal_data": dict}
Output: {"compliance_analysis": str, "risks_identified": list, "risks_count": int}"""


# =============================================================================
# 4. Fiscal Opinion Chain (especifica do dominio)
# =============================================================================

_OPINION_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(
        content=(
            "Voce e um consultor fiscal senior com 20+ anos de experiencia. "
            "Baseado na analise de conformidade, gere um parecer fiscal executivo com:\n"
            "1. Resumo do status fiscal (2-3 linhas)\n"
            "2. Principais achados (bullet points)\n"
            "3. Recomendacoes prioritarias (max 5, ordenadas por urgencia)\n"
            "4. Proximos passos concretos\n"
            "Use tom profissional e conclusivo. Inclua referencias legais quando aplicavel."
        )
    ),
    ("human",
     "Analise de Conformidade:\n{analysis}\n\n"
     "Riscos Identificados:\n{risks}\n\n"
     "Gere um parecer executivo."
     ),
])


async def _generate_opinion(input_data: dict) -> dict:
    """Gera parecer fiscal executivo via LLM."""
    analysis = input_data.get("analysis", input_data.get("compliance_analysis", ""))
    risks = input_data.get("risks", input_data.get("risks_identified", []))

    if isinstance(risks, list):
        risks_text = ", ".join(risks) if risks else "Nenhum risco identificado"
    else:
        risks_text = str(risks)

    llm = create_llm_with_fallback()
    chain = _OPINION_PROMPT | llm | StrOutputParser()

    try:
        opinion_text = await chain.ainvoke({
            "analysis": analysis,
            "risks": risks_text,
        })

        recommendations = [
            "Revisar calculos de imposto devido vs pago",
            "Verificar documentacao de despesas dedutivas",
            "Validar cumprimento de obrigacoes acessorias",
        ]

        logger.info(f"Fiscal opinion: {len(opinion_text)} chars")

        return {
            "fiscal_opinion": opinion_text,
            "recommendations": recommendations,
            "status": "complete",
        }

    except Exception as e:
        logger.error(f"Fiscal opinion error: {e}")
        return {
            "fiscal_opinion": f"Erro ao gerar parecer: {str(e)}",
            "recommendations": [],
            "status": "error",
            "error": str(e),
        }


fiscal_opinion_chain = RunnableLambda(_generate_opinion).with_config(
    {"run_name": "fiscal_opinion_chain"}
)
"""Chain de geracao de parecer fiscal.
Input: {"analysis": str, "risks": list[str]} ou {"compliance_analysis": str, "risks_identified": list}
Output: {"fiscal_opinion": str, "recommendations": list, "status": str}"""
