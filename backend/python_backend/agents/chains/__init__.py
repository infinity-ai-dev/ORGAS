"""
agents/chains/ -- Chains Reutilizaveis (LCEL - LangChain Expression Language)

Chains sao Runnables composiveis usando o operador | (pipe).
Diferente dos modules/ (funcoes async), chains seguem o protocolo Runnable
e podem ser compostos nativamente com LangChain/LangGraph.

Chains disponiveis:

Genericas (parametrizaveis por dominio):
- validation_chain: Validacao de entrada com schema Pydantic
- rag_chain: Busca RAG com retrieval contextual
- formatting_chain: Formatacao de saida com LLM
- llm_fallback_chain: LLM com fallback em tempo de invocacao

Dominio Fiscal:
- fiscal_chains: Chains pre-configuradas para dominio fiscal

Dominio Contabil:
- accounting_chains: Chains pre-configuradas para dominio contabil

Dominio Pessoal (LGPD/GDPR):
- personal_chains: Chains com anonimizacao obrigatoria

Compartilhadas:
- shared_chains: answer_question, categorize, compliance_check

Exemplo de composicao:
    from agents.chains import create_validation_chain, create_rag_chain

    val = create_validation_chain(domain="fiscal")
    rag = create_rag_chain(domain="fiscal", sources=["database", "rag"])

    val_result = await val.ainvoke({...})
    rag_result = await rag.ainvoke({...})
"""

# --- Generic chains (parametrizaveis) ---
from agents.chains.validation_chain import (
    create_validation_chain,
    ValidationInput,
    ValidationOutput,
)
from agents.chains.rag_chain import (
    create_rag_chain,
    RAGInput,
    RAGOutput,
)
from agents.chains.formatting_chain import (
    create_formatting_chain,
    FormattingInput,
    FormattingOutput,
)
from agents.chains.llm_fallback_chain import (
    create_llm_with_fallback,
    get_fallback_llm,
)

# --- Domain: Fiscal ---
from agents.chains.fiscal_chains import (
    fiscal_validation,
    fiscal_rag,
    fiscal_analysis_chain,
    fiscal_opinion_chain,
)

# --- Domain: Accounting ---
from agents.chains.accounting_chains import (
    accounting_validation,
    accounting_rag,
    accounting_analysis_chain,
    accounting_opinion_chain,
)

# --- Domain: Personal (LGPD/GDPR) ---
from agents.chains.personal_chains import (
    personal_validation,
    personal_rag,
    personal_anonymize_chain,
    personal_summary_chain,
)

# --- Shared chains ---
from agents.chains.shared_chains import (
    create_answer_question_chain,
    create_categorize_chain,
    create_compliance_check_chain,
)

__all__ = [
    # Generic
    "create_validation_chain",
    "ValidationInput",
    "ValidationOutput",
    "create_rag_chain",
    "RAGInput",
    "RAGOutput",
    "create_formatting_chain",
    "FormattingInput",
    "FormattingOutput",
    "create_llm_with_fallback",
    "get_fallback_llm",
    # Fiscal
    "fiscal_validation",
    "fiscal_rag",
    "fiscal_analysis_chain",
    "fiscal_opinion_chain",
    # Accounting
    "accounting_validation",
    "accounting_rag",
    "accounting_analysis_chain",
    "accounting_opinion_chain",
    # Personal
    "personal_validation",
    "personal_rag",
    "personal_anonymize_chain",
    "personal_summary_chain",
    # Shared
    "create_answer_question_chain",
    "create_categorize_chain",
    "create_compliance_check_chain",
]
