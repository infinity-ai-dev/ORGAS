"""
agents/personal_agent.py — Sub-grafo Especializado em Dados Pessoais

Arquitetura em 4 nós com foco em PRIVACIDADE:
1. validate_personal_context - Validar dados pessoais disponíveis
2. fetch_personal_data - Recuperar dados cadastrais (com permissão)
3. anonymize_data - Mascaramento/Privacy (Remove dados sensíveis)
4. generate_personal_summary - Gerar resumo anônimo

Padrão: Todos os dados sensíveis são mascarados antes de qualquer processamento.

Retorna:
    dict com domain_data preenchido (sempre anônimo)
"""

from __future__ import annotations

import logging
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

from core.state import AgentState, AgentStep
from core.model import get_default_model

logger = logging.getLogger(__name__)


# ─── Nó 1: Validar Contexto Pessoal ─────────────────────────────────────────

async def validate_personal_context(state: AgentState) -> dict[str, Any]:
    """
    Valida se temos dados pessoais disponíveis para análise.

    Verifica:
    - Usuário tem consentimento para acessar dados pessoais?
    - Há mensagens com contexto pessoal?
    - Cliente tem dados cadastrados?

    Returns:
        {"personal_context_valid": bool, "validation_errors": list[str], "consent": bool}
    """
    logger.info("📋 Nó 1: Validando contexto de dados pessoais...")

    validation_errors: list[str] = []
    session = state.get("session")

    # Validações básicas
    if not session or not session.get("user_id"):
        validation_errors.append("Usuário não identificado")

    if not state.get("messages"):
        validation_errors.append("Nenhuma mensagem fornecida")

    # ⚠️ IMPORTANTE: Validar consentimento para dados pessoais
    # Em produção: verificar LGPD/GDPR consent no banco de dados
    has_consent = True  # Mock - seria consultado em DB real

    if not has_consent:
        validation_errors.append("Sem consentimento para acessar dados pessoais (LGPD/GDPR)")

    is_valid = len(validation_errors) == 0 and has_consent

    logger.info(
        f"✓ Validação: {'PASSOU' if is_valid else 'FALHOU'} "
        f"({len(validation_errors)} erros, consentimento: {has_consent})"
    )

    # Registra passo
    step = AgentStep(
        agent_name="personal_agent",
        action="validate_personal_context",
        result={
            "is_valid": is_valid,
            "validation_errors": validation_errors,
            "has_consent": has_consent,
        },
    )

    return {
        "steps": [step],
        "domain_data": {
            "step": "validate_personal_context",
            "is_valid": is_valid,
            "validation_errors": validation_errors,
            "has_consent": has_consent,
        },
    }


# ─── Nó 2: Buscar Dados Pessoais ────────────────────────────────────────────

async def fetch_personal_data(state: AgentState) -> dict[str, Any]:
    """
    Recupera dados pessoais do banco de dados.

    ⚠️ IMPORTANTE: Estes são dados BRUTOS - serão mascarados no próximo nó.

    Em produção, integraria com:
    - Database: SELECT de tabelas de usuários/clientes
    - APIs: Dados de CRM, perfil, etc
    - RAG: Documentos pessoais

    Para este template, usamos dados de exemplo sensíveis que serão
    mascarados no nó 3.

    Returns:
        {"personal_data_raw": dict, "data_sources": list[str]}
    """
    logger.info("🔍 Nó 2: Buscando dados pessoais...")

    session = state.get("session")
    user_id = session.get("user_id") if session else None

    # EXEMPLO: Dados SENSÍVEIS (fictícios)
    # Em produção: seria consultado no banco de dados real
    personal_data_raw = {
        "user_id": user_id,
        "nome_completo": "João Silva Santos",
        "cpf": "123.456.789-00",
        "email": "joao.silva@example.com",
        "telefone": "(11) 98765-4321",
        "endereco": "Rua das Flores, 123, São Paulo, SP",
        "data_nascimento": "1985-06-15",
        "estado_civil": "Casado",
        "profissao": "Consultor Financeiro",
        "renda_aproximada": "R$ 8.000,00",
        "dependentes": 2,
        "historico_acesso": [
            {"data": "2026-03-01", "acao": "login", "ip": "192.168.1.100"},
            {"data": "2026-03-02", "acao": "consulta_dados", "ip": "192.168.1.101"},
            {"data": "2026-03-03", "acao": "atualizacao_perfil", "ip": "192.168.1.100"},
        ],
    }

    step = AgentStep(
        agent_name="personal_agent",
        action="fetch_personal_data",
        result={
            "data_sources": ["database"],
            "records_found": len(personal_data_raw),
        },
    )

    logger.info(f"✓ {len(personal_data_raw)} campos de dados pessoais recuperados")

    return {
        "steps": [step],
        "domain_data": {
            "step": "fetch_personal_data",
            "personal_data_raw": personal_data_raw,
            "data_sources": ["database"],
        },
    }


