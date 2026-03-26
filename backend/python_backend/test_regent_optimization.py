"""
Testes de validacao do regent_orchestrator otimizado.

Testa:
1. Classificacao de documentos (5 tipos)
2. Grafo v1 (backward compatible, Command routing)
3. Grafo v2 (HITL com interrupt)
4. Grafo Batch (Send API)
5. Tratamento de erros
6. Metricas de timing
"""

import json
import logging
import time
import sys

sys.path.insert(0, ".")

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# FIXTURES
# ═══════════════════════════════════════════════════════════════════════════

TEST_DOCUMENTS = {
    "fiscal": {
        "filename": "nfe_exemplo.pdf",
        "format": "pdf",
        "content": """
        NOTA FISCAL ELETRONICA - NF-e
        Emitente: CNPJ: 12.345.678/0001-90
        NFe 123456789
        ICMS: R$ 2.000,00
        IPI: R$ 1.000,00
        PIS: R$ 800,00
        COFINS: R$ 2.400,00
        Receita Federal
        """,
    },
    "accounting": {
        "filename": "demonstracao_financeira.pdf",
        "format": "pdf",
        "content": """
        DEMONSTRACAO FINANCEIRA - BALANCO PATRIMONIAL
        ATIVO Circulante: R$ 500.000,00
        PASSIVO Circulante: R$ 200.000,00
        PATRIMONIO LIQUIDO: R$ 1.000.000,00
        DRE - Resultado Operacional
        EBITDA: R$ 150.000,00
        Contabil - CPC/IFRS
        """,
    },
    "personal": {
        "filename": "dados_pessoais.pdf",
        "format": "pdf",
        "content": """
        FORMULARIO DE DADOS PESSOAIS - CONFIDENCIAL
        CPF: 123.456.789-00
        RG: 12.345.678-9
        Data de Nascimento: 15/06/1980
        Email PII: joao@email.com
        Telefone: (11) 98765-4321
        LGPD - Lei Geral de Protecao de Dados
        GDPR - Regulamento Geral
        """,
    },
    "support": {
        "filename": "ticket_suporte.txt",
        "format": "txt",
        "content": """
        TICKET DE SUPORTE - SLA 4 HORAS
        Ticket ID: TKT-2024-001234
        PROBLEMA RELATADO: Erro no sistema
        Bug na base de dados
        Feature Request: retry automatico
        Chamado de atendimento
        Help: Aguarde resposta
        """,
    },
    "generic": {
        "filename": "documento_generico.txt",
        "format": "txt",
        "content": """
        DOCUMENTO
        Este texto nao se enquadra em nenhuma class especifica.
        Como funciona o sistema?
        """,
    },
}

PASSED = 0
FAILED = 0


def check(test_name: str, condition: bool, detail: str = ""):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print(f"  [PASS] {test_name}")
    else:
        FAILED += 1
        print(f"  [FAIL] {test_name} - {detail}")


# ═══════════════════════════════════════════════════════════════════════════
# TEST 1: CLASSIFICACAO
# ═══════════════════════════════════════════════════════════════════════════

def test_classification():
    print("\n=== TEST 1: Classificacao de Documentos ===")
    from agents.regent_orchestrator import _classify_document

    for expected_type, doc in TEST_DOCUMENTS.items():
        detected, scores = _classify_document(doc["content"])
        check(
            f"Classificar '{expected_type}'",
            detected == expected_type,
            f"expected={expected_type}, got={detected}, scores={scores}",
        )

    # Edge cases
    detected, _ = _classify_document("")
    check("Conteudo vazio -> generic", detected == "generic")

    detected, _ = _classify_document("nota fiscal cpf suporte balanco")
    check("Conteudo misto -> tipo com mais matches", detected in TEST_DOCUMENTS)


# ═══════════════════════════════════════════════════════════════════════════
# TEST 2: GRAFO v1 (BACKWARD COMPATIBLE)
# ═══════════════════════════════════════════════════════════════════════════

