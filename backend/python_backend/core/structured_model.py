"""
STRUCTURED_MODEL - Configura modelos LLM com Structured Output

Para Gemini: Usa response_schema com response_mime_type="application/json"
Para outros: Usa output_parser com Pydantic models

Garante que TODOS os LLM calls retornem JSON válido estruturado,
nunca narrativas ou texto livre.
"""

import logging
from typing import Optional, Type
from pydantic import BaseModel

try:
    from google.genai import GenerativeModel
    from google.genai.types import GenerationConfig
    HAS_GOOGLE_GENAI = True
except ImportError:
    HAS_GOOGLE_GENAI = False

from langchain_core.language_models import BaseLLM
from langchain_core.output_parsers import JsonOutputParser, PydanticOutputParser
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate

from agents.schemas.structured_output_schemas import get_gemini_config_for_type

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS PARA OUTPUT PARSING
# ═══════════════════════════════════════════════════════════════════════════

class FiscalAnalysisOutput(BaseModel):
    """Schema para saída estruturada de análise fiscal"""
    step: str
    agent: str
    status: str
    is_valid: bool
    regime_tributario: Optional[str] = None
    receita_bruta: Optional[dict] = None
    impostos: Optional[dict] = None
    validacao_erros: list[str] = []
    risks_identified: list[str] = []
    recommendations: list[str] = []


class PersonalAnalysisOutput(BaseModel):
    """Schema para saída estruturada de análise pessoal"""
    step: str
    agent: str
    status: str
    is_valid: bool
    compliance: dict
    personal_data_anonymized: dict
    masking_rules_applied: list[str] = []
    privacy_recommendations: list[str] = []
    validacao_erros: list[str] = []


class AccountingAnalysisOutput(BaseModel):
    """Schema para saída estruturada de análise contábil"""
    step: str
    agent: str
    status: str
    is_valid: bool
    dados_empresa: dict
    balanco: dict
    demonstracao_resultado: dict
    indicadores: Optional[dict] = None
    alertas_contabeis: list[dict] = []
    validacao_erros: list[str] = []


class SupportAnalysisOutput(BaseModel):
    """Schema para saída estruturada de análise de suporte"""
    step: str
    agent: str
    status: str
    is_valid: bool
    ticket: dict
    problema: dict
    solucoes: list[dict] = []
    validacao_erros: list[str] = []


PYDANTIC_SCHEMA_MAP = {
    "fiscal": FiscalAnalysisOutput,
    "personal": PersonalAnalysisOutput,
    "accounting": AccountingAnalysisOutput,
    "support": SupportAnalysisOutput,
}


# ═══════════════════════════════════════════════════════════════════════════
# WRAPPER PARA GEMINI COM STRUCTURED OUTPUT
# ═══════════════════════════════════════════════════════════════════════════

class StructuredGeminiModel:
    """
    Wrapper para Google Gemini com Structured Output.

    Garante que respostas sempre sejam JSON válido estruturado.

    Uso:
        model = StructuredGeminiModel(report_type="fiscal")
        response = await model.ainvoke({"content": "..."})
        # response.content é sempre um dict JSON válido
    """

    def __init__(self, report_type: str = "generic", model_name: str = "gemini-2.5-pro"):
        self.report_type = report_type
        self.model_name = model_name
        self.model = None

        if HAS_GOOGLE_GENAI:
            self._init_gemini()
        else:
            logger.warning("google-genai não instalado, usando fallback")

    def _init_gemini(self):
        """Inicializa modelo Gemini com Structured Output."""
        try:
            generation_config_dict = get_gemini_config_for_type(self.report_type)
            generation_config = GenerationConfig(**generation_config_dict)

            self.model = GenerativeModel(
                self.model_name,
                generation_config=generation_config,
            )
            logger.info(
                f"✓ Gemini inicializado com Structured Output para: {self.report_type}"
            )
        except Exception as e:
            logger.error(f"❌ Erro ao inicializar Gemini: {e}")
            self.model = None

    async def ainvoke(self, input_data: dict) -> dict:
        """
        Chama o modelo com structured output.

        Args:
            input_data: dict com chaves para interpolar no prompt

        Returns:
            dict com resposta estruturada (sempre JSON válido)
        """
        if not self.model:
            logger.error("Modelo não inicializado")
            return {
                "step": "error",
                "agent": self.report_type,
                "status": "error",
                "is_valid": False,
                "validacao_erros": ["Modelo não disponível"]
            }

        try:
            # Construir prompt a partir dos inputs
            content = input_data.get("content", "")

            response = self.model.generate_content(content)

            # O Gemini com Structured Output sempre retorna JSON válido
            if hasattr(response, "text"):
                import json
                try:
                    return json.loads(response.text)
                except json.JSONDecodeError:
                    logger.warning("Resposta não é JSON válido, retornando como texto")
                    return {
                        "step": "error",
                        "agent": self.report_type,
                        "status": "error",
                        "is_valid": False,
                        "validacao_erros": ["Resposta inválida do modelo"],
                        "raw_response": response.text
                    }
            else:
                return response

        except Exception as e:
            logger.error(f"❌ Erro ao chamar Gemini: {e}")
            return {
                "step": "error",
                "agent": self.report_type,
                "status": "error",
                "is_valid": False,
                "validacao_erros": [f"Erro: {str(e)}"]
            }


# ═══════════════════════════════════════════════════════════════════════════
# FACTORY FUNCTION
# ═══════════════════════════════════════════════════════════════════════════

def get_structured_model(report_type: str = "generic") -> StructuredGeminiModel:
    """
    Factory que retorna modelo configurado com Structured Output.

    Uso em agentes:
        model = get_structured_model("fiscal")
        response = await model.ainvoke({"content": "dados..."})
        # response é SEMPRE um dict JSON válido, nunca string

    Args:
        report_type: tipo de relatório (fiscal, personal, accounting, support)

    Returns:
        StructuredGeminiModel configurado com schema apropriado
    """
    return StructuredGeminiModel(report_type=report_type)


def get_output_parser_for_type(report_type: str):
    """
    Obtém output parser apropriado para tipo de relatório.

    Usa PydanticOutputParser para validação e conversão.

    Uso:
        parser = get_output_parser_for_type("fiscal")
        chain = prompt | model | parser
        result = chain.invoke({"content": "..."})
        # result é instância de FiscalAnalysisOutput validada
    """
    schema_class = PYDANTIC_SCHEMA_MAP.get(report_type)

    if not schema_class:
        logger.warning(f"Parser não encontrado para: {report_type}")
        return JsonOutputParser()

    return PydanticOutputParser(pydantic_object=schema_class)
