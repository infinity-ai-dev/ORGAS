"""
agents/modules/compliance_checker.py — Módulo Reutilizável de Compliance

Usado por: fiscal_agent, accounting_agent, personal_agent, support_agent

Funções:
- Verificar conformidade com legislação
- Validar contra regulamentações
- Gerar relatórios de compliance
- Alertar sobre violações

Suporta composição:
    process_module → check_compliance_module → format_report_module
"""

import logging
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate

from core.state import AgentState, AgentStep
from core.model import get_default_model

logger = logging.getLogger(__name__)


async def check_compliance_module(
    state: AgentState,
    domain: str,
    data_to_check: dict[str, Any],
    compliance_standards: list[str] | None = None,
) -> dict[str, Any]:
    """
    Módulo reutilizável: Verificação de Compliance.

    Args:
        state: AgentState
        domain: Domínio (fiscal, accounting, personal, etc)
        data_to_check: Dados a verificar
        compliance_standards: Quais padrões verificar

    Returns:
        dict com resultado de compliance
    """
    logger.info(f"⚖️  Módulo: Verificar compliance ({domain})...")

    if compliance_standards is None:
        # Standards padrão por domínio
        standards_map = {
            "fiscal": ["legislacao_fiscal", "receita_federal", "obrigacoes_acessorias"],
            "accounting": ["ifrs", "cpc", "nbr_contabil"],
            "personal": ["lgpd", "gdpr", "ccpa"],
            "support": ["sla", "response_time", "satisfaction"],
        }
        compliance_standards = standards_map.get(domain, ["generic"])

    model = get_default_model()

    # Preparar prompt específico por domínio
    prompt_template = f"""
    Você é um especialista em compliance para {domain}.

    Verifique se os dados abaixo estão em conformidade com:
    {', '.join(compliance_standards)}

    Dados:
    {str(data_to_check)[:500]}

    Forneça:
    1. Status de conformidade (compliant/non-compliant/partially_compliant)
    2. Violações encontradas
    3. Recomendações
    """

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=prompt_template),
        HumanMessage(content="Verifique o compliance do dados acima."),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        analysis = result.content

        # Extrair status (em produção: usar structured output)
        compliance_status = "unknown"
        if "compliant" in analysis.lower() and "non" not in analysis.lower():
            compliance_status = "compliant"
        elif "non-compliant" in analysis.lower() or "violação" in analysis.lower():
            compliance_status = "non_compliant"
        else:
            compliance_status = "partially_compliant"

        violations = []
        if "violação" in analysis.lower() or "problema" in analysis.lower():
            violations.append("Possível violação detectada - revisar análise LLM")

        step = AgentStep(
            agent_name=f"module:compliance_checker[{domain}]",
            action="check_compliance",
            result={
                "status": compliance_status,
                "standards_checked": len(compliance_standards),
                "violations": len(violations),
            },
        )

        logger.info(f"✓ Compliance check: {compliance_status} ({len(violations)} violações)")

        return {
            "steps": [step],
            "module_result": {
                "module": "compliance_checker",
                "domain": domain,
                "compliance_status": compliance_status,
                "standards_checked": compliance_standards,
                "compliance_analysis": analysis,
                "violations": violations,
            },
        }

    except Exception as e:
        logger.error(f"❌ Erro ao verificar compliance: {e}")
        return {
            "steps": [
                AgentStep(
                    agent_name=f"module:compliance_checker[{domain}]",
                    action="check_compliance",
                    error=str(e),
                    result={},
                )
            ],
            "error": str(e),
        }


async def check_compliance_rules(
    state: AgentState,
    domain: str,
    data: dict[str, Any],
    rules: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Verificação rápida com regras predefinidas.

    Mais rápido que LLM, útil para validações simples.

    Args:
        state: AgentState
        domain: Domínio
        data: Dados a validar
        rules: Regras customizadas

    Returns:
        Resultado de verificação
    """
    logger.info(f"⚖️  Módulo: Verificar compliance (regras)...")

    if rules is None:
        # Regras padrão por domínio
        rules = get_default_rules_for_domain(domain)

    violations: list[str] = []
    checks_passed: list[str] = []

    for rule_name, rule_check in rules.items():
        try:
            # rule_check é uma função que retorna bool
            if callable(rule_check):
                if rule_check(data):
                    checks_passed.append(rule_name)
                else:
                    violations.append(f"Violação de regra: {rule_name}")
        except Exception as e:
            violations.append(f"Erro ao verificar {rule_name}: {str(e)}")

    compliance_status = (
        "compliant"
        if len(violations) == 0
        else (
            "partially_compliant"
            if len(violations) < len(rules) / 2
            else "non_compliant"
        )
    )

    step = AgentStep(
        agent_name=f"module:compliance_checker_rules[{domain}]",
        action="check_compliance_rules",
        result={
            "checks_passed": len(checks_passed),
            "violations": len(violations),
            "status": compliance_status,
        },
    )

    logger.info(
        f"✓ Compliance rules: {compliance_status} "
        f"({len(checks_passed)}/{len(rules)} regras passaram)"
    )

    return {
        "steps": [step],
        "module_result": {
            "module": "compliance_checker_rules",
            "domain": domain,
            "compliance_status": compliance_status,
            "checks_passed": checks_passed,
            "violations": violations,
        },
    }


def get_default_rules_for_domain(domain: str) -> dict[str, Any]:
    """Regras padrão de compliance por domínio."""

    rules = {
        "fiscal": {
            "regime_configurado": lambda d: "regime_tributario" in d,
            "receita_positiva": lambda d: d.get("receita_bruta", 0) > 0,
            "obrigacoes_acessorias": lambda d: len(d.get("obrigacoes", [])) > 0,
        },
        "accounting": {
            "saldo_valido": lambda d: isinstance(d.get("saldo_contabil"), (int, float)),
            "lancamentos_presentes": lambda d: d.get("lancamentos", 0) > 0,
            "periodo_configurado": lambda d: "periodo" in d,
        },
        "personal": {
            "user_id_presente": lambda d: "user_id" in d,
            "consentimento_obtido": lambda d: d.get("consent", False),
            "dados_mascarados": lambda d: "***" in str(d.get("cpf", "")),
        },
        "support": {
            "ticket_id_presente": lambda d: "ticket_id" in d,
            "categoria_definida": lambda d: "category" in d,
            "sla_respeitado": lambda d: d.get("response_time_ms", 0) < 86400000,  # 24h
        },
    }

    return rules.get(domain, {})
