#!/usr/bin/env python
"""
test_fiscal_agent.py — Testes para o Sub-grafo Fiscal

Demonstra como o novo sub-grafo fiscal funciona com:
1. Validação de contexto
2. Busca de dados
3. Análise LLM
4. Geração de parecer

Executar:
    python test_fiscal_agent.py
"""

import asyncio
import logging
from datetime import datetime

from core.state import AgentState, SessionContext
from agents.fiscal_agent import build_fiscal_subgraph
from langchain_core.messages import HumanMessage

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s | %(name)s | %(message)s"
)
logger = logging.getLogger(__name__)


async def test_fiscal_subgraph():
    """Testa o sub-grafo fiscal completo."""

    print("\n" + "="*70)
    print("🧪 TESTE: Sub-grafo Fiscal Completo")
    print("="*70 + "\n")

    # Setup estado com dados de teste
    session = SessionContext(
        user_id="user-123",
        regime_tributario="Lucro Presumido",
        client_name="Empresa Teste LTDA",
    )

    state = AgentState(
        messages=[
            HumanMessage(
                content="Preciso de uma análise fiscal completa. "
                        "Qual é meu status de conformidade fiscal para 2024?"
            )
        ],
        session=session,
        tipo_parecer="fiscal",
    )

    # Constrói sub-grafo
    print("📦 Construindo sub-grafo fiscal...")
    fiscal_graph = build_fiscal_subgraph()

    # Invoca sub-grafo
    print("▶️  Invocando sub-grafo...\n")

    try:
        result = await fiscal_graph.ainvoke(state)

        # Extrai resultados
        domain_data = result.get("domain_data", {})
        steps = result.get("steps", [])

        print("\n" + "="*70)
        print("📊 RESULTADOS DO SUB-GRAFO FISCAL")
        print("="*70 + "\n")

        # Mostra dados de domínio
        print("📋 Dados Fiscais Recuperados:")
        fiscal_data = domain_data.get("fiscal_data", {})
        if fiscal_data:
            print(f"  • Regime Tributário: {fiscal_data.get('regime_tributario')}")
            print(f"  • Receita Bruta: R$ {fiscal_data.get('receita_bruta_2024', 0):,.2f}")
            print(f"  • Despesas Dedutivas: R$ {fiscal_data.get('despesas_dedutivas_2024', 0):,.2f}")
            print(f"  • Imposto Devido: R$ {fiscal_data.get('imposto_devido_2024', 0):,.2f}")
            print(f"  • Imposto Pago: R$ {fiscal_data.get('imposto_pago_2024', 0):,.2f}")
            print(f"  • Diferença: R$ {fiscal_data.get('diferenca', 0):,.2f}")
            print(f"  • Obrigações Acessórias: {', '.join(fiscal_data.get('obrigacoes_acessorias', []))}")
        else:
            print("  (Nenhum dado disponível)")

        # Mostra análise de conformidade
        print("\n⚖️  Análise de Conformidade:")
        analysis = domain_data.get("compliance_analysis", "")
        if analysis:
            # Mostra primeiras 500 caracteres
            preview = analysis[:500] + "..." if len(analysis) > 500 else analysis
            print(f"  {preview}")
        else:
            print("  (Nenhuma análise disponível)")

        # Mostra riscos identificados
        print("\n⚠️  Riscos Identificados:")
        risks = domain_data.get("risks_identified", [])
        if risks:
            for i, risk in enumerate(risks, 1):
                print(f"  {i}. {risk}")
        else:
            print("  ✓ Nenhum risco identificado")

        # Mostra parecer fiscal
        print("\n📄 Parecer Fiscal:")
        opinion = domain_data.get("fiscal_opinion", "")
        if opinion:
            preview = opinion[:500] + "..." if len(opinion) > 500 else opinion
            print(f"  {preview}")
        else:
            print("  (Nenhum parecer disponível)")

        # Mostra recomendações
        print("\n💡 Recomendações:")
        recommendations = domain_data.get("recommendations", [])
        if recommendations:
            for i, rec in enumerate(recommendations, 1):
                print(f"  {i}. {rec}")
        else:
            print("  (Nenhuma recomendação)")

        # Mostra passos executados
        print("\n📍 Passos Executados:")
        for i, step in enumerate(steps, 1):
            status = "✅" if not step.error else "❌"
            print(f"  {status} {i}. {step.action}")
            if step.error:
                print(f"     Erro: {step.error}")

        # Status final
        print("\n" + "="*70)
        status = domain_data.get("status", "unknown")
        if status == "complete":
            print("✅ SUB-GRAFO FISCAL: COMPLETADO COM SUCESSO")
        elif status == "error":
            print("❌ SUB-GRAFO FISCAL: ERRO NA EXECUÇÃO")
        else:
            print("⚠️  SUB-GRAFO FISCAL: STATUS DESCONHECIDO")
        print("="*70 + "\n")

    except Exception as e:
        logger.error(f"❌ Erro ao executar sub-grafo: {e}", exc_info=True)
        print(f"\n❌ ERRO: {e}\n")


