"""
GRAFO REGENTE/ORQUESTRADOR - Gerenciador de Sub-grafos por Tipo de Relatorio

Versao otimizada com Send API, Command routing e interrupt() para HITL.

Arquitetura:
- v1 (backward compatible): Documento unico, fluxo linear
- v2 (otimizado): Batch com Send API, Command routing, interrupt para HITL

Padrão: Document-Driven Orchestration
┌──────────────────────────────────────────────────────────────────────┐
│                     GRAFO REGENTE v2                                 │
│                                                                      │
│  ══ Modo Single (v1-compatible) ══                                  │
│  ENTRADA (Documento)                                                │
│       ↓                                                              │
│  [1] validate_and_classify                                          │
│       ├─ Valida documento                                           │
│       └─ Detecta tipo (fiscal/accounting/personal/...)              │
│       ↓ (Command goto)                                              │
│  [2] execute_subgraph (roteamento direto, sem nó intermediário)     │
│       ├─ fiscal_executor                                            │
│       ├─ accounting_executor                                        │
│       ├─ personal_executor                                          │
│       ├─ support_executor                                           │
│       └─ generic_executor                                           │
│       ↓                                                              │
│  [3] review_checkpoint (interrupt, opcional para dados sensíveis)   │
│       ↓                                                              │
│  [4] consolidate_response                                           │
│       └─ Estrutura resposta final                                   │
│       ↓                                                              │
│  SAÍDA (JSON estruturado)                                           │
│                                                                      │
│  ══ Modo Batch (v2 - Send API) ══                                   │
│  ENTRADA (Lista de Documentos)                                      │
│       ↓                                                              │
│  [1] fan_out_documents (Send API → N executors em paralelo)         │
│       ↓                                                              │
│  [2] process_single_document (N instâncias paralelas)               │
│       ↓                                                              │
│  [3] aggregate_results (coleta todos os resultados)                 │
│       ↓                                                              │
│  SAÍDA (Lista de resultados JSON)                                   │
└──────────────────────────────────────────────────────────────────────┘

Decisões de otimização documentadas em REGENT_OPTIMIZATION.md
"""

import asyncio
import inspect
import logging
import time
from typing import Literal, Any
from typing_extensions import TypedDict, Annotated
import operator

from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command, Send, interrupt
from langgraph.checkpoint.memory import MemorySaver

# Sub-grafos
from agents import (
    get_fiscal_subgraph,
    get_accounting_subgraph,
    get_personal_subgraph,
    get_support_subgraph,
)
from agents.structured_analysis_agent import get_structured_analysis_subgraph

# Módulos
from agents.modules import validate_document_module
from core.structured_model import get_structured_model

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# CONSTANTES E CONFIGURAÇÃO
# ═══════════════════════════════════════════════════════════════════════════

def _merge_dicts(left: dict, right: dict) -> dict:
    """Reducer that merges dicts instead of replacing."""
    merged = {**left}
    merged.update(right)
    return merged


DOCUMENT_PATTERNS = {
    "fiscal": [
        "nfe", "nota fiscal", "cnpj", "icms", "ipi", "pis", "cofins",
        "receita federal", "imposto de renda", "irrf", "imposto",
        "declaração", "cálculo de imposto", "aliquota", "tributário",
    ],
    "accounting": [
        "balanço", "demonstração financeira", "ifrs", "cpc", "contábil",
        "ativo", "passivo", "patrimônio líquido", "resultado", "ebitda",
        "dre", "provisão", "conta contábil", "ledger", "journal entry",
    ],
    "personal": [
        "cpf", "rg", "pii", "pessoal", "privado", "confidencial",
        "dados pessoais", "identificação pessoal", "nascimento",
        "endereço", "telefone", "email", "lgpd", "gdpr",
    ],
    "support": [
        "ticket", "suporte", "problema", "erro", "dúvida", "solicitação",
        "chamado", "atendimento", "issue", "bug", "feature request",
        "help", "assistência", "complaint",
    ],
}

# Tipos que requerem review humano antes de consolidar
SENSITIVE_TYPES = {"personal"}

EXECUTOR_MAP = {
    "fiscal": "fiscal_executor",
    "accounting": "accounting_executor",
    "personal": "personal_executor",
    "support": "support_executor",
}

