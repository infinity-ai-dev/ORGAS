"""
agents/templates/test_template.py -- Template de Testes

INSTRUCOES:
    1. Copie para tests/test_<dominio>.py
    2. Substitua 'example' pelo nome do dominio
    3. Ajuste fixtures e assertions
    4. Rode: pytest tests/test_<dominio>.py -v

Cobertura padrao:
    - Unit tests: validacao, chains individuais
    - Integration tests: pipeline completo
    - Error handling: falhas de LLM, dados invalidos
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def valid_input():
    """Dados de entrada validos para o dominio."""
    return {
        "user_id": "test-user-123",
        "messages": ["Test message"],
        "session_data": {
            # <-- MUDAR: dados da sessao do dominio
        },
    }


@pytest.fixture
def invalid_input():
    """Dados de entrada invalidos."""
    return {
        "user_id": None,
        "messages": [],
        "session_data": {},
    }


@pytest.fixture
def mock_llm():
    """LLM mockado para testes sem API."""
    mock = MagicMock()
    mock.ainvoke = AsyncMock(
        return_value=MagicMock(content="Mocked LLM response")
    )
    return mock


# =============================================================================
# UNIT TESTS: VALIDACAO
# =============================================================================

class TestExampleValidation:
    """Testes de validacao do dominio."""

    # <-- MUDAR: importar chain do dominio
    # from agents.chains.example_chains import example_validation

    @pytest.mark.asyncio
    async def test_valid_input_passes(self, valid_input):
        """Entrada valida deve passar validacao."""
        from agents.chains.validation_chain import create_validation_chain

        chain = create_validation_chain(domain="generic")
        result = await chain.ainvoke(valid_input)

        assert result["is_valid"] is True
        assert len(result["errors"]) == 0

    @pytest.mark.asyncio
    async def test_missing_user_fails(self, invalid_input):
        """Sem user_id deve falhar."""
        from agents.chains.validation_chain import create_validation_chain

        chain = create_validation_chain(domain="generic")
        result = await chain.ainvoke(invalid_input)

        assert result["is_valid"] is False
        assert any("Usuario" in e for e in result["errors"])

    @pytest.mark.asyncio
    async def test_missing_messages_fails(self):
        """Sem mensagens deve falhar."""
        from agents.chains.validation_chain import create_validation_chain

        chain = create_validation_chain(domain="generic")
        result = await chain.ainvoke({
            "user_id": "user-123",
            "messages": [],
        })

        assert result["is_valid"] is False


# =============================================================================
# UNIT TESTS: RAG
# =============================================================================

class TestExampleRAG:
    """Testes de busca de dados."""

    @pytest.mark.asyncio
    async def test_database_source(self):
        """Busca no database deve retornar dados."""
        from agents.chains.rag_chain import create_rag_chain

        # <-- MUDAR: dominio e fontes
        chain = create_rag_chain(domain="generic", sources=["database"])
        result = await chain.ainvoke({
            "user_id": "user-123",
            "query": "test query",
        })

        assert "database" in result["sources_used"]
        assert result["documents_found"] > 0

    @pytest.mark.asyncio
    async def test_multiple_sources(self):
        """Multiplas fontes devem consolidar."""
        from agents.chains.rag_chain import create_rag_chain

        chain = create_rag_chain(domain="generic", sources=["database", "rag"])
        result = await chain.ainvoke({"query": "test"})

        assert len(result["sources_used"]) == 2


# =============================================================================
# UNIT TESTS: CHAINS COM LLM (mockado)
# =============================================================================

class TestExampleAnalysis:
    """Testes de analise com LLM mockado."""

    @pytest.mark.asyncio
    async def test_analysis_with_mock(self, mock_llm):
        """Analise deve funcionar com LLM mockado."""
        # <-- MUDAR: importar chain do dominio
        # from agents.chains.example_chains import example_analysis_chain

        # Exemplo com formatting_chain (que usa LLM)
        from agents.chains.formatting_chain import create_formatting_chain

        with patch(
            "agents.chains.formatting_chain.get_default_model",
            return_value=mock_llm,
        ):
            chain = create_formatting_chain(domain="generic")
            result = await chain.ainvoke({
                "data": {"key": "value"},
            })

        assert len(result["formatted_report"]) > 0

    @pytest.mark.asyncio
    async def test_analysis_error_handling(self):
        """Erro de LLM deve retornar fallback."""
        from agents.chains.formatting_chain import create_formatting_chain

        mock = MagicMock()
        mock.ainvoke = AsyncMock(side_effect=Exception("API Error"))

        with patch(
            "agents.chains.formatting_chain.get_default_model",
            return_value=mock,
        ):
            chain = create_formatting_chain(domain="generic")
            result = await chain.ainvoke({"data": {"test": True}})

        # Deve retornar fallback, nao lancar exception
        assert "formatted_report" in result


# =============================================================================
# INTEGRATION TESTS: PIPELINE COMPLETO
# =============================================================================

class TestExamplePipeline:
    """Testes de integracao do pipeline completo."""

    @pytest.mark.asyncio
    async def test_full_pipeline(self, valid_input, mock_llm):
        """Pipeline validate -> rag -> format deve funcionar."""
        from agents.chains.validation_chain import create_validation_chain
        from agents.chains.rag_chain import create_rag_chain
        from agents.chains.formatting_chain import create_formatting_chain

        # Step 1: Validate
        val_chain = create_validation_chain(domain="generic")
        val_result = await val_chain.ainvoke(valid_input)
        assert val_result["is_valid"] is True

        # Step 2: RAG
        rag_chain = create_rag_chain(domain="generic", sources=["database"])
        rag_result = await rag_chain.ainvoke({
            "query": "test query",
            "user_id": valid_input["user_id"],
        })
        assert "database" in rag_result["sources_used"]

        # Step 3: Format (mockado)
        with patch(
            "agents.chains.formatting_chain.get_default_model",
            return_value=mock_llm,
        ):
            fmt_chain = create_formatting_chain(domain="generic")
            fmt_result = await fmt_chain.ainvoke({
                "data": rag_result["context"],
            })

        assert len(fmt_result["formatted_report"]) > 0

    @pytest.mark.asyncio
    async def test_pipeline_with_invalid_input(self):
        """Pipeline com input invalido deve capturar erros."""
        from agents.chains.validation_chain import create_validation_chain

        chain = create_validation_chain(domain="generic")
        result = await chain.ainvoke({
            "user_id": None,
            "messages": [],
        })

        assert result["is_valid"] is False
        assert len(result["errors"]) > 0
