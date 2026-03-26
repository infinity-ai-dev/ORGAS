"""
agents/accounting_agent_refactored.py -- Sub-grafo Contabil Refatorado com Chains

ANTES (accounting_agent.py):
    5 nos individuais, alguns com logica inline de validacao, fetch, LLM, etc.

DEPOIS (este arquivo):
    - Nodes 1+2 (validate + fetch) compostos como chain sequencial
    - Nodes 3+5 (analyze + format) usam accounting_analysis_chain + formatting_chain
    - Node 4 mantém modulo check_compliance
    - Grafo mantem estrutura para futuras condicoes/loops
    - Chains reutilizaveis importadas de agents/chains/

Arquitetura:
    START -> validate_and_fetch (chain) -> analyze (accounting_chain)
          -> check_compliance (module) -> format_report (chain) -> END

O grafo mantem a estrutura de StateGraph para:
    - Possivel roteamento condicional futuro
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

# Chains específicas do domínio contábil
from agents.chains.accounting_chains import (
    accounting_analysis_chain,
    accounting_opinion_chain,
)

# Módulo de compliance (mantém para compatibilidade)
from agents.modules.compliance_checker import check_compliance_module

logger = logging.getLogger(__name__)

# --- Chains pre-configuradas para dominio contabil ----------------------------

_accounting_validation = create_validation_chain(
    domain="accounting",
    required_fields=["user_id", "categoria"],
)

_accounting_rag = create_rag_chain(
    domain="accounting",
    sources=["database", "api", "rag"],
)

_accounting_formatting = create_formatting_chain(
    domain="accounting",
    output_format="markdown",
)


# --- No 1+2: Validar e Buscar (composicao de chains) -----------------------

async def validate_and_fetch(state: AgentState) -> dict[str, Any]:
    """
    Compoe validation_chain + rag_chain em um unico no.

    Dois passos sequenciais que nao precisam de condicional:
    1. Validar contexto contabil (chain)
    2. Buscar dados contabeis (chain)

    Se a validacao falhar, ainda busca dados.
    """
    logger.info("📋 Node 1+2: Validating and fetching accounting data (chains)...")

    session = state.get("session")
    messages = state.get("messages", [])

    # --- Step 1: Validacao via chain ---
    validation_result = await _accounting_validation.ainvoke({
        "user_id": session.get("user_id") if session else None,
        "messages": messages,
        "session_data": {
            "categoria": session.categoria if hasattr(session, "categoria") else None,
        },
    })

    validation_step = AgentStep(
        agent_name="accounting_agent",
        action="validate_accounting_context",
        result={
            "is_valid": validation_result["is_valid"],
            "errors": validation_result["errors"],
        },
    )

    # --- Step 2: Busca de dados via chain ---
    rag_result = await _accounting_rag.ainvoke({
        "user_id": session.get("user_id") if session else None,
        "query": messages[-1].content if messages else "",
        "session_data": {
            "categoria": session.categoria if hasattr(session, "categoria") else None,
        },
    })

    fetch_step = AgentStep(
        agent_name="accounting_agent",
        action="fetch_accounting_data",
        result={
            "sources_used": rag_result["sources_used"],
            "documents_found": rag_result["documents_found"],
        },
    )

    # Consolidar dados do RAG
    accounting_data = rag_result["context"].get("database", {})

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
            "accounting_data": accounting_data,
            "sources_used": rag_result["sources_used"],
        },
    }


# --- No 3: Analisar Conformidade Contabil (chain) ----------------------------

async def analyze_accounting(state: AgentState) -> dict[str, Any]:
    """
    Analia conformidade contabil usando accounting_analysis_chain.

    Esta eh uma chain LCEL reutilizavel que pode ser testada isoladamente.
    """
    logger.info("📊 Node 3: Analyzing accounting compliance (chain)...")

    domain_data = state.get("domain_data", {})
    accounting_data = domain_data.get("accounting_data", {})

    try:
        # Invocar chain com dados preparados
        analysis_result = await accounting_analysis_chain.ainvoke({
            "accounting_data": accounting_data,
        })

        # Extrair resultados
        analysis_text = analysis_result.get("accounting_analysis", "")
        risks = analysis_result.get("risks_identified", [])

        step = AgentStep(
            agent_name="accounting_agent",
            action="analyze_accounting_data",
            result={
                "analysis_length": len(analysis_text),
                "risks_count": len(risks),
            },
        )

        logger.info(f"Analysis complete: {len(risks)} risks, {len(analysis_text)} chars")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "analyze_accounting",
                "accounting_analysis": analysis_text,
                "risks_identified": risks,
            },
        }

    except Exception as e:
        logger.error(f"Accounting analysis error: {e}")
        step = AgentStep(
            agent_name="accounting_agent",
            action="analyze_accounting_data",
            error=str(e),
            result={},
        )
        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                **domain_data,
                "step": "analyze_accounting",
                "accounting_analysis": f"Erro: {str(e)}",
                "risks_identified": [],
            },
        }


# --- No 4: Verificar Compliance (usa modulo para compatibilidade) -----------

async def check_accounting_compliance(state: AgentState) -> dict[str, Any]:
    """
    Verifica compliance usando modulo generico.

    Mantido para compatibilidade com fluxo original.
    """
    logger.info("⚖️  Node 4: Checking accounting compliance (module)...")

    domain_data = state.get("domain_data", {})
    analysis = domain_data.get("accounting_analysis", "")

    # Chamar modulo com standards contabeis
    result = await check_compliance_module(
        state,
        domain="accounting",
        data_to_check={"analysis": analysis},
        compliance_standards=["ifrs", "cpc", "nbr_contabil"],
    )

    return {
        "steps": result.get("steps", []),
        "domain_data": {
            **domain_data,
            "compliance_result": result.get("result", {}),
        },
    }


# --- No 5: Gerar Parecer Contabil (chain) ----------------------------------

async def generate_accounting_opinion(state: AgentState) -> dict[str, Any]:
    """
    Gera parecer contabil usando accounting_opinion_chain.

    Composicao:
    1. accounting_opinion_chain gera o parecer
    2. formatting_chain formata o relatorio final
    """
    logger.info("📄 Node 5: Generating accounting opinion (chain + formatting)...")

    domain_data = state.get("domain_data", {})
    analysis = domain_data.get("accounting_analysis", "")
    risks = domain_data.get("risks_identified", [])

    try:
        # Step 1: Gerar parecer via chain
        opinion_result = await accounting_opinion_chain.ainvoke({
            "analysis": analysis,
            "risks": risks,
        })

        accounting_opinion = opinion_result.get("accounting_opinion", "")
        recommendations = opinion_result.get("recommendations", [])

        # Step 2: Formatar relatorio (opcional, mantém para exemplo)
        # format_result = await _accounting_formatting.ainvoke({
        #     "data": {
        #         "analysis": analysis,
        #         "opinion": accounting_opinion,
        #         "risks": risks,
        #         "recommendations": recommendations,
        #     }
        # })

        step = AgentStep(
            agent_name="accounting_agent",
            action="generate_accounting_opinion",
            result={
                "opinion_length": len(accounting_opinion),
                "recommendations_count": len(recommendations),
            },
        )

        logger.info(f"Opinion generated: {len(recommendations)} recommendations")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "generate_opinion",
                "accounting_opinion": accounting_opinion,
                "recommendations": recommendations,
                "agent": "accounting",
                "status": "complete",
            },
        }

    except Exception as e:
        logger.error(f"Opinion generation error: {e}")
        step = AgentStep(
            agent_name="accounting_agent",
            action="generate_accounting_opinion",
            error=str(e),
            result={},
        )
        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                **domain_data,
                "step": "generate_opinion",
                "accounting_opinion": f"Erro ao gerar parecer: {str(e)}",
                "recommendations": [],
                "agent": "accounting",
                "status": "error",
            },
        }


# --- Construtor do Sub-grafo ------------------------------------------------

def build_accounting_subgraph_refactored() -> Any:
    """
    Constroi o sub-grafo contabil refatorado com chains.

    Estrutura:
        START -> validate_and_fetch -> analyze -> check_compliance
              -> opinion -> END

    Diferenca do original:
    - 3 nos em vez de 5 (validate+fetch compostos)
    - Chains reutilizaveis para validacao e RAG
    - accounting_analysis_chain para analise de conformidade
    - accounting_opinion_chain para parecer
    - Mesma interface de saida (domain_data compativel)
    """
    graph = StateGraph(AgentState)

    graph.add_node("validate_and_fetch", validate_and_fetch)
    graph.add_node("analyze", analyze_accounting)
    graph.add_node("compliance", check_accounting_compliance)
    graph.add_node("opinion", generate_accounting_opinion)

    graph.add_edge(START, "validate_and_fetch")
    graph.add_edge("validate_and_fetch", "analyze")
    graph.add_edge("analyze", "compliance")
    graph.add_edge("compliance", "opinion")
    graph.add_edge("opinion", END)

    return graph.compile()


# --- Compatibilidade: Export do grafo compilado --

get_accounting_subgraph = build_accounting_subgraph_refactored