SUBGRAPH_GETTERS = {
    "fiscal": get_structured_analysis_subgraph,
    "accounting": get_structured_analysis_subgraph,
    "personal": get_structured_analysis_subgraph,
    "support": get_structured_analysis_subgraph,
}


# ═══════════════════════════════════════════════════════════════════════════
# ESTADO DO GRAFO REGENTE
# ═══════════════════════════════════════════════════════════════════════════

class RegentState(TypedDict):
    """Estado para o grafo regente - entrada unica, saida estruturada."""

    # -- Entrada
    document: dict  # {"content": str, "filename": str, "format": str, ...}

    # -- Classificação
    document_type: str | None  # fiscal, accounting, personal, support, generic
    report_type: str | None  # fiscal, accounting, personal, support, generic
    document_valid: bool
    validation_errors: Annotated[list[str], operator.add]

    # -- Execução
    subgraph_executed: str | None
    extracted_data: dict

    # -- Controle de Fluxo
    error: str | None
    status: str  # pending, classifying, executing, completed, failed

    # -- Métricas de Performance (reducer: merge dicts)
    timing: Annotated[dict, _merge_dicts]

    # -- Saída
    response: dict | None


class BatchRegentState(TypedDict):
    """Estado para processamento em lote via Send API."""

    # -- Entrada batch
    documents: list[dict]

    # -- Resultados agregados (reducer: append)
    batch_results: Annotated[list[dict], operator.add]

    # -- Controle
    total_documents: int
    status: str
    timing: dict


# ═══════════════════════════════════════════════════════════════════════════
# FUNÇÕES UTILITÁRIAS
# ═══════════════════════════════════════════════════════════════════════════

def _classify_document(content: str) -> tuple[str, dict[str, int]]:
    """
    Classifica documento por padrões de conteúdo.

    Returns:
        (tipo_detectado, scores_por_tipo)
    """
    content_lower = content.lower()
    scores = {}
    for doc_type, pattern_list in DOCUMENT_PATTERNS.items():
        scores[doc_type] = sum(1 for p in pattern_list if p in content_lower)

    max_score = max(scores.values()) if scores else 0
    if max_score > 0:
        detected = max(scores, key=scores.get)
    else:
        # Se nenhum padrão específico for detectado, rotear para suporte
        detected = "support"

    return detected, scores


def _build_subgraph_initial_state(document: dict, report_type: str | None = None) -> dict:
    """Constrói estado inicial padronizado para qualquer sub-grafo."""
    from core.state import AgentState
    return {
        "messages": [],
        "documents": [document],
        "session": {
            "report_type": report_type,
        },
        "domain_data": {},
    }


def _execute_subgraph_safe(subgraph_name: str, document: dict, report_type: str | None = None) -> dict:
    """
    Executa um sub-grafo com tratamento de erro e métricas.

    Decisão: Factory function elimina duplicação dos 5 executors idênticos.
    Cada executor tinha o mesmo código; agora compartilham esta função.
    """
    logger.info(f"Executando sub-grafo: {subgraph_name}")
    start = time.perf_counter()

    getter = SUBGRAPH_GETTERS.get(subgraph_name)
    if not getter:
        return {
            "subgraph_executed": subgraph_name,
            "extracted_data": {},
            "status": "failed",
            "error": f"Sub-grafo desconhecido: {subgraph_name}",
        }

    try:
        subgraph_or_coro = getter()
        if inspect.iscoroutine(subgraph_or_coro):
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None
            if loop and loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    subgraph = pool.submit(asyncio.run, subgraph_or_coro).result()
            else:
                subgraph = asyncio.run(subgraph_or_coro)
        else:
            subgraph = subgraph_or_coro
        initial_state = _build_subgraph_initial_state(document, report_type)
        result = subgraph.invoke(initial_state)
        elapsed = time.perf_counter() - start

        logger.info(f"Sub-grafo {subgraph_name} concluido em {elapsed:.3f}s")

        return {
            "subgraph_executed": subgraph_name,
            "extracted_data": result.get("domain_data", {}),
            "status": "executing",
            "timing": {f"executor_{subgraph_name}": round(elapsed, 4)},
        }

    except Exception as e:
        elapsed = time.perf_counter() - start
        logger.error(f"Erro no sub-grafo {subgraph_name}: {e}")

        return {
            "subgraph_executed": subgraph_name,
            "extracted_data": {"error": str(e), "agent": subgraph_name},
            "status": "failed",
            "error": f"Falha no sub-grafo {subgraph_name}: {str(e)}",
            "timing": {f"executor_{subgraph_name}_error": round(elapsed, 4)},
        }


