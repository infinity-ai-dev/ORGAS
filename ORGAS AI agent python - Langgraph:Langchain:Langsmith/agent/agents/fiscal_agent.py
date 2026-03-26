"""
agents/fiscal_agent.py — Sub-grafo Especializado em Análise Fiscal

Arquitetura em 4 nós:
1. validate_fiscal_context - Validar dados fiscais disponíveis
2. fetch_fiscal_data - Recuperar dados fiscais (DB/API/RAG)
3. analyze_compliance - Analisar conformidade fiscal com LLM
4. generate_fiscal_opinion - Gerar parecer fiscal finalizado

Retorna:
    dict com domain_data preenchido para o orquestrador consolidar
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

from core.state import AgentState, AgentStep
from core.model import get_default_model

logger = logging.getLogger(__name__)


# ─── Nó 1: Validar Contexto Fiscal ──────────────────────────────────────────

async def validate_fiscal_context(state: AgentState) -> dict[str, Any]:
    """
    Valida se temos dados fiscais suficientes para análise.

    Verifica:
    - regime_tributario está configurado?
    - hay mensagens com contexto fiscal?
    - cliente tem dados cadastrados?

    Returns:
        {"fiscal_context_valid": bool, "validation_errors": list[str]}
    """
    logger.info("📋 Nó 1: Validando contexto fiscal...")

    validation_errors: list[str] = []
    session = state.get("session")

    # Validações básicas
    if not session or not session.get("regime_tributario"):
        validation_errors.append("Regime tributário não configurado")

    if not state.get("messages"):
        validation_errors.append("Nenhuma mensagem fornecida")

    if not session or not session.get("user_id"):
        validation_errors.append("Usuário não identificado")

    is_valid = len(validation_errors) == 0

    logger.info(
        f"✓ Validação: {'PASSOU' if is_valid else 'FALHOU'} "
        f"({len(validation_errors)} erros)"
    )

    # Registra passo
    step = AgentStep(
        agent_name="fiscal_agent",
        action="validate_fiscal_context",
        result={
            "is_valid": is_valid,
            "validation_errors": validation_errors,
        },
    )

    return {
        "steps": [step],
        "domain_data": {
            "step": "validate_fiscal_context",
            "is_valid": is_valid,
            "validation_errors": validation_errors,
        },
    }


# ─── Nó 2: Buscar Dados Fiscais ──────────────────────────────────────────────

async def fetch_fiscal_data(state: AgentState) -> dict[str, Any]:
    """
    Recupera dados fiscais do banco de dados, APIs externas ou RAG.

    Em produção, integraria com:
    - Database: SELECT de tabelas fiscais
    - APIs: SEFAZ, Receita Federal, etc.
    - RAG: Busca semântica em documentos fiscais

    Para este template, usamos dados de exemplo.

    Returns:
        {"fiscal_data": dict, "data_sources": list[str]}
    """
    logger.info("🔍 Nó 2: Buscando dados fiscais...")

    session = state.get("session")
    user_id = session.get("user_id") if session else None

    # EXEMPLO: Dados fictícios
    # Em produção, substituir por:
    #   - db.query(FiscalData).filter(user_id=user_id)
    #   - await fetch_from_sefaz(user_id)
    #   - await semantic_memory.search(query)
    fiscal_data = {
        "user_id": user_id,
        "regime_tributario": session.get("regime_tributario") if session else None,
        "receita_bruta_2024": 500000.00,
        "despesas_dedutivas_2024": 150000.00,
        "imposto_devido_2024": 70000.00,
        "imposto_pago_2024": 65000.00,
        "diferenca": -5000.00,
        "ultima_atualizacao": "2024-12-31",
        "status_compliance": "pending",
        "obrigacoes_acessorias": [
            "ECF",
            "ECD",
            "LALUR",
            "DIPJ",
        ],
    }

    step = AgentStep(
        agent_name="fiscal_agent",
        action="fetch_fiscal_data",
        result={
            "data_sources": ["database", "calendar"],
            "records_found": len(fiscal_data),
        },
    )

    logger.info(f"✓ {len(fiscal_data)} campos de dados fiscais recuperados")

    return {
        "steps": [step],
        "domain_data": {
            **state.get("domain_data", {}),
            "step": "fetch_fiscal_data",
            "fiscal_data": fiscal_data,
            "data_sources": ["database", "calendar"],
        },
    }


# ─── Nó 3: Analisar Conformidade ────────────────────────────────────────────

async def analyze_compliance(state: AgentState) -> dict[str, Any]:
    """
    Analisa conformidade fiscal usando LLM.

    O LLM:
    - Compara dados com legislação fiscal
    - Identifica gaps de conformidade
    - Sugere ações corretivas
    - Calcula exposição a risco

    Returns:
        {"compliance_analysis": dict, "risks_identified": list[str]}
    """
    logger.info("⚖️ Nó 3: Analisando conformidade fiscal...")

    model = get_default_model()
    domain_data = state.get("domain_data", {})
    fiscal_data = domain_data.get("fiscal_data", {})

    # Prepara contexto para o LLM
    context = f"""
    Regime Tributário: {fiscal_data.get('regime_tributario', 'N/A')}
    Receita Bruta 2024: R$ {fiscal_data.get('receita_bruta_2024', 0):,.2f}
    Despesas Dedutivas: R$ {fiscal_data.get('despesas_dedutivas_2024', 0):,.2f}
    Imposto Devido: R$ {fiscal_data.get('imposto_devido_2024', 0):,.2f}
    Imposto Pago: R$ {fiscal_data.get('imposto_pago_2024', 0):,.2f}
    Diferença: R$ {fiscal_data.get('diferenca', 0):,.2f}
    Obrigações Acessórias: {', '.join(fiscal_data.get('obrigacoes_acessorias', []))}
    """

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            "Você é um analista fiscal especializado. "
            "Analise os dados fiscais e: "
            "1. Identifique conformidade com legislação brasileira "
            "2. Aponte riscos fiscais "
            "3. Sugira ações corretivas "
            "4. Avalie exposição fiscal "
            "Seja técnico mas compreensível."
        ),
        HumanMessage(content=f"Analise os dados fiscais:\n{context}"),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        analysis_text = result.content

        # Extrai insights (em produção, usar estruturado via output_parser)
        risks = []
        if "diferença" in analysis_text.lower():
            risks.append("Diferença entre imposto devido e pago")
        if "acessória" in analysis_text.lower():
            risks.append("Verificar cumprimento de obrigações acessórias")

        step = AgentStep(
            agent_name="fiscal_agent",
            action="analyze_compliance",
            result={
                "risks_count": len(risks),
                "analysis_length": len(analysis_text),
            },
        )

        logger.info(f"✓ Análise completa: {len(risks)} riscos identificados")

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
        logger.error(f"❌ Erro ao analisar conformidade: {e}")
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


# ─── Nó 4: Gerar Parecer Fiscal ─────────────────────────────────────────────

async def generate_fiscal_opinion(state: AgentState) -> dict[str, Any]:
    """
    Gera parecer fiscal finalizado resumindo a análise.

    O parecer inclui:
    - Resumo executivo
    - Recomendações
    - Próximos passos
    - Referências legais

    Returns:
        {"fiscal_opinion": str, "recommendations": list[str]}
    """
    logger.info("📄 Nó 4: Gerando parecer fiscal...")

    model = get_default_model()
    domain_data = state.get("domain_data", {})
    compliance_analysis = domain_data.get("compliance_analysis", "")
    risks = domain_data.get("risks_identified", [])

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            "Você é um consultor fiscal sênior. "
            "Baseado na análise de conformidade, gere um parecer fiscal executivo com: "
            "1. Resumo do status fiscal "
            "2. Principais achados "
            "3. Recomendações prioritárias (máx 5) "
            "4. Próximos passos "
            "Use tom profissional e conclusivo."
        ),
        HumanMessage(
            content=(
                f"Análise de Conformidade:\n{compliance_analysis}\n\n"
                f"Riscos Identificados:\n{', '.join(risks)}\n\n"
                f"Gere um parecer executivo."
            )
        ),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        opinion_text = result.content

        # Extrai recomendações (em produção, usar estruturado)
        recommendations = [
            "Revisar cálculos de imposto devido vs pago",
            "Verificar documentação de despesas dedutivas",
            "Validar cumprimento de obrigações acessórias",
        ]

        step = AgentStep(
            agent_name="fiscal_agent",
            action="generate_fiscal_opinion",
            result={
                "opinion_length": len(opinion_text),
                "recommendations_count": len(recommendations),
            },
        )

        logger.info(f"✓ Parecer gerado com {len(recommendations)} recomendações")

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
        logger.error(f"❌ Erro ao gerar parecer: {e}")
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


# ─── Construtor do Sub-grafo ─────────────────────────────────────────────────

def build_fiscal_subgraph() -> Any:
    """
    Constrói o sub-grafo fiscal compilado.

    Estrutura:
        START → validate → fetch → analyze → opinion → END

    Returns:
        Grafo compilado pronto para invocar
    """
    graph = StateGraph(AgentState)

    # Adiciona nós
    graph.add_node("validate", validate_fiscal_context)
    graph.add_node("fetch", fetch_fiscal_data)
    graph.add_node("analyze", analyze_compliance)
    graph.add_node("opinion", generate_fiscal_opinion)

    # Define arestas (fluxo linear)
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "fetch")
    graph.add_edge("fetch", "analyze")
    graph.add_edge("analyze", "opinion")
    graph.add_edge("opinion", END)

    logger.info("🔨 Sub-grafo fiscal compilado com 4 nós")

    return graph.compile()


# ─── Lazy Loading (chamado pelo orquestrador) ────────────────────────────────

_fiscal_subgraph = None


async def get_fiscal_subgraph() -> Any:
    """
    Retorna o sub-grafo fiscal (lazy loading para otimizar memória).

    Returns:
        Sub-grafo compilado
    """
    global _fiscal_subgraph
    if _fiscal_subgraph is None:
        _fiscal_subgraph = build_fiscal_subgraph()
    return _fiscal_subgraph