def test_v1_graph():
    print("\n=== TEST 2: Grafo v1 (Backward Compatible) ===")
    from agents.regent_orchestrator import get_regent_orchestrator, RegentState

    orchestrator = get_regent_orchestrator()
    nodes = list(orchestrator.get_graph().nodes.keys())

    check("v1 compila", orchestrator is not None)
    check("v1 sem no 'route' intermediario", "route" not in nodes)
    check("v1 tem validate_and_classify", "validate_and_classify" in nodes)
    check("v1 tem consolidate_response", "consolidate_response" in nodes)

    # Teste funcional com cada tipo
    for doc_type, doc in TEST_DOCUMENTS.items():
        initial: RegentState = {
            "document": doc,
            "document_type": None,
            "document_valid": True,
            "validation_errors": [],
            "subgraph_executed": None,
            "extracted_data": {},
            "error": None,
            "status": "pending",
            "response": None,
            "timing": {},
        }

        start = time.perf_counter()
        result = orchestrator.invoke(initial)
        elapsed = time.perf_counter() - start

        check(
            f"v1 classifica '{doc_type}' corretamente",
            result["document_type"] == doc_type,
            f"got={result['document_type']}",
        )
        check(
            f"v1 '{doc_type}' completa",
            result["status"] == "completed",
            f"status={result['status']}",
        )
        check(
            f"v1 '{doc_type}' tem resposta",
            result["response"] is not None,
        )
        check(
            f"v1 '{doc_type}' tem timing",
            bool(result.get("timing")),
        )

    # Teste com documento invalido
    invalid_initial: RegentState = {
        "document": {},
        "document_type": None,
        "document_valid": True,
        "validation_errors": [],
        "subgraph_executed": None,
        "extracted_data": {},
        "error": None,
        "status": "pending",
        "response": None,
        "timing": {},
    }
    result_invalid = orchestrator.invoke(invalid_initial)
    check(
        "v1 documento sem content -> error",
        result_invalid.get("error") is not None,
    )


# ═══════════════════════════════════════════════════════════════════════════
# TEST 3: GRAFO v2 (HITL)
# ═══════════════════════════════════════════════════════════════════════════

def test_v2_hitl():
    print("\n=== TEST 3: Grafo v2 (HITL com interrupt) ===")
    from agents.regent_orchestrator import get_regent_orchestrator_v2, RegentState
    from langgraph.types import Command

    v2 = get_regent_orchestrator_v2()
    nodes = list(v2.get_graph().nodes.keys())

    check("v2 compila", v2 is not None)
    check("v2 tem review_checkpoint", "review_checkpoint" in nodes)

    # Teste: documento NAO-sensivel (fiscal) passa sem interrupt
    config_ns = {"configurable": {"thread_id": "test-non-sensitive"}}
    fiscal_state: RegentState = {
        "document": TEST_DOCUMENTS["fiscal"],
        "document_type": None,
        "document_valid": True,
        "validation_errors": [],
        "subgraph_executed": None,
        "extracted_data": {},
        "error": None,
        "status": "pending",
        "response": None,
        "timing": {},
    }

    result_ns = v2.invoke(fiscal_state, config_ns)
    check(
        "v2 fiscal (nao-sensivel) completa sem interrupt",
        result_ns["status"] == "completed",
    )
    check(
        "v2 fiscal tem resposta",
        result_ns.get("response") is not None,
    )

    # Teste: documento sensivel (personal) faz interrupt
    config_s = {"configurable": {"thread_id": "test-sensitive-approve"}}
    personal_state: RegentState = {
        "document": TEST_DOCUMENTS["personal"],
        "document_type": None,
        "document_valid": True,
        "validation_errors": [],
        "subgraph_executed": None,
        "extracted_data": {},
        "error": None,
        "status": "pending",
        "response": None,
        "timing": {},
    }

    result_s = v2.invoke(personal_state, config_s)
    graph_state = v2.get_state(config_s)
    check(
        "v2 personal faz interrupt (next=review_checkpoint)",
        "review_checkpoint" in graph_state.next,
        f"next={graph_state.next}",
    )

    # Resume com aprovacao
    result_approved = v2.invoke(Command(resume={"approved": True}), config_s)
    check(
        "v2 personal aprovado -> completed",
        result_approved["status"] == "completed",
    )

    # Teste: rejeicao
    v2_reject = get_regent_orchestrator_v2()
    config_r = {"configurable": {"thread_id": "test-sensitive-reject"}}
    v2_reject.invoke(personal_state, config_r)
    result_rejected = v2_reject.invoke(Command(resume={"approved": False}), config_r)
    check(
        "v2 personal rejeitado -> erro de rejeicao",
        "rejeitado" in (result_rejected.get("error") or "").lower()
        or "rejected" in (result_rejected.get("error") or "").lower(),
        f"error={result_rejected.get('error')}",
    )