# ═══════════════════════════════════════════════════════════════════════════
# NÓ 1: VALIDAR E CLASSIFICAR (com Command routing direto)
# ═══════════════════════════════════════════════════════════════════════════

def validate_and_classify(state: RegentState) -> Command[Literal[
    "fiscal_executor",
    "accounting_executor",
    "personal_executor",
    "support_executor",
    "generic_executor",
]]:
    """
    Nó 1: Valida o documento e roteia diretamente para o executor correto.

    Otimização: Usa Command para eliminar o nó intermediário `route`.
    Antes: validate -> route_node -> conditional_edge -> executor (2 hops + função chamada 2x)
    Agora: validate -> Command(goto=executor) (1 hop, sem duplicação)
    """
    start = time.perf_counter()
    document = state.get("document")
    filename = document.get("filename", "unknown") if isinstance(document, dict) else "unknown"
    logger.info(f"Validando documento: {filename}")

    # -- Validação básica
    if not document or not isinstance(document, dict):
        return Command(
            update={
                "document_valid": False,
                "validation_errors": ["Documento invalido ou vazio"],
                "status": "failed",
                "error": "Documento nao e um dict valido",
                "timing": {"validate_and_classify": round(time.perf_counter() - start, 4)},
            },
            goto="generic_executor",
        )

    if "content" not in document:
        return Command(
            update={
                "document_valid": False,
                "validation_errors": ["Campo obrigatorio ausente: content"],
                "status": "failed",
                "error": "Campo obrigatorio ausente: content",
                "timing": {"validate_and_classify": round(time.perf_counter() - start, 4)},
            },
            goto="generic_executor",
        )

    # -- Classificação
    content = document.get("content", "")
    detected_type, scores = _classify_document(content)

    if detected_type == "generic":
        logger.info("Nenhum padrao especifico detectado. Usando 'generic'.")
    else:
        logger.info(f"Tipo detectado: {detected_type} (score: {scores[detected_type]})")

    target_executor = EXECUTOR_MAP[detected_type]
    elapsed = time.perf_counter() - start

    return Command(
        update={
            "document_valid": True,
            "document_type": detected_type,
            "report_type": detected_type,
            "validation_errors": [],
            "status": "classifying",
            "timing": {"validate_and_classify": round(elapsed, 4)},
        },
        goto=target_executor,
    )


# ═══════════════════════════════════════════════════════════════════════════
# NÓS 2: EXECUTORES DE SUB-GRAFOS (DRY via factory)
# ═══════════════════════════════════════════════════════════════════════════
# Decisão: Antes havia 5 funções idênticas (fiscal_executor, accounting_executor, etc.)
# cada uma com ~20 linhas duplicadas. Agora todas delegam para _execute_subgraph_safe.

def fiscal_executor(state: RegentState) -> dict:
    """Executa sub-grafo fiscal."""
    return _execute_subgraph_safe("fiscal", state["document"], state.get("report_type"))


def accounting_executor(state: RegentState) -> dict:
    """Executa sub-grafo accounting."""
    return _execute_subgraph_safe("accounting", state["document"], state.get("report_type"))


def personal_executor(state: RegentState) -> dict:
    """Executa sub-grafo personal (LGPD/GDPR compliant)."""
    return _execute_subgraph_safe("personal", state["document"], state.get("report_type"))


def support_executor(state: RegentState) -> dict:
    """Executa sub-grafo support."""
    return _execute_subgraph_safe("support", state["document"], state.get("report_type"))


def generic_executor(state: RegentState) -> dict:
    """Executa sub-grafo generico (fallback)."""
    return _execute_subgraph_safe("generic", state["document"], state.get("report_type"))


# ═══════════════════════════════════════════════════════════════════════════
# NÓ 3: REVIEW CHECKPOINT (interrupt para human-in-the-loop)
# ═══════════════════════════════════════════════════════════════════════════

