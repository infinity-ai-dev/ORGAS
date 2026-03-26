"""
tests/test_chains.py -- Unit Tests para Chains Reutilizaveis

Testa cada chain isoladamente e em composicao.
Usa mocks para LLM para testes sem API key.
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agents.chains.validation_chain import (
    ValidationInput,
    ValidationOutput,
    _validate,
    create_validation_chain,
)
from agents.chains.rag_chain import (
    RAGInput,
    RAGOutput,
    create_rag_chain,
)
from agents.chains.formatting_chain import (
    FormattingInput,
    FormattingOutput,
    create_formatting_chain,
)
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda


def _make_fake_llm(content: str) -> RunnableLambda:
    """Create a fake LLM Runnable that returns a fixed AIMessage.
    Works properly with prompt | llm | StrOutputParser() chains."""
    return RunnableLambda(lambda _: AIMessage(content=content))


# ============================================================================
# Validation Chain Tests
# ============================================================================

class TestValidationChain:
    """Tests para validation_chain."""

    def test_valid_input_fiscal(self):
        """Validacao com todos os campos preenchidos deve passar."""
        input_data = ValidationInput(
            user_id="user-123",
            messages=["msg1"],
            session_data={"regime_tributario": "lucro_real"},
            domain="fiscal",
        )
        result = _validate(input_data)

        assert result.is_valid is True
        assert len(result.errors) == 0
        assert result.domain == "fiscal"

    def test_missing_user_id(self):
        """Sem user_id deve falhar."""
        input_data = ValidationInput(
            user_id=None,
            messages=["msg1"],
            domain="generic",
        )
        result = _validate(input_data)

        assert result.is_valid is False
        assert any("Usuario" in e for e in result.errors)

    def test_missing_messages(self):
        """Sem mensagens deve falhar."""
        input_data = ValidationInput(
            user_id="user-123",
            messages=[],
            domain="generic",
        )
        result = _validate(input_data)

        assert result.is_valid is False
        assert any("mensagem" in e for e in result.errors)

    def test_fiscal_missing_regime(self):
        """Fiscal sem regime tributario deve falhar."""
        input_data = ValidationInput(
            user_id="user-123",
            messages=["msg1"],
            session_data={},
            domain="fiscal",
        )
        result = _validate(input_data)

        assert result.is_valid is False
        assert any("regime_tributario" in e for e in result.errors)

    def test_fiscal_with_regime(self):
        """Fiscal com regime tributario deve passar."""
        input_data = ValidationInput(
            user_id="user-123",
            messages=["msg1"],
            session_data={"regime_tributario": "simples"},
            domain="fiscal",
        )
        result = _validate(input_data)

        assert result.is_valid is True

    def test_custom_required_fields(self):
        """Campos obrigatorios customizados."""
        input_data = ValidationInput(
            user_id="user-123",
            messages=["msg1"],
            session_data={},
            domain="generic",
            required_fields=["custom_field"],
        )
        result = _validate(input_data)

        assert result.is_valid is False
        assert any("custom_field" in e for e in result.errors)

    def test_validated_data_returned(self):
        """Dados validados devem ser retornados."""
        input_data = ValidationInput(
            user_id="user-123",
            messages=["msg1", "msg2"],
            session_data={"key": "value"},
            domain="generic",
        )
        result = _validate(input_data)

        assert result.validated_data["user_id"] == "user-123"
        assert result.validated_data["message_count"] == 2

    @pytest.mark.asyncio
    async def test_chain_invoke(self):
        """Chain deve funcionar via ainvoke."""
        chain = create_validation_chain(domain="generic")
        result = await chain.ainvoke({
            "user_id": "user-123",
            "messages": ["msg1"],
        })

        assert result["is_valid"] is True
        assert result["domain"] == "generic"

    @pytest.mark.asyncio
    async def test_chain_with_domain_override(self):
        """Chain deve aplicar dominio configurado."""
        chain = create_validation_chain(domain="fiscal")
        result = await chain.ainvoke({
            "user_id": "user-123",
            "messages": ["msg1"],
            "session_data": {"regime_tributario": "lucro_real"},
        })

        assert result["domain"] == "fiscal"
        assert result["is_valid"] is True

    def test_multiple_errors(self):
        """Multiplos erros devem ser capturados."""
        input_data = ValidationInput(
            user_id=None,
            messages=[],
            domain="fiscal",
        )
        result = _validate(input_data)

        assert result.is_valid is False
        assert len(result.errors) >= 2  # user_id + messages + regime


# ============================================================================
# RAG Chain Tests
# ============================================================================

class TestRAGChain:
    """Tests para rag_chain."""

    @pytest.mark.asyncio
    async def test_database_source(self):
        """Busca com database deve retornar dados."""
        chain = create_rag_chain(domain="fiscal", sources=["database"])
        result = await chain.ainvoke({
            "user_id": "user-123",
            "query": "analise fiscal",
            "session_data": {"regime_tributario": "lucro_real"},
        })

        assert "database" in result["sources_used"]
        assert result["documents_found"] > 0
        assert result["domain"] == "fiscal"

    @pytest.mark.asyncio
    async def test_multiple_sources(self):
        """Busca com multiplas fontes deve consolidar."""
        chain = create_rag_chain(domain="fiscal", sources=["database", "rag"])
        result = await chain.ainvoke({
            "user_id": "user-123",
            "query": "analise fiscal",
        })

        assert "database" in result["sources_used"]
        assert "rag" in result["sources_used"]
        assert len(result["sources_used"]) == 2

    @pytest.mark.asyncio
    async def test_rag_source(self):
        """Busca RAG deve retornar documentos."""
        chain = create_rag_chain(domain="fiscal", sources=["rag"])
        result = await chain.ainvoke({
            "query": "legislacao fiscal",
        })

        assert "rag" in result["sources_used"]
        rag_data = result["context"]["rag"]
        assert "documents" in rag_data
        assert len(rag_data["documents"]) > 0

    @pytest.mark.asyncio
    async def test_api_source(self):
        """Busca API deve retornar dados."""
        chain = create_rag_chain(domain="fiscal", sources=["api"])
        result = await chain.ainvoke({
            "query": "status fiscal",
        })

        assert "api" in result["sources_used"]

    @pytest.mark.asyncio
    async def test_domain_specific_data(self):
        """Dados devem ser especificos por dominio."""
        chain_fiscal = create_rag_chain(domain="fiscal", sources=["database"])
        chain_accounting = create_rag_chain(domain="accounting", sources=["database"])

        result_fiscal = await chain_fiscal.ainvoke({"query": "test"})
        result_accounting = await chain_accounting.ainvoke({"query": "test"})

        fiscal_db = result_fiscal["context"]["database"]
        accounting_db = result_accounting["context"]["database"]

        assert fiscal_db.get("domain") == "fiscal"
        assert accounting_db.get("domain") == "accounting"

    @pytest.mark.asyncio
    async def test_all_sources(self):
        """Todas as fontes em uma unica busca."""
        chain = create_rag_chain(
            domain="accounting",
            sources=["database", "api", "rag"],
        )
        result = await chain.ainvoke({"query": "balanco"})

        assert len(result["sources_used"]) == 3
        assert "database" in result["context"]
        assert "api" in result["context"]
        assert "rag" in result["context"]


# ============================================================================
# Formatting Chain Tests
# ============================================================================

class TestFormattingChain:
    """Tests para formatting_chain."""

    @pytest.mark.asyncio
    async def test_formatting_with_mock_llm(self):
        """Formatacao deve funcionar com LLM mockado."""
        mock_model = MagicMock()
        mock_model.ainvoke = AsyncMock(
            return_value=MagicMock(content="# Relatorio Fiscal\n\nResumo...")
        )

        with patch("agents.chains.formatting_chain.get_default_model", return_value=mock_model):
            chain = create_formatting_chain(domain="fiscal")
            result = await chain.ainvoke({
                "data": {"analysis": "dados de teste", "risks": ["risco1"]},
                "include_summary": True,
            })

        assert result["domain"] == "fiscal"
        assert result["output_format"] == "markdown"
        assert len(result["formatted_report"]) > 0

    @pytest.mark.asyncio
    async def test_formatting_error_fallback(self):
        """Em caso de erro LLM, deve retornar fallback."""
        mock_model = MagicMock()
        mock_model.ainvoke = AsyncMock(side_effect=Exception("API Error"))

        with patch("agents.chains.formatting_chain.get_default_model", return_value=mock_model):
            chain = create_formatting_chain(domain="fiscal")
            result = await chain.ainvoke({
                "data": {"key": "value"},
            })

        assert result["domain"] == "fiscal"
        # Fallback deve conter os dados brutos
        assert "key" in result["formatted_report"]

    @pytest.mark.asyncio
    async def test_formatting_domain_config(self):
        """Dominio deve ser propagado corretamente."""
        mock_model = MagicMock()
        mock_model.ainvoke = AsyncMock(
            return_value=MagicMock(content="Report content")
        )

        with patch("agents.chains.formatting_chain.get_default_model", return_value=mock_model):
            chain = create_formatting_chain(domain="personal")
            result = await chain.ainvoke({
                "data": {"profile": "anonymized"},
            })

        assert result["domain"] == "personal"


# ============================================================================
# LLM Fallback Chain Tests
# ============================================================================

class TestLLMFallbackChain:
    """Tests para llm_fallback_chain."""

    def test_single_model_available(self):
        """Com um unico modelo disponivel, deve retornar direto."""
        with patch("agents.chains.llm_fallback_chain.settings") as mock_settings:
            mock_settings.llm_fallback_enabled = True
            mock_settings.llm_fallback_order = ["gemini"]

            mock_model = MagicMock()
            with patch(
                "agents.chains.llm_fallback_chain._try_get_model",
                return_value=mock_model,
            ):
                from agents.chains.llm_fallback_chain import get_fallback_llm
                result = get_fallback_llm()
                assert result is mock_model

    def test_multiple_models_available(self):
        """Com multiplos modelos, deve retornar RunnableWithFallbacks."""
        with patch("agents.chains.llm_fallback_chain.settings") as mock_settings:
            mock_settings.llm_fallback_enabled = True
            mock_settings.llm_fallback_order = ["gemini", "openai"]

            mock_model1 = MagicMock()
            mock_model1.with_fallbacks = MagicMock(return_value="fallback_chain")
            mock_model2 = MagicMock()

            def _side_effect(provider, **kwargs):
                return {"gemini": mock_model1, "openai": mock_model2}.get(provider)

            with patch(
                "agents.chains.llm_fallback_chain._try_get_model",
                side_effect=_side_effect,
            ):
                from agents.chains.llm_fallback_chain import get_fallback_llm
                result = get_fallback_llm()
                mock_model1.with_fallbacks.assert_called_once_with([mock_model2])

    def test_no_models_available(self):
        """Sem modelos disponiveis, deve lancar erro."""
        with patch("agents.chains.llm_fallback_chain.settings") as mock_settings:
            mock_settings.llm_fallback_enabled = True
            mock_settings.llm_fallback_order = ["gemini", "openai"]

            with patch(
                "agents.chains.llm_fallback_chain._try_get_model",
                return_value=None,
            ):
                from agents.chains.llm_fallback_chain import get_fallback_llm
                with pytest.raises(Exception, match="Nenhum LLM"):
                    get_fallback_llm()


# ============================================================================
# Integration / Composition Tests
# ============================================================================

class TestChainComposition:
    """Tests de composicao de chains."""

    @pytest.mark.asyncio
    async def test_validation_then_rag(self):
        """Validacao seguida de RAG deve funcionar em sequencia."""
        val_chain = create_validation_chain(domain="fiscal")
        rag_chain = create_rag_chain(domain="fiscal", sources=["database"])

        val_result = await val_chain.ainvoke({
            "user_id": "user-123",
            "messages": ["msg"],
            "session_data": {"regime_tributario": "simples"},
        })
        assert val_result["is_valid"] is True

        rag_result = await rag_chain.ainvoke({
            "user_id": "user-123",
            "query": "analise fiscal",
            "session_data": {"regime_tributario": "simples"},
        })
        assert "database" in rag_result["sources_used"]

    @pytest.mark.asyncio
    async def test_full_pipeline_mock(self):
        """Pipeline completo (validate -> rag -> format) com mock."""
        val_chain = create_validation_chain(domain="fiscal")
        rag_chain = create_rag_chain(domain="fiscal", sources=["database", "rag"])

        # Step 1: Validate
        val_result = await val_chain.ainvoke({
            "user_id": "user-123",
            "messages": ["Analise meu imposto"],
            "session_data": {"regime_tributario": "lucro_real"},
        })
        assert val_result["is_valid"] is True

        # Step 2: RAG
        rag_result = await rag_chain.ainvoke({
            "user_id": "user-123",
            "query": "Analise meu imposto",
            "session_data": {"regime_tributario": "lucro_real"},
        })
        assert len(rag_result["sources_used"]) == 2

        # Step 3: Format (with mocked LLM)
        mock_model = MagicMock()
        mock_model.ainvoke = AsyncMock(
            return_value=MagicMock(content="# Parecer Fiscal\nAnalise completa.")
        )

        with patch("agents.chains.formatting_chain.get_default_model", return_value=mock_model):
            fmt_chain = create_formatting_chain(domain="fiscal")
            fmt_result = await fmt_chain.ainvoke({
                "data": rag_result["context"],
                "include_summary": True,
                "include_recommendations": True,
            })

        assert fmt_result["domain"] == "fiscal"
        assert len(fmt_result["formatted_report"]) > 0


# ============================================================================
# Accounting Chains Tests
# ============================================================================

class TestAccountingChains:
    """Tests para accounting_chains.py."""

    @pytest.mark.asyncio
    async def test_accounting_validation_valid(self):
        """Validacao contabil com campos corretos deve passar."""
        from agents.chains.accounting_chains import accounting_validation
        result = await accounting_validation.ainvoke({
            "user_id": "user-123",
            "messages": ["msg1"],
            "session_data": {"categoria": "balanco"},
        })
        assert result["is_valid"] is True
        assert result["domain"] == "accounting"

    @pytest.mark.asyncio
    async def test_accounting_validation_missing_fields(self):
        """Validacao contabil sem campos deve falhar."""
        from agents.chains.accounting_chains import accounting_validation
        result = await accounting_validation.ainvoke({
            "user_id": None,
            "messages": [],
        })
        assert result["is_valid"] is False
        assert len(result["errors"]) > 0

    @pytest.mark.asyncio
    async def test_accounting_rag(self):
        """RAG contabil deve retornar dados de 3 fontes."""
        from agents.chains.accounting_chains import accounting_rag
        result = await accounting_rag.ainvoke({
            "user_id": "user-123",
            "query": "balanco contabil",
        })
        assert len(result["sources_used"]) == 3
        assert "database" in result["sources_used"]
        assert "api" in result["sources_used"]
        assert "rag" in result["sources_used"]
        assert result["domain"] == "accounting"

    @pytest.mark.asyncio
    async def test_accounting_analysis_chain(self):
        """Analise contabil deve funcionar com mock LLM."""
        from agents.chains.accounting_chains import accounting_analysis_chain

        fake_llm = _make_fake_llm("Analise IFRS: conformidade parcial. Risco de conciliacao.")

        with patch("agents.chains.accounting_chains.create_llm_with_fallback", return_value=fake_llm):
            result = await accounting_analysis_chain.ainvoke({
                "context": "Dados contabeis de teste"
            })

        assert "accounting_analysis" in result
        assert isinstance(result["risks_identified"], list)
        assert "risks_count" in result

    @pytest.mark.asyncio
    async def test_accounting_opinion_chain(self):
        """Parecer contabil deve funcionar com mock LLM."""
        from agents.chains.accounting_chains import accounting_opinion_chain

        fake_llm = _make_fake_llm("Parecer: empresa em conformidade parcial com IFRS.")

        with patch("agents.chains.accounting_chains.create_llm_with_fallback", return_value=fake_llm):
            result = await accounting_opinion_chain.ainvoke({
                "analysis": "Analise de teste",
                "risks": ["Risco 1"],
            })

        assert "accounting_opinion" in result
        assert result["status"] == "complete"
        assert isinstance(result["recommendations"], list)


# ============================================================================
# Personal Chains Tests
# ============================================================================

class TestPersonalChains:
    """Tests para personal_chains.py (LGPD/GDPR)."""

    @pytest.mark.asyncio
    async def test_personal_validation_valid(self):
        """Validacao pessoal com campos corretos deve passar."""
        from agents.chains.personal_chains import personal_validation
        result = await personal_validation.ainvoke({
            "user_id": "user-123",
            "messages": ["msg1"],
        })
        assert result["is_valid"] is True
        assert result["domain"] == "personal"

    @pytest.mark.asyncio
    async def test_personal_rag(self):
        """RAG pessoal deve buscar apenas database (minimizar exposicao)."""
        from agents.chains.personal_chains import personal_rag
        result = await personal_rag.ainvoke({
            "user_id": "user-123",
            "query": "dados pessoais",
        })
        assert result["sources_used"] == ["database"]
        assert result["domain"] == "personal"

    @pytest.mark.asyncio
    async def test_anonymize_cpf(self):
        """CPF deve ser mascarado."""
        from agents.chains.personal_chains import personal_anonymize_chain
        result = await personal_anonymize_chain.ainvoke({
            "personal_data_raw": {
                "cpf": "123.456.789-00",
                "nome": "Joao Silva",
            }
        })
        assert result["anonymized_data"]["cpf"] == "***.***.***-**"
        assert result["anonymized_data"]["nome"] == "Joao Silva"  # nome nao e mascarado
        assert result["compliance"]["lgpd"] is True

    @pytest.mark.asyncio
    async def test_anonymize_email(self):
        """Email deve ser mascarado."""
        from agents.chains.personal_chains import personal_anonymize_chain
        result = await personal_anonymize_chain.ainvoke({
            "personal_data_raw": {
                "email": "joao.silva@example.com",
            }
        })
        anon_email = result["anonymized_data"]["email"]
        assert "joao.silva" not in anon_email
        assert "***" in anon_email

    @pytest.mark.asyncio
    async def test_anonymize_telefone(self):
        """Telefone deve ser mascarado."""
        from agents.chains.personal_chains import personal_anonymize_chain
        result = await personal_anonymize_chain.ainvoke({
            "personal_data_raw": {
                "telefone": "(11) 98765-4321",
            }
        })
        assert result["anonymized_data"]["telefone"] == "(XX) 9****-****"

    @pytest.mark.asyncio
    async def test_anonymize_removes_historico(self):
        """Historico de acesso deve ser removido (data minimization)."""
        from agents.chains.personal_chains import personal_anonymize_chain
        result = await personal_anonymize_chain.ainvoke({
            "personal_data_raw": {
                "nome": "Joao",
                "historico_acesso": [{"ip": "192.168.1.1"}],
            }
        })
        assert "historico_acesso" not in result["anonymized_data"]
        assert any("removido" in r for r in result["masking_rules_applied"])

    @pytest.mark.asyncio
    async def test_anonymize_generalizes_age(self):
        """Data nascimento deve ser convertida para faixa etaria."""
        from agents.chains.personal_chains import personal_anonymize_chain
        result = await personal_anonymize_chain.ainvoke({
            "personal_data_raw": {
                "data_nascimento": "1985-06-15",
            }
        })
        assert "Idade:" in result["anonymized_data"]["data_nascimento"]
        assert "1985" not in result["anonymized_data"]["data_nascimento"]

    @pytest.mark.asyncio
    async def test_anonymize_full_profile(self):
        """Perfil completo deve ser totalmente anonimizado."""
        from agents.chains.personal_chains import personal_anonymize_chain
        result = await personal_anonymize_chain.ainvoke({
            "personal_data_raw": {
                "nome": "Joao Silva",
                "cpf": "123.456.789-00",
                "email": "joao@test.com",
                "telefone": "(11) 99999-0000",
                "endereco": "Rua A, 123, Sao Paulo, SP",
                "data_nascimento": "1985-01-01",
                "historico_acesso": [{"ip": "10.0.0.1"}],
                "profissao": "Analista",
            }
        })
        anon = result["anonymized_data"]
        assert anon["cpf"] == "***.***.***-**"
        assert "joao" not in anon["email"]
        assert anon["telefone"] == "(XX) 9****-****"
        assert "Rua A" not in anon["endereco"]
        assert "1985" not in anon["data_nascimento"]
        assert "historico_acesso" not in anon
        assert anon["profissao"] == "Analista"  # nao sensivel
        assert result["compliance"]["lgpd"] is True
        assert result["compliance"]["gdpr"] is True
        assert result["fields_anonymized"] > 0

    @pytest.mark.asyncio
    async def test_anonymize_invalid_input(self):
        """Input invalido deve retornar compliance false."""
        from agents.chains.personal_chains import personal_anonymize_chain
        result = await personal_anonymize_chain.ainvoke({
            "personal_data_raw": "not a dict"
        })
        assert result["compliance"]["lgpd"] is False


# ============================================================================
# Shared Chains Tests
# ============================================================================

class TestSharedChains:
    """Tests para shared_chains.py."""

    @pytest.mark.asyncio
    async def test_answer_question_empty(self):
        """Sem pergunta deve retornar erro."""
        from agents.chains.shared_chains import create_answer_question_chain
        chain = create_answer_question_chain()
        result = await chain.ainvoke({"question": "", "context": "some ctx"})
        assert result["status"] == "error"
        assert "Nenhuma pergunta" in result["answer"]

    @pytest.mark.asyncio
    async def test_answer_question_with_mock(self):
        """Q&A deve funcionar com mock LLM."""
        from agents.chains.shared_chains import create_answer_question_chain

        fake_llm = _make_fake_llm("Para redefinir senha, acesse Configuracoes.")

        with patch("agents.chains.shared_chains.create_llm_with_fallback", return_value=fake_llm):
            chain = create_answer_question_chain(persona="suporte tecnico")
            result = await chain.ainvoke({
                "question": "Como redefinir minha senha?",
                "context": "FAQ: redefinir senha em Configuracoes > Seguranca",
            })

        assert result["status"] == "complete"
        assert len(result["answer"]) > 0
        assert result["question"] == "Como redefinir minha senha?"

    @pytest.mark.asyncio
    async def test_categorize_empty(self):
        """Sem texto deve retornar categoria default."""
        from agents.chains.shared_chains import create_categorize_chain
        chain = create_categorize_chain()
        result = await chain.ainvoke({"text": "", "context": ""})
        assert result["category"] == "geral"
        assert result["status"] == "error"

    @pytest.mark.asyncio
    async def test_categorize_with_mock(self):
        """Categorizacao deve funcionar com mock LLM."""
        from agents.chains.shared_chains import create_categorize_chain

        fake_llm = _make_fake_llm("Categoria: tecnico. Prioridade: alto.")

        with patch("agents.chains.shared_chains.create_llm_with_fallback", return_value=fake_llm):
            chain = create_categorize_chain(categories=["tecnico", "billing", "geral"])
            result = await chain.ainvoke({
                "text": "Meu sistema nao esta funcionando",
                "context": "",
            })

        assert result["status"] == "complete"
        assert result["category"] == "tecnico"
        assert result["priority"] == "alto"

    @pytest.mark.asyncio
    async def test_compliance_check_empty(self):
        """Sem dados deve retornar status unknown."""
        from agents.chains.shared_chains import create_compliance_check_chain
        chain = create_compliance_check_chain()
        result = await chain.ainvoke({"data_to_check": ""})
        assert result["compliance_status"] == "unknown"
        assert result["status"] == "error"

    @pytest.mark.asyncio
    async def test_compliance_check_with_mock(self):
        """Compliance check deve funcionar com mock LLM."""
        from agents.chains.shared_chains import create_compliance_check_chain

        fake_llm = _make_fake_llm("Status: parcial. Itens pendentes de revisao.")

        with patch("agents.chains.shared_chains.create_llm_with_fallback", return_value=fake_llm):
            chain = create_compliance_check_chain(standards=["sla", "accuracy"])
            result = await chain.ainvoke({
                "data_to_check": "Resposta do agente de suporte",
                "standards": ["sla", "accuracy"],
            })

        assert result["status"] == "complete"
        assert result["compliance_status"] == "parcial"
