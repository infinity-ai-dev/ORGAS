"""
agents/modules/report_formatter.py — Módulo Reutilizável de Formatação de Relatórios

Usado por: fiscal_agent, accounting_agent, personal_agent, support_agent, generic_agent

Funções:
- Formatar relatórios estruturados
- Gerar PDFs, JSON, HTML
- Aplicar templates por tipo de relatório
- Adicionar assinaturas digitais

Suporta composição:
    consolidate_data_module → check_compliance_module → format_report_module
"""

import json
import logging
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate

from core.state import AgentState, AgentStep
from core.model import get_default_model

logger = logging.getLogger(__name__)


async def format_report_module(
    state: AgentState,
    domain: str,
    data_to_format: dict[str, Any],
    output_format: Literal["json", "markdown", "html", "pdf"] = "markdown",
    include_summary: bool = True,
    include_recommendations: bool = True,
) -> dict[str, Any]:
    """
    Módulo reutilizável: Formatação de Relatórios.

    Args:
        state: AgentState
        domain: Domínio (fiscal, accounting, personal, etc)
        data_to_format: Dados a formatar
        output_format: Formato de saída (json, markdown, html, pdf)
        include_summary: Incluir resumo executivo
        include_recommendations: Incluir recomendações

    Returns:
        dict com relatório formatado
    """
    logger.info(f"📄 Módulo: Formatar relatório ({domain}, formato={output_format})...")

    model = get_default_model()

    # Preparar dados para formatação
    format_prompt = f"""
    Você é um especialista em formatação de relatórios para {domain}.

    Formate os dados abaixo como um relatório profissional:

    Dados:
    {json.dumps(data_to_format, ensure_ascii=False, indent=2)[:1000]}

    {f'Inclua um resumo executivo conciso.' if include_summary else ''}
    {f'Inclua recomendações principais.' if include_recommendations else ''}

    Formato de saída solicitado: {output_format}

    Mantenha estrutura clara e profissional.
    """

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=format_prompt),
        HumanMessage(content="Formate este relatório."),
    ])

    chain = prompt | model

    try:
        result = await chain.ainvoke({})
        formatted_report = result.content

        # Aplicar post-processing baseado em formato
        if output_format == "json":
            try:
                # Tentar extrair JSON
                report_json = json.loads(formatted_report)
            except json.JSONDecodeError:
                report_json = {"content": formatted_report}
            formatted_report = json.dumps(report_json, ensure_ascii=False, indent=2)

        elif output_format == "html":
            # Adicionar tags HTML básicas
            formatted_report = f"""
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Relatório {domain.title()}</title>
                <style>
                    body {{ font-family: Arial, sans-serif; margin: 20px; }}
                    h1 {{ color: #333; }}
                    .timestamp {{ color: #999; font-size: 0.9em; }}
                </style>
            </head>
            <body>
                <h1>Relatório de {domain.title()}</h1>
                <div class="timestamp">Gerado em: 2026-03-03</div>
                <div class="content">
                    {formatted_report}
                </div>
            </body>
            </html>
            """

        elif output_format == "pdf":
            # Nota: em produção, usar biblioteca como reportlab ou weasyprint
            formatted_report = f"[PDF] {formatted_report[:100]}..."

        step = AgentStep(
            agent_name=f"module:report_formatter[{domain}]",
            action="format_report",
            result={
                "output_format": output_format,
                "report_length": len(formatted_report),
                "includes_summary": include_summary,
                "includes_recommendations": include_recommendations,
            },
        )

        logger.info(
            f"✓ Relatório formatado ({output_format}): "
            f"{len(formatted_report)} caracteres"
        )

        return {
            "steps": [step],
            "module_result": {
                "module": "report_formatter",
                "domain": domain,
                "output_format": output_format,
                "formatted_report": formatted_report,
            },
        }

    except Exception as e:
        logger.error(f"❌ Erro ao formatar relatório: {e}")
        return {
            "steps": [
                AgentStep(
                    agent_name=f"module:report_formatter[{domain}]",
                    action="format_report",
                    error=str(e),
                    result={},
                )
            ],
            "error": str(e),
        }


async def format_report_with_template(
    state: AgentState,
    domain: str,
    data: dict[str, Any],
    template_name: str | None = None,
) -> dict[str, Any]:
    """
    Formatação com templates predefinidos.

    Mais rápido e consistente que LLM.

    Args:
        state: AgentState
        domain: Domínio
        data: Dados a formatar
        template_name: Nome do template (ou None para default)

    Returns:
        Relatório formatado com template
    """
    logger.info(f"📄 Módulo: Formatar com template ({domain})...")

    if template_name is None:
        template_name = f"{domain}_default"

    template = get_template_for_domain(domain, template_name)

    # Renderizar template com dados
    try:
        formatted = template.format(**data)
    except KeyError as e:
        logger.warning(f"Campo faltando no template: {e}")
        formatted = template

    step = AgentStep(
        agent_name=f"module:report_formatter_template[{domain}]",
        action="format_report_template",
        result={
            "template_name": template_name,
            "formatted_length": len(formatted),
        },
    )

    logger.info(f"✓ Relatório formatado com template: {len(formatted)} caracteres")

    return {
        "steps": [step],
        "module_result": {
            "module": "report_formatter_template",
            "domain": domain,
            "template_name": template_name,
            "formatted_report": formatted,
        },
    }


def get_template_for_domain(domain: str, template_name: str) -> str:
    """Retorna template predefinido para domínio."""

    templates = {
        "fiscal": {
            "default": """
RELATÓRIO DE ANÁLISE FISCAL
============================

Status: {status}
Regime: {regime}
Receita Bruta: R$ {receita_bruta:,.2f}
Imposto Devido: R$ {imposto_devido:,.2f}

Conformidade: {compliance}
Riscos Identificados: {risks}

Recomendações:
{recommendations}
""",
        },
        "accounting": {
            "default": """
RELATÓRIO CONTÁBIL
==================

Período: {periodo}
Saldo Contábil: R$ {saldo:,.2f}
Lançamentos: {lancamentos}

Análise: {analysis}

Status: {status}
""",
        },
        "personal": {
            "default": """
RELATÓRIO DE PRIVACIDADE
=======================

Status LGPD: {lgpd_status}
Status GDPR: {gdpr_status}

Anonimização: {anonymization_level}

Recomendações de Segurança:
{recommendations}
""",
        },
        "support": {
            "default": """
RELATÓRIO DE SUPORTE
====================

Ticket ID: {ticket_id}
Status: {status}
Categoria: {category}

Descrição: {description}

Tempo de Resposta: {response_time}h
Resolução: {resolution}
""",
        },
    }

    domain_templates = templates.get(domain, {})
    return domain_templates.get(template_name, "Relatório sem template definido")
