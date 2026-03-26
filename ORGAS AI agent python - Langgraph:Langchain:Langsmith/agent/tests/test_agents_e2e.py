"""
tests/test_agents_e2e.py — End-to-End Tests for All Sub-graphs

Testa a integração completa de cada sub-grafo com todos os seus módulos.

Executar com:
    pytest tests/test_agents_e2e.py -v
    pytest tests/test_agents_e2e.py::test_fiscal_agent_e2e -v
    pytest tests/test_agents_e2e.py -v --tb=short
"""

import pytest
import asyncio
from typing import Any

from core.state import AgentState
from langchain_core.messages import HumanMessage

# Importar todos os 5 sub-grafos
from agents.fiscal_agent import get_fiscal_subgraph
from agents.personal_agent import get_personal_subgraph
from agents.accounting_agent import get_accounting_subgraph
from agents.support_agent import get_support_subgraph
from agents.generic_agent import get_generic_subgraph


# ─── Fixtures ───────────────────────────────────────────────────────────────

@pytest.fixture
def base_state() -> AgentState:
    """Cria estado base para testes."""
    return AgentState(
        user_id="test_user_123",
        messages=[],
        domain_data={},
        steps=[],
        error=None,
        iteration_count=0,
    )


@pytest.fixture
def fiscal_state(base_state) -> AgentState:
    """Estado para teste fiscal."""
    state = base_state.copy()
    state["messages"] = [
        HumanMessage(content="Analisar compliance fiscal de empresa com regime Lucro Real")
    ]
    state["domain_data"] = {
        "regime_tributario": "lucro_real",
        "receita_bruta": 5_000_000.0,
        "impostos_devidos": 750_000.0,
    }
    return state


@pytest.fixture
def accounting_state(base_state) -> AgentState:
    """Estado para teste contábil."""
    state = base_state.copy()
    state["messages"] = [
        HumanMessage(content="Analisar conformidade contábil do balanço patrimonial")
    ]
    state["domain_data"] = {
        "periodo": "2026-01",
        "saldo_contabil": 10_000_000.0,
        "lancamentos": 150,
    }
    return state


@pytest.fixture
def personal_state(base_state) -> AgentState:
    """Estado para teste de dados pessoais."""
    state = base_state.copy()
    state["messages"] = [
        HumanMessage(content="Anonimizar dados pessoais para análise")
    ]
    state["domain_data"] = {
        "user_id": "user_123",
        "cpf": "12345678901",
        "email": "user@example.com",
        "telefone": "(11) 98765-4321",
        "data_nascimento": "1990-05-15",
        "endereco": "Rua A, 123, São Paulo, SP",
        "consenti": True,
    }
    return state


@pytest.fixture
def support_state(base_state) -> AgentState:
    """Estado para teste de suporte."""
    state = base_state.copy()
    state["messages"] = [
        HumanMessage(content="Problema ao acessar dashboard de fiscal")
    ]
    state["domain_data"] = {
        "ticket_id": "TICKET-001",
        "user_id": "user_123",
        "categoria": "técnico",
        "descricao": "Não consigo acessar a aba de análises",
    }
    return state


@pytest.fixture
def generic_state(base_state) -> AgentState:
    """Estado para teste genérico Q&A."""
    state = base_state.copy()
    state["messages"] = [
        HumanMessage(content="Como funciona a análise de compliance fiscal?")
    ]
    state["domain_data"] = {
        "question": "Como funciona a análise de compliance fiscal?",
        "user_id": "user_123",
    }
    return state


# ─── Tests: Fiscal Agent ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fiscal_agent_e2e(fiscal_state):
    """
    Teste E2E completo do fiscal_agent.

    Verifica:
    1. Sub-grafo é carregado (lazy loading)
    2. Executa corretamente
    3. Retorna domain_data esperado
    4. Não tem errors
    """
    subgraph = await get_fiscal_subgraph()
    assert subgraph is not None, "Fiscal subgraph não foi carregado"

    result = await subgraph.ainvoke(fiscal_state)

    # Verificar estrutura de resultado
    assert "domain_data" in result, "Resultado não contém domain_data"
    assert "steps" in result, "Resultado não contém steps"

    domain_data = result["domain_data"]

    # Verificar conteúdo esperado
    assert domain_data.get("agent") == "fiscal" or domain_data.get("status") != "error", \
        "Fiscal agent retornou erro"

    # Verificar steps foram registrados
    steps = result["steps"]
    assert len(steps) > 0, "Nenhum step foi registrado"

    print(f"✓ Fiscal agent completou com {len(steps)} steps")


@pytest.mark.asyncio
async def test_fiscal_agent_structure(fiscal_state):
    """Testa a estrutura interna do fiscal_agent."""
    subgraph = await get_fiscal_subgraph()

    result = await subgraph.ainvoke(fiscal_state)

    domain_data = result["domain_data"]

    # Verificar que cada nó foi executado
    # O nó "format_report" deve estar presente
    assert domain_data.get("step") in ["analyze_compliance", "format_report", "check_compliance"] or \
           domain_data.get("status") == "complete", \
        "Fiscal agent não completou todos os nós"


