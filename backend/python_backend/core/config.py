"""
core/config.py — Configurações Globais
"""

import os
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Configurações centralizadas com suporte a .env"""

    # ─── Ambiente ───────────────────────────────────────────────────────────
    environment: str = "development"
    debug: bool = True

    # ─── Servidor ────────────────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000
    ai_agent_token: str = ""
    expose_console: bool = False

    # ─── Database ────────────────────────────────────────────────────────────
    database_url: str = "postgresql://user:password@localhost:5432/orgas"

    # ─── Redis ───────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379"
    redis_db: int = 0
    redis_ttl_seconds: int = 3600  # 1 hora

    # ─── LLM Models (Fallback Chain: Gemini → OpenAI → Grok) ───────────────
    # API Keys
    google_api_key: str = ""
    openai_api_key: str = ""
    grok_api_key: str = ""  # xAI API key para Grok
    anthropic_api_key: str = ""

    # Principal: Google Gemini 2.5 Flash
    gemini_model: str = "gemini-2.5-flash"  # Modelo principal
    gemini_temperature: float = 0.2
    gemini_max_tokens: int = 4096

    # Fallback 1: OpenAI
    openai_model: str = "gpt-4-turbo"
    openai_temperature: float = 0.2
    openai_max_tokens: int = 4096

    # Fallback 2: Grok/xAI (OpenAI-compatible API)
    grok_model: str = "grok-1"
    grok_api_base: str = "https://api.x.ai/openai/v1"
    grok_temperature: float = 0.2
    grok_max_tokens: int = 4096

    # Embedding model
    embedding_model: str = "text-embedding-3-small"

    # LLM Fallback Configuration
    llm_fallback_enabled: bool = True
    llm_fallback_order: list[str] = ["gemini", "openai", "grok"]
    llm_fallback_timeout: int = 30  # Timeout por provider

    # ─── LangGraph ───────────────────────────────────────────────────────────
    checkpoint_dir: str = "./checkpoints"
    max_iterations: int = 10
    timeout_seconds: int = 300

    # ─── Semantic Memory ─────────────────────────────────────────────────────
    semantic_buffer_size: int = 10  # Últimas K mensagens
    semantic_similarity_threshold: float = 0.7
    semantic_max_context_messages: int = 20

    # ─── RAG Pipeline ────────────────────────────────────────────────────────
    rag_chunk_size: int = 1000
    rag_chunk_overlap: int = 200
    rag_retrieval_k: int = 5
    rag_score_threshold: float = 0.6

    # ─── Document Processing ────────────────────────────────────────────────
    max_document_size_mb: int = 50
    supported_mime_types: list[str] = [
        "application/pdf",
        "text/plain",
        "text/csv",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
    ]

    # ─── Logging ─────────────────────────────────────────────────────────────
    log_level: str = "INFO"
    log_format: str = "json"  # json ou text

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Retorna instância única de Settings (singleton com cache)"""
    return Settings()


settings = get_settings()


def get_agent_service_token() -> str:
    return (settings.ai_agent_token or os.getenv("AGENT_API_KEY") or "").strip()
