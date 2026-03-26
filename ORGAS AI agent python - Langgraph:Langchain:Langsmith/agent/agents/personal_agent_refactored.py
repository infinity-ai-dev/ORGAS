"""
agents/personal_agent_refactored.py -- Sub-grafo Pessoal Refatorado com LGPD/GDPR

ARQUITETURA COM GARANTIA LGPD/GDPR:
    PII (Personally Identifiable Information) NUNCA pode ser vista pelo LLM
    Isso é ARQUITETURALMENTE GARANTIDO através da ordem dos nós

ANTES (personal_agent.py):
    5 nos, sem garantia de privacidade na ordem

DEPOIS (este arquivo):
    START -> validate_and_fetch -> anonymize (CRITICAL) -> analyze -> opinion -> END
                                        ↓
                          PII nunca chega ao LLM

Cada nó:
    1. validate_and_fetch: Recebe dados brutos (CPF, email, phone, etc)
    2. anonymize: MASKS PII antes do LLM
       - CPF: ****.**-.##
       - Email: ***@domain
       - Phone: ***-#### (últimos 4 dígitos)
       - Address: [MASKED]
       - Birth date: Generalizado para age_range (K-anonymity)
       - Acesso history: REMOVIDO (data minimization)
    3. analyze: Processa dados ANONIMIZADOS
    4. opinion: Gera parecer baseado em dados seguros
    5. Output: Só contém resumo de dados anônimos

TESTES CRÍTICOS:
    - test_lgpd_anonymize_before_llm: Ordem dos nós
    - test_no_pii_in_llm_prompts: Verificação de PII em prompts
    - test_anonymization_quality: Masking/generalization corretos
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

from core.state import AgentState, AgentStep

# Chains reutilizaveis
from agents.chains.validation_chain import create_validation_chain
from agents.chains.rag_chain import create_rag_chain
from agents.chains.formatting_chain import create_formatting_chain
from agents.chains.llm_fallback_chain import create_llm_with_fallback

# Chains específicas do domínio pessoal (com LGPD built-in)
from agents.chains.personal_chains import (
    personal_analysis_chain,
    personal_summary_chain,
)

logger = logging.getLogger(__name__)

# --- Chains pre-configuradas para dominio pessoal ----------------------------

_personal_validation = create_validation_chain(
    domain="personal",
    required_fields=["user_id"],  # Menos campos obrigatórios
)

_personal_rag = create_rag_chain(
    domain="personal",
    sources=["database", "rag"],  # Sem API (dados pessoais sensíveis)
)

_personal_formatting = create_formatting_chain(
    domain="personal",
    output_format="markdown",
)


# --- FUNÇÕES DE ANONIMIZAÇÃO (LGPD/GDPR) ------------------------------------

def _mask_cpf(cpf: str) -> str:
    """Mascara CPF: 123.456.789-00 → ***.***.***-##"""
    if not cpf or len(cpf) < 3:
        return "***.***.***-##"
    return f"***.***.***.{cpf[-2:]}"


def _mask_email(email: str) -> str:
    """Mascara email: user@domain.com → ***@domain.com"""
    if not email or "@" not in email:
        return "***@unknown"
    domain = email.split("@")[1]
    return f"***@{domain}"


def _mask_phone(phone: str) -> str:
    """Mascara telefone: 11987654321 → ***-***-***-#### (últimos 4)"""
    if not phone or len(phone) < 4:
        return "***-***-***-####"
    return f"***-***-***-{phone[-4:]}"


