"""
agents/modules/data_anonymizer.py — Módulo Reutilizável de Anonimização

Usado por: personal_agent (obrigatório)
Pode ser usado por: accounting_agent, support_agent (opcional)

Funções:
- Masking de dados sensíveis
- K-anonymity (generalização)
- Data minimization (remoção)
- Aplicar regras de compliance

Suporta composição:
    fetch_data_module → anonymize_data_module → process_module
"""

import logging
import re
from typing import Any

from core.state import AgentState, AgentStep

logger = logging.getLogger(__name__)


async def anonymize_data_module(
    state: AgentState,
    data_to_anonymize: dict[str, Any],
    techniques: list[str] | None = None,
    compliance_level: str = "high",
) -> dict[str, Any]:
    """
    Módulo reutilizável: Anonimização de dados.

    Aplica múltiplas técnicas de privacy conforme necessário.

    Args:
        state: AgentState
        data_to_anonymize: Dados a anonimizar
        techniques: Quais técnicas usar [masking, k_anonymity, minimization]
        compliance_level: Nível de compliance [low, medium, high]

    Returns:
        dict com dados anonimizados
    """
    logger.info(f"🔐 Módulo: Anonimizar dados (compliance={compliance_level})...")

    if techniques is None:
        techniques = ["masking", "k_anonymity", "minimization"]

    anonymized = dict(data_to_anonymize)
    masking_rules_applied: list[str] = []

    # ─── Técnica 1: Masking ────────────────────────────────────────────
    if "masking" in techniques:
        logger.info(f"  🎭 Aplicando masking...")

        def mask_cpf(cpf: str) -> str:
            return "***.***.***-**"

        def mask_email(email: str) -> str:
            if "@" in email:
                local, domain = email.split("@")
                return f"{local[0]}***@{domain[:3]}***.***"
            return "***@***.***"

        def mask_phone(phone: str) -> str:
            return "(XX) 9****-****"

        def mask_address(address: str) -> str:
            if "," in address:
                parts = address.split(",")
                if len(parts) >= 2:
                    city_state = parts[-2:] if len(parts) > 1 else parts[-1]
                    return f"[Endereço mascarado], {', '.join(city_state)}"
            return "[Endereço mascarado]"

        # Aplicar masking baseado em compliance_level
        sensitive_fields = {
            "low": ["cpf", "email"],
            "medium": ["cpf", "email", "phone", "telefone"],
            "high": ["cpf", "email", "phone", "telefone", "endereco", "address"],
        }

        fields_to_mask = sensitive_fields.get(compliance_level, sensitive_fields["high"])

        for field in fields_to_mask:
            if field in anonymized:
                original = anonymized[field]
                if "cpf" in field.lower():
                    anonymized[field] = mask_cpf(str(original))
                    masking_rules_applied.append("CPF mascarado (***.***.***-**)")
                elif "email" in field.lower():
                    anonymized[field] = mask_email(str(original))
                    masking_rules_applied.append("Email mascarado (u***@e***)")
                elif "phone" in field.lower() or "telefone" in field.lower():
                    anonymized[field] = mask_phone(str(original))
                    masking_rules_applied.append("Telefone mascarado ((XX) 9****-****)")
                elif "address" in field.lower() or "endereco" in field.lower():
                    anonymized[field] = mask_address(str(original))
                    masking_rules_applied.append("Endereço mascarado (mantém apenas cidade/estado)")

    # ─── Técnica 2: K-anonymity ────────────────────────────────────────
    if "k_anonymity" in techniques:
        logger.info(f"  📊 Aplicando k-anonymity (generalização)...")

        # Generalizar campos identificadores únicos
        if "data_nascimento" in anonymized or "data_birth" in anonymized:
            anonymized["data_nascimento"] = "Idade: 35-45 anos"
            masking_rules_applied.append("Data nascimento → Faixa etária (k-anonymity)")

        if "endereco" in anonymized or "address" in anonymized:
            # Já foi generalizado em masking, aqui apenas registrar
            if "Endereço mascarado" in str(anonymized.get("endereco", "")):
                masking_rules_applied.append("Endereço generalizado → Apenas cidade/estado")

    # ─── Técnica 3: Data Minimization ──────────────────────────────────
    if "minimization" in techniques:
        logger.info(f"  🗑️  Aplicando data minimization...")

        # Remover dados desnecessários para compliance_level
        fields_to_remove = {
            "low": [],
            "medium": ["historico_acesso", "ip_address", "user_agent"],
            "high": ["historico_acesso", "ip_address", "user_agent", "timestamp", "metadata"],
        }

        remove_these = fields_to_remove.get(compliance_level, [])

        for field in remove_these:
            if field in anonymized:
                del anonymized[field]
                masking_rules_applied.append(f"Campo removido (data minimization): {field}")

    step = AgentStep(
        agent_name="module:data_anonymizer",
        action="anonymize_data",
        result={
            "masking_rules_applied": len(masking_rules_applied),
            "compliance_level": compliance_level,
            "techniques_used": techniques,
        },
    )

    logger.info(
        f"✓ Anonimização completa: {len(masking_rules_applied)} regras aplicadas "
        f"({compliance_level} compliance)"
    )

    return {
        "steps": [step],
        "module_result": {
            "module": "data_anonymizer",
            "anonymized_data": anonymized,
            "masking_rules_applied": masking_rules_applied,
            "compliance_level": compliance_level,
        },
    }


async def anonymize_with_differential_privacy(
    state: AgentState,
    data: dict[str, Any],
    epsilon: float = 1.0,
) -> dict[str, Any]:
    """
    Anonimização com Differential Privacy.

    Técnica avançada: adiciona ruído matemático aos dados.

    Args:
        state: AgentState
        data: Dados a anonimizar
        epsilon: Parâmetro de privacidade (menor = mais privado, mais ruído)

    Returns:
        Dados com ruído de privacidade diferencial
    """
    logger.info(f"🔐 Módulo: Differential Privacy (epsilon={epsilon})...")

    # Em produção: usar biblioteca como Opacus, PySyft
    # Aqui: mock de adicionar ruído

    import random

    anonymized = dict(data)
    noises_applied: list[str] = []

    # Adicionar ruído a campos numéricos
    for key, value in anonymized.items():
        if isinstance(value, (int, float)) and value > 0:
            noise = random.gauss(0, epsilon * value * 0.1)  # 10% do valor
            anonymized[key] = round(value + noise, 2)
            noises_applied.append(f"{key}: ±{epsilon*10}%")

    step = AgentStep(
        agent_name="module:data_anonymizer_dp",
        action="anonymize_differential_privacy",
        result={
            "epsilon": epsilon,
            "noises_applied": len(noises_applied),
        },
    )

    logger.info(f"✓ Differential Privacy aplicada: {len(noises_applied)} campos com ruído")

    return {
        "steps": [step],
        "module_result": {
            "module": "data_anonymizer_dp",
            "anonymized_data": anonymized,
            "epsilon": epsilon,
            "noises_applied": noises_applied,
        },
    }