def review_checkpoint(state: RegentState) -> dict:
    """
    Nó de revisão humana usando interrupt().

    Decisão: Dados sensíveis (personal/LGPD) devem ser revisados antes de
    consolidar. Usa interrupt() para pausar execução e aguardar aprovação.

    Para tipos não-sensíveis, passa direto sem interrupção.

    Quando interrompido, retorna ao caller:
    {
        "type": "review_required",
        "document_type": "personal",
        "extracted_data": {...},
        "message": "Dados pessoais detectados. Aprovar processamento?"
    }

    Para resumir, enviar: {"approved": True} ou {"approved": False}
    """
    doc_type = state.get("document_type", "generic")

    if doc_type in SENSITIVE_TYPES:
        logger.info(f"Tipo sensivel ({doc_type}): aguardando revisao humana...")

        review_decision = interrupt({
            "type": "review_required",
            "document_type": doc_type,
            "extracted_data_preview": {
                k: v for k, v in state.get("extracted_data", {}).items()
                if k in ("agent", "status", "step")
            },
            "message": f"Dados do tipo '{doc_type}' detectados. Aprovar processamento?",
        })

        if not review_decision.get("approved", False):
            logger.info("Revisao rejeitada pelo usuario.")
            return {
                "status": "rejected",
                "error": "Processamento rejeitado na revisao humana",
            }

        logger.info("Revisao aprovada pelo usuario.")

    return {}


# ═══════════════════════════════════════════════════════════════════════════
# NÓ 4: CONSOLIDAR RESPOSTA FINAL
# ═══════════════════════════════════════════════════════════════════════════

def consolidate_response(state: RegentState) -> dict:
    """
    Nó final: Estrutura a resposta em formato JSON padronizado.
    Inclui métricas de timing para benchmarking.
    """
    start = time.perf_counter()
    logger.info("Consolidando resposta final...")

    timing = state.get("timing", {})

    doc = state.get("document") or {}
    extracted = state.get("extracted_data") or {}

    response = {
        "status": "success" if state.get("document_valid") else "failed",
        "document": {
            "filename": doc.get("filename", "unknown") if isinstance(doc, dict) else "unknown",
            "type": state.get("document_type"),
            "valid": state.get("document_valid", False),
        },
        "execution": {
            "subgraph": state.get("subgraph_executed"),
            "timestamp": extracted.get("timestamp") if isinstance(extracted, dict) else None,
        },
        "data": extracted,
        "errors": state.get("error"),
        "validation_errors": state.get("validation_errors", []),
        "performance": timing,
    }

    elapsed = time.perf_counter() - start
    timing["consolidate_response"] = round(elapsed, 4)

    return {
        "response": response,
        "status": "completed",
        "timing": timing,
    }


# ═══════════════════════════════════════════════════════════════════════════
# CONSTRUTOR DO GRAFO REGENTE v1 (backward compatible)
# ═══════════════════════════════════════════════════════════════════════════

def build_regent_orchestrator() -> CompiledStateGraph:
    """
    Constrói o grafo regente v1 (backward compatible).

    Otimizações aplicadas vs versão original:
    1. Command routing: eliminou nó intermediário `route` (1 hop menos)
    2. DRY executors: 5 funções idênticas agora usam factory compartilhada
    3. Error handling: executores com try/except e fallback gracioso
    4. Timing: métricas de performance em cada nó

    Arquitetura:
    ```
                    START
                      |
            validate_and_classify
              (Command routing)
                      |
        +------+------+------+------+------+
        |      |      |      |      |      |
       fiscal acct  personal support generic
        |      |      |      |      |      |
        +------+------+------+------+------+
                      |
            consolidate_response
                      |
                    END
    ```
    """
    graph = StateGraph(RegentState)

    # -- Nós
    graph.add_node("validate_and_classify", validate_and_classify)
    graph.add_node("fiscal_executor", fiscal_executor)
    graph.add_node("accounting_executor", accounting_executor)
    graph.add_node("personal_executor", personal_executor)
    graph.add_node("support_executor", support_executor)
    graph.add_node("generic_executor", generic_executor)
    graph.add_node("consolidate_response", consolidate_response)

    # -- Arestas
    # Entrada -> validate_and_classify (que usa Command para rotear)
    graph.add_edge(START, "validate_and_classify")
    # validate_and_classify usa Command(goto=...) -> executor direto

    # Executores -> consolidação
    graph.add_edge("fiscal_executor", "consolidate_response")
    graph.add_edge("accounting_executor", "consolidate_response")
    graph.add_edge("personal_executor", "consolidate_response")
    graph.add_edge("support_executor", "consolidate_response")
    graph.add_edge("generic_executor", "consolidate_response")

    # Consolidação -> Saída
    graph.add_edge("consolidate_response", END)

    compiled = graph.compile()

    logger.info("Grafo Regente v1 compilado com sucesso!")

    return compiled


