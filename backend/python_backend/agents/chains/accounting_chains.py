"""
agents/chains/accounting_chains.py -- Chains Especificas do Dominio Contabil

Chains pre-configuradas para o dominio contabil (accounting) que compoem
as chains genericas com parametros especificos.

Segue o mesmo padrao de fiscal_chains.py. Para criar chains de outro dominio,
copie este arquivo e ajuste:
1. Domain = "seu_dominio"
2. Prompts especificos do dominio
3. Campos obrigatorios do dominio

Uso:
    from agents.chains.accounting_chains import (
        accounting_validation,
        accounting_rag,
        accounting_analysis_chain,
        accounting_opinion_chain,
    )

    # Validar
    val = await accounting_validation.ainvoke({...})

    # Buscar dados
    data = await accounting_rag.ainvoke({...})

    # Analisar conformidade contabil
    analysis = await accounting_analysis_chain.ainvoke({"context": "..."})

    # Gerar parecer contabil
    opinion = await accounting_opinion_chain.ainvoke({"analysis": "...", "risks": [...]})
"""

from __future__ import annotations

import logging

from langchain_core.messages import SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda

from agents.chains.validation_chain import create_validation_chain
from agents.chains.rag_chain import create_rag_chain
from agents.chains.llm_fallback_chain import create_llm_with_fallback

logger = logging.getLogger(__name__)


# =============================================================================
# 1. Validation Chain (pre-configurada para accounting)
# =============================================================================

accounting_validation = create_validation_chain(
    domain="accounting",
    required_fields=["user_id", "categoria"],
)
"""Chain de validacao configurada para dominio contabil.
Verifica: user_id, messages, categoria."""


# =============================================================================
# 2. RAG Chain (pre-configurada para accounting)
# =============================================================================

accounting_rag = create_rag_chain(
    domain="accounting",
    sources=["database", "api", "rag"],
)
"""Chain de RAG configurada para dominio contabil.
Busca: database (dados contabeis) + api (dados externos) + rag (normas IFRS/CPC)."""


# =============================================================================
# 3. Accounting Analysis Chain (especifica do dominio)
# =============================================================================

_ANALYSIS_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(
        content=(
            "Voce e um analista contabil especializado em normas IFRS e CPC. "
            "Analise os dados contabeis fornecidos e:\n"
            "1. Verifique conformidade com IFRS/CPC\n"
            "2. Analise estrutura de contas e saldos\n"
            "3. Identifique riscos contabeis com nivel de severidade\n"
            "4. Avalie lancamentos e conciliacoes\n"
            "Seja tecnico mas compreensivel. Use valores em R$."
        )
    ),
    ("human", "Analise os seguintes dados contabeis:\n{context}"),
])


def _build_accounting_context(data: dict) -> str:
    """Formata dados contabeis para o prompt de analise."""
    acct = data.get("accounting_data", data)
    lines = [
        f"Categoria: {acct.get('categoria', 'N/A')}",
        f"Periodo: {acct.get('periodo', 'N/A')}",
        f"Ativo Total: R$ {acct.get('ativo_total', 0):,.2f}",
        f"Passivo Total: R$ {acct.get('passivo_total', 0):,.2f}",
        f"Patrimonio Liquido: R$ {acct.get('patrimonio_liquido', 0):,.2f}",
        f"Receita Operacional: R$ {acct.get('receita_operacional', 0):,.2f}",
        f"Resultado Liquido: R$ {acct.get('resultado_liquido', 0):,.2f}",
    ]
    normas = acct.get("normas_aplicaveis", [])
    if normas:
        lines.append(f"Normas Aplicaveis: {', '.join(normas)}")
    return "\n".join(lines)


async def _analyze_accounting(input_data: dict) -> dict:
    """Executa analise de conformidade contabil via LLM."""
    context = input_data.get("context", "")
    if not context and "accounting_data" in input_data:
        context = _build_accounting_context(input_data)

    llm = create_llm_with_fallback()
    chain = _ANALYSIS_PROMPT | llm | StrOutputParser()

    try:
        analysis_text = await chain.ainvoke({"context": context})

        risks = []
        lower = analysis_text.lower()
        if "ifrs" in lower or "cpc" in lower:
            risks.append("Verificar conformidade com normas IFRS/CPC")
        if "conciliacao" in lower or "conciliação" in lower:
            risks.append("Pendencias de conciliacao contabil")
        if "risco" in lower:
            risks.append("Riscos contabeis identificados na analise")
        if "provisao" in lower or "provisão" in lower:
            risks.append("Verificar adequacao de provisoes")

        logger.info(f"Accounting analysis: {len(risks)} risks, {len(analysis_text)} chars")

        return {
            "accounting_analysis": analysis_text,
            "risks_identified": risks,
            "risks_count": len(risks),
        }

    except Exception as e:
        logger.error(f"Accounting analysis error: {e}")
        return {
            "accounting_analysis": f"Erro na analise: {str(e)}",
            "risks_identified": [],
            "risks_count": 0,
            "error": str(e),
        }


accounting_analysis_chain = RunnableLambda(_analyze_accounting).with_config(
    {"run_name": "accounting_analysis_chain"}
)
"""Chain de analise de conformidade contabil.
Input: {"context": str} ou {"accounting_data": dict}
Output: {"accounting_analysis": str, "risks_identified": list, "risks_count": int}"""


# =============================================================================
# 4. Accounting Opinion Chain (especifica do dominio)
# =============================================================================

_OPINION_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(
        content=(
            "Voce e um auditor contabil senior com 20+ anos de experiencia. "
            "Baseado na analise contabil, gere um parecer contabil executivo com:\n"
            "1. Resumo do status contabil (2-3 linhas)\n"
            "2. Principais achados (bullet points)\n"
            "3. Conformidade com IFRS/CPC (status por norma)\n"
            "4. Recomendacoes prioritarias (max 5, ordenadas por urgencia)\n"
            "5. Proximos passos concretos\n"
            "Use tom profissional e conclusivo. Inclua referencias a normas quando aplicavel."
        )
    ),
    ("human",
     "Analise Contabil:\n{analysis}\n\n"
     "Riscos Identificados:\n{risks}\n\n"
     "Gere um parecer executivo."
     ),
])


async def _generate_opinion(input_data: dict) -> dict:
    """Gera parecer contabil executivo via LLM."""
    analysis = input_data.get("analysis", input_data.get("accounting_analysis", ""))
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
            "Revisar conformidade com normas IFRS/CPC vigentes",
            "Verificar conciliacoes contabeis pendentes",
            "Avaliar adequacao de provisoes e contingencias",
            "Validar estrutura de plano de contas",
        ]

        logger.info(f"Accounting opinion: {len(opinion_text)} chars")

        return {
            "accounting_opinion": opinion_text,
            "recommendations": recommendations,
            "status": "complete",
        }

    except Exception as e:
        logger.error(f"Accounting opinion error: {e}")
        return {
            "accounting_opinion": f"Erro ao gerar parecer: {str(e)}",
            "recommendations": [],
            "status": "error",
            "error": str(e),
        }


accounting_opinion_chain = RunnableLambda(_generate_opinion).with_config(
    {"run_name": "accounting_opinion_chain"}
)
"""Chain de geracao de parecer contabil.
Input: {"analysis": str, "risks": list[str]} ou {"accounting_analysis": str, "risks_identified": list}
Output: {"accounting_opinion": str, "recommendations": list, "status": str}"""
