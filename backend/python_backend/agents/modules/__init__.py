"""
agents/modules/ — Módulos Reutilizáveis (Composição Dinâmica)

Módulos de uso geral que qualquer sub-grafo pode importar dinamicamente.

Exemplos de composição:
- fiscal_agent = validate_document + fetch_data + analyze_compliance + format_report
- accounting_agent = validate_document + fetch_data + analyze_accounts + format_report
- personal_agent = validate_consent + fetch_data + anonymize_data + format_report

Cada módulo é um mini sub-grafo que pode:
1. Ser importado por múltiplos sub-grafos
2. Ser encadeado com outros módulos
3. Ser substituído por versões especializadas
"""

from agents.modules.document_validator import validate_document_module
from agents.modules.data_retriever import fetch_data_module
from agents.modules.data_anonymizer import anonymize_data_module
from agents.modules.compliance_checker import check_compliance_module
from agents.modules.report_formatter import format_report_module

__all__ = [
    "validate_document_module",
    "fetch_data_module",
    "anonymize_data_module",
    "check_compliance_module",
    "format_report_module",
]