# ═══════════════════════════════════════════════════════════════════════════
# CONSTRUTOR DO GRAFO REGENTE v2 (com interrupt HITL)
# ═══════════════════════════════════════════════════════════════════════════

def build_regent_orchestrator_v2() -> CompiledStateGraph:
    """
    Constrói o grafo regente v2 com human-in-the-loop via interrupt().

    Adiciona review_checkpoint entre executor e consolidação.
    Requer checkpointer para persistir estado durante interrupt.

    Arquitetura:
    ```
                    START
                      |
            validate_and_classify
              (Command routing)
                      |
        +------+------+------+------+------+
        |      |      |      |      |      |
       fiscal acct  personal support generic
        |      |      |      |      |      |
        +------+------+------+------+------+
                      |
             review_checkpoint
          (interrupt se tipo sensível)
                      |
            consolidate_response
                      |
                    END
    ```
    """
    graph = StateGraph(RegentState)

    # -- Nós
    graph.add_node("validate_and_classify", validate_and_classify)
    graph.add_node("fiscal_executor", fiscal_executor)
    graph.add_node("accounting_executor", accounting_executor)
    graph.add_node("personal_executor", personal_executor)
    graph.add_node("support_executor", support_executor)
    graph.add_node("generic_executor", generic_executor)
    graph.add_node("review_checkpoint", review_checkpoint)
    graph.add_node("consolidate_response", consolidate_response)

    # -- Arestas
    graph.add_edge(START, "validate_and_classify")

    # Executores -> review
    graph.add_edge("fiscal_executor", "review_checkpoint")
    graph.add_edge("accounting_executor", "review_checkpoint")
    graph.add_edge("personal_executor", "review_checkpoint")
    graph.add_edge("support_executor", "review_checkpoint")
    graph.add_edge("generic_executor", "review_checkpoint")

    # Review -> consolidação
    graph.add_edge("review_checkpoint", "consolidate_response")

    # Consolidação -> Saída
    graph.add_edge("consolidate_response", END)

    # Checkpointer necessário para interrupt()
    checkpointer = MemorySaver()
    compiled = graph.compile(checkpointer=checkpointer)

    logger.info("Grafo Regente v2 (HITL) compilado com sucesso!")

    return compiled


# ═══════════════════════════════════════════════════════════════════════════
# CONSTRUTOR DO GRAFO BATCH (Send API)
# ═══════════════════════════════════════════════════════════════════════════

def _process_single_document(state: dict) -> dict:
    """
    Processa um único documento no contexto de batch.
    Cada instância é criada pelo Send API em paralelo.

    Recebe estado individual via Send(node, arg).
    """
    document = state["document"]
    doc_index = state.get("doc_index", 0)

    logger.info(f"[Batch] Processando documento {doc_index}: {document.get('filename', 'unknown')}")

    start = time.perf_counter()

    # Classificar
    content = document.get("content", "")
    detected_type, scores = _classify_document(content)

    # Executar sub-grafo
    exec_result = _execute_subgraph_safe(detected_type, document, detected_type)
    elapsed = time.perf_counter() - start

    result = {
        "doc_index": doc_index,
        "filename": document.get("filename", "unknown"),
        "document_type": detected_type,
        "classification_scores": scores,
        "subgraph_executed": exec_result.get("subgraph_executed"),
        "extracted_data": exec_result.get("extracted_data", {}),
        "status": "success" if exec_result.get("status") != "failed" else "failed",
        "error": exec_result.get("error"),
        "elapsed_seconds": round(elapsed, 4),
    }

    return {"batch_results": [result]}


