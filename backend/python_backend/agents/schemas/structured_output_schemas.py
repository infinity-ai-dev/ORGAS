"""
STRUCTURED_OUTPUT_SCHEMAS - Schemas JSON para Structured Output do Gemini

Define os schemas que o Gemini usa para garantir saída estruturada correta.
Cada tipo de relatório tem seu próprio schema.

Uso com Gemini API:
    from google.genai import GenerativeModel
    from google.genai.types import Tool, ToolConfig

    model = GenerativeModel(
        "gemini-2.5-pro",
        tools=[...],
        tool_config=ToolConfig(
            function_calling_config=FunctionCallingConfig(
                mode=FunctionCallingConfig.Mode.ANY
            )
        )
    )

    # OU com json_schema (Structured Output)
    response = model.generate_content(
        prompt,
        generation_config=GenerationConfig(
            response_mime_type="application/json",
            response_schema=SCHEMA_FISCAL
        )
    )
"""

from typing import Optional

# ═══════════════════════════════════════════════════════════════════════════
# SCHEMA PARA PARECER FISCAL
# ═══════════════════════════════════════════════════════════════════════════

SCHEMA_FISCAL = {
    "type": "object",
    "properties": {
        "step": {"type": "string", "enum": ["generate_fiscal_opinion"]},
        "agent": {"type": "string", "enum": ["fiscal"]},
        "status": {"type": "string", "enum": ["complete", "error", "partial"]},
        "is_valid": {"type": "boolean"},
        "regime_tributario": {
            "type": "string",
            "description": "Regime tributário (Simples, Lucro Presumido, Lucro Real, etc)"
        },
        "receita_bruta": {
            "type": "object",
            "properties": {
                "valor": {"type": "number"},
                "periodo": {"type": "string"},
                "formatado": {"type": "string"}
            },
            "required": ["valor"]
        },
        "despesas": {
            "type": "object",
            "properties": {
                "total": {"type": "number"},
                "deducoes": {"type": "number"},
                "formatado": {"type": "string"}
            }
        },
        "impostos": {
            "type": "object",
            "properties": {
                "devido": {"type": "number"},
                "pago": {"type": "number"},
                "diferenca": {"type": "number"},
                "aliquota_efetiva": {"type": "number"}
            },
            "required": ["devido", "pago"]
        },
        "obrigacoes_acessorias": {
            "type": "array",
            "items": {"type": "string"},
            "description": "ECF, ECD, LALUR, DIPJ, etc"
        },
        "dados_estabelecimentos": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "descricao": {"type": "string"},
                    "cnpj": {"type": "string"},
                    "receita": {"type": "number"},
                    "aliquota": {"type": "number"},
                    "imposto": {"type": "number"}
                }
            }
        },
        "alertas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tipo": {"type": "string", "enum": ["FOLHA_INCOMPLETA", "INCONSISTENCIA", "ALERTA", "INFO"]},
                    "nivel": {"type": "string", "enum": ["error", "warning", "info"]},
                    "mensagem": {"type": "string"}
                }
            }
        },
        "validacao_erros": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Erros encontrados na validação"
        },
        "risks_identified": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Riscos fiscais identificados"
        },
        "recommendations": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Recomendações estruturadas (SEM narrativas)"
        },
        "data_sources": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Fontes de dados usadas (database, api, rag, etc)"
        }
    },
    "required": ["step", "agent", "status", "is_valid"]
}


# ═══════════════════════════════════════════════════════════════════════════
# SCHEMA PARA PARECER PESSOAL (PRIVACIDADE)
# ═══════════════════════════════════════════════════════════════════════════

SCHEMA_PERSONAL = {
    "type": "object",
    "properties": {
        "step": {"type": "string", "enum": ["generate_personal_summary"]},
        "agent": {"type": "string", "enum": ["personal"]},
        "status": {"type": "string", "enum": ["complete", "error"]},
        "is_valid": {"type": "boolean"},
        "compliance": {
            "type": "object",
            "properties": {
                "gdpr": {"type": "boolean"},
                "lgpd": {"type": "boolean"},
                "data_minimization": {"type": "boolean"},
                "anonymization_level": {"type": "string", "enum": ["Low", "Medium", "High"]}
            },
            "required": ["gdpr", "lgpd", "data_minimization"]
        },
        "personal_data_anonymized": {
            "type": "object",
            "properties": {
                "nome_completo": {"type": "string"},
                "cpf": {"type": "string", "description": "Mascarado: ***.***.***-**"},
                "email": {"type": "string", "description": "Mascarado: u***@e***"},
                "telefone": {"type": "string", "description": "Mascarado: (XX) 9****-****"},
                "endereco": {"type": "string", "description": "Apenas cidade/estado"},
                "data_nascimento": {"type": "string", "description": "Faixa etária para k-anonymity"},
                "estado_civil": {"type": "string"},
                "profissao": {"type": "string"},
                "dependentes": {"type": "integer"},
                "renda_aproximada": {"type": "string"}
            }
        },
        "masking_rules_applied": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Técnicas de mascaramento aplicadas"
        },
        "privacy_recommendations": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Recomendações de privacidade estruturadas"
        },
        "validacao_erros": {
            "type": "array",
            "items": {"type": "string"}
        }
    },
    "required": ["step", "agent", "status", "is_valid", "compliance"]
}


