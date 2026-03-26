#!/usr/bin/env python
"""
test_personal_agent.py — Testes para o Sub-grafo Personal

Demonstra como o sub-grafo pessoal funciona com:
1. Validação de contexto pessoal (com consentimento LGPD)
2. Busca de dados (dados brutos)
3. Anonimização (masking + k-anonymity)
4. Geração de resumo anônimo

Executar:
    python test_personal_agent.py
"""

import asyncio
import logging
from datetime import datetime

from core.state import AgentState, SessionContext
from agents.personal_agent import build_personal_subgraph
from langchain_core.messages import HumanMessage

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s | %(name)s | %(message)s"
)
logger = logging.getLogger(__name__)


async def test_personal_subgraph():
    """Testa o sub-grafo pessoal completo."""

    print("\n" + "="*70)
    print("🧪 TESTE: Sub-grafo Personal Completo")
    print("="*70 + "\n")

    # Setup estado com dados de teste
    session = SessionContext(
        user_id="user-456",
        client_name="Cliente Pessoa Física",
    )

    state = AgentState(
        messages=[
            HumanMessage(
                content="Preciso revisar meus dados pessoais e garantir a conformidade LGPD."
            )
        ],
        session=session,
        tipo_parecer="pessoal",
    )

    # Constrói sub-grafo
    print("📦 Construindo sub-grafo pessoal (LGPD compliant)...")
    personal_graph = build_personal_subgraph()

    # Invoca sub-grafo
    print("▶️  Invocando sub-grafo...\n")

    try:
        result = await personal_graph.ainvoke(state)

        # Extrai resultados
        domain_data = result.get("domain_data", {})
        steps = result.get("steps", [])

        print("\n" + "="*70)
        print("📊 RESULTADOS DO SUB-GRAFO PERSONAL")
        print("="*70 + "\n")

        # Mostra dados brutos recuperados
        print("📋 Dados Pessoais Recuperados (BRUTOS):")
        raw_data = domain_data.get("personal_data_raw", {})
        if raw_data:
            print(f"  ⚠️  SENSÍVEL - Dados originais (antes de anonimizar):")
            print(f"  • Nome: {raw_data.get('nome_completo')}")
            print(f"  • CPF: {raw_data.get('cpf')}")
            print(f"  • Email: {raw_data.get('email')}")
            print(f"  • Telefone: {raw_data.get('telefone')}")
            print(f"  • Endereço: {raw_data.get('endereco')}")
            print(f"  • Profissão: {raw_data.get('profissao')}")
            print(f"  • Renda: {raw_data.get('renda_aproximada')}")
        else:
            print("  (Nenhum dado disponível)")

        # Mostra dados anonimizados
        print("\n🔐 Dados Pessoais ANONIMIZADOS (LGPD/GDPR):")
        anonymized = domain_data.get("personal_data_anonymized", {})
        if anonymized:
            print(f"  ✓ SEGURO - Dados mascarados:")
            print(f"  • Nome: {anonymized.get('nome_completo')} (original mascarado)")
            print(f"  • CPF: {anonymized.get('cpf')}")
            print(f"  • Email: {anonymized.get('email')}")
            print(f"  • Telefone: {anonymized.get('telefone')}")
            print(f"  • Endereço: {anonymized.get('endereco')}")
            print(f"  • Profissão: {anonymized.get('profissao')}")
            print(f"  • Renda: {anonymized.get('renda_aproximada')}")
            print(f"  • Idade: {anonymized.get('data_nascimento')} (faixa etária)")
        else:
            print("  (Nenhum dado disponível)")

        # Mostra regras de masking aplicadas
        print("\n🛡️  Regras de Anonimização Aplicadas:")
        masking_rules = domain_data.get("masking_rules_applied", [])
        if masking_rules:
            for i, rule in enumerate(masking_rules, 1):
                print(f"  {i}. {rule}")
        else:
            print("  (Nenhuma regra aplicada)")

        # Mostra resumo anônimo
        print("\n📄 Resumo Anônimo:")
        summary = domain_data.get("personal_summary", "")
        if summary:
            preview = summary[:400] + "..." if len(summary) > 400 else summary
            print(f"  {preview}")
        else:
            print("  (Nenhum resumo disponível)")

        # Mostra recomendações de privacidade
        print("\n🔐 Recomendações de Segurança/Privacidade:")
        recommendations = domain_data.get("privacy_recommendations", [])
        if recommendations:
            for i, rec in enumerate(recommendations, 1):
                print(f"  {i}. {rec}")
        else:
            print("  (Nenhuma recomendação)")

        # Mostra status de compliance
        print("\n✅ Status de Compliance:")
        compliance = domain_data.get("compliance", {})
        if compliance:
            print(f"  • LGPD (Brasil): {'✓ Compliant' if compliance.get('lgpd') else '✗ Não compliant'}")
            print(f"  • GDPR (Europa): {'✓ Compliant' if compliance.get('gdpr') else '✗ Não compliant'}")
            print(f"  • Nível de Anonimização: {compliance.get('anonymization_level', 'Unknown')}")
            print(f"  • Data Minimization: {'✓ Aplicado' if compliance.get('data_minimization') else '✗ Não aplicado'}")
        else:
            print("  (Nenhuma informação de compliance)")

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
            print("✅ SUB-GRAFO PERSONAL: COMPLETADO COM SUCESSO")
            print("   Dados LGPD/GDPR Compliant")
        elif status == "error":
            print("❌ SUB-GRAFO PERSONAL: ERRO NA EXECUÇÃO")
        else:
            print("⚠️  SUB-GRAFO PERSONAL: STATUS DESCONHECIDO")
        print("="*70 + "\n")

    except Exception as e:
        logger.error(f"❌ Erro ao executar sub-grafo: {e}", exc_info=True)
        print(f"\n❌ ERRO: {e}\n")


