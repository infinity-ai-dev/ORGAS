"""
agents/ — Sub-grafos Especializados

Cada sub-grafo é uma especialização LangGraph independente:
- fiscal_agent.py — Análise fiscal
- accounting_agent.py — Análise contábil
- personal_agent.py — Dados pessoais (LGPD/GDPR compliant)
- support_agent.py — Atendimento/tickets
- generic_agent.py — QA geral
"""

from agents.fiscal_agent import get_fiscal_subgraph
from agents.personal_agent import get_personal_subgraph
from agents.accounting_agent import get_accounting_subgraph
from agents.support_agent import get_support_subgraph
from agents.generic_agent import get_generic_subgraph
from agents.regent_orchestrator import (
    get_regent_orchestrator,
    get_regent_orchestrator_v2,
    get_batch_orchestrator,
    get_multi_analysis_orchestrator,
    stream_regent,
    stream_batch,
)

__all__ = [
    "get_fiscal_subgraph",
    "get_personal_subgraph",
    "get_accounting_subgraph",
    "get_support_subgraph",
    "get_generic_subgraph",
    "get_regent_orchestrator",
    "get_regent_orchestrator_v2",
    "get_batch_orchestrator",
    "get_multi_analysis_orchestrator",
    "stream_regent",
    "stream_batch",
]
