"""
agents/accounting_agent.py — Sub-grafo de Análise Contábil (Composição de Módulos)

EXEMPLO: Como usar os módulos reutilizáveis dinamicamente.

Este sub-grafo NÃO reinventa a roda. Ao invés disso:
1. Importa e compõe módulos genéricos
2. Customiza o comportamento conforme necessário
3. Permite adicionar/remover módulos dinamicamente

Composição Dinâmica:
    validate_document → fetch_data → analyze_accounts → check_compliance → format_report

Cada passo é um MÓDULO reutilizável que pode ser:
- Importado por outros sub-grafos
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

async def validate_accounting_context(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico validate_document_module customizado para accounting.
    """
    logger.info("📋 Nó 1: Validando contexto contábil (via módulo)...")

    # Chamar módulo com parâmetros customizados
    result = await validate_document_module(
        state,
        domain="accounting",
        required_fields=["user_id", "categoria"],
    )

    return result


# ─── Nó 2: Buscar Dados Contábeis (usa módulo genérico) ───────────────────

async def fetch_accounting_data(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico fetch_data_module customizado para accounting.

    Exemplo de composição: pode chamar múltiplas fontes.
    """
    logger.info("🔍 Nó 2: Buscando dados contábeis (via módulo)...")

    # Chamar módulo com múltiplas fontes
    result = await fetch_data_module(
        state,
        domain="accounting",
        sources=["database", "api", "rag"],  # Compõe múltiplas fontes!
    )

    return result


# ─── Nó 3: Analisar Contas (lógica específica de accounting) ────────────────

async def analyze_accounting_data(state: AgentState) -> dict[str, Any]:
    """
    Lógica especializada para accounting.

    Este nó NÃO é um módulo genérico (é específico da contabilidade).
    Poderia usar módulos de compliance internamente.
    """
    logger.info("📊 Nó 3: Analisando dados contábeis...")

    model = get_default_model()
    domain_data = state.get("domain_data", {})
    module_result = domain_data.get("module_result", {})

    # Extrair dados dos módulos anteriores
    all_data = module_result.get("data", {})

    # Preparar análise contábil
    context = f"""
    Dados Contábeis:
    {str(all_data)[:500]}

    Analise:
    1. Conformidade com IFRS
    2. Estrutura de contas
    3. Saldos contábeis
    4. Lançamentos registrados
    """

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            "Você é um analista contábil. "
            "Analise a estrutura contábil fornecida e identifique:"
            "1. Conformidade com IFRS/CPC"
            "2. Riscos contábeis"
            "3. Oportunidades de otimização"
        ),
        HumanMessage(content=context),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        analysis = result.content

        step = AgentStep(
            agent_name="accounting_agent",
            action="analyze_accounting_data",
            result={"analysis_length": len(analysis)},
        )

        logger.info("✓ Análise contábil completa")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "analyze_accounting",
                "accounting_analysis": analysis,
            },
        }

    except Exception as e:
        logger.error(f"❌ Erro na análise: {e}")
        return {
            "steps": [
                AgentStep(
                    agent_name="accounting_agent",
                    action="analyze_accounting_data",
                    error=str(e),
                    result={},
                )
            ],
            "error": str(e),
        }


# ─── Nó 4: Verificar Compliance (usa módulo genérico) ─────────────────────

async def check_accounting_compliance(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico check_compliance_module customizado para accounting.
    """
    logger.info("⚖️  Nó 4: Verificando compliance contábil (via módulo)...")

    domain_data = state.get("domain_data", {})
    data_to_check = domain_data.get("accounting_analysis", "")

    # Chamar módulo com standards contábeis
    result = await check_compliance_module(
        state,
        domain="accounting",
        data_to_check={"analysis": data_to_check},
        compliance_standards=["ifrs", "cpc", "nbr_contabil"],
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

async def format_accounting_report(state: AgentState) -> dict[str, Any]:
    """
    Usa o módulo genérico format_report_module customizado para accounting.

    Exemplo de composição final: agrega resultados em relatório estruturado.
    """
    logger.info("📄 Nó 5: Formatando relatório contábil (via módulo)...")

    domain_data = state.get("domain_data", {})

    # Preparar dados para relatório
    report_data = {
        "domain": "accounting",
        "status": domain_data.get("compliance_status", "unknown"),
        "analysis": domain_data.get("accounting_analysis", "")[:200],
        "compliance": domain_data.get("compliance_analysis", "")[:200],
    }

    # Chamar módulo de formatação
    result = await format_report_module(
        state,
        domain="accounting",
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
            "agent": "accounting",
            "status": "complete",
        },
    }


# ─── Construtor do Sub-grafo ─────────────────────────────────────────────────

def build_accounting_subgraph() -> Any:
    """
    Constrói o sub-grafo contábil COMPOSTOS DE MÓDULOS.

    Arquitetura:
        START → validate → fetch → analyze → check_compliance → format → END

    Cada nó (exceto analyze) é composto de MÓDULOS reutilizáveis!
    """
    graph = StateGraph(AgentState)

    # Adiciona nós
    graph.add_node("validate", validate_accounting_context)
    graph.add_node("fetch", fetch_accounting_data)
    graph.add_node("analyze", analyze_accounting_data)
    graph.add_node("compliance", check_accounting_compliance)
    graph.add_node("format", format_accounting_report)

    # Define arestas
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "fetch")
    graph.add_edge("fetch", "analyze")
    graph.add_edge("analyze", "compliance")
    graph.add_edge("compliance", "format")
    graph.add_edge("format", END)

    logger.info("🔨 Sub-grafo contábil compilado (composição de módulos)")

    return graph.compile()


# ─── Lazy Loading ────────────────────────────────────────────────────────────

_accounting_subgraph = None


async def get_accounting_subgraph() -> Any:
    """Retorna sub-grafo contábil (lazy loading)."""
    global _accounting_subgraph
    if _accounting_subgraph is None:
        _accounting_subgraph = build_accounting_subgraph()
    return _accounting_subgraph
