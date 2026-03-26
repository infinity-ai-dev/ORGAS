"""
agents/chains/rag_chain.py -- Chain Reutilizavel de Busca RAG

Recupera dados de multiplas fontes (database, API, RAG/vector store)
e consolida em um unico contexto para processamento.

Uso:
    from agents.chains import create_rag_chain, RAGInput

    chain = create_rag_chain(domain="fiscal", sources=["database", "rag"])
    result = await chain.ainvoke(RAGInput(
        user_id="user-123",
        query="analise fiscal empresa",
        session_data={"regime_tributario": "lucro_real"},
    ))

    context = result["context"]  # Contexto consolidado
    sources = result["sources_used"]
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# --- Input/Output Schemas ---------------------------------------------------

class RAGInput(BaseModel):
    """Schema de entrada para a chain de RAG."""
    user_id: str | None = None
    query: str = ""
    domain: str = "generic"
    session_data: dict[str, Any] = Field(default_factory=dict)
    sources: list[Literal["database", "api", "rag"]] = Field(
        default_factory=lambda: ["database"]
    )
    top_k: int = 5


class RAGOutput(BaseModel):
    """Schema de saida da chain de RAG."""
    context: dict[str, Any] = Field(default_factory=dict)
    sources_used: list[str] = Field(default_factory=list)
    documents_found: int = 0
    domain: str = "generic"


# --- Domain-specific mock data -----------------------------------------------

def _fetch_database(domain: str, session_data: dict, user_id: str | None) -> dict:
    """Busca dados do database (mock - em producao: query real)."""
    base = {
        "user_id": user_id,
        "domain": domain,
        "source": "database",
    }

    domain_data = {
        "fiscal": {
            "regime_tributario": session_data.get("regime_tributario"),
            "receita_bruta_2024": 500000.00,
            "despesas_dedutivas_2024": 150000.00,
            "imposto_devido_2024": 70000.00,
            "imposto_pago_2024": 65000.00,
            "diferenca": -5000.00,
            "ultima_atualizacao": "2024-12-31",
            "status_compliance": "pending",
            "obrigacoes_acessorias": ["ECF", "ECD", "LALUR", "DIPJ"],
        },
        "accounting": {
            "saldo_contabil": 250000.00,
            "lancamentos": 45,
            "periodo": "2026-Q1",
        },
        "personal": {
            "nome": "Joao Silva Santos",
            "cpf": "123.456.789-00",
            "email": "joao@example.com",
        },
        "support": {
            "ticket_history": [],
            "faq_references": [],
        },
    }

    base.update(domain_data.get(domain, {}))
    return base


def _fetch_api(domain: str, session_data: dict) -> dict:
    """Busca dados de API externa (mock)."""
    base = {"source": "external_api", "api_version": "v2"}

    domain_data = {
        "fiscal": {"sefaz_status": "compliant", "last_declaration": "2025-12-31"},
        "accounting": {"audit_score": 8.5, "compliance_percentage": 95},
        "personal": {"credit_score": 750, "last_update": "2026-02-15"},
    }

    base.update(domain_data.get(domain, {}))
    return base


def _fetch_rag(domain: str, query: str, top_k: int) -> dict:
    """Busca via RAG/vector store (mock)."""
    domain_docs = {
        "fiscal": [
            "Legislacao de regime LP",
            "Norma de deducoes fiscais",
            "Resolucao sobre ECF",
        ],
        "accounting": [
            "Normas IFRS aplicaveis",
            "Guia de classificacao contabil",
            "Padroes de auditoria",
        ],
        "personal": [
            "LGPD Lei 13.709",
            "Direitos do titular de dados",
            "Politicas de privacidade",
        ],
        "support": [
            "FAQ: Como resetar senha",
            "FAQ: Politica de SLA",
            "FAQ: Contato suporte",
        ],
    }

    docs = domain_docs.get(domain, [f"Documento generico {i+1}" for i in range(3)])
    return {
        "source": "semantic_memory",
        "documents": docs[:top_k],
        "documents_found": len(docs[:top_k]),
        "similarity_threshold": 0.85,
        "query": query,
    }


# --- Core retrieval logic ---------------------------------------------------

async def _retrieve(input_data: dict | RAGInput) -> dict:
    """Logica de retrieval consolidada."""
    if isinstance(input_data, dict):
        input_data = RAGInput(**input_data)

    domain = input_data.domain
    sources = input_data.sources
    context: dict[str, Any] = {}
    sources_used: list[str] = []
    total_docs = 0

    if "database" in sources:
        db_data = _fetch_database(domain, input_data.session_data, input_data.user_id)
        context["database"] = db_data
        sources_used.append("database")
        total_docs += len(db_data)
        logger.info(f"RAG [{domain}] database: {len(db_data)} fields")

    if "api" in sources:
        api_data = _fetch_api(domain, input_data.session_data)
        context["api"] = api_data
        sources_used.append("api")
        total_docs += len(api_data)
        logger.info(f"RAG [{domain}] api: {len(api_data)} fields")

    if "rag" in sources:
        rag_data = _fetch_rag(domain, input_data.query, input_data.top_k)
        context["rag"] = rag_data
        sources_used.append("rag")
        total_docs += rag_data.get("documents_found", 0)
        logger.info(f"RAG [{domain}] rag: {rag_data.get('documents_found', 0)} docs")

    logger.info(f"RAG [{domain}] complete: {len(sources_used)} sources, {total_docs} items")

    return RAGOutput(
        context=context,
        sources_used=sources_used,
        documents_found=total_docs,
        domain=domain,
    ).model_dump()


# --- Chain Factory -----------------------------------------------------------

def create_rag_chain(
    domain: str = "generic",
    sources: list[Literal["database", "api", "rag"]] | None = None,
) -> RunnableLambda:
    """
    Cria uma chain de RAG configurada para um dominio.

    Args:
        domain: Dominio de busca (fiscal, accounting, personal, etc.)
        sources: Fontes de dados a consultar ["database", "api", "rag"]

    Returns:
        RunnableLambda composivel com outras chains

    Exemplo:
        chain = create_rag_chain(domain="fiscal", sources=["database", "rag"])
        result = await chain.ainvoke({
            "user_id": "user-123",
            "query": "analise fiscal",
            "session_data": {"regime_tributario": "lucro_real"},
        })
    """
    default_sources = sources or ["database"]

    async def _run(input_data: dict | RAGInput) -> dict:
        if isinstance(input_data, dict):
            input_data.setdefault("domain", domain)
            input_data.setdefault("sources", default_sources)
            input_data = RAGInput(**input_data)
        else:
            if input_data.domain == "generic" and domain != "generic":
                input_data.domain = domain
            if input_data.sources == ["database"] and default_sources != ["database"]:
                input_data.sources = default_sources
        return await _retrieve(input_data)

    return RunnableLambda(_run).with_config({"run_name": f"rag_chain[{domain}]"})