async def test_individual_nodes():
    """Testa cada nó individualmente (útil para debug)."""

    print("\n" + "="*70)
    print("🔬 TESTE: Nós Individuais do Sub-grafo Fiscal")
    print("="*70 + "\n")

    from agents.fiscal_agent import (
        validate_fiscal_context,
        fetch_fiscal_data,
        analyze_compliance,
        generate_fiscal_opinion,
    )

    session = SessionContext(
        user_id="user-123",
        regime_tributario="Lucro Presumido",
    )

    state = AgentState(
        messages=[HumanMessage(content="Análise fiscal")],
        session=session,
        tipo_parecer="fiscal",
    )

    # Teste Nó 1: Validação
    print("1️⃣  Testando: validate_fiscal_context")
    result = await validate_fiscal_context(state)
    is_valid = result.get("domain_data", {}).get("is_valid")
    errors = result.get("domain_data", {}).get("validation_errors", [])
    print(f"   ✓ Válido: {is_valid}, Erros: {len(errors)}\n")

    # Teste Nó 2: Busca de Dados
    print("2️⃣  Testando: fetch_fiscal_data")
    result = await fetch_fiscal_data(state)
    fiscal_data = result.get("domain_data", {}).get("fiscal_data", {})
    print(f"   ✓ Campos recuperados: {len(fiscal_data)}\n")

    # Teste Nó 3: Análise
    print("3️⃣  Testando: analyze_compliance")
    state.update(result)  # Atualiza com dados do passo anterior
    result = await analyze_compliance(state)
    analysis = result.get("domain_data", {}).get("compliance_analysis", "")
    risks = result.get("domain_data", {}).get("risks_identified", [])
    print(f"   ✓ Análise length: {len(analysis)}, Riscos: {len(risks)}\n")

    # Teste Nó 4: Parecer
    print("4️⃣  Testando: generate_fiscal_opinion")
    state.update(result)
    result = await generate_fiscal_opinion(state)
    opinion = result.get("domain_data", {}).get("fiscal_opinion", "")
    recommendations = result.get("domain_data", {}).get("recommendations", [])
    print(f"   ✓ Parecer length: {len(opinion)}, Recomendações: {len(recommendations)}\n")

    print("="*70)
    print("✅ TODOS OS NÓS TESTADOS COM SUCESSO")
    print("="*70 + "\n")


async def main():
    """Executa todos os testes."""
    print("\n🚀 Iniciando testes do sub-grafo fiscal...\n")

    # Teste de nós individuais
    await test_individual_nodes()

    # Teste do sub-grafo completo
    await test_fiscal_subgraph()

    print("\n✨ Testes finalizados!\n")


if __name__ == "__main__":
    asyncio.run(main())