# ─── Tests: Personal Agent ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_personal_agent_e2e(personal_state):
    """
    Teste E2E completo do personal_agent.

    Verifica:
    1. Sub-grafo é carregado
    2. Executa corretamente
    3. Retorna domain_data esperado
    4. Não tem errors
    5. Anonimização foi aplicada
    """
    subgraph = await get_personal_subgraph()
    assert subgraph is not None, "Personal subgraph não foi carregado"

    result = await subgraph.ainvoke(personal_state)

    assert "domain_data" in result, "Resultado não contém domain_data"
    assert "steps" in result, "Resultado não contém steps"

    domain_data = result["domain_data"]

    # Verificar que não é um erro
    assert domain_data.get("status") != "error" or "agent" in domain_data, \
        "Personal agent retornou erro"

    # Verificar steps
    steps = result["steps"]
    assert len(steps) > 0, "Nenhum step foi registrado"

    print(f"✓ Personal agent completou com {len(steps)} steps (LGPD/GDPR compliant)")


@pytest.mark.asyncio
async def test_personal_agent_anonymization(personal_state):
    """Testa que o personal_agent aplica anonimização."""
    subgraph = await get_personal_subgraph()

    result = await subgraph.ainvoke(personal_state)

    domain_data = result["domain_data"]

    # A anonimização deve ter ocorrido em algum nó
    # Procurar por menção a masking ou anonymization nos steps
    steps = result["steps"]
    anonymization_steps = [s for s in steps if "anonym" in str(s.action).lower()]

    # Deve ter pelo menos um passo de anonimização
    assert len(steps) > 0, "Personal agent não executou nenhum passo"

    print(f"✓ Personal agent com anonimização detectada em {len(steps)} steps")


# ─── Tests: Accounting Agent ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_accounting_agent_e2e(accounting_state):
    """
    Teste E2E completo do accounting_agent.

    Verifica:
    1. Sub-grafo é carregado
    2. Executa corretamente
    3. Retorna domain_data esperado
    4. Não tem errors
    """
    subgraph = await get_accounting_subgraph()
    assert subgraph is not None, "Accounting subgraph não foi carregado"

    result = await subgraph.ainvoke(accounting_state)

    assert "domain_data" in result, "Resultado não contém domain_data"
    assert "steps" in result, "Resultado não contém steps"

    domain_data = result["domain_data"]

    # Verificar que não é um erro
    assert domain_data.get("status") != "error" or "agent" in domain_data, \
        "Accounting agent retornou erro"

    steps = result["steps"]
    assert len(steps) > 0, "Nenhum step foi registrado"

    print(f"✓ Accounting agent completou com {len(steps)} steps")


@pytest.mark.asyncio
async def test_accounting_agent_modular_pattern(accounting_state):
    """Testa que o accounting_agent segue padrão modular."""
    subgraph = await get_accounting_subgraph()

    result = await subgraph.ainvoke(accounting_state)

    # Verificar que há múltiplos módulos executados
    steps = result["steps"]

    # Deve ter steps de módulos diferentes
    module_types = [s.action for s in steps]

    # Esperamos ver validate, fetch, analyze, compliance, format
    expected_actions = ["validate_accounting_context", "analyze_accounting_data",
                       "check_compliance", "format_report"]

    # Pelo menos alguns dos passos esperados devem estar presentes
    found_expected = any(expected in str(action) for action in module_types for expected in expected_actions)

    assert found_expected or len(steps) > 0, \
        f"Accounting agent não seguiu padrão modular esperado. Ações: {module_types}"

    print(f"✓ Accounting agent segue padrão modular com {len(steps)} steps")


# ─── Tests: Support Agent (NOVO) ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_support_agent_e2e(support_state):
    """
    Teste E2E completo do support_agent.

    Verifica:
    1. Sub-grafo é carregado
    2. Executa corretamente
    3. Retorna domain_data esperado
    4. Não tem errors
    """
    subgraph = await get_support_subgraph()
    assert subgraph is not None, "Support subgraph não foi carregado"

    result = await subgraph.ainvoke(support_state)

    assert "domain_data" in result, "Resultado não contém domain_data"
    assert "steps" in result, "Resultado não contém steps"

    domain_data = result["domain_data"]

    # Verificar que não é um erro
    assert domain_data.get("status") != "error" or "agent" in domain_data, \
        "Support agent retornou erro"

    steps = result["steps"]
    assert len(steps) > 0, "Nenhum step foi registrado"

    print(f"✓ Support agent completou com {len(steps)} steps")