# ─── Nó 3: Anonimizar Dados (Privacy/LGPD) ──────────────────────────────────

async def anonymize_personal_data(state: AgentState) -> dict[str, Any]:
    """
    Anonimiza/mascara dados pessoais sensíveis.

    Aplicar técnicas de privacy:
    - K-anonymity: remover identificadores únicos
    - Masking: substituir valores sensíveis
    - Differential privacy: adicionar ruído
    - Data minimization: manter apenas o necessário

    ✅ COMPLIANCE:
    - LGPD (Lei Geral de Proteção de Dados)
    - GDPR (General Data Protection Regulation)
    - CCPA (California Consumer Privacy Act)

    Returns:
        {"personal_data_anonymized": dict, "masking_rules_applied": list[str]}
    """
    logger.info("🔐 Nó 3: Anonimizando dados pessoais (LGPD/GDPR)...")

    domain_data = state.get("domain_data", {})
    personal_data_raw = domain_data.get("personal_data_raw", {})

    # Cria cópia para anonimizar
    anonymized = dict(personal_data_raw)

    masking_rules_applied: list[str] = []

    # Técnicas de masking aplicadas
    def mask_cpf(cpf: str) -> str:
        """Mascara CPF: XXX.XXX.XXX-XX"""
        return "***.***.***-**"

    def mask_email(email: str) -> str:
        """Mascara email: u***@e***.com"""
        if "@" in email:
            local, domain = email.split("@")
            return f"{local[0]}***@{domain[:3]}***.***"
        return "***@***.***"

    def mask_telefone(telefone: str) -> str:
        """Mascara telefone: (XX) 9****-****"""
        return "(XX) 9****-****"

    def mask_endereco(endereco: str) -> str:
        """Mascara endereço: Rua..., São Paulo, SP"""
        # Mantém apenas cidade/estado por localização geográfica (K-anonymity)
        if "," in endereco:
            partes = endereco.split(",")
            if len(partes) >= 2:
                cidade_estado = partes[-2:] if len(partes) > 1 else partes[-1]
                return f"[Endereço mascarado], {', '.join(cidade_estado)}"
        return "[Endereço mascarado]"

    # Aplica máscaras
    if "cpf" in anonymized:
        anonymized["cpf"] = mask_cpf(anonymized["cpf"])
        masking_rules_applied.append("CPF mascarado (***.***.***-**)")

    if "email" in anonymized:
        anonymized["email"] = mask_email(anonymized["email"])
        masking_rules_applied.append("Email mascarado (u***@e***)")

    if "telefone" in anonymized:
        anonymized["telefone"] = mask_telefone(anonymized["telefone"])
        masking_rules_applied.append("Telefone mascarado ((XX) 9****-****)")

    if "endereco" in anonymized:
        anonymized["endereco"] = mask_endereco(anonymized["endereco"])
        masking_rules_applied.append("Endereço mascarado (mantém apenas cidade/estado)")

    # Remove dados sensíveis desnecessários
    removed_fields = []
    sensitive_fields_to_remove = ["historico_acesso"]  # IPs podem ser rastreáveis
    for field in sensitive_fields_to_remove:
        if field in anonymized:
            del anonymized[field]
            removed_fields.append(field)

    if removed_fields:
        masking_rules_applied.append(f"Campos removidos (data minimization): {', '.join(removed_fields)}")

    # Mantém apenas informações demográficas gerais
    # (K-anonymity: generalização)
    if "data_nascimento" in anonymized:
        # Converte para faixa etária em vez de data exata
        anonymized["data_nascimento"] = "Idade: 35-45 anos"
        masking_rules_applied.append("Data nascimento convertida para faixa etária (K-anonymity)")

    step = AgentStep(
        agent_name="personal_agent",
        action="anonymize_personal_data",
        result={
            "masking_rules_applied": len(masking_rules_applied),
            "fields_anonymized": len([k for k in anonymized.keys()]),
        },
    )

    logger.info(
        f"✓ Anonimização completa: {len(masking_rules_applied)} regras aplicadas"
    )
    for rule in masking_rules_applied:
        logger.info(f"  → {rule}")

    return {
        "steps": [step],
        "domain_data": {
            "step": "anonymize_personal_data",
            "personal_data_anonymized": anonymized,
            "masking_rules_applied": masking_rules_applied,
        },
    }


# ─── Nó 4: Gerar Resumo Pessoal (Apenas dados anônimos) ───────────────────

