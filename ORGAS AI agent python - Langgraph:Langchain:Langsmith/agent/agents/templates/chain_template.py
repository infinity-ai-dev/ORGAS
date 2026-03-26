"""
agents/templates/chain_template.py -- Template de Chain Reutilizavel

INSTRUCOES:
    1. Copie para agents/chains/<nome>_chain.py
    2. Defina Input/Output schemas com Pydantic
    3. Implemente a logica core
    4. Crie a factory function
    5. Exporte em agents/chains/__init__.py
    6. Adicione testes

Padrao:
    - Input/Output schema com Pydantic BaseModel
    - Logica core como funcao async pura
    - Factory retorna RunnableLambda configuravel
    - Error handling com fallback
    - Logging estruturado
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# =============================================================================
# INPUT/OUTPUT SCHEMAS
# Defina os contratos de dados da chain
# =============================================================================

class ExampleInput(BaseModel):
    """Schema de entrada. Documente cada campo."""
    query: str = ""
    domain: str = "generic"
    options: dict[str, Any] = Field(default_factory=dict)


class ExampleOutput(BaseModel):
    """Schema de saida. Documente cada campo."""
    result: str = ""
    domain: str = "generic"
    metadata: dict[str, Any] = Field(default_factory=dict)


# =============================================================================
# LOGICA CORE
# Funcao pura, testavel, sem side-effects
# =============================================================================

async def _process(input_data: dict | ExampleInput) -> dict:
    """
    Logica principal da chain.

    Args:
        input_data: Dict ou ExampleInput

    Returns:
        Dict serializavel (ExampleOutput.model_dump())
    """
    if isinstance(input_data, dict):
        input_data = ExampleInput(**input_data)

    # --- SUA LOGICA AQUI ---

    # Exemplo: processamento simples
    result = f"Processed: {input_data.query} in domain {input_data.domain}"

    # Para chains com LLM:
    # from agents.chains.llm_fallback_chain import create_llm_with_fallback
    # from langchain_core.prompts import ChatPromptTemplate
    # from langchain_core.output_parsers import StrOutputParser
    #
    # prompt = ChatPromptTemplate.from_messages([...])
    # llm = create_llm_with_fallback()
    # chain = prompt | llm | StrOutputParser()
    # try:
    #     result = await chain.ainvoke({})
    # except Exception as e:
    #     logger.error(f"LLM error: {e}")
    #     result = f"Fallback: {str(e)}"

    logger.info(f"ExampleChain [{input_data.domain}]: processed")

    return ExampleOutput(
        result=result,
        domain=input_data.domain,
        metadata={"query_length": len(input_data.query)},
    ).model_dump()


# =============================================================================
# FACTORY FUNCTION
# Cria chain configuravel que retorna RunnableLambda
# =============================================================================

def create_example_chain(
    domain: str = "generic",
    # Adicione parametros de configuracao aqui
) -> RunnableLambda:
    """
    Cria chain configurada para um dominio.

    Args:
        domain: Dominio de processamento

    Returns:
        RunnableLambda composivel com | (pipe)

    Exemplo:
        chain = create_example_chain(domain="fiscal")
        result = await chain.ainvoke({"query": "analise fiscal"})
        print(result["result"])
    """

    async def _run(input_data: dict | ExampleInput) -> dict:
        if isinstance(input_data, dict):
            input_data.setdefault("domain", domain)
        return await _process(input_data)

    return RunnableLambda(_run).with_config(
        {"run_name": f"example_chain[{domain}]"}
    )