# ═══════════════════════════════════════════════════════════════════════════
# TEST 4: GRAFO BATCH (SEND API)
# ═══════════════════════════════════════════════════════════════════════════

def test_batch():
    print("\n=== TEST 4: Grafo Batch (Send API) ===")
    from agents.regent_orchestrator import get_batch_orchestrator, BatchRegentState

    batch = get_batch_orchestrator()
    nodes = list(batch.get_graph().nodes.keys())

    check("batch compila", batch is not None)
    check("batch tem fan_out_documents", "fan_out_documents" in nodes)
    check("batch tem process_single_document", "process_single_document" in nodes)
    check("batch tem aggregate_batch_results", "aggregate_batch_results" in nodes)

    # Teste funcional: 3 documentos
    docs = [
        TEST_DOCUMENTS["fiscal"],
        TEST_DOCUMENTS["accounting"],
        TEST_DOCUMENTS["support"],
    ]

    batch_state: BatchRegentState = {
        "documents": docs,
        "batch_results": [],
        "total_documents": len(docs),
        "status": "pending",
        "timing": {},
    }

    start = time.perf_counter()
    result = batch.invoke(batch_state)
    elapsed = time.perf_counter() - start

    check("batch status completed", result["status"] == "completed")
    check(
        "batch processou todos os documentos",
        len(result["batch_results"]) == len(docs),
        f"expected={len(docs)}, got={len(result['batch_results'])}",
    )

    # Verifica classificacao correta para cada doc no batch
    expected_types = ["fiscal", "accounting", "support"]
    for r in result["batch_results"]:
        idx = r["doc_index"]
        check(
            f"batch doc[{idx}] classificado como '{expected_types[idx]}'",
            r["document_type"] == expected_types[idx],
            f"got={r['document_type']}",
        )

    print(f"  Batch total time: {elapsed:.3f}s")

    # Teste com lista vazia
    empty_state: BatchRegentState = {
        "documents": [],
        "batch_results": [],
        "total_documents": 0,
        "status": "pending",
        "timing": {},
    }
    result_empty = batch.invoke(empty_state)
    check("batch vazio completa sem erro", result_empty["status"] == "completed")


# ═══════════════════════════════════════════════════════════════════════════
# TEST 5: TRATAMENTO DE ERROS
# ═══════════════════════════════════════════════════════════════════════════

def test_error_handling():
    print("\n=== TEST 5: Tratamento de Erros ===")
    from agents.regent_orchestrator import get_regent_orchestrator, RegentState

    orchestrator = get_regent_orchestrator()

    # Documento None
    try:
        result = orchestrator.invoke({
            "document": None,
            "document_type": None,
            "document_valid": True,
            "validation_errors": [],
            "subgraph_executed": None,
            "extracted_data": {},
            "error": None,
            "status": "pending",
            "response": None,
            "timing": {},
        })
        check("v1 doc None -> nao crash", True)
        check("v1 doc None -> status failed ou completed", result["status"] in ("failed", "completed"))
    except Exception as e:
        check("v1 doc None -> nao crash", False, str(e))

    # Documento sem content
    result_no_content = orchestrator.invoke({
        "document": {"filename": "empty.txt"},
        "document_type": None,
        "document_valid": True,
        "validation_errors": [],
        "subgraph_executed": None,
        "extracted_data": {},
        "error": None,
        "status": "pending",
        "response": None,
        "timing": {},
    })
    check(
        "v1 doc sem content -> erro reportado",
        result_no_content.get("error") is not None,
    )