def fan_out_documents(state: BatchRegentState) -> Command:
    """
    Nó que usa Send API via Command para despachar documentos em paralelo.

    Decisão: Send API permite que N documentos sejam processados
    concorrentemente pelo LangGraph runtime, ao invés de sequencialmente.

    Cada Send cria uma instância independente de process_single_document.
    Usa Command(goto=[Send(...)]) que é o padrão correto no LangGraph 1.0+.
    """
    documents = state.get("documents", [])
    logger.info(f"[Batch] Fan-out: {len(documents)} documentos para processamento paralelo")

    if not documents:
        return Command(goto="aggregate_batch_results")

    sends = [
        Send("process_single_document", {"document": doc, "doc_index": i})
        for i, doc in enumerate(documents)
    ]

    return Command(goto=sends)


def aggregate_batch_results(state: BatchRegentState) -> dict:
    """
    Agrega resultados do batch após todos os Send completarem.
    """
    results = state.get("batch_results", [])
    total = state.get("total_documents", len(results))

    successes = sum(1 for r in results if r.get("status") == "success")
    failures = total - successes

    logger.info(f"[Batch] Agregando: {successes} sucesso, {failures} falhas de {total} total")

    return {
        "status": "completed",
        "timing": {
            "total_documents": total,
            "successes": successes,
            "failures": failures,
        },
    }


def build_batch_orchestrator() -> CompiledStateGraph:
    """
    Constrói grafo para processamento em lote com Send API.

    Decisão: Send API cria N instâncias paralelas de process_single_document,
    uma para cada documento. O LangGraph runtime gerencia a concorrência.

    Arquitetura:
    ```
                START
                  |
          fan_out_documents
          (Send API x N docs)
                  |
        +----+----+----+----+
        |    |    |    |    |
       doc0 doc1 doc2 doc3 ...
        |    |    |    |    |
        +----+----+----+----+
                  |
        aggregate_batch_results
                  |
                END
    ```
    """
    graph = StateGraph(BatchRegentState)

    graph.add_node("fan_out_documents", fan_out_documents)
    graph.add_node("process_single_document", _process_single_document)
    graph.add_node("aggregate_batch_results", aggregate_batch_results)

    graph.add_edge(START, "fan_out_documents")
    # fan_out_documents uses Command(goto=[Send(...)]) for parallel dispatch
    # or Command(goto="aggregate_batch_results") for empty doc list
    graph.add_edge("process_single_document", "aggregate_batch_results")
    graph.add_edge("aggregate_batch_results", END)
    # Note: fan_out_documents -> aggregate_batch_results edge is implicit via Command

    compiled = graph.compile()

    logger.info("Grafo Batch (Send API) compilado com sucesso!")

    return compiled


# ═══════════════════════════════════════════════════════════════════════════
# INTERFACE PÚBLICA
# ═══════════════════════════════════════════════════════════════════════════

def get_regent_orchestrator() -> CompiledStateGraph:
    """Obtém o grafo regente v1 compilado (backward compatible)."""
    return build_regent_orchestrator()


def get_regent_orchestrator_v2() -> CompiledStateGraph:
    """Obtém o grafo regente v2 com HITL via interrupt()."""
    return build_regent_orchestrator_v2()


def get_batch_orchestrator() -> CompiledStateGraph:
    """Obtém o grafo batch com Send API para processamento paralelo."""
    return build_batch_orchestrator()


# ═══════════════════════════════════════════════════════════════════════════
# STREAMING HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def stream_regent(state: RegentState, mode: str = "updates") -> Any:
    """
    Executa o regent orchestrator com streaming para monitorar progresso.

    Decisão de stream mode:
    - "updates": Melhor para monitoramento de progresso. Emite apenas os campos
      alterados por cada nó, permitindo rastrear exatamente qual nó executou e
      o que mudou. Recomendado para UIs de progresso.
    - "values": Emite o estado completo após cada nó. Útil para debug, mas
      mais dados por evento.
    - "messages": Emite mensagens LLM individuais. Útil quando sub-grafos
      geram texto via LLM e o caller quer streaming token-by-token.

    Recomendação: usar "updates" como padrão para monitorar progresso do
    orchestrator, pois cada update mostra claramente qual nó executou.

    Args:
        state: Estado inicial do RegentState
        mode: Stream mode - "updates" (recomendado), "values", ou "messages"

    Yields:
        Eventos de streaming conforme o mode selecionado
    """
    orchestrator = get_regent_orchestrator()
    for event in orchestrator.stream(state, stream_mode=mode):
        yield event


