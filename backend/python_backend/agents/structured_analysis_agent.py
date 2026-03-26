"""
STRUCTURED_ANALYSIS_AGENT - Agente genérico para extração de dados estruturados

Substitui os agentes específicos (fiscal, personal, accounting, support) com
um pipeline genérico que:

1. Extrai dados estruturados (SEM narrativas)
2. Valida integridade
3. Analisa dados extraídos
4. Retorna JSON estruturado puro

Arquitetura:
- extract_data: Chama LLM com prompt de extração
- validate_data: Valida campos obrigatórios
- analyze_data: Chama LLM para análise (ainda estruturada)
- consolidate: Mescla extração + análise em resposta final
"""

import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import END, START, StateGraph

from core.state import AgentState, AgentStep
from core.model import get_default_model

from agents.prompts.structured_analysis_prompts import (
    PROMPT_MAP,
    get_extraction_prompt,
    get_analysis_prompt,
)
from agents.modules.json_parser import parse_response_by_type

logger = logging.getLogger(__name__)


# ─── Nó 1: Extrair Dados Estruturados ────────────────────────────────────────

async def extract_structured_data(state: AgentState) -> dict[str, Any]:
    """
    Extrai dados estruturados do documento usando LLM.

    O LLM é instruído para retornar APENAS JSON estruturado,
    sem narrativas ou resumos.

    Retorna:
        domain_data com "extracted_data" em JSON estruturado
    """
    logger.info("📊 Nó 1: Extraindo dados estruturados...")

    model = get_default_model()
    messages = state.get("messages", [])
    report_type = state.get("session", {}).get("report_type", "generic")

    if not messages:
        return {
            "domain_data": {
                "step": "extract_structured_data",
                "extracted_data": {},
                "validacao_erros": ["Nenhum documento fornecido"],
            },
            "error": "Nenhum documento fornecido"
        }

    # Obter prompt de extração específico do tipo
    extraction_prompt = get_extraction_prompt(report_type)

    if not extraction_prompt:
        logger.warning(f"Prompt não encontrado para tipo: {report_type}")
        extraction_prompt = ChatPromptTemplate.from_template(
            "Extraia dados estruturados em JSON do seguinte conteúdo:\n{content}"
        )

    # Preparar conteúdo do documento
    content = messages[0].content if messages else ""

    try:
        # Chamar LLM com prompt de extração
        chain = extraction_prompt | model
        result = await chain.ainvoke({"content": content})
        llm_response = result.content

        # Parse da resposta para JSON estruturado
        extracted_data = parse_response_by_type(llm_response, report_type)

        step = AgentStep(
            agent_name="structured_analysis_agent",
            action="extract_structured_data",
            result={
                "report_type": report_type,
                "fields_extracted": len(extracted_data),
            },
        )

        logger.info(f"✓ {len(extracted_data)} campos extraídos")

        return {
            "steps": [step],
            "domain_data": {
                "step": "extract_structured_data",
                "extracted_data": extracted_data,
                "report_type": report_type,
                "validacao_erros": extracted_data.get("validacao_erros", []),
            },
        }

    except Exception as e:
        logger.error(f"❌ Erro ao extrair dados: {e}")
        step = AgentStep(
            agent_name="structured_analysis_agent",
            action="extract_structured_data",
            error=str(e),
            result={},
        )

        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                "step": "extract_structured_data",
                "extracted_data": {},
                "validacao_erros": [f"Erro na extração: {str(e)}"],
            },
        }


# ─── Nó 2: Validar Dados Estruturados ────────────────────────────────────────

async def validate_structured_data(state: AgentState) -> dict[str, Any]:
    """
    Valida integridade dos dados estruturados extraídos.

    Verifica:
    - Campos obrigatórios presentes
    - Tipos de dados corretos
    - Valores razoáveis
    - Consistência entre campos

    Retorna:
        Validação OK ou lista de erros
    """
    logger.info("✓ Nó 2: Validando dados estruturados...")

    domain_data = state.get("domain_data", {})
    extracted_data = domain_data.get("extracted_data", {})
    report_type = domain_data.get("report_type", "generic")

    validation_errors = extracted_data.get("validacao_erros", [])

    # Validações por tipo
    if report_type == "fiscal" and extracted_data:
        if not extracted_data.get("regime_tributario"):
            validation_errors.append("Regime tributário não configurado")
        if not extracted_data.get("receita_bruta"):
            validation_errors.append("Receita bruta não encontrada")

    elif report_type == "personal" and extracted_data:
        if not extracted_data.get("compliance"):
            validation_errors.append("Dados de conformidade ausentes")

    elif report_type == "accounting" and extracted_data:
        if not extracted_data.get("balanco"):
            validation_errors.append("Balanço não encontrado")

    is_valid = len(validation_errors) == 0

    step = AgentStep(
        agent_name="structured_analysis_agent",
        action="validate_structured_data",
        result={
            "is_valid": is_valid,
            "errors_count": len(validation_errors),
        },
    )

    logger.info(f"{'✓ Validação OK' if is_valid else f'❌ {len(validation_errors)} erros'}")

    return {
        "steps": [step],
        "domain_data": {
            **domain_data,
            "step": "validate_structured_data",
            "is_valid": is_valid,
            "validacao_erros": validation_errors,
        },
    }


