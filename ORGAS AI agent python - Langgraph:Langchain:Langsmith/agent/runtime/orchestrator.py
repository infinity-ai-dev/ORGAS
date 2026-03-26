"""
runtime/orchestrator.py — Grafo Orquestrador (Grafo Pai)

Arquitetura LangGraph com:
1. Detecção dinâmica de intenção via LLM
2. Roteamento para sub-grafos especializados
3. Consolidação de respostas
4. Human-in-the-loop para operações de risco
5. Logging estruturado e observabilidade

Padrão: Supervisor com sub-grafos independentes.
"""

from __future__ import annotations

import logging
from typing import Any, Literal, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command

from core.state import AgentState
from core.model import get_default_model
from agents.fiscal_agent import get_fiscal_subgraph
from agents.personal_agent import get_personal_subgraph
from agents.accounting_agent import get_accounting_subgraph
from agents.support_agent import get_support_subgraph
from agents.generic_agent import get_generic_subgraph

logger = logging.getLogger(__name__)

# Agentes de alto risco que exigem aprovação humana (HITL)
HIGH_RISK_AGENTS: set[str] = {
    "fiscal_transfer",
    "email_sender",
    "data_deletion",
    "payment",
}


# ─── Nó 1: Detectar Intenção ────────────────────────────────────────────────

async def detect_intent(state: AgentState) -> Command[Literal["route", END]]:
    """
    Detecta a intenção do usuário via LLM e roteia dinamicamente.
    Usa Command para combinar:
    - Update de state (tipo_parecer, intent)
    - Routing (goto next node)

    Returns:
        Command com intenção detectada e próximo nó
    """
    last_message = state["messages"][-1].content if state["messages"] else ""

    model = get_default_model()

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            "Você é um roteador de intenções inteligente. "
            "Analise a mensagem e determine o tipo de análise necessária.\n"
            "Categorias: fiscal, contabil, pessoal, atendimento, generico\n"
            "Responda com APENAS uma palavra."
        ),
        HumanMessage(content=last_message),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        intent_text = result.content.strip().lower()

        # Normaliza para categorias conhecidas
        tipo_parecer = "generico"
        if "fiscal" in intent_text:
            tipo_parecer = "fiscal"
        elif "contab" in intent_text or "contábil" in intent_text:
            tipo_parecer = "contabil"
        elif "pessoal" in intent_text or "pessoa" in intent_text:
            tipo_parecer = "pessoal"
        elif "atendimento" in intent_text or "chamado" in intent_text:
            tipo_parecer = "atendimento"

        logger.info(f"Intent detectada: {tipo_parecer}")

        # Retorna Command: update + routing
        return Command(
            update={
                "intent": intent_text,
                "tipo_parecer": tipo_parecer,
                "iteration_count": state.get("iteration_count", 0) + 1,
            },
            goto="route",
        )

    except Exception as e:
        logger.error(f"Erro ao detectar intenção: {e}")
        return Command(
            update={
                "intent": None,
                "tipo_parecer": "generico",
                "error": str(e),
                "iteration_count": state.get("iteration_count", 0) + 1,
            },
            goto="route",
        )


# ─── Nó 2: Rotear para Sub-grafo ────────────────────────────────────────────

async def route_to_subgraph(state: AgentState) -> Command[
    Literal["fiscal_agent", "accounting_agent", "personal_agent", "support_agent", "generic_agent"]
]:
    """
    Roteia para o sub-grafo apropriado.

    Mapeia tipo_parecer -> agente especializado.
    """
    tipo = state.get("tipo_parecer") or "generico"

    # Mapeamento tipo -> sub-grafo
    subgraph_map = {
        "fiscal": "fiscal_agent",
        "contabil": "accounting_agent",
        "pessoal": "personal_agent",
        "atendimento": "support_agent",
        "generico": "generic_agent",
    }

    agent_name = subgraph_map.get(tipo, "generic_agent")
    logger.info(f"Roteando para: {agent_name}")

    return Command(
        update={"active_agent": agent_name},
        goto=agent_name,
    )


# ─── Nó 3a: Sub-grafo Fiscal ────────────────────────────────────────────────