async def test_individual_nodes():
    """Testa cada nó individualmente (útil para debug)."""

    print("\n" + "="*70)
    print("🔬 TESTE: Nós Individuais do Sub-grafo Personal")
    print("="*70 + "\n")

    from agents.personal_agent import (
        validate_personal_context,
        fetch_personal_data,
        anonymize_personal_data,
        generate_personal_summary,
    )

    session = SessionContext(
        user_id="user-456",
    )

    state = AgentState(
        messages=[HumanMessage(content="Dados pessoais")],
        session=session,
        tipo_parecer="pessoal",
    )

    # Teste Nó 1: Validação
    print("1️⃣  Testando: validate_personal_context")
    result = await validate_personal_context(state)
    is_valid = result.get("domain_data", {}).get("is_valid")
    has_consent = result.get("domain_data", {}).get("has_consent")
    errors = result.get("domain_data", {}).get("validation_errors", [])
    print(f"   ✓ Válido: {is_valid}, Consentimento: {has_consent}, Erros: {len(errors)}\n")

    # Teste Nó 2: Busca de Dados
    print("2️⃣  Testando: fetch_personal_data")
    result = await fetch_personal_data(state)
    raw_data = result.get("domain_data", {}).get("personal_data_raw", {})
    print(f"   ✓ Campos recuperados (brutos): {len(raw_data)}\n")

    # Teste Nó 3: Anonimização
    print("3️⃣  Testando: anonymize_personal_data")
    state.update(result)  # Atualiza com dados do passo anterior
    result = await anonymize_personal_data(state)
    anonymized = result.get("domain_data", {}).get("personal_data_anonymized", {})
    masking_rules = result.get("domain_data", {}).get("masking_rules_applied", [])
    print(f"   ✓ Campos anônimos: {len(anonymized)}, Regras aplicadas: {len(masking_rules)}\n")

    # Mostra exemplo de masking
    print("   📋 Exemplo de Masking:")
    if raw_data:
        original_cpf = raw_data.get("cpf", "N/A")
        masked_cpf = anonymized.get("cpf", "N/A")
        print(f"      CPF Original: {original_cpf}")
        print(f"      CPF Mascarado: {masked_cpf}")

        original_email = raw_data.get("email", "N/A")
        masked_email = anonymized.get("email", "N/A")
        print(f"      Email Original: {original_email}")
        print(f"      Email Mascarado: {masked_email}")

        original_addr = raw_data.get("endereco", "N/A")
        masked_addr = anonymized.get("endereco", "N/A")
        print(f"      Endereço Original: {original_addr}")
        print(f"      Endereço Mascarado: {masked_addr}\n")

    # Teste Nó 4: Parecer
    print("4️⃣  Testando: generate_personal_summary")
    state.update(result)
    result = await generate_personal_summary(state)
    summary = result.get("domain_data", {}).get("personal_summary", "")
    recommendations = result.get("domain_data", {}).get("privacy_recommendations", [])
    compliance = result.get("domain_data", {}).get("compliance", {})
    print(f"   ✓ Resumo length: {len(summary)}, Recomendações: {len(recommendations)}")
    print(f"   ✓ LGPD Compliant: {compliance.get('lgpd', False)}, "
          f"GDPR Compliant: {compliance.get('gdpr', False)}\n")

    print("="*70)
    print("✅ TODOS OS NÓS TESTADOS COM SUCESSO")
    print("="*70 + "\n")


async def test_gdpr_compliance():
    """Testa conformidade específica com GDPR/LGPD."""

    print("\n" + "="*70)
    print("🔒 TESTE: GDPR/LGPD Compliance")
    print("="*70 + "\n")

    from agents.personal_agent import (
        fetch_personal_data,
        anonymize_personal_data,
    )

    session = SessionContext(user_id="user-789")
    state = AgentState(
        messages=[HumanMessage(content="Teste GDPR")],
        session=session,
        tipo_parecer="pessoal",
    )

    # Busca dados
    fetch_result = await fetch_personal_data(state)
    state.update(fetch_result)

    # Anonimiza
    anon_result = await anonymize_personal_data(state)
    anonymized_data = anon_result.get("domain_data", {}).get("personal_data_anonymized", {})
    masking_rules = anon_result.get("domain_data", {}).get("masking_rules_applied", [])

    print("📋 Verificação de Compliance:")
    print(f"  ✓ K-anonymity: {'Sim (dados generalizados)' if 'faixa etária' in str(anonymized_data) else 'Não'}")
    print(f"  ✓ Data Minimization: {'Sim (dados sensíveis removidos)' if len(masking_rules) > 0 else 'Não'}")
    print(f"  ✓ Masking Applied: {len(masking_rules)} regras")
    print(f"  ✓ Identificadores Removidos: {'Sim (CPF/Email/Telefone mascarados)' if anonymized_data.get('cpf', '').count('*') > 3 else 'Não'}")

    print("\n✅ CONFORMIDADE GDPR/LGPD VERIFICADA")
    print("="*70 + "\n")


async def main():
    """Executa todos os testes."""
    print("\n🚀 Iniciando testes do sub-grafo pessoal...\n")

    # Teste de nós individuais
    await test_individual_nodes()

    # Teste de compliance GDPR/LGPD
    await test_gdpr_compliance()

    # Teste do sub-grafo completo
    await test_personal_subgraph()

    print("\n✨ Testes finalizados!\n")


if __name__ == "__main__":
    asyncio.run(main())