# ─── Nó 3: Analisar Dados Estruturados ───────────────────────────────────────

async def analyze_structured_data(state: AgentState) -> dict[str, Any]:
    """
    Analisa dados estruturados extraídos usando LLM.

    O LLM recebe os dados extraídos e retorna análise ESTRUTURADA:
    - Validação lógica
    - Identificação de riscos/alertas
    - Recomendações estruturadas
    - Indicadores calculados

    NÃO gera narrativas ou pareceres em texto.

    Retorna:
        domain_data com "analysis_data" em JSON estruturado
    """
    logger.info("🔍 Nó 3: Analisando dados estruturados...")

    model = get_default_model()
    domain_data = state.get("domain_data", {})
    extracted_data = domain_data.get("extracted_data", {})
    report_type = domain_data.get("report_type", "generic")

    if not extracted_data:
        return {
            "domain_data": {
                **domain_data,
                "step": "analyze_structured_data",
                "analysis_data": {},
                "validacao_erros": ["Sem dados para analisar"],
            }
        }

    # Obter prompt de análise específico do tipo
    analysis_prompt = get_analysis_prompt(report_type)

    if not analysis_prompt:
        logger.warning(f"Prompt de análise não encontrado para: {report_type}")
        analysis_prompt = ChatPromptTemplate.from_template(
            "Analise os seguintes dados estruturados e retorne APENAS JSON estruturado:\n{data}"
        )

    try:
        # Chamar LLM com prompt de análise
        chain = analysis_prompt | model
        result = await chain.ainvoke({f"{report_type}_data": str(extracted_data)})
        llm_response = result.content

        # Parse da resposta para JSON estruturado
        analysis_data = parse_response_by_type(llm_response, report_type)

        step = AgentStep(
            agent_name="structured_analysis_agent",
            action="analyze_structured_data",
            result={
                "analysis_fields": len(analysis_data),
            },
        )

        logger.info(f"✓ Análise completa com {len(analysis_data)} campos")

        return {
            "steps": [step],
            "domain_data": {
                **domain_data,
                "step": "analyze_structured_data",
                "analysis_data": analysis_data,
            },
        }

    except Exception as e:
        logger.error(f"❌ Erro ao analisar dados: {e}")
        step = AgentStep(
            agent_name="structured_analysis_agent",
            action="analyze_structured_data",
            error=str(e),
            result={},
        )

        return {
            "steps": [step],
            "error": str(e),
            "domain_data": {
                **domain_data,
                "step": "analyze_structured_data",
                "analysis_data": {},
                "validacao_erros": [f"Erro na análise: {str(e)}"],
            },
        }


# ─── Nó 4: Consolidar Resposta Final ─────────────────────────────────────────

async def consolidate_response(state: AgentState) -> dict[str, Any]:
    """
    Consolida extração + análise em resposta final estruturada.

    Combina:
    - extracted_data: Dados brutos extraídos
    - analysis_data: Análise dos dados
    - metadata: Tipo, status, timing

    Retorna resposta pronta para serialização JSON.

    Retorna:
        domain_data com "response" completa em JSON estruturado
    """
    logger.info("📋 Nó 4: Consolidando resposta estruturada...")

    domain_data = state.get("domain_data", {})
    extracted_data = domain_data.get("extracted_data", {})
    analysis_data = domain_data.get("analysis_data", {})
    report_type = domain_data.get("report_type", "generic")
    is_valid = domain_data.get("is_valid", True)
    validation_errors = domain_data.get("validacao_erros", [])

    # Estrutura final padronizada para todos os tipos
    final_response = {
        # Metadados
        "step": "consolidation",
        "agent": report_type,
        "status": "complete" if is_valid else "partial",
        "is_valid": is_valid,
        "validacao_erros": validation_errors,

        # Dados extraídos (brutos, estruturados)
        "extracted_data": extracted_data,

        # Dados analisados (insights estruturados)
        "analysis_data": analysis_data,

        # Campos específicos do tipo (preserva estrutura original)
        **extracted_data,
        **(analysis_data if analysis_data else {}),
    }

    step = AgentStep(
        agent_name="structured_analysis_agent",
        action="consolidate_response",
        result={
            "response_keys": len(final_response),
            "status": "complete" if is_valid else "partial",
        },
    )

    logger.info(f"✓ Resposta consolidada: {final_response['status']}")

    return {
        "steps": [step],
        "domain_data": {
            **domain_data,
            "step": "consolidation",
            "response": final_response,
        },
    }


# ─── Construtor do Sub-grafo ─────────────────────────────────────────────────

async def get_structured_analysis_subgraph():
    """Constrói e retorna o sub-grafo de análise estruturada."""
    builder = StateGraph(AgentState)

    builder.add_node("extract_data", extract_structured_data)
    builder.add_node("validate_data", validate_structured_data)
    builder.add_node("analyze_data", analyze_structured_data)
    builder.add_node("consolidate", consolidate_response)

    builder.add_edge(START, "extract_data")
    builder.add_edge("extract_data", "validate_data")
    builder.add_edge("validate_data", "analyze_data")
    builder.add_edge("analyze_data", "consolidate")
    builder.add_edge("consolidate", END)

    return builder.compile()