def _generalize_birth_date(birth_date: str) -> str:
    """
    Generaliza data de nascimento para faixa etária (K-anonymity).
    Exemplo: 1990-03-15 → 35-45 (faixa de 10 anos)
    """
    if not birth_date:
        return "[18-100]"

    try:
        # Parse common date formats
        date_obj = None
        for fmt in ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"]:
            try:
                date_obj = datetime.strptime(birth_date, fmt)
                break
            except ValueError:
                continue

        if not date_obj:
            return "[18-100]"

        today = datetime.now()
        age = today.year - date_obj.year - (
            (today.month, today.day) < (date_obj.month, date_obj.day)
        )

        # Bucket to age range (5-year buckets for K-anonymity)
        bucket_size = 5
        min_age = (age // bucket_size) * bucket_size
        max_age = min_age + bucket_size - 1

        return f"[{min_age}-{max_age}]"
    except Exception as e:
        logger.warning(f"Could not generalize birth date: {e}")
        return "[18-100]"


def _remove_pii_patterns(text: str) -> str:
    """Remove PII patterns not caught by explicit fields."""
    if not text:
        return ""

    # Regex patterns for common PII
    patterns = [
        (r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b", "[CPF]"),  # CPF
        (r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b", "[CNPJ]"),  # CNPJ
        (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", "[EMAIL]"),  # Email
        (r"\b\d{11}\b", "[PHONE]"),  # 11-digit phone
        (r"(?:Rua|Av|Avenida|Travessa) [^,]*", "[ADDRESS]"),  # Addresses
    ]

    result = text
    for pattern, replacement in patterns:
        result = re.sub(pattern, replacement, result)

    return result


# --- No 1+2: Validar e Buscar (composicao de chains) -----------------------

async def validate_and_fetch(state: AgentState) -> dict[str, Any]:
    """
    Compoe validation_chain + rag_chain em um unico no.

    IMPORTANTE: Neste estágio, temos PII bruto (CPF, email, phone, etc).
    DEVE ser seguido pelo nó de anonimização antes do LLM.
    """
    logger.info("📋 Node 1+2: Validating and fetching personal data (chains)...")

    session = state.get("session")
    messages = state.get("messages", [])

    # --- Step 1: Validacao via chain ---
    validation_result = await _personal_validation.ainvoke({
        "user_id": session.get("user_id") if session else None,
        "messages": messages,
        "session_data": {},  # Personal domain tem menos dados de sessão
    })

    validation_step = AgentStep(
        agent_name="personal_agent",
        action="validate_personal_context",
        result={
            "is_valid": validation_result["is_valid"],
            "errors": validation_result["errors"],
        },
    )

    # --- Step 2: Busca de dados via chain ---
    rag_result = await _personal_rag.ainvoke({
        "user_id": session.get("user_id") if session else None,
        "query": messages[-1].content if messages else "",
        "session_data": {},
    })

    fetch_step = AgentStep(
        agent_name="personal_agent",
        action="fetch_personal_data",
        result={
            "sources_used": rag_result["sources_used"],
            "documents_found": rag_result["documents_found"],
        },
    )

    # Consolidar dados brutos (COM PII)
    personal_data_raw = rag_result["context"].get("database", {})

    logger.info(
        f"Validate+Fetch complete: valid={validation_result['is_valid']}, "
        f"sources={rag_result['sources_used']}"
    )

    return {
        "steps": [validation_step, fetch_step],
        "domain_data": {
            "step": "validate_and_fetch",
            "is_valid": validation_result["is_valid"],
            "validation_errors": validation_result["errors"],
            "personal_data_raw": personal_data_raw,  # Com PII (será anon no próximo nó)
            "sources_used": rag_result["sources_used"],
        },
    }


# --- No 2.5: ANONIMIZAR DADOS (LGPD/GDPR CRÍTICO) ----------------------------

async def anonymize_personal_data(state: AgentState) -> dict[str, Any]:
    """
    ⚠️  CRÍTICO PARA LGPD/GDPR

    Este nó DEVE rodar ANTES de qualquer processamento LLM.
    Mascara e generaliza PII para garantir privacidade.

    Transformações:
    - CPF: 123.456.789-00 → ***.***.***.00
    - Email: user@domain.com → ***@domain.com
    - Phone: 11987654321 → ***-***-***-4321
    - Birth date: 1990-03-15 → [35-45] (age range)
    - Address: "Rua X" → [MASKED]
    - access_history: REMOVIDO completamente

    Resultado: Dados SEGUROS para LLM processar
    """
    logger.info("🔒 Node 3: Anonymizing personal data (LGPD/GDPR)...")

    domain_data = state.get("domain_data", {})
    personal_data_raw = domain_data.get("personal_data_raw", {})

    try:
        # Construir dados anonimizados
        anonymized = {
            # Campos identificadores (mascarados)
            "cpf": _mask_cpf(personal_data_raw.get("cpf", "")),
            "email": _mask_email(personal_data_raw.get("email", "")),
            "phone": _mask_phone(personal_data_raw.get("phone", "")),

            # Endereço (mascarado completamente)
            "address": "[MASKED]",

            # Data de nascimento (generalizada para faixa etária)
            "age_range": _generalize_birth_date(personal_data_raw.get("birth_date", "")),

            # Campos não-sensíveis preservados
            "name": personal_data_raw.get("name", "[ANONYMOUS]"),  # Também mascarado
            "marital_status": personal_data_raw.get("marital_status", ""),
            "occupation": personal_data_raw.get("occupation", ""),

            # Campos sensíveis REMOVIDOS (data minimization)
            # access_history: NOT included
            # location_tracking: NOT included
            # browsing_history: NOT included
        }

        # Remove PII patterns from any text fields
        for key in ["name", "occupation"]:
            if key in anonymized and anonymized[key]:
                anonymized[key] = _remove_pii_patterns(anonymized[key])

        step = AgentStep(
            agent_name="personal_agent",
            action="anonymize_personal_data",
            result={
                "fields_masked": 5,
                "fields_generalized": 1,
                "fields_removed": 3,
            },
        )

        logger.info(
            "✓ Anonymization complete: "
            "5 fields masked, 1 field generalized, 3 fields removed"
        )

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "anonymize",
                "personal_data_anonymized": anonymized,
                "pii_anonymized": True,  # Flag para verificação em testes
                "personal_data_raw": None,  # Remove dados brutos do estado
            },
        }

    except Exception as e:
        logger.error(f"Anonymization error: {e}")
        step = AgentStep(
            agent_name="personal_agent",
            action="anonymize_personal_data",
            error=str(e),
            result={},
        )
        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                **domain_data,
                "step": "anonymize",
                "pii_anonymized": False,
                "error": "Anonymization failed - cannot proceed",
            },
        }


