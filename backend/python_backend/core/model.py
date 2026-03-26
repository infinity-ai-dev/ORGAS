"""
core/model.py — LLM Management com Fallback em Cascata

Estratégia de fallback (em ordem):
1. Google Gemini 2.5 Flash (Principal) ← PRINCIPAL
2. OpenAI GPT-4 Turbo (Fallback 1)
3. Grok/xAI (Fallback 2)

Se um modelo falhar, automaticamente tenta o próximo.
"""

from functools import lru_cache
from typing import Literal
import logging

from langchain_core.language_models import BaseLanguageModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from core.config import settings

logger = logging.getLogger(__name__)


class LLMFallbackError(Exception):
    """Erro quando todos os LLMs falharem."""
    pass


# ─── Google Gemini (Principal) ──────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_gemini_model(
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> ChatGoogleGenerativeAI:
    """
    Retorna modelo Google Gemini 2.5 Flash.

    Args:
        temperature: Criatividade (0.0-2.0). Default: settings.gemini_temperature
        max_tokens: Máximo de tokens. Default: settings.gemini_max_tokens

    Returns:
        Instância de ChatGoogleGenerativeAI

    Raises:
        ValueError: Se GOOGLE_API_KEY não configurada
    """
    if not settings.google_api_key:
        raise ValueError("GOOGLE_API_KEY não configurada")

    temp = temperature if temperature is not None else settings.gemini_temperature
    max_tok = max_tokens if max_tokens is not None else settings.gemini_max_tokens

    logger.info(f"📱 Carregando Gemini 2.5 Flash (temp={temp}, max_tokens={max_tok})")

    return ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        api_key=settings.google_api_key,
        temperature=temp,
        max_output_tokens=max_tok,
        convert_system_message_to_human=False,
    )


# ─── OpenAI (Fallback 1) ────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_openai_model(
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> ChatOpenAI:
    """
    Retorna modelo OpenAI GPT-4 Turbo (fallback).

    Args:
        temperature: Criatividade. Default: settings.openai_temperature
        max_tokens: Máximo de tokens. Default: settings.openai_max_tokens

    Returns:
        Instância de ChatOpenAI

    Raises:
        ValueError: Se OPENAI_API_KEY não configurada
    """
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY não configurada")

    temp = temperature if temperature is not None else settings.openai_temperature
    max_tok = max_tokens if max_tokens is not None else settings.openai_max_tokens

    logger.warning(f"🔴 Usando OpenAI (fallback) - {settings.openai_model}")

    return ChatOpenAI(
        model=settings.openai_model,
        api_key=settings.openai_api_key,
        temperature=temp,
        max_tokens=max_tok,
    )


# ─── Grok/xAI (Fallback 2) ──────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_grok_model(
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> ChatOpenAI:
    """
    Retorna modelo Grok/xAI (OpenAI-compatible API).

    Grok usa a API OpenAI, mas com endpoint customizado.

    Args:
        temperature: Criatividade. Default: settings.grok_temperature
        max_tokens: Máximo de tokens. Default: settings.grok_max_tokens

    Returns:
        Instância de ChatOpenAI (com endpoint xAI)

    Raises:
        ValueError: Se GROK_API_KEY não configurada
    """
    if not settings.grok_api_key:
        raise ValueError("GROK_API_KEY não configurada")

    temp = temperature if temperature is not None else settings.grok_temperature
    max_tok = max_tokens if max_tokens is not None else settings.grok_max_tokens

    logger.warning(f"⚫ Usando Grok/xAI (fallback 2) - {settings.grok_model}")

    return ChatOpenAI(
        model=settings.grok_model,
        api_key=settings.grok_api_key,
        base_url=settings.grok_api_base,
        temperature=temp,
        max_tokens=max_tok,
    )


# ─── Fallback em Cascata ────────────────────────────────────────────────────

def get_model_with_fallback(
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> BaseLanguageModel:
    """
    Retorna um modelo LLM com fallback automático em cascata.

    Ordem:
    1. Google Gemini 2.5 Flash (Principal)
    2. OpenAI GPT-4 Turbo (Fallback 1)
    3. Grok/xAI (Fallback 2)

    Se um falhar, automaticamente tenta o próximo.

    Args:
        temperature: Criatividade. Aplicado a todos os modelos.
        max_tokens: Máximo de tokens. Aplicado a todos os modelos.

    Returns:
        Primeira instância de LLM que conseguir ser criada

    Raises:
        LLMFallbackError: Se todos os modelos falharem
    """

    if not settings.llm_fallback_enabled:
        logger.info("🔧 Fallback desativado. Usando principal...")
        return get_gemini_model(temperature, max_tokens)

    errors = []
    for provider in settings.llm_fallback_order:
        try:
            if provider == "gemini":
                logger.info("✅ Tentando Gemini 2.5 Flash (principal)...")
                return get_gemini_model(temperature, max_tokens)

            elif provider == "openai":
                logger.warning("⚠️  Gemini falhou. Tentando OpenAI...")
                return get_openai_model(temperature, max_tokens)

            elif provider == "grok":
                logger.warning("⚠️  OpenAI falhou. Tentando Grok/xAI...")
                return get_grok_model(temperature, max_tokens)

        except ValueError as e:
            error_msg = f"{provider}: {str(e)}"
            errors.append(error_msg)
            logger.error(f"❌ {error_msg}")
            continue

        except Exception as e:
            error_msg = f"{provider}: {type(e).__name__}: {str(e)}"
            errors.append(error_msg)
            logger.error(f"❌ {error_msg}")
            continue

    # Se chegou aqui, todos falharam
    error_summary = "\n".join(errors)
    raise LLMFallbackError(
        f"Todos os LLMs falharam:\n{error_summary}"
    )


def get_default_model(
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> BaseLanguageModel:
    """
    Atalho para get_model_with_fallback().

    Retorna o melhor modelo disponível com fallback automático.
    """
    return get_model_with_fallback(temperature, max_tokens)


# ─── Helpers para Debugging ──────────────────────────────────────────────────

def get_available_models() -> dict[str, bool]:
    """
    Verifica quais modelos estão disponíveis (configurados).

    Returns:
        Dict com status de cada modelo
        Exemplo: {"gemini": True, "openai": False, "grok": True}
    """
    return {
        "gemini": bool(settings.google_api_key),
        "openai": bool(settings.openai_api_key),
        "grok": bool(settings.grok_api_key),
    }


def get_fallback_chain() -> list[str]:
    """
    Retorna a cadeia de fallback configurada.

    Returns:
        Lista de provedores em ordem de tentativa
    """
    return settings.llm_fallback_order


def log_llm_status() -> None:
    """
    Log de status dos LLMs disponíveis.

    Útil para debugging e verificação de configuração.
    """
    logger.info("=" * 60)
    logger.info("🧠 LLM Status")
    logger.info("=" * 60)

    available = get_available_models()
    for provider, is_available in available.items():
        status = "✅ Disponível" if is_available else "❌ Não configurado"
        logger.info(f"  {provider.upper():10} → {status}")

    logger.info(f"\n🔄 Ordem de Fallback: {' → '.join(get_fallback_chain())}")
    logger.info("=" * 60)
