#!/usr/bin/env python3
"""
Test Integration Script - Verifica todos os componentes do projeto
"""

import sys
import os
from pathlib import Path

# Add project to path
sys.path.insert(0, str(Path(__file__).parent))

def print_header(text):
    """Print formatted header"""
    print(f"\n{'='*60}")
    print(f"✓ {text}")
    print(f"{'='*60}")

def test_imports():
    """Test all critical imports"""
    print_header("1. TESTANDO IMPORTS")

    tests_passed = []
    tests_failed = []

    imports_to_test = [
        ("agents.regent_orchestrator", "Regent Orchestrator"),
        ("agents.fiscal_agent", "Fiscal Agent"),
        ("agents.accounting_agent", "Accounting Agent"),
        ("agents.personal_agent", "Personal Agent"),
        ("agents.support_agent", "Support Agent"),
        ("agents.generic_agent", "Generic Agent"),
        ("agents.modules.document_validator", "Document Validator Module"),
        ("agents.modules.data_retriever", "Data Retriever Module"),
        ("agents.modules.data_anonymizer", "Data Anonymizer Module"),
        ("agents.modules.compliance_checker", "Compliance Checker Module"),
        ("agents.modules.report_formatter", "Report Formatter Module"),
        ("core.config", "Config"),
        ("core.state", "State"),
    ]

    for import_path, name in imports_to_test:
        try:
            __import__(import_path)
            tests_passed.append(name)
            print(f"  ✅ {name}")
        except Exception as e:
            tests_failed.append((name, str(e)))
            print(f"  ❌ {name}: {e}")

    return tests_passed, tests_failed

def test_orchestrator_build():
    """Test orchestrator build"""
    print_header("2. TESTANDO CONSTRUÇÃO DO ORQUESTRADOR")

    try:
        from agents.regent_orchestrator import get_regent_orchestrator, RegentState

        orchestrator = get_regent_orchestrator()
        print(f"  ✅ Orchestrator criado: {type(orchestrator)}")
        print(f"  ✅ RegentState definido: {RegentState}")

        return True, None
    except Exception as e:
        print(f"  ❌ Erro ao criar orchestrator: {e}")
        return False, str(e)

def test_config():
    """Test configuration loading"""
    print_header("3. TESTANDO CONFIGURAÇÃO")

    try:
        from core.config import get_settings

        settings = get_settings()
        print(f"  ✅ Settings carregados")
        print(f"     - Environment: {settings.environment}")
        print(f"     - Debug: {settings.debug}")
        print(f"     - Host: {settings.host}")
        print(f"     - Port: {settings.port}")
        print(f"     - Max iterations: {settings.max_iterations}")
        print(f"     - Gemini model: {settings.gemini_model}")
        print(f"     - LLM Fallback enabled: {settings.llm_fallback_enabled}")

        return True, None
    except Exception as e:
        print(f"  ❌ Erro ao carregar settings: {e}")
        return False, str(e)

def test_state():
    """Test state definitions"""
    print_header("4. TESTANDO DEFINIÇÕES DE ESTADO")

    try:
        from core.state import AgentState, AgentStep

        print(f"  ✅ AgentState definido")
        print(f"  ✅ AgentStep definido")

        # Try to create a sample state
        sample_state: AgentState = {
            "user_input": "Test",
            "current_agent": "fiscal",
            "conversation_history": [],
            "extracted_data": {},
            "validation_status": "pending",
            "compliance_status": "pending",
            "execution_status": "pending",
        }
        print(f"  ✅ Sample state criado com sucesso")

        return True, None
    except Exception as e:
        print(f"  ❌ Erro ao testar state: {e}")
        return False, str(e)

def test_file_structure():
    """Test file structure"""
    print_header("5. TESTANDO ESTRUTURA DE ARQUIVOS")

    base_path = Path(__file__).parent
    files_to_check = [
        "agents/regent_orchestrator.py",
        "agents/__init__.py",
        "agents/fiscal_agent.py",
        "agents/accounting_agent.py",
        "agents/personal_agent.py",
        "agents/support_agent.py",
        "agents/generic_agent.py",
        "agents/modules/document_validator.py",
        "agents/modules/data_retriever.py",
        "agents/modules/data_anonymizer.py",
        "agents/modules/compliance_checker.py",
        "agents/modules/report_formatter.py",
        "core/config.py",
        "core/state.py",
        "core/__init__.py",
        "main.py",
        ".env",
    ]

    files_ok = []
    files_missing = []

    for file_path in files_to_check:
        full_path = base_path / file_path
        if full_path.exists():
            files_ok.append(file_path)
            print(f"  ✅ {file_path}")
        else:
            files_missing.append(file_path)
            print(f"  ❌ FALTA: {file_path}")

    return len(files_ok), len(files_missing)

def test_documentation():
    """Test documentation files"""
    print_header("6. TESTANDO DOCUMENTAÇÃO")

    base_path = Path(__file__).parent.parent
    docs_to_check = [
        "README.md",
        "REGENT_ORCHESTRATOR_GUIDE.md",
        "REGENT_ARCHITECTURE.md",
        "INTEGRATION_STATUS_REPORT.md",
    ]

    docs_found = []
    docs_missing = []

    for doc in docs_to_check:
        full_path = base_path / doc
        if full_path.exists():
            docs_found.append(doc)
            size = full_path.stat().st_size
            print(f"  ✅ {doc} ({size:,} bytes)")
        else:
            docs_missing.append(doc)
            print(f"  ❌ FALTA: {doc}")

    return len(docs_found), len(docs_missing)

def main():
    """Main test runner"""
    print("\n" + "="*60)
    print("🧪 TESTE DE INTEGRAÇÃO - ORGAS AI AGENT")
    print("="*60)

    results = {
        "imports": None,
        "orchestrator": None,
        "config": None,
        "state": None,
        "files": None,
        "docs": None,
    }

    # Test imports
    passed, failed = test_imports()
    results["imports"] = (len(passed), len(failed))

    # Test orchestrator
    success, error = test_orchestrator_build()
    results["orchestrator"] = success

    # Test config
    success, error = test_config()
    results["config"] = success

    # Test state
    success, error = test_state()
    results["state"] = success

    # Test file structure
    ok, missing = test_file_structure()
    results["files"] = (ok, missing)

    # Test documentation
    found, missing = test_documentation()
    results["docs"] = (found, missing)

    # Summary
    print_header("RESUMO DOS TESTES")

    print(f"\n📦 Imports: {results['imports'][0]} ✅ / {results['imports'][1]} ❌")
    print(f"🔧 Orchestrator: {'✅' if results['orchestrator'] else '❌'}")
    print(f"⚙️  Config: {'✅' if results['config'] else '❌'}")
    print(f"📊 State: {'✅' if results['state'] else '❌'}")
    print(f"📁 Arquivos: {results['files'][0]} ✅ / {results['files'][1]} ❌")
    print(f"📚 Documentação: {results['docs'][0]} ✅ / {results['docs'][1]} ❌")

    # Overall status
    all_ok = (
        results["imports"][1] == 0 and
        results["orchestrator"] and
        results["config"] and
        results["state"] and
        results["files"][1] == 0
    )

    print("\n" + "="*60)
    if all_ok:
        print("✅ TODOS OS TESTES PASSARAM!")
        print("🚀 Sistema pronto para uso em produção!")
    else:
        print("❌ ALGUNS TESTES FALHARAM")
        print("⚠️  Por favor, revisar os erros acima")
    print("="*60 + "\n")

    return 0 if all_ok else 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
