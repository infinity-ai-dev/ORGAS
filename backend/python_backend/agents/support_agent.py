"""
agents/support_agent.py — Sub-grafo de Suporte/Atendimento (Composição de Módulos)

EXEMPLO: Como usar os módulos reutilizáveis para o domínio de suporte.

Este sub-grafo segue o padrão modular:
1. Importa e compõe módulos genéricos
2. Customiza o comportamento para atendimento
3. Permite adicionar/remover módulos dinamicamente

Composição Dinâmica:
    validate_document → fetch_data → categorize_ticket → check_compliance → format_report

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

async def validate_support_context(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico validate_document_module customizado para support.
    """
    logger.info("📋 Nó 1: Validando contexto de suporte (via módulo)...")

    # Chamar módulo com parâmetros customizados para suporte
    result = await validate_document_module(
        state,
        domain="support",
        required_fields=["user_id", "ticket_id", "category"],
    )

    return result


# ─── Nó 2: Buscar Dados de Suporte (usa módulo genérico) ────────────────────

async def fetch_support_data(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico fetch_data_module customizado para support.

    Busca histórico de ticket, FAQ, documentos de suporte.
    """
    logger.info("🔍 Nó 2: Buscando dados de suporte (via módulo)...")

    # Chamar módulo com múltiplas fontes
    # Support combina: database (histórico), rag (FAQ/documentos)
    result = await fetch_data_module(
        state,
        domain="support",
        sources=["database", "rag"],  # DB: histórico; RAG: FAQ/documentos
    )

    return result


# ─── Nó 3: Categorizar Ticket (lógica específica de support) ────────────────

async def categorize_ticket(state: AgentState) -> dict[str, Any]:
    """
    Lógica especializada para suporte: categorização de ticket.

    Este nó NÃO é um módulo genérico (é específico de suporte).
    Classifica ticket em categorias e prioridades.
    """
    logger.info("🏷️  Nó 3: Categorizando ticket...")

    model = get_default_model()
    domain_data = state.get("domain_data", {})
    module_result = domain_data.get("module_result", {})

    # Extrair dados dos módulos anteriores
    all_data = module_result.get("data", {})

    # Preparar análise de categorização
    context = f"""
    Dados do Ticket:
    {str(all_data)[:500]}

    Analise e categorize:
    1. Categoria principal (técnico, billing, dados, outro)
    2. Prioridade (crítico, alto, médio, baixo)
    3. Tempo estimado de resolução
    4. Área responsável
    5. Documentos FAQ relevantes
    """

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            "Você é um gestor de suporte. "
            "Analise o ticket e forneça categorização detalhada com:"
            "1. Categoria principal"
            "2. Nível de prioridade"
            "3. Tempo estimado de resposta"
            "4. Área responsável"
            "5. Documentos FAQ ou soluções relevantes"
        ),
        HumanMessage(content=context),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        analysis = result.content

        step = AgentStep(
            agent_name="support_agent",
            action="categorize_ticket",
            result={"analysis_length": len(analysis)},
        )

        logger.info("✓ Ticket categorizado")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "categorize_ticket",
                "ticket_categorization": analysis,
            },
        }

    except Exception as e:
        logger.error(f"❌ Erro na categorização: {e}")
        return {
            "steps": [
                AgentStep(
                    agent_name="support_agent",
                    action="categorize_ticket",
                    error=str(e),
                    result={},
                )
            ],
            "error": str(e),
        }


# ─── Nó 4: Verificar Compliance (usa módulo genérico) ─────────────────────

async def check_support_compliance(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico check_compliance_module customizado para support.

    Verifica SLA, tempo de resposta, padrões de atendimento.
    """
    logger.info("⚖️  Nó 4: Verificando compliance de suporte (via módulo)...")

    domain_data = state.get("domain_data", {})
    data_to_check = domain_data.get("ticket_categorization", "")

    # Chamar módulo com standards de suporte (SLA, resposta, satisfação)
    result = await check_compliance_module(
        state,
        domain="support",
        data_to_check={"analysis": data_to_check},
        compliance_standards=["sla", "response_time", "satisfaction"],
    )

    return {
        "steps": result.get("steps", []),
        "domain_data": {
            **domain_data,
            "step": "check_compliance",
            **result.get("module_result", {}),
        },
    }


# ─── Nó 5: Formatar Relatório (usa módulo genérico) ────────────────────────

async def format_support_report(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico format_report_module customizado para support.

    Exemplo de composição final: agrega resultados em relatório estruturado.
    """
    logger.info("📄 Nó 5: Formatando relatório de suporte (via módulo)...")

    domain_data = state.get("domain_data", {})

    # Preparar dados para relatório
    report_data = {
        "domain": "support",
        "ticket_id": state.get("messages", [{}])[0].content[:50] if state.get("messages") else "N/A",
        "status": domain_data.get("compliance_status", "unknown"),
        "categorization": domain_data.get("ticket_categorization", "")[:200],
        "compliance": domain_data.get("compliance_analysis", "")[:200],
    }

    # Chamar módulo de formatação
    result = await format_report_module(
        state,
        domain="support",
        data_to_format=report_data,
        output_format="markdown",
        include_summary=True,
        include_recommendations=True,
    )

    return {
        "steps": result.get("steps", []),
        "domain_data": {
            **domain_data,
            "step": "format_report",
            "final_report": result.get("module_result", {}).get("formatted_report", ""),
            "agent": "support",
            "status": "complete",
        },
    }


# ─── Construtor do Sub-grafo ─────────────────────────────────────────────────

def build_support_subgraph() -> Any:
    """
    Constrói o sub-grafo de suporte COMPOSTO DE MÓDULOS.

    Arquitetura:
        START → validate → fetch → categorize → check_compliance → format → END

    Cada nó (exceto categorize) é composto de MÓDULOS reutilizáveis!
    """
    graph = StateGraph(AgentState)

    # Adiciona nós
    graph.add_node("validate", validate_support_context)
    graph.add_node("fetch", fetch_support_data)
    graph.add_node("categorize", categorize_ticket)
    graph.add_node("compliance", check_support_compliance)
    graph.add_node("format", format_support_report)

    # Define arestas
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "fetch")
    graph.add_edge("fetch", "categorize")
    graph.add_edge("categorize", "compliance")
    graph.add_edge("compliance", "format")
    graph.add_edge("format", END)

    logger.info("🔨 Sub-grafo de suporte compilado (composição de módulos)")

    return graph.compile()


# ─── Lazy Loading ────────────────────────────────────────────────────────────

_support_subgraph = None


async def get_support_subgraph() -> Any:
    """Retorna sub-grafo de suporte (lazy loading)."""
    global _support_subgraph
    if _support_subgraph is None:
        _support_subgraph = build_support_subgraph()
    return _support_subgraph