# ═══════════════════════════════════════════════════════════════════════════
# SCHEMA PARA PARECER CONTÁBIL
# ═══════════════════════════════════════════════════════════════════════════

SCHEMA_ACCOUNTING = {
    "type": "object",
    "properties": {
        "step": {"type": "string"},
        "agent": {"type": "string", "enum": ["accounting"]},
        "status": {"type": "string", "enum": ["complete", "error", "partial"]},
        "is_valid": {"type": "boolean"},
        "dados_empresa": {
            "type": "object",
            "properties": {
                "cnpj": {"type": "string"},
                "razao_social": {"type": "string"},
                "periodo": {"type": "string"}
            }
        },
        "balanco": {
            "type": "object",
            "properties": {
                "ativo": {
                    "type": "object",
                    "properties": {
                        "circulante": {"type": "number"},
                        "nao_circulante": {"type": "number"},
                        "total": {"type": "number"}
                    }
                },
                "passivo": {
                    "type": "object",
                    "properties": {
                        "circulante": {"type": "number"},
                        "nao_circulante": {"type": "number"},
                        "total": {"type": "number"}
                    }
                },
                "patrimonio_liquido": {"type": "number"}
            }
        },
        "demonstracao_resultado": {
            "type": "object",
            "properties": {
                "receita_bruta": {"type": "number"},
                "deducoes": {"type": "number"},
                "receita_liquida": {"type": "number"},
                "custos": {"type": "number"},
                "lucro_bruto": {"type": "number"},
                "despesas": {"type": "number"},
                "lucro_operacional": {"type": "number"},
                "resultado_liquido": {"type": "number"}
            }
        },
        "indicadores": {
            "type": "object",
            "properties": {
                "liquidez_corrente": {"type": "number"},
                "endividamento": {"type": "number"},
                "margem_liquida": {"type": "number"},
                "roe": {"type": "number"},
                "roa": {"type": "number"}
            }
        },
        "alertas_contabeis": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tipo": {"type": "string", "enum": ["inconsistencia", "desvio", "anomalia"]},
                    "severidade": {"type": "string", "enum": ["alto", "medio", "baixo"]},
                    "descricao": {"type": "string"},
                    "impacto": {"type": "string"}
                }
            }
        },
        "validacao_erros": {
            "type": "array",
            "items": {"type": "string"}
        }
    },
    "required": ["step", "agent", "status", "is_valid"]
}


# ═══════════════════════════════════════════════════════════════════════════
# SCHEMA PARA PARECER DE SUPORTE
# ═══════════════════════════════════════════════════════════════════════════

SCHEMA_SUPPORT = {
    "type": "object",
    "properties": {
        "step": {"type": "string"},
        "agent": {"type": "string", "enum": ["support"]},
        "status": {"type": "string", "enum": ["complete", "error"]},
        "is_valid": {"type": "boolean"},
        "ticket": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "titulo": {"type": "string"},
                "descricao": {"type": "string"},
                "prioridade": {"type": "string", "enum": ["alta", "media", "baixa"]},
                "categoria": {"type": "string"},
                "status": {"type": "string", "enum": ["aberto", "em_analise", "resolvido"]}
            }
        },
        "problema": {
            "type": "object",
            "properties": {
                "tipo": {"type": "string", "enum": ["bug", "feature_request", "duvida", "reclamacao"]},
                "componente": {"type": "string"},
                "passos_reproducao": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            }
        },
        "solucoes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "numero": {"type": "integer"},
                    "titulo": {"type": "string"},
                    "passos": {
                        "type": "array",
                        "items": {"type": "string"}
                    },
                    "complexidade": {"type": "string", "enum": ["baixa", "media", "alta"]},
                    "tempo_minutos": {"type": "integer"}
                }
            }
        },
        "validacao_erros": {
            "type": "array",
            "items": {"type": "string"}
        }
    },
    "required": ["step", "agent", "status", "is_valid"]
}


# ═══════════════════════════════════════════════════════════════════════════
# MAPEAMENTO DE SCHEMAS
# ═══════════════════════════════════════════════════════════════════════════

SCHEMA_MAP = {
    "fiscal": SCHEMA_FISCAL,
    "personal": SCHEMA_PERSONAL,
    "accounting": SCHEMA_ACCOUNTING,
    "support": SCHEMA_SUPPORT,
}


def get_schema_for_type(report_type: str) -> Optional[dict]:
    """Obtém schema JSON para tipo de relatório."""
    return SCHEMA_MAP.get(report_type)


def get_gemini_config_for_type(report_type: str) -> dict:
    """
    Retorna configuração para GenerationConfig do Gemini com Structured Output.

    Uso:
        from google.genai.types import GenerationConfig
        config = get_gemini_config_for_type("fiscal")
        response = model.generate_content(prompt, generation_config=config)

    Returns:
        dict com response_mime_type e response_schema para usar com Gemini
    """
    schema = get_schema_for_type(report_type)

    if not schema:
        return {
            "response_mime_type": "application/json",
        }

    return {
        "response_mime_type": "application/json",
        "response_schema": schema,
    }