# ═══════════════════════════════════════════════════════════════════════════
# TEST 6: METRICAS DE TIMING
# ═══════════════════════════════════════════════════════════════════════════

def test_timing():
    print("\n=== TEST 6: Metricas de Timing ===")
    from agents.regent_orchestrator import get_regent_orchestrator, RegentState

    orchestrator = get_regent_orchestrator()

    initial: RegentState = {
        "document": TEST_DOCUMENTS["fiscal"],
        "document_type": None,
        "document_valid": True,
        "validation_errors": [],
        "subgraph_executed": None,
        "extracted_data": {},
        "error": None,
        "status": "pending",
        "response": None,
        "timing": {},
    }

    result = orchestrator.invoke(initial)
    timing = result.get("timing", {})

    check("timing presente no resultado", bool(timing))
    check(
        "timing tem validate_and_classify",
        "validate_and_classify" in timing,
        f"keys={list(timing.keys())}",
    )
    check(
        "timing tem consolidate_response",
        "consolidate_response" in timing,
        f"keys={list(timing.keys())}",
    )

    # Response tambem tem performance
    response_perf = result.get("response", {}).get("performance", {})
    check("response tem campo performance", bool(response_perf))


# ═══════════════════════════════════════════════════════════════════════════
# TEST 7: STREAMING
# ═══════════════════════════════════════════════════════════════════════════

def test_streaming():
    print("\n=== TEST 7: Streaming ===")
    from agents.regent_orchestrator import stream_regent, stream_batch, RegentState, BatchRegentState

    # Stream v1 com mode "updates"
    initial: RegentState = {
        "document": TEST_DOCUMENTS["fiscal"],
        "document_type": None,
        "document_valid": True,
        "validation_errors": [],
        "subgraph_executed": None,
        "extracted_data": {},
        "error": None,
        "status": "pending",
        "response": None,
        "timing": {},
    }

    events = list(stream_regent(initial, mode="updates"))
    check("stream updates emite eventos", len(events) > 0, f"got {len(events)} events")

    # Verifica que os eventos contêm os nós esperados
    node_names = set()
    for event in events:
        if isinstance(event, tuple):
            node_names.add(event[0])
        elif isinstance(event, dict):
            node_names.update(event.keys())

    check(
        "stream updates inclui validate_and_classify",
        "validate_and_classify" in node_names,
        f"nodes={node_names}",
    )
    check(
        "stream updates inclui consolidate_response",
        "consolidate_response" in node_names,
        f"nodes={node_names}",
    )

    # Stream v1 com mode "values"
    values_events = list(stream_regent(initial, mode="values"))
    check("stream values emite eventos", len(values_events) > 0)

    # Stream batch
    batch_state: BatchRegentState = {
        "documents": [
            TEST_DOCUMENTS["fiscal"],
            TEST_DOCUMENTS["support"],
        ],
        "batch_results": [],
        "total_documents": 2,
        "status": "pending",
        "timing": {},
    }

    batch_events = list(stream_batch(batch_state, mode="updates"))
    check("stream batch emite eventos", len(batch_events) > 0)


# ═══════════════════════════════════════════════════════════════════════════
# TEST 8: MULTI-AGENT PARALLEL ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════