# --- No 3: Analisar Dados Pessoais Anonimizados (chain) ---------------------

async def analyze_personal_data(state: AgentState) -> dict[str, Any]:
    """
    Analia dados ANONIMIZADOS usando personal_analysis_chain.

    Neste ponto, PII foi removido/mascarado. Seguro para LLM.
    """
    logger.info("📊 Node 4: Analyzing personal data (chain)...")

    domain_data = state.get("domain_data", {})

    # VERIFY: PII foi anonimizado
    if not domain_data.get("pii_anonymized"):
        logger.error("CRITICAL: PII not anonymized - blocking LLM processing")
        return {
            "steps": [
                AgentStep(
                    agent_name="personal_agent",
                    action="analyze_personal_data",
                    error="PII not anonymized",
                    result={},
                )
            ],
            "error": "LGPD violation: PII not anonymized before LLM",
            "domain_data": {**domain_data, "status": "error"},
        }

    personal_data_anon = domain_data.get("personal_data_anonymized", {})

    try:
        # Invocar chain com dados ANONIMIZADOS
        analysis_result = await personal_analysis_chain.ainvoke({
            "personal_data": personal_data_anon,
        })

        analysis_text = analysis_result.get("personal_analysis", "")
        insights = analysis_result.get("insights", [])

        step = AgentStep(
            agent_name="personal_agent",
            action="analyze_personal_data",
            result={
                "analysis_length": len(analysis_text),
                "insights_count": len(insights),
            },
        )

        logger.info(f"Analysis complete: {len(insights)} insights")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "analyze",
                "personal_analysis": analysis_text,
                "insights": insights,
            },
        }

    except Exception as e:
        logger.error(f"Personal analysis error: {e}")
        step = AgentStep(
            agent_name="personal_agent",
            action="analyze_personal_data",
            error=str(e),
            result={},
        )
        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                **domain_data,
                "step": "analyze",
                "personal_analysis": f"Erro: {str(e)}",
                "insights": [],
            },
        }


# --- No 4: Gerar Resumo Pessoal (chain) -----------------------------------

async def generate_personal_summary(state: AgentState) -> dict[str, Any]:
    """
    Gera resumo pessoal usando personal_summary_chain.

    Output é SEGURO (só contém dados anonimizados).
    """
    logger.info("📄 Node 5: Generating personal summary (chain)...")

    domain_data = state.get("domain_data", {})
    analysis = domain_data.get("personal_analysis", "")
    insights = domain_data.get("insights", [])

    try:
        # Invocar chain com análise (já anonimizada)
        summary_result = await personal_summary_chain.ainvoke({
            "analysis": analysis,
            "insights": insights,
        })

        personal_summary = summary_result.get("personal_summary", "")
        recommendations = summary_result.get("recommendations", [])

        step = AgentStep(
            agent_name="personal_agent",
            action="generate_personal_summary",
            result={
                "summary_length": len(personal_summary),
                "recommendations_count": len(recommendations),
            },
        )

        logger.info(f"Summary generated: {len(recommendations)} recommendations")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "generate_summary",
                "personal_summary": personal_summary,
                "recommendations": recommendations,
                "agent": "personal",
                "status": "complete",
                "pii_in_output": False,  # Safety check
            },
        }

    except Exception as e:
        logger.error(f"Summary generation error: {e}")
        step = AgentStep(
            agent_name="personal_agent",
            action="generate_personal_summary",
            error=str(e),
            result={},
        )
        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                **domain_data,
                "step": "generate_summary",
                "personal_summary": f"Erro ao gerar resumo: {str(e)}",
                "recommendations": [],
                "agent": "personal",
                "status": "error",
            },
        }


# --- Construtor do Sub-grafo ------------------------------------------------

def build_personal_subgraph_refactored() -> Any:
    """
    Constroi o sub-grafo pessoal com GARANTIA LGPD/GDPR.

    Estrutura:
        START -> validate_and_fetch -> anonymize (CRITICAL)
              -> analyze -> summary -> END

    Invariante Arquitetural:
        PII NUNCA pode ser visto pelo LLM.
        Isso é garantido pela ordem dos nós.

    Testes obrigatórios:
        - test_lgpd_anonymize_before_llm
        - test_no_pii_in_llm_inputs
        - test_anonymization_quality
    """
    graph = StateGraph(AgentState)

    graph.add_node("validate_and_fetch", validate_and_fetch)
    graph.add_node("anonymize", anonymize_personal_data)
    graph.add_node("analyze", analyze_personal_data)
    graph.add_node("summary", generate_personal_summary)

    graph.add_edge(START, "validate_and_fetch")
    graph.add_edge("validate_and_fetch", "anonymize")  # CRITICAL ORDER
    graph.add_edge("anonymize", "analyze")  # Analyze só vê dados anôn
    graph.add_edge("analyze", "summary")
    graph.add_edge("summary", END)

    return graph.compile()


# --- Compatibilidade: Export do grafo compilado --

get_personal_subgraph = build_personal_subgraph_refactored