def stream_batch(state: BatchRegentState, mode: str = "updates") -> Any:
    """
    Executa o batch orchestrator com streaming.

    Com "updates", cada document processado emite um evento separado,
    permitindo mostrar progresso em tempo real (ex: "3/10 documentos processados").

    Args:
        state: Estado inicial do BatchRegentState
        mode: Stream mode

    Yields:
        Eventos de streaming
    """
    batch = get_batch_orchestrator()
    for event in batch.stream(state, stream_mode=mode):
        yield event


# ═══════════════════════════════════════════════════════════════════════════
# MULTI-AGENT PARALLEL ANALYSIS (Send API avancado)
# ═══════════════════════════════════════════════════════════════════════════

class MultiAnalysisState(TypedDict):
    """Estado para analise paralela de um documento por multiplos agentes."""

    document: dict
    analyses_requested: list[str]  # ["fiscal", "accounting", ...]
    analysis_results: Annotated[list[dict], operator.add]
    status: str
    timing: Annotated[dict, _merge_dicts]


def _run_single_analysis(state: dict) -> dict:
    """Executa uma analise especifica em paralelo via Send API."""
    document = state["document"]
    analysis_type = state["analysis_type"]

    logger.info(f"[MultiAnalysis] Executando analise '{analysis_type}'")
    start = time.perf_counter()

    exec_result = _execute_subgraph_safe(analysis_type, document, analysis_type)
    elapsed = time.perf_counter() - start

    return {
        "analysis_results": [{
            "analysis_type": analysis_type,
            "extracted_data": exec_result.get("extracted_data", {}),
            "status": "success" if exec_result.get("status") != "failed" else "failed",
            "error": exec_result.get("error"),
            "elapsed_seconds": round(elapsed, 4),
        }],
    }


def fan_out_analyses(state: MultiAnalysisState) -> Command:
    """Despacha multiplas analises em paralelo usando Send API."""
    analyses = state.get("analyses_requested", [])
    document = state["document"]

    logger.info(f"[MultiAnalysis] Fan-out: {len(analyses)} analises em paralelo")

    if not analyses:
        return Command(goto="aggregate_analyses")

    sends = [
        Send("run_single_analysis", {
            "document": document,
            "analysis_type": analysis_type,
        })
        for analysis_type in analyses
    ]
    return Command(goto=sends)


def aggregate_analyses(state: MultiAnalysisState) -> dict:
    """Agrega resultados de multiplas analises paralelas."""
    results = state.get("analysis_results", [])
    successes = sum(1 for r in results if r.get("status") == "success")

    logger.info(f"[MultiAnalysis] {successes}/{len(results)} analises concluidas")

    return {
        "status": "completed",
        "timing": {
            "analyses_completed": len(results),
            "analyses_successful": successes,
        },
    }


def build_multi_analysis_orchestrator() -> CompiledStateGraph:
    """
    Constrói grafo para analise paralela de um documento por multiplos agentes.

    Use case: Um documento pode ser analisado simultaneamente pelos agentes
    fiscal E accounting (ex: nota fiscal com dados contabeis).

    Arquitetura:
    ```
              START
                |
        fan_out_analyses
      (Send API x N analises)
                |
      +-----+-----+-----+
      |     |     |     |
    fiscal acct  ...  support
      |     |     |     |
      +-----+-----+-----+
                |
       aggregate_analyses
                |
              END
    ```
    """
    graph = StateGraph(MultiAnalysisState)

    graph.add_node("fan_out_analyses", fan_out_analyses)
    graph.add_node("run_single_analysis", _run_single_analysis)
    graph.add_node("aggregate_analyses", aggregate_analyses)

    graph.add_edge(START, "fan_out_analyses")
    graph.add_edge("run_single_analysis", "aggregate_analyses")
    graph.add_edge("aggregate_analyses", END)

    compiled = graph.compile()
    logger.info("Grafo Multi-Analysis (Send API) compilado com sucesso!")
    return compiled


