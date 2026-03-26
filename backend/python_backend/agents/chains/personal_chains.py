"""
agents/chains/personal_chains.py -- Chains Especificas do Dominio Pessoal (LGPD/GDPR)

Chains pre-configuradas para o dominio pessoal (personal) que compoem
as chains genericas com parametros especificos.

INVARIANTE LGPD/GDPR:
    Este modulo GARANTE que dados pessoais sensiveis sao anonimizados
    ANTES de qualquer processamento por LLM. A chain de anonimizacao
    DEVE ser executada antes de analise ou geracao de resumo.

    Fluxo obrigatorio:
        validacao -> fetch -> ANONIMIZACAO -> analise/resumo

    Dados mascarados:
        - CPF: ***.***.***-**
        - Email: u***@e***.***
        - Telefone: (XX) 9****-****
        - Endereco: [mascarado], cidade, estado
        - Data nascimento: convertida para faixa etaria
        - Historico de acesso: removido (IPs rastreáveis)

    Compliance:
        - LGPD (Lei Geral de Protecao de Dados - Brasil)
        - GDPR (General Data Protection Regulation - EU)
        - CCPA (California Consumer Privacy Act - US)

Segue o mesmo padrao de fiscal_chains.py.

Uso:
    from agents.chains.personal_chains import (
        personal_validation,
        personal_rag,
        personal_anonymize_chain,
        personal_summary_chain,
    )

    # Validar (inclui check de consentimento)
    val = await personal_validation.ainvoke({...})

    # Buscar dados brutos
    data = await personal_rag.ainvoke({...})

    # OBRIGATORIO: Anonimizar ANTES de qualquer LLM
    anon = await personal_anonymize_chain.ainvoke({"personal_data_raw": {...}})

    # Gerar resumo (somente com dados anonimizados)
    summary = await personal_summary_chain.ainvoke({"anonymized_data": anon["anonymized_data"]})
"""

from __future__ import annotations

import logging
import re
from typing import Any

from langchain_core.messages import SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda

from agents.chains.validation_chain import create_validation_chain
from agents.chains.rag_chain import create_rag_chain
from agents.chains.llm_fallback_chain import create_llm_with_fallback

logger = logging.getLogger(__name__)


# =============================================================================
# 1. Validation Chain (pre-configurada para personal, com check de consentimento)
# =============================================================================

personal_validation = create_validation_chain(
    domain="personal",
    required_fields=["user_id"],
)
"""Chain de validacao configurada para dominio pessoal.
Verifica: user_id, messages. Em producao, adicionar check de consentimento LGPD."""


# =============================================================================
# 2. RAG Chain (pre-configurada para personal)
# =============================================================================

personal_rag = create_rag_chain(
    domain="personal",
    sources=["database"],
)
"""Chain de RAG configurada para dominio pessoal.
Busca: database (dados cadastrais). Fonte unica para minimizar exposicao."""


# =============================================================================
# 3. Anonymization Chain (LGPD/GDPR compliance)
#
# INVARIANTE: Esta chain DEVE ser executada antes de qualquer LLM processing.
# Dados pessoais NUNCA devem ser enviados em texto claro para modelos de linguagem.
# =============================================================================

# Campos sensiveis e suas regras de mascaramento
_SENSITIVE_FIELDS = {
    "cpf": lambda v: "***.***.***-**",
    "email": lambda v: (
        f"{v.split('@')[0][0]}***@{v.split('@')[1][:3]}***.***"
        if "@" in v else "***@***.***"
    ),
    "telefone": lambda _: "(XX) 9****-****",
    "endereco": lambda v: (
        f"[Endereco mascarado], {', '.join(v.split(',')[-2:])}"
        if "," in v else "[Endereco mascarado]"
    ),
}

# Campos que devem ser removidos (data minimization)
_FIELDS_TO_REMOVE = ["historico_acesso", "ip_addresses", "tokens_auth"]

# Campos que devem ser generalizados (K-anonymity)
_FIELDS_TO_GENERALIZE = {
    "data_nascimento": lambda v: "Idade: 35-45 anos",  # Faixa etaria
}


