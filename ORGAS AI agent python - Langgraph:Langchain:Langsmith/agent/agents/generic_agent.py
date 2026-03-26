"""
agents/generic_agent.py — Sub-grafo Genérico/Q&A (Composição de Módulos)

EXEMPLO: Como usar os módulos reutilizáveis para o domínio genérico de Q&A.

Este sub-grafo segue o padrão modular:
1. Importa e compõe módulos genéricos
2. Customiza o comportamento para Q&A com RAG
3. Permite adicionar/remover módulos dinamicamente

Composição Dinâmica:
    validate_document → fetch_data_rag → answer_question → check_compliance → format_report

Cada passo é um MÓDULO reutilizável ou lógica especializada que pode ser:
- Reutilizado por outros sub-grafos
- Customizado com parâmetros
- Substituído por versão especializada
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

from core.state import AgentState, AgentStep
from core.model import get_default_model

# 🔑 IMPORTAR MÓDULOS REUTILIZÁVEIS
from agents.modules.document_validator import validate_document_module
from agents.modules.data_retriever import fetch_data_module
from agents.modules.compliance_checker import check_compliance_module
from agents.modules.report_formatter import format_report_module

logger = logging.getLogger(__name__)


# ─── Nó 1: Validar Contexto (usa módulo genérico) ────────────────────────

async def validate_generic_context(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico validate_document_module customizado para generic.

    Para Q&A genérico, valida se temos uma pergunta bem formada.
    """
    logger.info("📋 Nó 1: Validando pergunta (via módulo)...")

    # Chamar módulo com parâmetros customizados para generic
    result = await validate_document_module(
        state,
        domain="generic",
        required_fields=["user_id", "question"],
    )

    return result


# ─── Nó 2: Buscar Dados (usa módulo genérico com RAG) ────────────────────

async def fetch_generic_data(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico fetch_data_module customizado para generic.

    Generic combina: database (contexto do usuário) e rag (documentos/FAQ).
    Prioriza RAG para respostas informativas.
    """
    logger.info("🔍 Nó 2: Buscando dados para responder (via módulo)...")

    # Chamar módulo com múltiplas fontes
    # Generic: DB (contexto) + RAG (documentos, FAQ, conhecimento)
    result = await fetch_data_module(
        state,
        domain="generic",
        sources=["database", "rag"],  # DB: contexto do usuário; RAG: conhecimento
    )

    return result


# ─── Nó 3: Responder Pergunta (lógica específica de Q&A) ────────────────────

async def answer_question(state: AgentState) -> dict[str, Any]:
    """
    Lógica especializada para Q&A: geração de resposta.

    Este nó NÃO é um módulo genérico (é específico de Q&A).
    Gera resposta contextualizada baseada em dados recuperados.
    """
    logger.info("🤔 Nó 3: Respondendo pergunta...")

    model = get_default_model()
    domain_data = state.get("domain_data", {})
    module_result = domain_data.get("module_result", {})

    # Extrair dados dos módulos anteriores
    all_data = module_result.get("data", {})

    # Extrair pergunta original
    question = ""
    if state.get("messages"):
        question = state["messages"][-1].content

    # Preparar contexto para resposta
    context = f"""
    Pergunta do Usuário:
    {question}

    Contexto Recuperado:
    {str(all_data)[:1000]}

    Gere uma resposta clara, precisa e útil baseada no contexto.
    Se o contexto não tiver informação suficiente, indique o que está faltando.
    """

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            "Você é um assistente especializado em responder perguntas. "
            "Baseie-se no contexto fornecido para oferecer respostas precisas e úteis. "
            "Se necessário, peça esclarecimentos ou indique limitações."
        ),
        HumanMessage(content=context),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        answer = result.content

        step = AgentStep(
            agent_name="generic_agent",
            action="answer_question",
            result={"answer_length": len(answer)},
        )

        logger.info("✓ Resposta gerada")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "answer_question",
                "answer": answer,
                "question": question,
            },
        }

    except Exception as e:
        logger.error(f"❌ Erro ao responder: {e}")
        return {
            "steps": [
                AgentStep(
                    agent_name="generic_agent",
                    action="answer_question",
                    error=str(e),
                    result={},
                )
            ],
            "error": str(e),
        }


# ─── Nó 4: Verificar Compliance (usa módulo genérico) ─────────────────────

async def check_generic_compliance(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico check_compliance_module customizado para generic.

    Para Q&A genérico, verifica conformidade da resposta com padrões gerais.
    """
    logger.info("⚖️  Nó 4: Verificando conformidade da resposta (via módulo)...")

    domain_data = state.get("domain_data", {})
    data_to_check = domain_data.get("answer", "")

    # Chamar módulo - para generic, usa standards genéricos
    result = await check_compliance_module(
        state,
        domain="generic",
        data_to_check={"answer": data_to_check},
        compliance_standards=["accuracy", "completeness", "clarity"],
    )

    return {
        "steps": result.get("steps", []),
        "domain_data": {
            **domain_data,
            "step": "check_compliance",
            **result.get("module_result", {}),
        },
    }


# ─── Nó 5: Formatar Resposta (usa módulo genérico) ────────────────────────

async def format_generic_response(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico format_report_module customizado para generic.

    Formata a resposta final de forma estruturada e profissional.
    """
    logger.info("📄 Nó 5: Formatando resposta final (via módulo)...")

    domain_data = state.get("domain_data", {})

    # Preparar dados para formatação
    report_data = {
        "domain": "generic",
        "question": domain_data.get("question", "")[:100],
        "answer": domain_data.get("answer", "")[:500],
        "compliance_status": domain_data.get("compliance_status", "unknown"),
    }

    # Chamar módulo de formatação
    result = await format_report_module(
        state,
        domain="generic",
        data_to_format=report_data,
        output_format="markdown",
        include_summary=False,
        include_recommendations=True,
    )

    return {
        "steps": result.get("steps", []),
        "domain_data": {
            **domain_data,
            "step": "format_response",
            "final_response": result.get("module_result", {}).get("formatted_report", ""),
            "agent": "generic",
            "status": "complete",
        },
    }


# ─── Construtor do Sub-grafo ─────────────────────────────────────────────────

def build_generic_subgraph() -> Any:
    """
    Constrói o sub-grafo genérico COMPOSTO DE MÓDULOS.

    Arquitetura:
        START → validate → fetch → answer → check_compliance → format → END

    Cada nó (exceto answer) é composto de MÓDULOS reutilizáveis!
    """
    graph = StateGraph(AgentState)

    # Adiciona nós
    graph.add_node("validate", validate_generic_context)
    graph.add_node("fetch", fetch_generic_data)
    graph.add_node("answer", answer_question)
    graph.add_node("compliance", check_generic_compliance)
    graph.add_node("format", format_generic_response)

    # Define arestas
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "fetch")
    graph.add_edge("fetch", "answer")
    graph.add_edge("answer", "compliance")
    graph.add_edge("compliance", "format")
    graph.add_edge("format", END)

    logger.info("🔨 Sub-grafo genérico compilado (composição de módulos)")

    return graph.compile()


# ─── Lazy Loading ────────────────────────────────────────────────────────────

_generic_subgraph = None


async def get_generic_subgraph() -> Any:
    """Retorna sub-grafo genérico (lazy loading)."""
    global _generic_subgraph
    if _generic_subgraph is None:
        _generic_subgraph = build_generic_subgraph()
    return _generic_subgraph
