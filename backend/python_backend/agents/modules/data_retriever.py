"""
agents/modules/data_retriever.py — Módulo Reutilizável de Busca de Dados

Usado por: fiscal_agent, accounting_agent, personal_agent, support_agent

Funções:
- Buscar dados de DB
- Buscar de APIs externas
- Buscar via RAG (Retrieval Augmented Generation)
- Cachear resultados

Suporta composição:
    validate_document_module → fetch_data_module ← [DB/API/RAG]
"""

import logging
from typing import Any, Literal

from core.state import AgentState, AgentStep

logger = logging.getLogger(__name__)


async def fetch_data_module(
    state: AgentState,
    domain: str = "generic",
    sources: list[Literal["database", "api", "rag"]] | None = None,
) -> dict[str, Any]:
    """
    Módulo reutilizável: Busca de dados.

    Suporta múltiplas fontes de dados que podem ser
    compostas dinamicamente para cada relatório.

    Args:
        state: AgentState compartilhado
        domain: Domínio (fiscal, accounting, personal, etc)
        sources: Quais fontes usar [database, api, rag]

    Returns:
        dict com dados recuperados
    """
    logger.info(f"🔍 Módulo: Buscar dados ({domain})...")

    if sources is None:
        sources = ["database"]  # Default

    session = state.get("session")
    user_id = session.get("user_id") if session else None

    all_data = {}

    # ─── Fonte 1: Database ──────────────────────────────────────────────
    if "database" in sources:
        logger.info(f"  📊 Buscando de Database...")

        # Mock: em produção seria real query
        db_data = {
            "user_id": user_id,
            "domain": domain,
            "timestamp": "2026-03-03T10:00:00Z",
        }

        # Dados específicos por domínio
        if domain == "fiscal":
            db_data.update({
                "regime_tributario": session.get("regime_tributario") if session else None,
                "receita_bruta": 500000.00,
                "despesas": 150000.00,
            })
        elif domain == "accounting":
            db_data.update({
                "saldo_contabil": 250000.00,
                "lancamentos": 45,
                "periodo": "2026-Q1",
            })
        elif domain == "personal":
            db_data.update({
                "nome": "João Silva Santos",
                "cpf": "123.456.789-00",
                "email": "joao@example.com",
            })

        all_data["database"] = db_data
        logger.info(f"    ✓ {len(db_data)} campos de DB")

    # ─── Fonte 2: API Externa ──────────────────────────────────────────
    if "api" in sources:
        logger.info(f"  🔌 Buscando de API...")

        # Mock: em produção seria chamada HTTP real
        api_data = {
            "source": "external_api",
            "api_version": "v2",
            "response_time_ms": 125,
        }

        # Dados específicos por domínio
        if domain == "fiscal":
            api_data.update({
                "sefaz_status": "compliant",
                "last_declaration": "2025-12-31",
            })
        elif domain == "accounting":
            api_data.update({
                "audit_score": 8.5,
                "compliance_percentage": 95,
            })
        elif domain == "personal":
            api_data.update({
                "credit_score": 750,
                "last_update": "2026-02-15",
            })

        all_data["api"] = api_data
        logger.info(f"    ✓ {len(api_data)} campos de API")

    # ─── Fonte 3: RAG (Retrieval Augmented Generation) ─────────────────
    if "rag" in sources:
        logger.info(f"  🧠 Buscando via RAG...")

        # Mock: em produção seria busca em vector DB
        rag_data = {
            "source": "semantic_memory",
            "documents_found": 3,
            "similarity_threshold": 0.85,
        }

        # Documentos específicos por domínio
        if domain == "fiscal":
            rag_data.update({
                "documents": [
                    "Legislação de regime LP",
                    "Norma de deduções fiscais",
                    "Resolução sobre ECF",
                ],
            })
        elif domain == "accounting":
            rag_data.update({
                "documents": [
                    "Normas IFRS aplicáveis",
                    "Guia de classificação contábil",
                    "Padrões de auditoria",
                ],
            })
        elif domain == "personal":
            rag_data.update({
                "documents": [
                    "LGPD Lei 13.709",
                    "Direitos do titular de dados",
                    "Políticas de privacidade",
                ],
            })

        all_data["rag"] = rag_data
        logger.info(f"    ✓ {len(rag_data)} campos de RAG")

    step = AgentStep(
        agent_name=f"module:data_retriever[{domain}]",
        action="fetch_data",
        result={
            "sources_used": sources,
            "total_fields": sum(len(v) for v in all_data.values()),
        },
    )

    logger.info(f"✓ Busca completa: {len(all_data)} fontes, dados consolidados")

    return {
        "steps": [step],
        "module_result": {
            "module": "data_retriever",
            "domain": domain,
            "sources_used": sources,
            "data": all_data,
        },
    }


async def fetch_data_with_rag(
    state: AgentState,
    query: str,
    domain: str = "generic",
    top_k: int = 5,
) -> dict[str, Any]:
    """
    Busca especializada com RAG.

    Para domínios que precisam de contexto documentado.

    Args:
        state: AgentState
        query: Busca semântica
        domain: Contexto de domínio
        top_k: Top K documentos

    Returns:
        Documentos relevantes ordenados por relevância
    """
    logger.info(f"🧠 Módulo: Buscar com RAG ({domain})...")

    # Em produção: usar semantic_memory.search()
    rag_results = [
        {
            "document": f"Documento relevante {i+1} para {domain}",
            "similarity": 0.95 - (i * 0.05),
            "source": "semantic_memory",
        }
        for i in range(min(top_k, 5))
    ]

    step = AgentStep(
        agent_name=f"module:data_retriever_rag[{domain}]",
        action="fetch_data_rag",
        result={
            "query": query,
            "documents_found": len(rag_results),
        },
    )

    logger.info(f"✓ RAG busca: {len(rag_results)} documentos relevantes")

    return {
        "steps": [step],
        "module_result": {
            "module": "data_retriever_rag",
            "domain": domain,
            "query": query,
            "results": rag_results,
        },
    }