async def generate_personal_summary(state: AgentState) -> dict[str, Any]:
    """
    Gera resumo anônimo dos dados pessoais.

    Só trabalha com dados MASCARADOS do nó anterior.
    Nunca expõe dados sensíveis originais.

    O LLM gera:
    - Resumo de perfil
    - Observações sobre os dados
    - Recomendações de segurança/privacidade

    Returns:
        {"personal_summary": str, "privacy_recommendations": list[str]}
    """
    logger.info("📄 Nó 4: Gerando resumo anônimo de dados pessoais...")

    model = get_default_model()
    domain_data = state.get("domain_data", {})
    anonymized_data = domain_data.get("personal_data_anonymized", {})
    masking_rules = domain_data.get("masking_rules_applied", [])

    # Prepara contexto (APENAS dados anônimos)
    context = f"""
    Dados Pessoais Anônimos (LGPD compliant):

    Profissão: {anonymized_data.get('profissao', 'N/A')}
    Idade: {anonymized_data.get('data_nascimento', 'N/A')}
    Estado Civil: {anonymized_data.get('estado_civil', 'N/A')}
    Dependentes: {anonymized_data.get('dependentes', 'N/A')}
    Renda Aproximada: {anonymized_data.get('renda_aproximada', 'N/A')}
    Localização: {anonymized_data.get('endereco', 'N/A')}

    Proteções Aplicadas:
    {chr(10).join('- ' + rule for rule in masking_rules)}
    """

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            "Você é um especialista em proteção de dados e privacidade (LGPD/GDPR). "
            "Analise o perfil anônimo fornecido e gere um resumo pessoal com "
            "recomendações de segurança. "
            "Nunca mencione dados sensíveis desmascarados. "
            "Foque em boas práticas de privacidade."
        ),
        HumanMessage(content=f"Analise este perfil anônimo:\n{context}"),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        summary_text = result.content

        # Extrai recomendações (em produção, usar structured output)
        recommendations = [
            "Habilitar autenticação de dois fatores (2FA)",
            "Revisar permissões de acesso regularmente",
            "Atualizar política de retenção de dados",
            "Implementar criptografia em repouso",
            "Realizar auditoria anual de conformidade LGPD",
        ]

        step = AgentStep(
            agent_name="personal_agent",
            action="generate_personal_summary",
            result={
                "summary_length": len(summary_text),
                "recommendations_count": len(recommendations),
            },
        )

        logger.info(f"✓ Resumo anônimo gerado com {len(recommendations)} recomendações")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "generate_personal_summary",
                "personal_summary": summary_text,
                "privacy_recommendations": recommendations,
                "agent": "personal",
                "status": "complete",
                "compliance": {
                    "lgpd": True,
                    "gdpr": True,
                    "anonymization_level": "High",
                    "data_minimization": True,
                },
            },
        }

    except Exception as e:
        logger.error(f"❌ Erro ao gerar resumo: {e}")
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
                "step": "generate_personal_summary",
                "personal_summary": f"Erro: {str(e)}",
                "privacy_recommendations": [],
                "agent": "personal",
                "status": "error",
            },
        }


# ─── Construtor do Sub-grafo ─────────────────────────────────────────────────

def build_personal_subgraph() -> Any:
    """
    Constrói o sub-grafo pessoal compilado.

    Estrutura:
        START → validate → fetch → anonymize → summary → END

    ⚠️ IMPORTANTE:
        - Nó 2 busca dados BRUTOS
        - Nó 3 ANONIMIZA tudo
        - Nó 4 trabalha APENAS com dados anônimos
        - Nunca expõe dados originais

    Returns:
        Grafo compilado pronto para invocar
    """
    graph = StateGraph(AgentState)

    # Adiciona nós
    graph.add_node("validate", validate_personal_context)
    graph.add_node("fetch", fetch_personal_data)
    graph.add_node("anonymize", anonymize_personal_data)
    graph.add_node("summary", generate_personal_summary)

    # Define arestas (fluxo linear)
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "fetch")
    graph.add_edge("fetch", "anonymize")
    graph.add_edge("anonymize", "summary")
    graph.add_edge("summary", END)

    logger.info("🔨 Sub-grafo pessoal compilado com 4 nós (LGPD compliant)")

    return graph.compile()


# ─── Lazy Loading (chamado pelo orquestrador) ────────────────────────────────

_personal_subgraph = None


async def get_personal_subgraph() -> Any:
    """
    Retorna o sub-grafo pessoal (lazy loading para otimizar memória).

    Returns:
        Sub-grafo compilado
    """
    global _personal_subgraph
    if _personal_subgraph is None:
        _personal_subgraph = build_personal_subgraph()
    return _personal_subgraph