async def fiscal_agent(state: AgentState) -> dict:
    """
    Sub-grafo especializado em análise fiscal.

    Invoca o sub-grafo compilado que executa:
    1. Validação de contexto fiscal
    2. Busca de dados fiscais
    3. Análise de conformidade
    4. Geração de parecer

    Returns:
        domain_data com resultados da análise fiscal
    """
    logger.info("🔄 Invocando sub-grafo FISCAL...")

    try:
        # Lazy-loaded subgraph
        fiscal_subgraph = await get_fiscal_subgraph()

        # Invoca o sub-grafo com o estado atual
        result = await fiscal_subgraph.ainvoke(state)

        logger.info("✅ Sub-grafo FISCAL completado")

        # Retorna os dados atualizados
        return {
            "domain_data": result.get("domain_data", {}),
            "steps": result.get("steps", []),
            "error": result.get("error"),
        }

    except Exception as e:
        logger.error(f"❌ Erro no sub-grafo FISCAL: {e}")
        return {
            "domain_data": {
                "agent": "fiscal",
                "status": "error",
                "error": str(e),
            },
            "error": str(e),
        }


# ─── Nó 3b: Sub-grafo Contábil (Composição de Módulos) ───────────────────

async def accounting_agent(state: AgentState) -> dict:
    """
    Sub-grafo especializado em análise contábil.

    ✨ EXEMPLO: Composição de Módulos Dinâmicos

    Arquitetura:
    1. validate_document_module (genérico customizado)
    2. fetch_data_module (genérico + múltiplas fontes)
    3. analyze_accounting_data (lógica especializada)
    4. check_compliance_module (genérico com standards contábeis)
    5. format_report_module (genérico com template contábil)

    Cada módulo pode ser:
    - Reutilizado por outros sub-grafos
    - Customizado com parâmetros
    - Substituído por versão especializada

    Invoca o sub-grafo compilado que executa a cadeia acima.

    Returns:
        domain_data com análise contábil completa
    """
    logger.info("📊 Invocando sub-grafo CONTÁBIL (composição de módulos)...")

    try:
        # Lazy-loaded subgraph
        accounting_subgraph = await get_accounting_subgraph()

        # Invoca o sub-grafo com o estado atual
        result = await accounting_subgraph.ainvoke(state)

        logger.info("✅ Sub-grafo CONTÁBIL completado")

        # Retorna os dados atualizados
        return {
            "domain_data": result.get("domain_data", {}),
            "steps": result.get("steps", []),
            "error": result.get("error"),
        }

    except Exception as e:
        logger.error(f"❌ Erro no sub-grafo CONTÁBIL: {e}")
        return {
            "domain_data": {
                "agent": "accounting",
                "status": "error",
                "error": str(e),
            },
            "error": str(e),
        }


# ─── Nó 3c: Sub-grafo Pessoal ───────────────────────────────────────────────

async def personal_agent(state: AgentState) -> dict:
    """
    Sub-grafo especializado em dados pessoais com foco em PRIVACIDADE.

    Invoca o sub-grafo compilado que executa:
    1. Validação de contexto pessoal (consentimento LGPD/GDPR)
    2. Busca de dados pessoais (dados brutos)
    3. Anonimização (masking, k-anonymity, data minimization)
    4. Geração de resumo anônimo

    ⚠️ IMPORTANTE: Todos os dados sensíveis são mascarados antes
    de qualquer processamento ou exposição. Totalmente LGPD/GDPR compliant.

    Returns:
        domain_data com resultados (APENAS dados anônimos)
    """
    logger.info("🔒 Invocando sub-grafo PESSOAL (LGPD/GDPR compliant)...")

    try:
        # Lazy-loaded subgraph
        personal_subgraph = await get_personal_subgraph()

        # Invoca o sub-grafo com o estado atual
        result = await personal_subgraph.ainvoke(state)

        logger.info("✅ Sub-grafo PESSOAL completado (dados anônimos)")

        # Retorna os dados atualizados (APENAS anônimos)
        return {
            "domain_data": result.get("domain_data", {}),
            "steps": result.get("steps", []),
            "error": result.get("error"),
        }

    except Exception as e:
        logger.error(f"❌ Erro no sub-grafo PESSOAL: {e}")
        return {
            "domain_data": {
                "agent": "personal",
                "status": "error",
                "error": str(e),
            },
            "error": str(e),
        }


# ─── Nó 3d: Sub-grafo Suporte (Composição de Módulos) ───────────────────