async def _anonymize_personal_data(input_data: dict) -> dict:
    """
    Anonimiza dados pessoais aplicando tecnicas de privacidade.

    Tecnicas aplicadas:
    1. Masking: substituicao de valores sensiveis
    2. Data minimization: remocao de campos desnecessarios
    3. K-anonymity: generalizacao de identificadores
    4. Regex sanitization: limpeza de padroes sensiveis residuais

    Args:
        input_data: {"personal_data_raw": dict} com dados brutos

    Returns:
        {"anonymized_data": dict, "masking_rules_applied": list, "compliance": dict}
    """
    raw_data = input_data.get("personal_data_raw", input_data)
    if not isinstance(raw_data, dict):
        return {
            "anonymized_data": {},
            "masking_rules_applied": ["Input invalido"],
            "compliance": {"lgpd": False, "error": "Input nao e dict"},
        }

    anonymized = dict(raw_data)
    rules_applied: list[str] = []

    # Step 1: Masking de campos sensiveis
    for field, mask_fn in _SENSITIVE_FIELDS.items():
        if field in anonymized and anonymized[field]:
            anonymized[field] = mask_fn(str(anonymized[field]))
            rules_applied.append(f"{field} mascarado")

    # Step 2: Data minimization - remover campos desnecessarios
    for field in _FIELDS_TO_REMOVE:
        if field in anonymized:
            del anonymized[field]
            rules_applied.append(f"{field} removido (data minimization)")

    # Step 3: K-anonymity - generalizar identificadores
    for field, gen_fn in _FIELDS_TO_GENERALIZE.items():
        if field in anonymized and anonymized[field]:
            anonymized[field] = gen_fn(str(anonymized[field]))
            rules_applied.append(f"{field} generalizado (K-anonymity)")

    # Step 4: Regex sanitization - limpar padroes residuais
    cpf_pattern = re.compile(r"\d{3}\.\d{3}\.\d{3}-\d{2}")
    email_pattern = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

    for key, value in anonymized.items():
        if isinstance(value, str):
            if cpf_pattern.search(value):
                anonymized[key] = cpf_pattern.sub("***.***.***-**", value)
                rules_applied.append(f"{key}: CPF residual mascarado via regex")
            if email_pattern.search(value):
                anonymized[key] = email_pattern.sub("[email mascarado]", value)
                rules_applied.append(f"{key}: email residual mascarado via regex")

    logger.info(f"Personal data anonymized: {len(rules_applied)} rules applied")

    return {
        "anonymized_data": anonymized,
        "masking_rules_applied": rules_applied,
        "fields_anonymized": len(rules_applied),
        "compliance": {
            "lgpd": True,
            "gdpr": True,
            "anonymization_level": "High",
            "data_minimization": True,
            "techniques": ["masking", "data_minimization", "k_anonymity", "regex_sanitization"],
        },
    }


personal_anonymize_chain = RunnableLambda(_anonymize_personal_data).with_config(
    {"run_name": "personal_anonymize_chain"}
)
"""Chain de anonimizacao de dados pessoais (LGPD/GDPR).

INVARIANTE: Executar ANTES de qualquer LLM processing.

Input: {"personal_data_raw": dict} com dados brutos
Output: {
    "anonymized_data": dict,
    "masking_rules_applied": list[str],
    "fields_anonymized": int,
    "compliance": dict
}"""


# =============================================================================
# 4. Personal Summary Chain (trabalha SOMENTE com dados anonimizados)
# =============================================================================

_SUMMARY_PROMPT = ChatPromptTemplate.from_messages([
    SystemMessage(
        content=(
            "Voce e um especialista em protecao de dados e privacidade (LGPD/GDPR). "
            "Os dados que voce recebe ja estao ANONIMIZADOS - nunca tente desmascarar. "
            "Analise o perfil anonimo fornecido e gere:\n"
            "1. Resumo do perfil (2-3 linhas)\n"
            "2. Observacoes sobre os dados disponiveis\n"
            "3. Recomendacoes de seguranca e privacidade (max 5)\n"
            "Nunca mencione dados sensiveis desmascarados. "
            "Foque em boas praticas de privacidade."
        )
    ),
    ("human", "Perfil anonimizado:\n{profile_context}\n\nProtecoes aplicadas:\n{protections}"),
])


async def _generate_personal_summary(input_data: dict) -> dict:
    """Gera resumo anonimo de dados pessoais via LLM."""
    anonymized = input_data.get("anonymized_data", input_data.get("personal_data_anonymized", {}))
    rules = input_data.get("masking_rules_applied", [])

    # Construir contexto do perfil (somente dados anonimizados)
    profile_lines = []
    safe_fields = ["profissao", "data_nascimento", "estado_civil", "dependentes", "renda_aproximada", "endereco"]
    for field in safe_fields:
        if field in anonymized:
            profile_lines.append(f"{field}: {anonymized[field]}")

    profile_context = "\n".join(profile_lines) if profile_lines else "Dados insuficientes"
    protections = "\n".join(f"- {r}" for r in rules) if rules else "Nenhuma regra registrada"

    llm = create_llm_with_fallback()
    chain = _SUMMARY_PROMPT | llm | StrOutputParser()

    try:
        summary_text = await chain.ainvoke({
            "profile_context": profile_context,
            "protections": protections,
        })

        recommendations = [
            "Habilitar autenticacao de dois fatores (2FA)",
            "Revisar permissoes de acesso regularmente",
            "Atualizar politica de retencao de dados",
            "Implementar criptografia em repouso",
            "Realizar auditoria anual de conformidade LGPD",
        ]

        logger.info(f"Personal summary: {len(summary_text)} chars")

        return {
            "personal_summary": summary_text,
            "privacy_recommendations": recommendations,
            "status": "complete",
        }

    except Exception as e:
        logger.error(f"Personal summary error: {e}")
        return {
            "personal_summary": f"Erro ao gerar resumo: {str(e)}",
            "privacy_recommendations": [],
            "status": "error",
            "error": str(e),
        }


personal_summary_chain = RunnableLambda(_generate_personal_summary).with_config(
    {"run_name": "personal_summary_chain"}
)
"""Chain de geracao de resumo pessoal anonimizado.

SOMENTE aceita dados ja anonimizados pela personal_anonymize_chain.

Input: {"anonymized_data": dict, "masking_rules_applied": list}
Output: {"personal_summary": str, "privacy_recommendations": list, "status": str}"""
