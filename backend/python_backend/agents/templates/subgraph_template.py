"""
agents/templates/subgraph_template.py -- Template de Sub-grafo Especializado

INSTRUCOES:
    1. Copie para agents/<dominio>_agent.py
    2. Substitua 'example' pelo nome do seu dominio
    3. Ajuste validacoes, dados e prompts
    4. Registre em agents/__init__.py
    5. Crie testes copiando test_template.py

Estrutura padrao (3 nos com chains):
    START -> validate_and_fetch -> analyze -> generate_output -> END

Cada no compoe chains reutilizaveis de agents/chains/.
O grafo mantem StateGraph para possivel roteamento condicional.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

from core.state import AgentState, AgentStep

# --- Chains reutilizaveis ---------------------------------------------------
# Importar chains genericas
from agents.chains.validation_chain import create_validation_chain
from agents.chains.rag_chain import create_rag_chain
from agents.chains.llm_fallback_chain import create_llm_with_fallback

logger = logging.getLogger(__name__)

# =============================================================================
# CONFIGURACAO DO DOMINIO
# Ajuste estas constantes para seu dominio
# =============================================================================

DOMAIN_NAME = "example"  # <-- MUDAR: nome do dominio
AGENT_NAME = "example_agent"  # <-- MUDAR: nome do agente

# Campos obrigatorios para validacao
REQUIRED_FIELDS = ["user_id"]  # <-- MUDAR: adicionar campos do dominio

# Fontes de dados para RAG
DATA_SOURCES = ["database"]  # <-- MUDAR: ["database", "api", "rag"]

# Prompt do sistema para analise
ANALYSIS_SYSTEM_PROMPT = (
    # <-- MUDAR: prompt especializado para seu dominio
    "Voce e um especialista em {domain}. "
    "Analise os dados fornecidos e identifique:\n"
    "1. Pontos positivos\n"
    "2. Riscos ou problemas\n"
    "3. Recomendacoes\n"
    "Seja tecnico mas compreensivel."
)

# Prompt do sistema para geracao de parecer
OUTPUT_SYSTEM_PROMPT = (
    # <-- MUDAR: prompt para geracao de saida
    "Voce e um consultor senior em {domain}. "
    "Gere um parecer executivo com:\n"
    "1. Resumo\n"
    "2. Principais achados\n"
    "3. Recomendacoes prioritarias (max 5)\n"
    "4. Proximos passos\n"
    "Use tom profissional e conclusivo."
)


# =============================================================================
# CHAINS PRE-CONFIGURADAS
# =============================================================================

_validation = create_validation_chain(
    domain=DOMAIN_NAME,
    required_fields=REQUIRED_FIELDS,
)

_rag = create_rag_chain(
    domain=DOMAIN_NAME,
    sources=DATA_SOURCES,
)


# =============================================================================
# NO 1: VALIDAR E BUSCAR DADOS (composicao de chains)
# =============================================================================

async def validate_and_fetch(state: AgentState) -> dict[str, Any]:
    """
    Compoe validation_chain + rag_chain.

    Validacao + busca de dados em um unico no.
    """
    logger.info(f"[{AGENT_NAME}] Node 1: Validate and fetch...")

    session = state.get("session")
    messages = state.get("messages", [])

    # Step 1: Validacao
    val_result = await _validation.ainvoke({
        "user_id": session.get("user_id") if session else None,
        "messages": messages,
        "session_data": {
            # <-- MUDAR: mapear campos da sessao
            # "campo_dominio": session.campo if session else None,
        },
    })

    val_step = AgentStep(
        agent_name=AGENT_NAME,
        action="validate_context",
        result={
            "is_valid": val_result["is_valid"],
            "errors": val_result["errors"],
        },
    )

    # Step 2: Busca de dados
    rag_result = await _rag.ainvoke({
        "user_id": session.get("user_id") if session else None,
        "query": messages[-1].content if messages else "",
        "session_data": {},
    })

    fetch_step = AgentStep(
        agent_name=AGENT_NAME,
        action="fetch_data",
        result={
            "sources_used": rag_result["sources_used"],
            "documents_found": rag_result["documents_found"],
        },
    )

    data = rag_result["context"].get("database", {})

    return {
        "steps": [val_step, fetch_step],
        "domain_data": {
            "step": "validate_and_fetch",
            "is_valid": val_result["is_valid"],
            "validation_errors": val_result["errors"],
            "data": data,
            "data_sources": rag_result["sources_used"],
        },
    }


# =============================================================================
# NO 2: ANALISAR (LLM com fallback)
# =============================================================================

async def analyze(state: AgentState) -> dict[str, Any]:
    """
    Analisa dados do dominio usando LLM com fallback.
    """
    logger.info(f"[{AGENT_NAME}] Node 2: Analyze...")

    domain_data = state.get("domain_data", {})
    data = domain_data.get("data", {})

    # <-- MUDAR: formatar contexto especifico do dominio
    context = f"Dados de {DOMAIN_NAME}:\n{str(data)[:1500]}"

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=ANALYSIS_SYSTEM_PROMPT.format(domain=DOMAIN_NAME)),
        HumanMessage(content=f"Analise os dados:\n{context}"),
    ])

    llm = create_llm_with_fallback()
    chain = prompt | llm | StrOutputParser()

    try:
        analysis_text = await chain.ainvoke({})

        # <-- MUDAR: extrair insights especificos do dominio
        insights = []
        if "risco" in analysis_text.lower():
            insights.append("Riscos identificados")

        step = AgentStep(
            agent_name=AGENT_NAME,
            action="analyze",
            result={
                "analysis_length": len(analysis_text),
                "insights_count": len(insights),
            },
        )

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "analyze",
                "analysis": analysis_text,
                "insights": insights,
            },
        }

    except Exception as e:
        logger.error(f"[{AGENT_NAME}] Analysis error: {e}")
        step = AgentStep(
            agent_name=AGENT_NAME,
            action="analyze",
            error=str(e),
            result={},
        )
        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                **domain_data,
                "step": "analyze",
                "analysis": f"Erro: {str(e)}",
                "insights": [],
            },
        }


# =============================================================================
# NO 3: GERAR SAIDA (LLM com fallback)
# =============================================================================

async def generate_output(state: AgentState) -> dict[str, Any]:
    """
    Gera parecer/relatorio final usando LLM com fallback.
    """
    logger.info(f"[{AGENT_NAME}] Node 3: Generate output...")

    domain_data = state.get("domain_data", {})
    analysis = domain_data.get("analysis", "")
    insights = domain_data.get("insights", [])

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=OUTPUT_SYSTEM_PROMPT.format(domain=DOMAIN_NAME)),
        HumanMessage(content=(
            f"Analise:\n{analysis}\n\n"
            f"Insights:\n{', '.join(insights)}\n\n"
            f"Gere o parecer executivo."
        )),
    ])

    llm = create_llm_with_fallback()
    chain = prompt | llm | StrOutputParser()

    try:
        output_text = await chain.ainvoke({})

        # <-- MUDAR: recomendacoes especificas do dominio
        recommendations = [
            "Recomendacao 1",
            "Recomendacao 2",
        ]

        step = AgentStep(
            agent_name=AGENT_NAME,
            action="generate_output",
            result={
                "output_length": len(output_text),
                "recommendations_count": len(recommendations),
            },
        )

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "generate_output",
                "output": output_text,
                "recommendations": recommendations,
                "agent": DOMAIN_NAME,
                "status": "complete",
            },
        }

    except Exception as e:
        logger.error(f"[{AGENT_NAME}] Output error: {e}")
        step = AgentStep(
            agent_name=AGENT_NAME,
            action="generate_output",
            error=str(e),
            result={},
        )
        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                **domain_data,
                "step": "generate_output",
                "output": f"Erro: {str(e)}",
                "recommendations": [],
                "agent": DOMAIN_NAME,
                "status": "error",
            },
        }


# =============================================================================
# CONSTRUTOR DO SUB-GRAFO
# =============================================================================

def build_example_subgraph() -> Any:
    """
    Constroi o sub-grafo compilado.

    Estrutura:
        START -> validate_and_fetch -> analyze -> output -> END
    """
    graph = StateGraph(AgentState)

    graph.add_node("validate_and_fetch", validate_and_fetch)
    graph.add_node("analyze", analyze)
    graph.add_node("output", generate_output)

    graph.add_edge(START, "validate_and_fetch")
    graph.add_edge("validate_and_fetch", "analyze")
    graph.add_edge("analyze", "output")
    graph.add_edge("output", END)

    logger.info(f"[{AGENT_NAME}] Subgraph compiled: 3 nodes")

    return graph.compile()


# =============================================================================
# LAZY LOADING
# =============================================================================

_subgraph = None


async def get_example_subgraph() -> Any:
    """Retorna o sub-grafo (lazy loading)."""
    global _subgraph
    if _subgraph is None:
        _subgraph = build_example_subgraph()
    return _subgraph