async def support_agent(state: AgentState) -> dict:
    """
    Sub-grafo especializado em suporte/atendimento.

    ✨ EXEMPLO: Composição de Módulos Dinâmicos

    Arquitetura:
    1. validate_document_module (validação de ticket)
    2. fetch_data_module (histórico + FAQ via RAG)
    3. categorize_ticket (lógica especializada)
    4. check_compliance_module (SLA, resposta, satisfação)
    5. format_report_module (relatório de suporte)

    Invoca o sub-grafo compilado que executa a cadeia acima.

    Returns:
        domain_data com análise de suporte completa
    """
    logger.info("🎫 Invocando sub-grafo SUPORTE (composição de módulos)...")

    try:
        # Lazy-loaded subgraph
        support_subgraph = await get_support_subgraph()

        # Invoca o sub-grafo com o estado atual
        result = await support_subgraph.ainvoke(state)

        logger.info("✅ Sub-grafo SUPORTE completado")

        # Retorna os dados atualizados
        return {
            "domain_data": result.get("domain_data", {}),
            "steps": result.get("steps", []),
            "error": result.get("error"),
        }

    except Exception as e:
        logger.error(f"❌ Erro no sub-grafo SUPORTE: {e}")
        return {
            "domain_data": {
                "agent": "support",
                "status": "error",
                "error": str(e),
            },
            "error": str(e),
        }


# ─── Nó 3e: Sub-grafo Genérico (Composição de Módulos) ────────────────────

async def generic_agent(state: AgentState) -> dict:
    """
    Sub-grafo genérico para Q&A e tópicos diversos.

    ✨ EXEMPLO: Composição de Módulos Dinâmicos

    Arquitetura:
    1. validate_document_module (validação de pergunta)
    2. fetch_data_module (contexto do usuário + RAG para conhecimento)
    3. answer_question (lógica especializada de Q&A)
    4. check_compliance_module (verificação de qualidade da resposta)
    5. format_report_module (formatação da resposta final)

    Invoca o sub-grafo compilado que executa a cadeia acima.

    Returns:
        domain_data com resposta estruturada
    """
    logger.info("💬 Invocando sub-grafo GENÉRICO (composição de módulos)...")

    try:
        # Lazy-loaded subgraph
        generic_subgraph = await get_generic_subgraph()

        # Invoca o sub-grafo com o estado atual
        result = await generic_subgraph.ainvoke(state)

        logger.info("✅ Sub-grafo GENÉRICO completado")

        # Retorna os dados atualizados
        return {
            "domain_data": result.get("domain_data", {}),
            "steps": result.get("steps", []),
            "error": result.get("error"),
        }

    except Exception as e:
        logger.error(f"❌ Erro no sub-grafo GENÉRICO: {e}")
        return {
            "domain_data": {
                "agent": "generic",
                "status": "error",
                "error": str(e),
            },
            "error": str(e),
        }


# ─── Roteador Condicional: Approve vs Consolidate ────────────────────────────

def route_after_execution(state: AgentState) -> Literal["approve", "consolidate"]:
    """
    Decide se requer aprovação humana (HITL).

    Retorna:
        'approve' se agente em HIGH_RISK_AGENTS
        'consolidate' senão
    """
    agent = state.get("active_agent")
    if agent in HIGH_RISK_AGENTS:
        logger.info(f"Requer aprovação humana: {agent}")
        return "approve"
    return "consolidate"


# ─── Nó 4a: Aprovação Humana (HITL) ─────────────────────────────────────────

async def approve_action(state: AgentState) -> dict:
    """
    Pausa para aprovação humana (Human-in-the-Loop).

    Em produção, isso seria um interrupt() na API.
    """
    logger.warning(f"HITL: Aguardando aprovação para {state.get('active_agent')}")
    return {"approved": True}


# ─── Nó 4b: Consolidar Resposta ──────────────────────────────────────────────