def get_multi_analysis_orchestrator() -> CompiledStateGraph:
    """Obtém o grafo de analise multi-agente paralela."""
    return build_multi_analysis_orchestrator()


# ═══════════════════════════════════════════════════════════════════════════
# EXEMPLO DE USO
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import json

    logging.basicConfig(level=logging.INFO)

    # ── Exemplo 1: Single document (v1 backward compatible) ──
    print("\n" + "=" * 70)
    print("GRAFO REGENTE v1 - Single Document")
    print("=" * 70)

    orchestrator = get_regent_orchestrator()

    test_document = {
        "filename": "nfe_123456.pdf",
        "format": "pdf",
        "content": """
        NOTA FISCAL ELETRONICA
        CNPJ: 12.345.678/0001-90
        NFe 123456789012345678901234567890123456789012
        ICMS: 1000.00
        IPI: 500.00
        PIS: 200.00
        COFINS: 300.00
        Emitido pela Receita Federal
        """,
    }

    initial_state: RegentState = {
        "document": test_document,
        "document_type": None,
        "report_type": None,
        "document_valid": True,
        "validation_errors": [],
        "subgraph_executed": None,
        "extracted_data": {},
        "error": None,
        "status": "pending",
        "response": None,
        "timing": {},
    }

    result = orchestrator.invoke(initial_state)

    print(f"Status: {result['status']}")
    print(f"Tipo: {result['document_type']}")
    print(f"Sub-grafo: {result['subgraph_executed']}")
    print(f"Timing: {result.get('timing', {})}")
    print("\nResposta:")
    print(json.dumps(result.get("response"), indent=2, ensure_ascii=False, default=str))

    # ── Exemplo 2: Batch processing (Send API) ──
    print("\n" + "=" * 70)
    print("GRAFO REGENTE BATCH - Send API")
    print("=" * 70)

    batch_orchestrator = get_batch_orchestrator()

    batch_state: BatchRegentState = {
        "documents": [
            {
                "filename": "nfe_001.pdf",
                "content": "NOTA FISCAL CNPJ ICMS IPI",
            },
            {
                "filename": "balanco_2024.pdf",
                "content": "BALANCO PATRIMONIAL ATIVO PASSIVO DRE EBITDA",
            },
            {
                "filename": "ticket_001.txt",
                "content": "TICKET SUPORTE PROBLEMA ERRO BUG",
            },
        ],
        "batch_results": [],
        "total_documents": 3,
        "status": "pending",
        "timing": {},
    }

    batch_result = batch_orchestrator.invoke(batch_state)

    print(f"Status: {batch_result['status']}")
    print(f"Resultados: {len(batch_result['batch_results'])}")
    for r in batch_result["batch_results"]:
        print(f"  [{r['doc_index']}] {r['filename']}: {r['document_type']} -> {r['status']}")

    # ── Exemplo 3: v2 com HITL (demonstração de interrupt) ──
    print("\n" + "=" * 70)
    print("GRAFO REGENTE v2 - HITL (interrupt demo)")
    print("=" * 70)

    orchestrator_v2 = get_regent_orchestrator_v2()
    config = {"configurable": {"thread_id": "demo-thread-1"}}

    personal_doc = {
        "filename": "dados_pessoais.pdf",
        "content": "CPF RG DADOS PESSOAIS LGPD GDPR CONFIDENCIAL PII",
    }

    hitl_state: RegentState = {
        "document": personal_doc,
        "document_type": None,
        "report_type": None,
        "document_valid": True,
        "validation_errors": [],
        "subgraph_executed": None,
        "extracted_data": {},
        "error": None,
        "status": "pending",
        "response": None,
        "timing": {},
    }

    # Primeira invocação: vai pausar no interrupt
    result_v2 = orchestrator_v2.invoke(hitl_state, config)
    print(f"Estado apos interrupt: status={result_v2.get('status')}")

    # Resumir com aprovação
    resumed = orchestrator_v2.invoke(
        Command(resume={"approved": True}),
        config,
    )
    print(f"Apos aprovacao: status={resumed['status']}")
    print(f"Resposta: {json.dumps(resumed.get('response', {}), indent=2, ensure_ascii=False, default=str)}")
