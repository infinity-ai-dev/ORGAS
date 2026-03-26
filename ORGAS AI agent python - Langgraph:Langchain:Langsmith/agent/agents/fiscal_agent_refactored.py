"""
agents/fiscal_agent_refactored.py -- Sub-grafo Fiscal Refatorado com Chains

ANTES (fiscal_agent.py):
    4 nos individuais, cada um com logica inline de validacao, fetch, LLM, etc.

DEPOIS (este arquivo):
    - Nodes 1+2 (validate + fetch) compostos como chain sequencial
    - Nodes 3+4 (analyze + opinion) usam llm_fallback_chain
    - Grafo mantem estrutura para futuras condicoes/loops
    - Chains reutilizaveis importadas de agents/chains/

Arquitetura:
    START -> validate_and_fetch (chain) -> analyze_compliance (LLM+fallback)
          -> generate_opinion (LLM+fallback) -> END

O grafo mantem a estrutura de StateGraph para:
    - Possivel roteamento condicional futuro (ex: skip analyze se invalido)
    - Controle de fluxo com AgentState
    - Compatibilidade com o orquestrador regent

Mas internamente cada no COMPOE chains reutilizaveis.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

from core.state import AgentState, AgentStep

# Chains reutilizaveis
from agents.chains.validation_chain import create_validation_chain
from agents.chains.rag_chain import create_rag_chain
from agents.chains.formatting_chain import create_formatting_chain
from agents.chains.llm_fallback_chain import create_llm_with_fallback

logger = logging.getLogger(__name__)

# --- Chains pre-configuradas para dominio fiscal ----------------------------

_fiscal_validation = create_validation_chain(
    domain="fiscal",
    required_fields=["user_id", "regime_tributario"],
)

_fiscal_rag = create_rag_chain(
    domain="fiscal",
    sources=["database", "rag"],
)

_fiscal_formatting = create_formatting_chain(
    domain="fiscal",
    output_format="markdown",
)


# --- No 1+2: Validar e Buscar (composicao de chains) -----------------------

async def validate_and_fetch(state: AgentState) -> dict[str, Any]:
    """
    Compoe validation_chain + rag_chain em um unico no.

    Dois passos sequenciais que nao precisam de condicional:
    1. Validar contexto fiscal (chain)
    2. Buscar dados fiscais (chain)

    Se a validacao falhar, ainda busca dados (o orquestrador decide o que fazer).
    """
    logger.info("Node 1+2: Validating and fetching fiscal data (chains)...")

    session = state.get("session")
    messages = state.get("messages", [])

    # --- Step 1: Validacao via chain ---
    validation_result = await _fiscal_validation.ainvoke({
        "user_id": session.get("user_id") if session else None,
        "messages": messages,
        "session_data": {
            "regime_tributario": session.get("regime_tributario") if session else None,
        },
    })

    validation_step = AgentStep(
        agent_name="fiscal_agent",
        action="validate_fiscal_context",
        result={
            "is_valid": validation_result["is_valid"],
            "errors": validation_result["errors"],
        },
    )

    # --- Step 2: Busca de dados via chain ---
    rag_result = await _fiscal_rag.ainvoke({
        "user_id": session.get("user_id") if session else None,
        "query": messages[-1].content if messages else "",
        "session_data": {
            "regime_tributario": session.get("regime_tributario") if session else None,
        },
    })

    fetch_step = AgentStep(
        agent_name="fiscal_agent",
        action="fetch_fiscal_data",
        result={
            "sources_used": rag_result["sources_used"],
            "documents_found": rag_result["documents_found"],
        },
    )

    # Consolidar dados do RAG para o formato esperado pelo grafo
    fiscal_data = rag_result["context"].get("database", {})

    logger.info(
        f"Validate+Fetch complete: valid={validation_result['is_valid']}, "
        f"sources={rag_result['sources_used']}"
    )

    return {
        "steps": [validation_step, fetch_step],
        "domain_data": {
            "step": "validate_and_fetch",
            "is_valid": validation_result["is_valid"],
            "validation_errors": validation_result["errors"],
            "fiscal_data": fiscal_data,
            "data_sources": rag_result["sources_used"],
        },
    }


# --- No 3: Analisar Conformidade (LLM com fallback) -------------------------

async def analyze_compliance(state: AgentState) -> dict[str, Any]:
    """
    Analisa conformidade fiscal usando LLM com fallback em tempo de invocacao.

    Usa llm_fallback_chain para resiliencia: se Gemini falhar,
    automaticamente tenta OpenAI, depois Grok.
    """
    logger.info("Node 3: Analyzing fiscal compliance (LLM+fallback)...")

    domain_data = state.get("domain_data", {})
    fiscal_data = domain_data.get("fiscal_data", {})

    context = f"""
    Regime Tributario: {fiscal_data.get('regime_tributario', 'N/A')}
    Receita Bruta 2024: R$ {fiscal_data.get('receita_bruta_2024', 0):,.2f}
    Despesas Dedutivas: R$ {fiscal_data.get('despesas_dedutivas_2024', 0):,.2f}
    Imposto Devido: R$ {fiscal_data.get('imposto_devido_2024', 0):,.2f}
    Imposto Pago: R$ {fiscal_data.get('imposto_pago_2024', 0):,.2f}
    Diferenca: R$ {fiscal_data.get('diferenca', 0):,.2f}
    Obrigacoes Acessorias: {', '.join(fiscal_data.get('obrigacoes_acessorias', []))}
    """

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            content=(
                "Voce e um analista fiscal especializado. "
                "Analise os dados fiscais e:\n"
                "1. Identifique conformidade com legislacao brasileira\n"
                "2. Aponte riscos fiscais\n"
                "3. Sugira acoes corretivas\n"
                "4. Avalie exposicao fiscal\n"
                "Seja tecnico mas compreensivel."
            )
        ),
        HumanMessage(content=f"Analise os dados fiscais:\n{context}"),
    ])

    # LLM com fallback em tempo de invocacao
    llm = create_llm_with_fallback()
    chain = prompt | llm | StrOutputParser()

    try:
        analysis_text = await chain.ainvoke({})

        risks = []
        analysis_lower = analysis_text.lower()
        if "diferenca" in analysis_lower or "diferença" in analysis_lower:
            risks.append("Diferenca entre imposto devido e pago")
        if "acessoria" in analysis_lower or "acessória" in analysis_lower:
            risks.append("Verificar cumprimento de obrigacoes acessorias")

        step = AgentStep(
            agent_name="fiscal_agent",
            action="analyze_compliance",
            result={
                "risks_count": len(risks),
                "analysis_length": len(analysis_text),
            },
        )

        logger.info(f"Compliance analysis complete: {len(risks)} risks found")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "analyze_compliance",
                "compliance_analysis": analysis_text,
                "risks_identified": risks,
            },
        }

    except Exception as e:
        logger.error(f"Compliance analysis error: {e}")
        step = AgentStep(
            agent_name="fiscal_agent",
            action="analyze_compliance",
            error=str(e),
            result={},
        )
        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                **domain_data,
                "step": "analyze_compliance",
                "compliance_analysis": f"Erro: {str(e)}",
                "risks_identified": [],
            },
        }


# --- No 4: Gerar Parecer Fiscal (LLM + formatting chain) --------------------

async def generate_fiscal_opinion(state: AgentState) -> dict[str, Any]:
    """
    Gera parecer fiscal usando LLM com fallback + formatting chain.

    Composicao:
    1. LLM com fallback gera o conteudo
    2. formatting_chain formata o relatorio final
    """
    logger.info("Node 4: Generating fiscal opinion (LLM+fallback + formatting)...")

    domain_data = state.get("domain_data", {})
    compliance_analysis = domain_data.get("compliance_analysis", "")
    risks = domain_data.get("risks_identified", [])

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            content=(
                "Voce e um consultor fiscal senior. "
                "Baseado na analise de conformidade, gere um parecer fiscal "
                "executivo com:\n"
                "1. Resumo do status fiscal\n"
                "2. Principais achados\n"
                "3. Recomendacoes prioritarias (max 5)\n"
                "4. Proximos passos\n"
                "Use tom profissional e conclusivo."
            )
        ),
        HumanMessage(
            content=(
                f"Analise de Conformidade:\n{compliance_analysis}\n\n"
                f"Riscos Identificados:\n{', '.join(risks)}\n\n"
                f"Gere um parecer executivo."
            )
        ),
    ])

    llm = create_llm_with_fallback()
    chain = prompt | llm | StrOutputParser()

    try:
        opinion_text = await chain.ainvoke({})

        recommendations = [
            "Revisar calculos de imposto devido vs pago",
            "Verificar documentacao de despesas dedutivas",
            "Validar cumprimento de obrigacoes acessorias",
        ]

        step = AgentStep(
            agent_name="fiscal_agent",
            action="generate_fiscal_opinion",
            result={
                "opinion_length": len(opinion_text),
                "recommendations_count": len(recommendations),
            },
        )

        logger.info(f"Opinion generated: {len(recommendations)} recommendations")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "generate_fiscal_opinion",
                "fiscal_opinion": opinion_text,
                "recommendations": recommendations,
                "agent": "fiscal",
                "status": "complete",
            },
        }

    except Exception as e:
        logger.error(f"Opinion generation error: {e}")
        step = AgentStep(
            agent_name="fiscal_agent",
            action="generate_fiscal_opinion",
            error=str(e),
            result={},
        )
        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                **domain_data,
                "step": "generate_fiscal_opinion",
                "fiscal_opinion": f"Erro ao gerar parecer: {str(e)}",
                "recommendations": [],
                "agent": "fiscal",
                "status": "error",
            },
        }


# --- Construtor do Sub-grafo ------------------------------------------------

def build_fiscal_subgraph_refactored() -> Any:
    """
    Constroi o sub-grafo fiscal refatorado com chains.

    Estrutura:
        START -> validate_and_fetch -> analyze -> opinion -> END

    Diferenca do original:
    - 3 nos em vez de 4 (validate+fetch compostos)
    - Chains reutilizaveis para validacao e RAG
    - LLM com fallback em tempo de invocacao
    - Mesma interface de saida (domain_data compativel)
    """
    graph = StateGraph(AgentState)

    graph.add_node("validate_and_fetch", validate_and_fetch)
    graph.add_node("analyze", analyze_compliance)
    graph.add_node("opinion", generate_fiscal_opinion)

    graph.add_edge(START, "validate_and_fetch")
    graph.add_edge("validate_and_fetch", "analyze")
    graph.add_edge("analyze", "opinion")
    graph.add_edge("opinion", END)

    logger.info("Fiscal subgraph (refactored) compiled: 3 nodes with chains")

    return graph.compile()


# --- Lazy Loading ------------------------------------------------------------

_fiscal_subgraph_refactored = None


async def get_fiscal_subgraph_refactored() -> Any:
    """Retorna o sub-grafo fiscal refatorado (lazy loading)."""
    global _fiscal_subgraph_refactored
    if _fiscal_subgraph_refactored is None:
        _fiscal_subgraph_refactored = build_fiscal_subgraph_refactored()
    return _fiscal_subgraph_refactored