async def consolidate_response(state: AgentState) -> dict:
    """
    Consolida resposta final combinando resultados.

    Usa o LLM para gerar resposta natural baseada em:
    - Mensagem original
    - Resultados do sub-grafo
    - Documentos recuperados
    """
    model = get_default_model()

    # Monta contexto
    context_parts = []
    if state.get("domain_data"):
        context_parts.append(f"Análise: {state['domain_data']}")
    if state.get("retrieved_docs"):
        context_parts.append(
            f"Documentos: {len(state['retrieved_docs'])} recuperados"
        )

    context_text = "\n".join(context_parts) if context_parts else "Sem contexto"

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            "Você consolida análises de agentes em resposta clara ao usuário. "
            "Seja conciso, direto e profissional."
        ),
        HumanMessage(
            content=(
                f"Pergunta: {state['messages'][0].content if state['messages'] else 'N/A'}\n"
                f"Contexto: {context_text}"
            )
        ),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        logger.info("Resposta consolidada")
        return {"final_response": result.content}
    except Exception as e:
        logger.error(f"Erro na consolidação: {e}")
        return {
            "final_response": "Houve um erro ao processar sua solicitação.",
            "error": str(e),
        }


# ─── Builder do Grafo ───────────────────────────────────────────────────────

def build_orchestrator() -> Any:
    """
    Constrói e compila o grafo orquestrador com padrão Supervisor.

    Arquitetura:
    ```
                    START
                      ↓
              detect_intent (Command)
                      ↓
              route_to_subgraph (Command)
                      ↓
         ┌────┬────┬────┬────┬────┐
         ↓    ↓    ↓    ↓    ↓    ↓
       fiscal accounting personal support generic
         ↓    ↓    ↓    ↓    ↓    ↓
         └────┴────┴────┴────┴────┘
              ↓
        route_after_execution
              ↓
         ┌────┴────┐
         ↓         ↓
       approve  consolidate
         ↓         ↓
         └────┬────┘
              ↓
            END
    ```

    Fluxo com Command:
    1. detect_intent: detecta tipo_parecer + roteia para "route"
    2. route_to_subgraph: roteia para agente especializado
    3. Agentes: executam análise
    4. route_after_execution: condicional HITL vs consolidação
    5. consolidate_response: gera resposta final
    """
    graph = StateGraph(AgentState)

    # ─── Adiciona nós ───────────────────────────────────────────────────────
    graph.add_node("detect_intent", detect_intent)
    graph.add_node("route", route_to_subgraph)

    # Sub-grafos especializados
    graph.add_node("fiscal_agent", fiscal_agent)
    graph.add_node("accounting_agent", accounting_agent)
    graph.add_node("personal_agent", personal_agent)
    graph.add_node("support_agent", support_agent)
    graph.add_node("generic_agent", generic_agent)

    # Nós de consolidação
    graph.add_node("approve", approve_action)
    graph.add_node("consolidate", consolidate_response)

    # ─── Adiciona arestas ───────────────────────────────────────────────────

    # Entrada
    graph.add_edge(START, "detect_intent")

    # detect_intent usa Command para rotear para "route"
    # (nenhuma aresta necessária, Command controla)

    # route usa Command para rotear para sub-grafos
    # (nenhuma aresta necessária)

    # Todos os sub-grafos vão para roteador condicional
    for agent in ["fiscal_agent", "accounting_agent", "personal_agent", "support_agent", "generic_agent"]:
        graph.add_conditional_edges(
            agent,
            route_after_execution,
            {"approve": "approve", "consolidate": "consolidate"},
        )

    # Caminhos condicionais: HITL ou direto para consolidação
    graph.add_edge("approve", "consolidate")
    # route_after_execution já roteia para "consolidate"

    # Saída
    graph.add_edge("consolidate", END)

    # ─── Compila ────────────────────────────────────────────────────────────
    compiled = graph.compile()

    logger.info("✅ Orquestrador compilado (Padrão Supervisor com sub-grafos)")

    return compiled


# ─── Helpers para Checkpoints e Time Travel ──────────────────────────────────

async def list_checkpoints(
    orchestrator: Any,
    config: dict[str, Any],
) -> list[dict[str, Any]]:
    """
    Lista checkpoints/histórico de execução.

    Args:
        orchestrator: Grafo compilado
        config: Configuração com thread_id

    Returns:
        Lista de checkpoints com metadata
    """
    # TODO: Integrar com checkpointer real (PostgreSQL em produção)
    return []


async def travel_to_checkpoint(
    orchestrator: Any,
    config: dict[str, Any],
    index: int,
) -> dict:
    """
    Viaja para um checkpoint anterior (time travel/debugging).

    Args:
        orchestrator: Grafo compilado
        config: Configuração com thread_id
        index: Índice do checkpoint

    Returns:
        Estado restaurado
    """
    # TODO: Integrar com checkpointer real
    return {}
