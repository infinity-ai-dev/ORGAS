"""
runtime/tool_validator.py — Validação de Tools

Garante que todas as tools têm docstrings estruturadas corretas.
Padrão obrigatório:
    1. Primeira linha: O QUÊ a tool faz
    2. "Use quando": casos de uso
    3. "NÃO use para": diferenciação
    4. Args: descrição de parâmetros
    5. Returns: formato de resposta
"""

import inspect
import logging
from typing import Callable, Any
from functools import wraps

from langchain_core.tools import BaseTool

logger = logging.getLogger(__name__)


class ToolValidationError(Exception):
    """Erro na validação de uma tool."""
    pass


def validate_docstring(func: Callable) -> None:
    """
    Valida a docstring de uma função/tool.

    Args:
        func: Função a validar

    Raises:
        ToolValidationError: Se docstring não segue padrão
    """
    if not func.__doc__:
        raise ToolValidationError(f"{func.__name__}: Docstring vazia ou ausente")

    doc = func.__doc__.strip()
    lines = doc.split('\n')

    # 1. Primeira linha: descrição do QUÊ
    if not lines[0].strip():
        raise ToolValidationError(
            f"{func.__name__}: Primeira linha vazia (descrição obrigatória)"
        )

    # 2. Busca "Use quando" ou "When to use"
    has_use_when = any(
        'use quando' in line.lower() or 'when to use' in line.lower()
        for line in lines
    )
    if not has_use_when:
        logger.warning(
            f"{func.__name__}: Falta seção 'Use quando' na docstring"
        )

    # 3. Busca "NÃO use para" ou "Don't use for"
    has_dont_use = any(
        'não use' in line.lower() or "don't use" in line.lower()
        for line in lines
    )
    if not has_dont_use:
        logger.warning(
            f"{func.__name__}: Falta seção 'NÃO use para' na docstring"
        )

    # 4. Busca "Args:"
    has_args = any('args:' in line.lower() for line in lines)
    if not has_args:
        logger.warning(
            f"{func.__name__}: Falta seção 'Args:' na docstring"
        )

    # 5. Busca "Returns:"
    has_returns = any('returns:' in line.lower() for line in lines)
    if not has_returns:
        logger.warning(
            f"{func.__name__}: Falta seção 'Returns:' na docstring"
        )


def validated_tool(func: Callable) -> Callable:
    """
    Decorator que valida docstring e retorna a função original.

    Uso:
        @validated_tool
        async def my_tool(param: str) -> str:
            '''
            Descrição do que faz.

            Use quando:
            - Caso 1
            - Caso 2

            NÃO use para:
            - Caso A

            Args:
                param: descrição

            Returns:
                Resultado
            '''
            pass
    """
    validate_docstring(func)

    @wraps(func)
    async def async_wrapper(*args, **kwargs):
        return await func(*args, **kwargs)

    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        return func(*args, **kwargs)

    # Se a função é async, retorna versão async
    if inspect.iscoroutinefunction(func):
        return async_wrapper
    else:
        return sync_wrapper


def validate_tools(tools: list[BaseTool | Callable]) -> dict[str, Any]:
    """
    Valida um conjunto de tools e retorna relatório de qualidade.

    Args:
        tools: Lista de tools a validar

    Returns:
        Dicionário com relatório de validação
    """
    report = {
        "total": len(tools),
        "valid": 0,
        "warnings": 0,
        "errors": [],
        "details": [],
    }

    for tool in tools:
        name = getattr(tool, "name", str(tool))
        try:
            if isinstance(tool, BaseTool):
                validate_docstring(tool.func)
            else:
                validate_docstring(tool)
            report["valid"] += 1
            report["details"].append({"name": name, "status": "✅ OK"})
        except ToolValidationError as e:
            report["errors"].append(str(e))
            report["details"].append({
                "name": name,
                "status": "❌ ERRO",
                "error": str(e),
            })

    return report


def print_validation_report(report: dict[str, Any]) -> None:
    """Imprime relatório de validação de tools."""
    print(f"\n{'='*60}")
    print(f"  Tool Validation Report")
    print(f"{'='*60}")
    print(f"  Total: {report['total']}")
    print(f"  Valid: {report['valid']}")
    print(f"  Warnings: {report['warnings']}")

    if report["errors"]:
        print(f"\n  ❌ Errors:")
        for error in report["errors"]:
            print(f"    - {error}")

    print(f"\n  Details:")
    for detail in report["details"]:
        print(f"    {detail['name']}: {detail['status']}")
        if "error" in detail:
            print(f"      {detail['error']}")

    print(f"{'='*60}\n")