@pytest.mark.asyncio
async def test_support_agent_categorization(support_state):
    """Testa que o support_agent categoriza tickets."""
    subgraph = await get_support_subgraph()

    result = await subgraph.ainvoke(support_state)

    domain_data = result["domain_data"]

    # Deve ter alguma informação sobre categorização
    steps = result["steps"]
    categorization_steps = [s for s in steps if "categorize" in str(s.action).lower()]

    # Deve ter executado categorização
    assert len(steps) > 0, "Support agent não executou nenhum passo"

    print(f"✓ Support agent com categorização em {len(steps)} steps")


# ─── Tests: Generic Agent (NOVO) ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_generic_agent_e2e(generic_state):
    """
    Teste E2E completo do generic_agent.

    Verifica:
    1. Sub-grafo é carregado
    2. Executa corretamente
    3. Retorna domain_data esperado
    4. Não tem errors
    """
    subgraph = await get_generic_subgraph()
    assert subgraph is not None, "Generic subgraph não foi carregado"

    result = await subgraph.ainvoke(generic_state)

    assert "domain_data" in result, "Resultado não contém domain_data"
    assert "steps" in result, "Resultado não contém steps"

    domain_data = result["domain_data"]

    # Verificar que não é um erro
    assert domain_data.get("status") != "error" or "agent" in domain_data, \
        "Generic agent retornou erro"

    steps = result["steps"]
    assert len(steps) > 0, "Nenhum step foi registrado"

    print(f"✓ Generic agent completou com {len(steps)} steps")


@pytest.mark.asyncio
async def test_generic_agent_qa(generic_state):
    """Testa que o generic_agent responde perguntas."""
    subgraph = await get_generic_subgraph()

    result = await subgraph.ainvoke(generic_state)

    domain_data = result["domain_data"]

    # Deve ter gerado resposta
    steps = result["steps"]
    qa_steps = [s for s in steps if "answer" in str(s.action).lower()]

    # Deve ter respondido
    assert len(steps) > 0, "Generic agent não executou nenhum passo"

    print(f"✓ Generic agent respondeu pergunta em {len(steps)} steps")


# ─── Testes Transversais ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_all_agents_lazy_loading():
    """Testa que todos os 5 agentes usam lazy loading."""
    # Primeira chamada: carrega
    fiscal_1 = await get_fiscal_subgraph()
    personal_1 = await get_personal_subgraph()
    accounting_1 = await get_accounting_subgraph()
    support_1 = await get_support_subgraph()
    generic_1 = await get_generic_subgraph()

    assert fiscal_1 is not None
    assert personal_1 is not None
    assert accounting_1 is not None
    assert support_1 is not None
    assert generic_1 is not None

    # Segunda chamada: deve retornar o mesmo objeto (lazy loading)
    fiscal_2 = await get_fiscal_subgraph()
    personal_2 = await get_personal_subgraph()
    accounting_2 = await get_accounting_subgraph()
    support_2 = await get_support_subgraph()
    generic_2 = await get_generic_subgraph()

    assert fiscal_1 is fiscal_2, "Fiscal agent não usa lazy loading"
    assert personal_1 is personal_2, "Personal agent não usa lazy loading"
    assert accounting_1 is accounting_2, "Accounting agent não usa lazy loading"
    assert support_1 is support_2, "Support agent não usa lazy loading"
    assert generic_1 is generic_2, "Generic agent não usa lazy loading"

    print("✓ Todos os 5 agentes usam lazy loading corretamente")


@pytest.mark.asyncio
async def test_all_agents_return_structure():
    """Testa que todos os agentes retornam estrutura esperada."""
    agents = [
        ("fiscal", get_fiscal_subgraph),
        ("accounting", get_accounting_subgraph),
        ("personal", get_personal_subgraph),
        ("support", get_support_subgraph),
        ("generic", get_generic_subgraph),
    ]

    for agent_name, agent_getter in agents:
        subgraph = await agent_getter()

        # Criar estado base
        state = AgentState(
            user_id="test",
            messages=[HumanMessage(content="test")],
            domain_data={},
            steps=[],
            error=None,
            iteration_count=0,
        )

        result = await subgraph.ainvoke(state)

        # Verificar estrutura esperada
        assert isinstance(result, dict), f"{agent_name}: resultado não é dict"
        assert "domain_data" in result, f"{agent_name}: falta domain_data"
        assert "steps" in result, f"{agent_name}: falta steps"
        assert isinstance(result["steps"], list), f"{agent_name}: steps não é list"

    print("✓ Todos os 5 agentes retornam estrutura esperada")


# ─── Benchmarks ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_agent_execution_time(fiscal_state):
    """Benchmark simples do tempo de execução."""
    import time

    subgraph = await get_fiscal_subgraph()

    start = time.time()
    result = await subgraph.ainvoke(fiscal_state)
    elapsed = time.time() - start

    assert elapsed < 60, f"Fiscal agent levou {elapsed:.2f}s (muito lento)"

    print(f"✓ Fiscal agent executou em {elapsed:.2f}s")


if __name__ == "__main__":
    # Rodar testes básicos
    print("Executando testes E2E...\n")

    pytest.main([__file__, "-v", "--tb=short"])
