"""
agents/file_upload_graph.py — Grafo Especializado em Upload de Arquivos

Arquitetura em 4 nós com foco em UPLOAD SEGURO:
1. validate_file_input - Validar base64 e metadados do arquivo
2. convert_base64 - Converter base64 → binário
3. upload_to_gemini - Enviar para Files API do Gemini
4. aggregate_results - Agregar URIs de upload para o contexto do agente

Padrão: Processa múltiplos arquivos em paralelo usando Send API.

Retorna:
    dict com uploaded_files contendo URIs para uso em mensagens do agente
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Annotated
import operator
from io import BytesIO

from langchain_core.messages import HumanMessage
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send
import google.generativeai as genai

from core.state import AgentState, AgentStep
from core.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()


# ─── Estado Local do Grafo de Upload ────────────────────────────────────────

class FileUploadState(dict):
    """
    Estado local para o grafo de upload.

    Campos:
        - files: list[dict] - Lista de arquivos a fazer upload (cada um com 'base64', 'filename', 'mime_type')
        - uploaded_files: list[dict] - Resultado de uploads (acumula URIs)
        - current_file: dict - Arquivo sendo processado
        - errors: list[str] - Erros encontrados
        - status: str - Status geral ('pending', 'processing', 'completed', 'failed')
    """
    pass


# ─── Nó 1: Validar Entrada de Arquivo ───────────────────────────────────────

async def validate_file_input(state: AgentState) -> dict[str, Any]:
    """
    Valida se os arquivos base64 e metadados estão corretos.

    Verifica:
    - Base64 está bem formado?
    - Mime type é suportado?
    - Tamanho do arquivo está dentro do limite?
    - Filename é válido?

    Input esperado em state['domain_data']:
        {
            "files": [
                {
                    "base64": "...",
                    "filename": "documento.pdf",
                    "mime_type": "application/pdf"
                },
                ...
            ]
        }

    Returns:
        {
            "valid_files": list[dict],
            "invalid_files": list[dict],
            "validation_errors": list[str],
            "should_continue": bool
        }
    """
    logger.info("Nó 1: Validando entrada de arquivos...")

    validation_errors: list[str] = []
    valid_files: list[dict] = []
    invalid_files: list[dict] = []

    # Extrai arquivos do domain_data
    files_input = state.get("domain_data", {}).get("files", [])

    if not files_input:
        validation_errors.append("Nenhum arquivo fornecido (esperado em domain_data.files)")
        logger.warning("Nenhum arquivo fornecido")
        return {
            "steps": [AgentStep(
                agent_name="file_upload_graph",
                action="validate_file_input",
                result={"error": "No files provided"},
                error=validation_errors[0] if validation_errors else None
            )],
            "domain_data": {
                "upload_status": "failed",
                "validation_errors": validation_errors,
                "uploaded_files": [],
            }
        }

    # Valida cada arquivo
    for idx, file_obj in enumerate(files_input):
        file_errors = []

        # Valida base64
        if not isinstance(file_obj.get("base64"), str):
            file_errors.append("Base64 deve ser string")
        else:
            try:
                # Tenta decodificar para validar formato
                base64.b64decode(file_obj["base64"], validate=True)
            except Exception as e:
                file_errors.append(f"Base64 inválido: {str(e)}")

        # Valida mime_type
        if not file_obj.get("mime_type"):
            file_errors.append("mime_type é obrigatório")
        elif file_obj["mime_type"] not in settings.supported_mime_types:
            file_errors.append(f"Mime type não suportado: {file_obj['mime_type']}")

        # Valida filename
        if not file_obj.get("filename"):
            file_errors.append("filename é obrigatório")

        # Estima tamanho em bytes
        if not file_errors and file_obj.get("base64"):
            # Base64 tem ~33% overhead - tamanho real é ~3/4 do tamanho encoded
            estimated_size_mb = (len(file_obj["base64"]) * 0.75) / (1024 * 1024)
            if estimated_size_mb > settings.max_document_size_mb:
                file_errors.append(
                    f"Arquivo muito grande: {estimated_size_mb:.2f}MB "
                    f"(máximo: {settings.max_document_size_mb}MB)"
                )

        if file_errors:
            invalid_files.append({
                "index": idx,
                "filename": file_obj.get("filename", "unknown"),
                "errors": file_errors
            })
            validation_errors.extend(file_errors)
        else:
            valid_files.append({
                **file_obj,
                "index": idx,
                "status": "pending"
            })

    should_continue = len(valid_files) > 0

    logger.info(
        f"✓ Validação completa: {len(valid_files)} válidos, {len(invalid_files)} inválidos"
    )

    # Registra passo
    step = AgentStep(
        agent_name="file_upload_graph",
        action="validate_file_input",
        result={
            "valid_count": len(valid_files),
            "invalid_count": len(invalid_files),
            "should_continue": should_continue,
        },
        error=None if should_continue else "Nenhum arquivo válido"
    )

    return {
        "steps": [step],
        "domain_data": {
            "upload_status": "processing" if should_continue else "failed",
            "valid_files": valid_files,
            "invalid_files": invalid_files,
            "validation_errors": validation_errors,
            "should_continue": should_continue,
        }
    }


# ─── Nó 2: Converter Base64 → Binário ────────────────────────────────────────

async def convert_base64_to_binary(state: AgentState) -> dict[str, Any]:
    """
    Converte cada arquivo base64 para binário.

    Usa Send API para processar múltiplos arquivos em paralelo.

    Returns:
        list[Send(...)] para fan-out aos nós de upload
    """
    logger.info("🔄 Nó 2: Convertendo base64 → binário (preparando para upload)...")

    valid_files = state.get("domain_data", {}).get("valid_files", [])

    if not valid_files:
        logger.warning("⚠️ Nenhum arquivo válido para converter")
        return {
            "steps": [AgentStep(
                agent_name="file_upload_graph",
                action="convert_base64_to_binary",
                result={"files_processed": 0},
                error="Nenhum arquivo válido"
            )],
            "domain_data": {
                "conversion_status": "failed",
                "converted_files": [],
            }
        }

    # Fan-out: envia cada arquivo para o nó de upload
    # Cada Send cria uma invocação paralela do nó "upload_worker"
    tasks = []
    for file_obj in valid_files:
        try:
            # Decodifica base64 → bytes
            binary_data = base64.b64decode(file_obj["base64"])

            # Envia para upload em paralelo
            tasks.append(Send(
                "upload_worker",
                {
                    "file_index": file_obj["index"],
                    "filename": file_obj["filename"],
                    "mime_type": file_obj["mime_type"],
                    "binary_data": binary_data,  # Bytes já decodificados
                }
            ))

            logger.debug(
                f"📤 Conversão OK: {file_obj['filename']} "
                f"({len(binary_data)} bytes)"
            )

        except Exception as e:
            logger.error(f"❌ Erro ao converter {file_obj['filename']}: {str(e)}")
            # Continua com outros arquivos

    # Registra passo
    step = AgentStep(
        agent_name="file_upload_graph",
        action="convert_base64_to_binary",
        result={"files_converted": len(tasks), "files_failed": len(valid_files) - len(tasks)},
    )

    # Retorna Send tasks para fan-out (não atualiza state aqui)
    # O grafo automaticamente agregará respostas em upload_results
    return {
        "steps": [step],
        "domain_data": {
            "conversion_status": "processing" if tasks else "failed",
            "files_ready_for_upload": len(tasks),
        }
    }


# ─── Nó 3: Upload Worker (Nó Paralelo) ──────────────────────────────────────

async def upload_worker(state: dict) -> dict[str, Any]:
    """
    Faz upload de um arquivo para a Files API do Gemini.

    Este nó é invocado em paralelo para cada arquivo via Send API.

    Input:
        {
            "file_index": int,
            "filename": str,
            "mime_type": str,
            "binary_data": bytes
        }

    Returns:
        {
            "upload_result": {
                "file_index": int,
                "filename": str,
                "uri": str,  # file://... URI retornado pela API
                "status": str,  # "success" ou "failed"
                "error": str | None
            }
        }
    """
    logger.info(f"📤 Nó 3: Upload Worker iniciado para {state['filename']}...")

    file_index = state.get("file_index")
    filename = state.get("filename")
    mime_type = state.get("mime_type")
    binary_data = state.get("binary_data")

    result = {
        "file_index": file_index,
        "filename": filename,
        "uri": None,
        "status": "failed",
        "error": None,
    }

    try:
        # Configura cliente Gemini
        genai.configure(api_key=settings.google_api_key)

        # Cria file upload
        # A API do Gemini aceita bytes diretamente ou file-like objects
        file_obj = genai.upload_file(
            data=binary_data,
            mime_type=mime_type,
            display_name=filename,
        )

        # Extrai URI (formato: "files/...")
        file_uri = file_obj.uri

        result["uri"] = file_uri
        result["status"] = "success"

        logger.info(f"✅ Upload OK: {filename} → {file_uri}")

    except Exception as e:
        error_msg = f"Erro ao fazer upload: {str(e)}"
        result["error"] = error_msg
        logger.error(f"❌ {error_msg}")

    return {"upload_results": [result]}


# ─── Nó 4: Agregar Resultados ───────────────────────────────────────────────

async def aggregate_upload_results(state: AgentState) -> dict[str, Any]:
    """
    Agrega os URIs de upload dos arquivos processados.

    Consolida resultados de uploads paralelos e prepara para uso no contexto
    do agente nas mensagens de usuário.

    Returns:
        {
            "uploaded_files": [
                {
                    "filename": str,
                    "uri": str,  # file://... para usar em context
                    "mime_type": str,
                    "status": str
                },
                ...
            ],
            "upload_summary": {
                "total_processed": int,
                "successful": int,
                "failed": int,
                "upload_errors": list[str]
            }
        }
    """
    logger.info("📋 Nó 4: Agregando resultados de upload...")

    # Coleta resultados de todos os uploads (já agregados via reducer)
    upload_results = state.get("domain_data", {}).get("upload_results", [])

    uploaded_files = []
    failed_uploads = []
    upload_errors = []

    # Mapeia resultados de volta aos arquivos originais
    valid_files = {f["index"]: f for f in state.get("domain_data", {}).get("valid_files", [])}

    for result in upload_results:
        if isinstance(result, list):
            # Se acumulou como lista (por ser annotated)
            for item in result:
                if item["status"] == "success":
                    uploaded_files.append({
                        "filename": item["filename"],
                        "uri": item["uri"],
                        "mime_type": valid_files.get(item["file_index"], {}).get("mime_type"),
                        "status": "uploaded",
                        "file_index": item["file_index"],
                    })
                else:
                    failed_uploads.append({
                        "filename": item["filename"],
                        "error": item["error"],
                    })
                    upload_errors.append(
                        f"{item['filename']}: {item['error']}"
                    )
        else:
            # Resultado singular
            if result["status"] == "success":
                uploaded_files.append({
                    "filename": result["filename"],
                    "uri": result["uri"],
                    "mime_type": valid_files.get(result["file_index"], {}).get("mime_type"),
                    "status": "uploaded",
                    "file_index": result["file_index"],
                })
            else:
                failed_uploads.append({
                    "filename": result["filename"],
                    "error": result["error"],
                })
                upload_errors.append(
                    f"{result['filename']}: {result['error']}"
                )

    total_processed = len(valid_files) + len(state.get("domain_data", {}).get("invalid_files", []))

    logger.info(
        f"✓ Agregação completa: {len(uploaded_files)} sucesso, "
        f"{len(failed_uploads)} falha"
    )

    # Registra passo
    step = AgentStep(
        agent_name="file_upload_graph",
        action="aggregate_upload_results",
        result={
            "uploaded_count": len(uploaded_files),
            "failed_count": len(failed_uploads),
        }
    )

    # Prepara contexto para adicionar às mensagens do agente
    file_context = ""
    if uploaded_files:
        file_context = "\n\nArquivos enviados para análise:\n"
        for f in uploaded_files:
            file_context += f"- {f['filename']} ({f['mime_type']}): {f['uri']}\n"

    return {
        "steps": [step],
        "domain_data": {
            "upload_status": "completed",
            "uploaded_files": uploaded_files,
            "upload_summary": {
                "total_provided": total_processed,
                "successful": len(uploaded_files),
                "failed": len(failed_uploads),
                "upload_errors": upload_errors,
            },
            "file_context": file_context,  # Pronto para adicionar às mensagens
        },
        "documents": [
            {
                "type": "uploaded_file",
                "filename": f["filename"],
                "uri": f["uri"],
                "mime_type": f["mime_type"],
            }
            for f in uploaded_files
        ]
    }


# ─── Router: Decidir se continua ou para no erro ─────────────────────────────

def route_after_validation(state: AgentState) -> str:
    """Decide se continua para upload ou para com erro."""
    should_continue = state.get("domain_data", {}).get("should_continue", False)
    return "convert_base64" if should_continue else END


# ─── Builder: Montar o Grafo ────────────────────────────────────────────────

def build_file_upload_graph() -> StateGraph:
    """
    Constrói e retorna o grafo compilado de upload de arquivos.

    Fluxo:
        1. validate_file_input → Valida base64, mime_type, tamanho
        2. [conditional] → Se válido, segue; se não, termina
        3. convert_base64_to_binary → Usa Send API para fan-out
        4. upload_worker (paralelo) → Processa múltiplos arquivos em paralelo
        5. aggregate_upload_results → Consolida URIs
        6. END

    Returns:
        Compiled StateGraph pronto para invocar
    """

    graph = (
        StateGraph(AgentState)
        .add_node("validate_input", validate_file_input)
        .add_node("convert_base64", convert_base64_to_binary)
        .add_node("upload_worker", upload_worker)
        .add_node("aggregate_results", aggregate_upload_results)

        # Edges
        .add_edge(START, "validate_input")
        .add_conditional_edges("validate_input", route_after_validation)

        # Fan-out: convert_base64 retorna list[Send(...)]
        .add_edge("convert_base64", "upload_worker")
        .add_edge("upload_worker", "aggregate_results")
        .add_edge("aggregate_results", END)
    )

    return graph.compile()


# ─── Exported Graph ────────────────────────────────────────────────────────

file_upload_graph = build_file_upload_graph()
