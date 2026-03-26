#!/usr/bin/env python3
"""
test_llm_fallback.py — Test the LLM Fallback System

Tests the cascading fallback mechanism:
1. Gemini 2.5 Flash (Primary)
2. OpenAI GPT-4 Turbo (Fallback 1)
3. Grok/xAI (Fallback 2)

Usage:
    python test_llm_fallback.py
"""

import asyncio
import logging
from core.model import (
    get_gemini_model,
    get_openai_model,
    get_grok_model,
    get_model_with_fallback,
    get_available_models,
    get_fallback_chain,
    log_llm_status,
)
from core.config import settings

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def test_available_models():
    """Test which models are available based on API keys."""
    print("\n" + "=" * 60)
    print("🔍 Testing Available Models")
    print("=" * 60)

    available = get_available_models()
    for provider, is_available in available.items():
        status = "✅ AVAILABLE" if is_available else "❌ NOT CONFIGURED"
        print(f"  {provider.upper():10} → {status}")

    print()


def test_fallback_chain():
    """Test the configured fallback order."""
    print("\n" + "=" * 60)
    print("🔄 Testing Fallback Chain")
    print("=" * 60)

    chain = get_fallback_chain()
    print(f"Fallback order: {' → '.join(chain.upper())}")
    print()


def test_individual_models():
    """Test getting individual models."""
    print("\n" + "=" * 60)
    print("🧠 Testing Individual Model Loaders")
    print("=" * 60)

    # Test Gemini
    print("\n1️⃣  Testing Gemini 2.5 Flash...")
    try:
        gemini = get_gemini_model()
        print(f"   ✅ Gemini loaded: {type(gemini).__name__}")
    except Exception as e:
        print(f"   ❌ Gemini error: {e}")

    # Test OpenAI
    print("\n2️⃣  Testing OpenAI GPT-4 Turbo...")
    try:
        openai = get_openai_model()
        print(f"   ✅ OpenAI loaded: {type(openai).__name__}")
    except Exception as e:
        print(f"   ❌ OpenAI error: {e}")

    # Test Grok
    print("\n3️⃣  Testing Grok/xAI...")
    try:
        grok = get_grok_model()
        print(f"   ✅ Grok loaded: {type(grok).__name__}")
    except Exception as e:
        print(f"   ❌ Grok error: {e}")

    print()


def test_fallback_system():
    """Test the cascading fallback system."""
    print("\n" + "=" * 60)
    print("⛓️  Testing Cascading Fallback System")
    print("=" * 60)

    try:
        model = get_model_with_fallback()
        print(f"\n✅ Fallback system returned model: {type(model).__name__}")
        print(f"   Model: {model.model_name if hasattr(model, 'model_name') else 'N/A'}")
    except Exception as e:
        print(f"\n❌ Fallback system error: {e}")

    print()


async def test_llm_invocation():
    """Test invoking the model."""
    print("\n" + "=" * 60)
    print("💬 Testing LLM Invocation")
    print("=" * 60)

    try:
        model = get_model_with_fallback()
        from langchain_core.messages import HumanMessage

        # Simple test message
        response = await model.ainvoke([
            HumanMessage(content="Responda em uma frase: O que é IA?")
        ])

        print(f"\n✅ LLM Response:")
        print(f"   {response.content[:100]}...")
    except Exception as e:
        print(f"\n❌ LLM invocation error: {e}")

    print()


def main():
    """Run all tests."""
    print("\n")
    print("╔" + "=" * 58 + "╗")
    print("║  🚀 LLM Fallback System Test Suite                 ║")
    print("╚" + "=" * 58 + "╝")

    # Test configuration
    print("\n" + "=" * 60)
    print("⚙️  Configuration")
    print("=" * 60)
    print(f"Fallback Enabled: {settings.llm_fallback_enabled}")
    print(f"Fallback Timeout: {settings.llm_fallback_timeout}s")
    print()

    # Run tests
    test_available_models()
    test_fallback_chain()
    test_individual_models()
    test_fallback_system()

    # Test async invocation
    try:
        asyncio.run(test_llm_invocation())
    except Exception as e:
        print(f"❌ Async test error: {e}")

    # Log LLM status
    print("\n" + "=" * 60)
    print("📊 LLM Status Summary")
    print("=" * 60)
    log_llm_status()

    print("\n" + "=" * 60)
    print("✅ Test suite completed!")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
