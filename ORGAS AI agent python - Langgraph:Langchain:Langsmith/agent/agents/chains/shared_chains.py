"""
agents/chains/shared_chains.py -- Chains Compartilhadas entre Dominios

Chains que sao reutilizadas por multiplos agentes sem pertencer a um
dominio especifico.

Chains disponiveis:
- answer_question_chain: Responde perguntas com base em contexto RAG.
  Usado por: generic_agent, support_agent.
- categorize_chain: Categoriza e prioriza conteudo textual.
  Usado por: support_agent (tickets), generic_agent (triagem).
- compliance_check_chain: Verificacao generica de compliance.
  Usado por: todos os agentes que possuem no de compliance.

Uso:
    from agents.chains.shared_chains import (
        create_answer_question_chain,
        create_categorize_chain,
        create_compliance_check_chain,
    )

    # Q&A com contexto
    qa = create_answer_question_chain(persona="assistente de suporte")
    result = await qa.ainvoke({"question": "...", "context": "..."})

    # Categorizar
    cat = create_categorize_chain(categories=["tecnico", "billing", "dados"])
    result = await cat.ainvoke({"text": "...", "context": "..."})

    # Compliance check
    cc = create_compliance_check_chain(standards=["sla", "accuracy"])
    result = await cc.ainvoke({"data_to_check": "...", "standards": [...]})
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import SystemMessage
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda

from agents.chains.llm_fallback_chain import create_llm_with_fallback

logger = logging.getLogger(__name__)


# =============================================================================
# 1. Answer Question Chain (usado por generic_agent e support_agent)
# =============================================================================

def create_answer_question_chain(
    persona: str = "assistente especializado",
    max_context_chars: int = 1000,
) -> RunnableLambda:
    """
    Cria chain de Q&A parametrizavel por persona.

    Args:
        persona: Descricao do papel do assistente (ex: "analista contabil",
                 "assistente de suporte", "consultor fiscal").
        max_context_chars: Limite de caracteres do contexto enviado ao LLM.

    Returns:
        RunnableLambda que aceita {"question": str, "context": str | dict}
        e retorna {"answer": str, "question": str, "status": str}

    Exemplo:
        chain = create_answer_question_chain(persona="assistente de suporte")
        result = await chain.ainvoke({
            "question": "Como redefinir minha senha?",
            "context": "FAQ: Para redefinir, acesse Configuracoes > Seguranca..."
        })
        print(result["answer"])
    """

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            content=(
                f"Voce e um {persona}. "
                "Baseie-se no contexto fornecido para oferecer respostas precisas e uteis. "
                "Se o contexto nao tiver informacao suficiente, indique claramente. "
                "Nunca invente informacoes alem do que o contexto suporta."
            )
        ),
        ("human",
         "Pergunta: {question}\n\n"
         "Contexto:\n{context}\n\n"
         "Responda de forma clara e direta."
         ),
    ])

    async def _answer(input_data: dict) -> dict:
        question = input_data.get("question", "")
        context = input_data.get("context", "")

        if isinstance(context, dict):
            context = str(context)
        context = context[:max_context_chars]

        if not question:
            return {
                "answer": "Nenhuma pergunta fornecida.",
                "question": "",
                "status": "error",
            }

        llm = create_llm_with_fallback()
        chain = prompt | llm | StrOutputParser()

        try:
            answer_text = await chain.ainvoke({
                "question": question,
                "context": context,
            })

            logger.info(f"Answer generated: {len(answer_text)} chars")

            return {
                "answer": answer_text,
                "question": question,
                "status": "complete",
            }

        except Exception as e:
            logger.error(f"Answer question error: {e}")
            return {
                "answer": f"Erro ao gerar resposta: {str(e)}",
                "question": question,
                "status": "error",
                "error": str(e),
            }

    return RunnableLambda(_answer).with_config(
        {"run_name": f"answer_question_chain({persona})"}
    )


# =============================================================================
# 2. Categorize Chain (usado por support_agent e generic_agent)
# =============================================================================

def create_categorize_chain(
    categories: list[str] | None = None,
    include_priority: bool = True,
) -> RunnableLambda:
    """
    Cria chain de categorizacao parametrizavel.

    Args:
        categories: Lista de categorias validas. Se None, usa categorias default.
        include_priority: Se True, inclui nivel de prioridade na saida.

    Returns:
        RunnableLambda que aceita {"text": str, "context": str}
        e retorna {"category": str, "priority": str | None, "reasoning": str, "status": str}
    """

    if categories is None:
        categories = ["tecnico", "billing", "dados", "geral"]

    categories_str = ", ".join(categories)
    priority_instruction = (
        "\n4. Prioridade: critico, alto, medio, baixo"
        if include_priority else ""
    )

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(
            content=(
                "Voce e um classificador de conteudo. "
                f"Categorias validas: {categories_str}.\n"
                "Analise o texto e determine:\n"
                "1. Categoria principal (uma das listadas)\n"
                "2. Confianca da classificacao (0-100%)\n"
                "3. Justificativa breve"
                f"{priority_instruction}\n"
                "Responda em formato estruturado."
            )
        ),
        ("human",
         "Texto para categorizar:\n{text}\n\n"
         "Contexto adicional:\n{context}"
         ),
    ])

    async def _categorize(input_data: dict) -> dict:
        text = input_data.get("text", "")
        context = input_data.get("context", "")

        if not text:
            return {
                "category": "geral",
                "priority": "baixo" if include_priority else None,
                "reasoning": "Texto vazio",
                "status": "error",
            }

        llm = create_llm_with_fallback()
        chain = prompt | llm | StrOutputParser()

        try:
            result_text = await chain.ainvoke({
                "text": text,
                "context": context,
            })

            # Extrair categoria da resposta
            category = "geral"
            for cat in categories:
                if cat.lower() in result_text.lower():
                    category = cat
                    break

            # Extrair prioridade se solicitada
            priority = None
            if include_priority:
                priority = "medio"
                for p in ["critico", "alto", "medio", "baixo"]:
                    if p in result_text.lower():
                        priority = p
                        break

            logger.info(f"Categorized: {category} (priority: {priority})")

            return {
                "category": category,
                "priority": priority,
                "reasoning": result_text,
                "status": "complete",
            }

        except Exception as e:
            logger.error(f"Categorize error: {e}")
            return {
                "category": "geral",
                "priority": "medio" if include_priority else None,
                "reasoning": f"Erro: {str(e)}",
                "status": "error",
                "error": str(e),
            }

    return RunnableLambda(_categorize).with_config(
        {"run_name": f"categorize_chain({categories_str})"}
    )


# =============================================================================
# 3. Compliance Check Chain (reutilizavel por qualquer agente)
# =============================================================================

def create_compliance_check_chain(
    standards: list[str] | None = None,
) -> RunnableLambda:
    """
    Cria chain de verificacao de compliance parametrizavel.

    Args:
        standards: Lista de padroes a verificar. Se None, usa padroes default.

    Returns:
        RunnableLambda que aceita {"data_to_check": str | dict, "standards": list[str] | None}
        e retorna {"compliance_status": str, "compliance_analysis": str, "issues": list, "status": str}
    """

    if standards is None:
        standards = ["accuracy", "completeness"]

    async def _check_compliance(input_data: dict) -> dict:
        data = input_data.get("data_to_check", "")
        check_standards = input_data.get("standards", standards)

        if isinstance(data, dict):
            data = str(data)

        if not data:
            return {
                "compliance_status": "unknown",
                "compliance_analysis": "Sem dados para verificar",
                "issues": [],
                "status": "error",
            }

        standards_str = ", ".join(check_standards)

        prompt = ChatPromptTemplate.from_messages([
            SystemMessage(
                content=(
                    f"Verifique conformidade dos dados com os padroes: {standards_str}.\n"
                    "Para cada padrao, indique:\n"
                    "1. Status (conforme / nao-conforme / parcial)\n"
                    "2. Justificativa\n"
                    "3. Acoes corretivas (se nao-conforme)\n"
                    "Conclua com status geral: conforme, parcial ou nao-conforme."
                )
            ),
            ("human", "Dados para verificacao:\n{data}"),
        ])

        llm = create_llm_with_fallback()
        chain = prompt | llm | StrOutputParser()

        try:
            analysis_text = await chain.ainvoke({"data": data[:2000]})

            # Determinar status geral
            lower = analysis_text.lower()
            if "nao-conforme" in lower or "nao conforme" in lower:
                status = "nao-conforme"
            elif "parcial" in lower:
                status = "parcial"
            else:
                status = "conforme"

            issues = []
            if "nao-conforme" in lower or "nao conforme" in lower:
                issues.append("Itens nao conformes identificados")
            if "pendente" in lower:
                issues.append("Verificacoes pendentes")

            logger.info(f"Compliance check: {status}, {len(issues)} issues")

            return {
                "compliance_status": status,
                "compliance_analysis": analysis_text,
                "issues": issues,
                "status": "complete",
            }

        except Exception as e:
            logger.error(f"Compliance check error: {e}")
            return {
                "compliance_status": "unknown",
                "compliance_analysis": f"Erro: {str(e)}",
                "issues": [],
                "status": "error",
                "error": str(e),
            }

    return RunnableLambda(_check_compliance).with_config(
        {"run_name": f"compliance_check_chain({','.join(standards)})"}
    )