def test_multi_analysis():
    print("\n=== TEST 8: Multi-Agent Parallel Analysis ===")
    from agents.regent_orchestrator import get_multi_analysis_orchestrator, MultiAnalysisState

    ma = get_multi_analysis_orchestrator()
    nodes = list(ma.get_graph().nodes.keys())

    check("multi-analysis compila", ma is not None)
    check("multi-analysis tem fan_out_analyses", "fan_out_analyses" in nodes)
    check("multi-analysis tem run_single_analysis", "run_single_analysis" in nodes)
    check("multi-analysis tem aggregate_analyses", "aggregate_analyses" in nodes)

    # Teste: analisar documento fiscal com fiscal + accounting em paralelo
    state: MultiAnalysisState = {
        "document": TEST_DOCUMENTS["fiscal"],
        "analyses_requested": ["fiscal", "accounting"],
        "analysis_results": [],
        "status": "pending",
        "timing": {},
    }

    start = time.perf_counter()
    result = ma.invoke(state)
    elapsed = time.perf_counter() - start

    check("multi-analysis status completed", result["status"] == "completed")
    check(
        "multi-analysis retorna 2 resultados",
        len(result["analysis_results"]) == 2,
        f"got {len(result['analysis_results'])}",
    )

    types_analyzed = {r["analysis_type"] for r in result["analysis_results"]}
    check(
        "multi-analysis inclui fiscal",
        "fiscal" in types_analyzed,
        f"types={types_analyzed}",
    )
    check(
        "multi-analysis inclui accounting",
        "accounting" in types_analyzed,
        f"types={types_analyzed}",
    )

    print(f"  Multi-analysis time: {elapsed*1000:.1f}ms")

    # Teste com lista vazia
    empty_state: MultiAnalysisState = {
        "document": TEST_DOCUMENTS["fiscal"],
        "analyses_requested": [],
        "analysis_results": [],
        "status": "pending",
        "timing": {},
    }
    result_empty = ma.invoke(empty_state)
    check("multi-analysis vazio completa", result_empty["status"] == "completed")


# ═══════════════════════════════════════════════════════════════════════════
# BENCHMARK COMPARATIVO
# ═══════════════════════════════════════════════════════════════════════════

def benchmark():
    print("\n=== BENCHMARK ===")
    from agents.regent_orchestrator import get_regent_orchestrator, get_batch_orchestrator

    # Single document benchmark
    orchestrator = get_regent_orchestrator()
    times = []
    for doc_type, doc in TEST_DOCUMENTS.items():
        initial = {
            "document": doc,
            "document_type": None,
            "document_valid": True,
            "validation_errors": [],
            "subgraph_executed": None,
            "extracted_data": {},
            "error": None,
            "status": "pending",
            "response": None,
            "timing": {},
        }
        start = time.perf_counter()
        orchestrator.invoke(initial)
        elapsed = time.perf_counter() - start
        times.append(elapsed)
        print(f"  Single {doc_type}: {elapsed*1000:.1f}ms")

    avg_single = sum(times) / len(times) if times else 0
    print(f"  Average single: {avg_single*1000:.1f}ms")

    # Batch benchmark
    batch = get_batch_orchestrator()
    all_docs = list(TEST_DOCUMENTS.values())
    batch_state = {
        "documents": all_docs,
        "batch_results": [],
        "total_documents": len(all_docs),
        "status": "pending",
        "timing": {},
    }
    start = time.perf_counter()
    batch.invoke(batch_state)
    batch_elapsed = time.perf_counter() - start
    print(f"  Batch ({len(all_docs)} docs): {batch_elapsed*1000:.1f}ms")
    print(f"  Batch per-doc avg: {batch_elapsed/len(all_docs)*1000:.1f}ms")

    sequential_total = sum(times)
    print(f"  Sequential total: {sequential_total*1000:.1f}ms")
    if batch_elapsed > 0:
        speedup = sequential_total / batch_elapsed
        print(f"  Speedup: {speedup:.2f}x")


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 70)
    print("REGENT ORCHESTRATOR - Optimization Validation Tests")
    print("=" * 70)

    test_classification()
    test_v1_graph()
    test_v2_hitl()
    test_batch()
    test_error_handling()
    test_timing()
    test_streaming()
    test_multi_analysis()
    benchmark()

    print("\n" + "=" * 70)
    print(f"RESULTS: {PASSED} passed, {FAILED} failed, {PASSED + FAILED} total")
    print("=" * 70)

    if FAILED > 0:
        sys.exit(1)
