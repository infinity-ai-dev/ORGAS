"""
agents/fiscal_agent.py — Sub-grafo Especializado em Análise Fiscal

O fluxo fiscal agora usa exclusivamente os documentos enviados para montar o
parecer. A versão anterior devolvia dados mockados, o que contaminava a fila
de aprovação com valores irreais.
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Any

from langgraph.graph import END, START, StateGraph

from core.document_processing import (
    build_fiscal_report_payload,
    extract_text_from_document,
    infer_cnpj_from_documents,
    infer_competencia_from_documents,
)
from core.rejected_report_memory import search_rejected_report_guardrails
from core.state import AgentState, AgentStep

logger = logging.getLogger(__name__)

REQUIRED_FISCAL_DOCUMENTS = {
    "pgdas": "Extrato do Simples Nacional / PGDAS-D",
    "das": "DAS do Simples Nacional",
    "livro_iss": "Livro fiscal / ISSQN",
}


def _get_session_metadata(state: AgentState) -> tuple[dict[str, Any], dict[str, Any]]:
    session = state.get("session") or {}
    metadata = session.get("metadata") or {}
    return session, metadata


def _detect_missing_required_documents(documents: list[dict[str, Any]]) -> list[str]:
    detected = {
        "pgdas": False,
        "das": False,
        "livro_iss": False,
    }

    for document in documents:
        text = document.get("text") or ""
        lookup = text.upper()
        if "EXTRATO DO SIMPLES NACIONAL" in lookup:
            detected["pgdas"] = True
        if "DOCUMENTO DE ARRECADAÇÃO DO SIMPLES NACIONAL" in lookup or "DOCUMENTO DE ARRECADACAO DO SIMPLES NACIONAL" in lookup:
            detected["das"] = True
        if "LIVRO DE REGISTRO ISSQN" in lookup:
            detected["livro_iss"] = True

    return [
        label
        for key, label in REQUIRED_FISCAL_DOCUMENTS.items()
        if not detected[key]
    ]


async def validate_fiscal_context(state: AgentState) -> dict[str, Any]:
    logger.info("📋 Nó 1: Validando contexto fiscal...")

    documents = state.get("documents") or []
    validation_errors: list[str] = []

    if not documents:
        validation_errors.append("Nenhum documento enviado para o parecer fiscal")

    if not state.get("messages"):
        validation_errors.append("Nenhuma instrução foi enviada ao agente")

    is_valid = len(validation_errors) == 0

    step = AgentStep(
        agent_name="fiscal_agent",
        action="validate_fiscal_context",
        result={
            "is_valid": is_valid,
            "validation_errors": validation_errors,
            "documents_received": len(documents),
        },
    )

    return {
        "steps": [step],
        "domain_data": {
            "step": "validate_fiscal_context",
            "is_valid": is_valid,
            "validation_errors": validation_errors,
            "documents_received": len(documents),
        },
    }


async def fetch_fiscal_data(state: AgentState) -> dict[str, Any]:
    logger.info("🔍 Nó 2: Extraindo dados fiscais dos anexos...")

    session, metadata = _get_session_metadata(state)
    documents = state.get("documents") or []
    extracted_documents = [
        extract_text_from_document(document, index)
        for index, document in enumerate(documents)
    ]

    extracted_with_text = [doc for doc in extracted_documents if doc.get("text")]
    extracted_without_text = [doc for doc in extracted_documents if not doc.get("text")]
    document_type_counts = Counter(
        (doc.get("document_type") or "sem_tipo").lower()
        for doc in extracted_documents
    )
    documentos_sem_texto = [
        doc.get("filename") for doc in extracted_without_text if doc.get("filename")
    ]
    missing_required = _detect_missing_required_documents(extracted_documents)
    inferred_competencia = metadata.get("competencia") or infer_competencia_from_documents(
        extracted_documents
    )
    inferred_cliente_cnpj = metadata.get("cliente_cnpj") or infer_cnpj_from_documents(
        extracted_documents
    )

    structured_report = build_fiscal_report_payload(
        extracted_documents,
        cliente_nome=session.get("client_name"),
        competencia=inferred_competencia,
        cliente_cnpj=inferred_cliente_cnpj,
        regime_tributario=session.get("regime_tributario") or metadata.get("regime_tributario"),
        missing_required=missing_required,
        documentos_sem_texto=documentos_sem_texto,
    )
    rejected_report_insights = await search_rejected_report_guardrails(
        report_type="fiscal",
        client_name=session.get("client_name"),
        competencia=inferred_competencia,
        cliente_cnpj=inferred_cliente_cnpj,
        current_report=structured_report,
    )

    step = AgentStep(
        agent_name="fiscal_agent",
        action="fetch_fiscal_data",
        result={
            "documents_received": len(documents),
            "documents_with_text": len(extracted_with_text),
            "document_types": dict(document_type_counts),
        },
    )

    logger.info(
        "✓ Documentos fiscais extraídos: %s com texto / %s totais",
        len(extracted_with_text),
        len(documents),
    )

    return {
        "steps": [step],
        "domain_data": {
            **state.get("domain_data", {}),
            "step": "fetch_fiscal_data",
            "_documents_extracted": extracted_documents,
            "_metadata": {
                "competencia": inferred_competencia,
                "cliente_cnpj": inferred_cliente_cnpj,
                "cliente_nome": session.get("client_name"),
                "regime_tributario": session.get("regime_tributario") or metadata.get("regime_tributario"),
            },
            "data_sources": ["uploaded_documents"],
            "documentos_recebidos": [
                {
                    "nome": doc.get("filename"),
                    "tipo": doc.get("document_type") or "sem_tipo",
                    "mime_type": doc.get("mime_type"),
                    "texto_extraido": bool(doc.get("text")),
                    "erro_extracao": doc.get("extraction_error"),
                }
                for doc in extracted_documents
            ],
            "documentos_por_tipo": dict(document_type_counts),
            "documentos_sem_texto": documentos_sem_texto,
            "missing_required_documents": missing_required,
            "_rejected_report_insights": rejected_report_insights,
            "rejected_report_guardrails": rejected_report_insights.get("guardrails", []),
            "_fiscal_report": structured_report,
        },
    }


async def analyze_compliance(state: AgentState) -> dict[str, Any]:
    logger.info("⚖️ Nó 3: Consolidando análise fiscal estruturada...")

    domain_data = state.get("domain_data", {})
    structured_report = domain_data.get("_fiscal_report", {}) or {}
    validation_errors = list(structured_report.get("validation_errors", []))
    risks_identified = list(structured_report.get("risks_identified", []))
    compliance_analysis = structured_report.get("compliance_analysis", "")
    is_valid = not validation_errors and bool(structured_report.get("receita_bruta"))

    step = AgentStep(
        agent_name="fiscal_agent",
        action="analyze_compliance",
        result={
            "is_valid": is_valid,
            "risks_count": len(risks_identified),
            "validation_errors": len(validation_errors),
        },
    )

    return {
        "steps": [step],
        "domain_data": {
            **domain_data,
            "step": "analyze_compliance",
            "is_valid": is_valid,
            "validation_errors": validation_errors,
            "risks_identified": risks_identified,
            "compliance_analysis": compliance_analysis,
        },
    }


async def generate_fiscal_opinion(state: AgentState) -> dict[str, Any]:
    logger.info("📄 Nó 4: Finalizando parecer fiscal estruturado...")

    domain_data = state.get("domain_data", {})
    metadata = domain_data.get("_metadata", {})
    documentos_recebidos = domain_data.get("documentos_recebidos", [])
    documentos_por_tipo = domain_data.get("documentos_por_tipo", {})
    documentos_sem_texto = domain_data.get("documentos_sem_texto", [])
    missing_required = domain_data.get("missing_required_documents", [])
    structured_report = domain_data.get("_fiscal_report", {}) or {}
    rejected_report_insights = domain_data.get("_rejected_report_insights", {}) or {}
    rejected_report_guardrails = list(rejected_report_insights.get("guardrails", []))

    validation_errors = list(structured_report.get("validation_errors", []))
    risks_identified = list(structured_report.get("risks_identified", []))
    if rejected_report_guardrails:
        structured_report["recommendations"] = list(structured_report.get("recommendations", [])) + [
            f"Evitar recorrência observada em reprovados similares: {item}"
            for item in rejected_report_guardrails[:3]
        ]
    structured_report["auditoriaReprovados"] = {
        "casosSimilares": rejected_report_insights.get("matches", []),
        "guardrails": rejected_report_guardrails,
        "gruposPorTipo": rejected_report_insights.get("type_groups", []),
        "tipoConsulta": rejected_report_insights.get("corpus_type"),
        "quantidadeCorpus": rejected_report_insights.get("corpus_size", 0),
        "revisaoObrigatoria": bool(rejected_report_guardrails and (validation_errors or risks_identified)),
    }
    is_valid = not validation_errors and bool(structured_report.get("receita_bruta"))
    status = (
        "pending"
        if validation_errors or (rejected_report_guardrails and risks_identified)
        else "complete"
    )

    step = AgentStep(
        agent_name="fiscal_agent",
        action="generate_fiscal_opinion",
        result={
            "documents_processed": len(documentos_recebidos),
            "has_receita_bruta": bool(structured_report.get("receita_bruta")),
            "has_impostos": bool(structured_report.get("impostos")),
        },
    )

    return {
        "steps": [step],
        "domain_data": {
            **structured_report,
            "step": "generate_fiscal_opinion",
            "agent": "fiscal",
            "status": status,
            "tipo_parecer": "fiscal",
            "is_valid": is_valid,
            "validation_errors": validation_errors,
            "validacao_erros": validation_errors,
            "documentos_recebidos": documentos_recebidos,
            "documentos_por_tipo": documentos_por_tipo,
            "documentos_sem_texto": documentos_sem_texto,
            "documentos_analisados": len(documentos_recebidos),
            "missing_required_documents": missing_required,
            "rejected_report_guardrails": rejected_report_guardrails,
            "rejected_report_matches": rejected_report_insights.get("matches", []),
            "rejected_report_type_groups": rejected_report_insights.get("type_groups", []),
            "competencia": structured_report.get("competencia") or metadata.get("competencia"),
            "cliente_cnpj": structured_report.get("cliente_cnpj") or metadata.get("cliente_cnpj"),
            "regime_tributario": structured_report.get("regime_tributario") or metadata.get("regime_tributario"),
        },
    }


def build_fiscal_subgraph() -> Any:
    graph = StateGraph(AgentState)

    graph.add_node("validate", validate_fiscal_context)
    graph.add_node("fetch", fetch_fiscal_data)
    graph.add_node("analyze", analyze_compliance)
    graph.add_node("opinion", generate_fiscal_opinion)

    graph.add_edge(START, "validate")
    graph.add_edge("validate", "fetch")
    graph.add_edge("fetch", "analyze")
    graph.add_edge("analyze", "opinion")
    graph.add_edge("opinion", END)

    logger.info("🔨 Sub-grafo fiscal compilado com extração documental real")
    return graph.compile()


_fiscal_subgraph = None


async def get_fiscal_subgraph() -> Any:
    global _fiscal_subgraph
    if _fiscal_subgraph is None:
        _fiscal_subgraph = build_fiscal_subgraph()
    return _fiscal_subgraph
