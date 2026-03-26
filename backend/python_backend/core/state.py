"""
core/state.py — Estado Global do Agente

Define o contrato de dados que flui por TODOS os nós do grafo.
Reducers controlam como os campos são mesclados (append vs. replace).
"""

from __future__ import annotations

import operator
from typing import Annotated, Any
from uuid import uuid4

from langchain_core.messages import BaseMessage
from langgraph.graph import MessagesState
from pydantic import BaseModel, Field


# ─── Contexto da Sessão ──────────────────────────────────────────────────────

class SessionContext(BaseModel):
    """Metadados da sessão atual."""
    session_id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str | None = None
    tenant_id: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    language: str = "pt-BR"
    regime_tributario: str | None = None
    categoria: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


# ─── Resultado de Tool/Sub-Grafo ─────────────────────────────────────────────

class AgentStep(BaseModel):
    """Registro de um passo executado por qualquer sub-grafo."""
    agent_name: str
    action: str
    result: Any
    error: str | None = None
    tokens_used: int = 0


# ─── Estado Principal ────────────────────────────────────────────────────────

class AgentState(MessagesState):
    """
    Estado compartilhado entre TODOS os nós do grafo.

    Campos com `Annotated[list, operator.add]` são acumulados (append).
    Campos sem Annotated são sobrescritos (replace) a cada nó.
    """

    # ── Identidade ──────────────────────────────────────────────────────────
    session: SessionContext = Field(default_factory=SessionContext)

    # ── Roteamento ──────────────────────────────────────────────────────────
    active_agent: str | None = None          # Nome do sub-grafo ativo
    next_agent: str | None = None            # Próximo sub-grafo a ser chamado
    intent: str | None = None                # Intenção detectada pelo orquestrador
    tipo_parecer: str | None = None          # Tipo de parecer (fiscal, contabil, etc)

    # ── Contexto Recuperado (RAG) ────────────────────────────────────────────
    retrieved_docs: Annotated[list[str], operator.add] = Field(default_factory=list)

    # ── Rastreamento de Passos ───────────────────────────────────────────────
    steps: Annotated[list[AgentStep], operator.add] = Field(default_factory=list)

    # ── Dados de Domínio (preenchidos pelos sub-grafos) ──────────────────────
    domain_data: dict[str, Any] = Field(default_factory=dict)

    # ── Documentos ───────────────────────────────────────────────────────────
    documents: Annotated[list[dict[str, Any]], operator.add] = Field(default_factory=list)

    # ── Controle de Fluxo ────────────────────────────────────────────────────
    error: str | None = None
    should_end: bool = False
    approved: bool = False          # Sinaliza aprovação no HITL
    iteration_count: int = 0

    # ── Resposta Final ────────────────────────────────────────────────────────
    final_response: str | None = None


# ─── Estado para Sub-Grafos ──────────────────────────────────────────────────

class SubgraphState(BaseModel):
    """
    Estado local de um sub-grafo.
    Permite que cada agente tenha dados privados sem poluir o estado global.
    """
    messages: list[BaseMessage] = Field(default_factory=list)
    tools_called: Annotated[list[str], operator.add] = Field(default_factory=list)
    local_data: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    result: Any = None
