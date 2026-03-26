"""
agents/chains/llm_fallback_chain.py -- Chain com Fallback em Tempo de Invocacao

Diferente do core/model.py que faz fallback na CRIACAO do modelo,
esta chain faz fallback na INVOCACAO: se uma chamada ao LLM falhar,
automaticamente tenta o proximo provider.

Usa RunnableWithFallbacks do LangChain para fallback nativo.

Uso:
    from agents.chains import create_llm_with_fallback

    # Chain com fallback automatico
    chain = create_llm_with_fallback()
    result = await chain.ainvoke([
        SystemMessage(content="Voce e um analista fiscal."),
        HumanMessage(content="Analise estes dados..."),
    ])

    # Composicao com prompt
    from langchain_core.prompts import ChatPromptTemplate
    prompt = ChatPromptTemplate.from_messages([...])
    full_chain = prompt | create_llm_with_fallback()
    result = await full_chain.ainvoke({"input": "..."})
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.language_models import BaseLanguageModel
from langchain_core.runnables import RunnableWithFallbacks

from core.config import settings

logger = logging.getLogger(__name__)


def _try_get_model(provider: str, **kwargs: Any) -> BaseLanguageModel | None:
    """Tenta criar um modelo para o provider especificado."""
    temperature = kwargs.get("temperature")
    max_tokens = kwargs.get("max_tokens")

    try:
        if provider == "gemini":
            from core.model import get_gemini_model
            return get_gemini_model(temperature, max_tokens)
        elif provider == "openai":
            from core.model import get_openai_model
            return get_openai_model(temperature, max_tokens)
        elif provider == "grok":
            from core.model import get_grok_model
            return get_grok_model(temperature, max_tokens)
    except (ValueError, Exception) as e:
        logger.warning(f"LLM fallback: {provider} unavailable: {e}")
        return None
    return None


def get_fallback_llm(
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> BaseLanguageModel:
    """
    Retorna um LLM com fallback em tempo de invocacao.

    Diferente de get_default_model() que faz fallback na criacao,
    este retorna um RunnableWithFallbacks que tenta cada provider
    quando a CHAMADA falha (timeout, rate limit, erro de API).

    Args:
        temperature: Temperatura para todos os modelos
        max_tokens: Max tokens para todos os modelos

    Returns:
        LLM com fallback automatico (RunnableWithFallbacks ou modelo unico)

    Exemplo:
        llm = get_fallback_llm(temperature=0.2)
        result = await llm.ainvoke([SystemMessage(...), HumanMessage(...)])
    """
    kwargs = {}
    if temperature is not None:
        kwargs["temperature"] = temperature
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens

    fallback_order = settings.llm_fallback_order if settings.llm_fallback_enabled else ["gemini"]

    models: list[BaseLanguageModel] = []
    for provider in fallback_order:
        model = _try_get_model(provider, **kwargs)
        if model is not None:
            models.append(model)
            logger.info(f"LLM fallback chain: {provider} loaded")

    if not models:
        from core.model import LLMFallbackError
        raise LLMFallbackError("Nenhum LLM disponivel para fallback chain")

    if len(models) == 1:
        return models[0]

    primary = models[0]
    fallbacks = models[1:]
    return primary.with_fallbacks(fallbacks)


def create_llm_with_fallback(
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> BaseLanguageModel:
    """
    Factory que cria LLM com fallback em tempo de invocacao.

    Alias para get_fallback_llm(), mantido para consistencia
    com as outras chains (create_validation_chain, etc.).

    Args:
        temperature: Temperatura para todos os modelos
        max_tokens: Max tokens para todos os modelos

    Returns:
        LLM (possivelmente com RunnableWithFallbacks)

    Exemplo:
        from langchain_core.prompts import ChatPromptTemplate

        prompt = ChatPromptTemplate.from_messages([
            ("system", "Voce e um analista fiscal."),
            ("human", "{input}"),
        ])

        chain = prompt | create_llm_with_fallback() | StrOutputParser()
        result = await chain.ainvoke({"input": "Analise meu imposto"})
    """
    return get_fallback_llm(temperature, max_tokens)
