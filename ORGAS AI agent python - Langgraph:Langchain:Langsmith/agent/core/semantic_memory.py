"""
core/semantic_memory.py — Memória Semântica

Resolve o "Problema Dory": IAs que esquecem contexto importante
porque mantêm apenas as últimas N mensagens (janela fixa).

Usa buffer (Redis) para coerência imediata +
busca semântica vetorial para recuperar informações importantes.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any

import redis
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_google_genai import GoogleGenerativeAIEmbeddings

from core.config import settings

logger = logging.getLogger(__name__)


# ─── Tipos ───────────────────────────────────────────────────────────────────

@dataclass
class MemoryEntry:
    """Uma entrada no histórico semântico."""
    role: str           # human | assistant | system
    content: str
    session_id: str
    message_id: str     # Hash do conteúdo para deduplicação
    turn_index: int     # Posição na conversa (para ordenação)
    embedding: list[float] | None = None
    metadata: dict[str, Any] | None = None

    def to_langchain_message(self) -> BaseMessage:
        if self.role == "human":
            return HumanMessage(content=self.content)
        elif self.role == "assistant":
            return AIMessage(content=self.content)
        else:
            return SystemMessage(content=self.content)


# ─── Embedder ────────────────────────────────────────────────────────────────

class EmbedderService:
    """Serviço de embeddings usando Google Generative AI."""

    def __init__(self):
        try:
            self.embedder = GoogleGenerativeAIEmbeddings(
                model="models/text-embedding-004",
                google_api_key=settings.google_api_key,
            )
            self.available = True
        except Exception as e:
            logger.warning(f"Embedder não disponível: {e}. Usando fallback.")
            self.available = False

    async def embed(self, text: str) -> list[float]:
        """
        Gera embedding para um texto.

        Returns:
            Vetor de embeddings ou fallback sintético.
        """
        if not self.available:
            return self._synthetic_embedding(text)

        try:
            result = await self.embedder.aembed_query(text)
            return result
        except Exception as e:
            logger.warning(f"Erro ao gerar embedding: {e}. Usando fallback.")
            return self._synthetic_embedding(text)

    @staticmethod
    def _synthetic_embedding(text: str) -> list[float]:
        """Embedding sintético para fallback (não usar em produção)."""
        vec = [0.0] * 768
        for i, char in enumerate(text[:768]):
            vec[i] = (ord(char) % 256) / 256.0
        return vec


# ─── Semantic Memory ─────────────────────────────────────────────────────────

class SemanticMemory:
    """
    Memória semântica híbrida com buffer recente + busca vetorial.
    """

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.redis_client = redis.from_url(settings.redis_url, decode_responses=True)
        self.embedder = EmbedderService()
        self.buffer_key = f"session:{session_id}:buffer"
        self.semantic_key = f"session:{session_id}:semantic"
        self.turn_counter_key = f"session:{session_id}:turn_count"

    async def add_message(self, role: str, content: str) -> None:
        """
        Adiciona uma mensagem ao histórico semântico.

        Args:
            role: 'human' | 'assistant' | 'system'
            content: Conteúdo da mensagem
        """
        # Gera ID único
        message_id = hashlib.md5(f"{role}:{content}".encode()).hexdigest()[:8]

        # Incrementa contador de turno
        turn_index = int(self.redis_client.incr(self.turn_counter_key)) - 1

        # Cria entrada
        entry = MemoryEntry(
            role=role,
            content=content,
            session_id=self.session_id,
            message_id=message_id,
            turn_index=turn_index,
        )

        # Gera embedding
        embedding = await self.embedder.embed(content)
        entry.embedding = embedding

        # Salva no buffer (FIFO deslizante)
        buffer_entry = {
            "role": entry.role,
            "content": entry.content,
            "turn": turn_index,
            "embedding": json.dumps(embedding),
        }
        self.redis_client.lpush(self.buffer_key, json.dumps(buffer_entry))
        self.redis_client.ltrim(
            self.buffer_key,
            0,
            settings.semantic_buffer_size - 1,
        )

        # Salva no índice semântico (ZSet com score de recência)
        score = turn_index  # Score = posição temporal
        self.redis_client.zadd(
            self.semantic_key,
            {f"{message_id}:{role}": score},
        )

        logger.debug(f"Mensagem salva: {message_id} ({role}) turno={turn_index}")

    async def get_relevant_context(
        self,
        query: str,
        max_messages: int | None = None,
    ) -> list[BaseMessage]:
        """
        Recupera contexto relevante usando buffer recente + semântica.

        Args:
            query: Pergunta/intenção atual
            max_messages: Limite de mensagens a retornar

        Returns:
            Lista de BaseMessage ordenadas por relevância + recência
        """
        max_msg = max_messages or settings.semantic_max_context_messages

        # 1. Buffer recente (últimas K mensagens)
        buffer_raw = self.redis_client.lrange(self.buffer_key, 0, -1)
        buffer_messages = []

        for item_str in reversed(buffer_raw):  # Inverte para manter ordem
            try:
                item = json.loads(item_str)
                buffer_messages.append(
                    MemoryEntry(
                        role=item["role"],
                        content=item["content"],
                        session_id=self.session_id,
                        message_id="buffer",
                        turn_index=item["turn"],
                    ).to_langchain_message()
                )
            except Exception as e:
                logger.warning(f"Erro ao desserializar buffer: {e}")

        # Se temos poucos históricos, retorna o buffer
        if len(buffer_messages) <= max_msg:
            return buffer_messages

        # 2. Busca semântica para encontrar contexto relevante
        query_embedding = await self.embedder.embed(query)

        # Aqui em produção, você usaria um índice vetorial real
        # (Pinecone, Weaviate, Chroma, etc)
        # Por enquanto, fazemos matching simples

        relevant = self._simple_semantic_search(
            query_embedding,
            max_messages=max_msg - len(buffer_messages),
        )

        # 3. Combina buffer recente + semântico
        all_messages = buffer_messages + relevant
        all_messages = all_messages[:max_msg]

        return all_messages

    def _simple_semantic_search(
        self,
        query_embedding: list[float],
        max_messages: int = 5,
    ) -> list[BaseMessage]:
        """
        Busca semântica simples (substitua por índice vetorial em produção).
        """
        # TODO: Integrar com índice vetorial real (Pinecone, Weaviate, etc)
        return []

    def stats(self) -> str:
        """Retorna estatísticas da memória."""
        buffer_len = self.redis_client.llen(self.buffer_key)
        semantic_len = self.redis_client.zcard(self.semantic_key)
        turn_count = int(self.redis_client.get(self.turn_counter_key) or 0)

        return (
            f"Memória(buffer={buffer_len}, semantic={semantic_len}, "
            f"turnos={turn_count})"
        )

    async def clear(self) -> None:
        """Limpa todo o histórico da sessão."""
        self.redis_client.delete(self.buffer_key)
        self.redis_client.delete(self.semantic_key)
        self.redis_client.delete(self.turn_counter_key)
        logger.info(f"Memória da sessão {self.session_id} limpa")


def get_semantic_memory(session_id: str) -> SemanticMemory:
    """Factory para criar instância de memória semântica."""
    return SemanticMemory(session_id)
