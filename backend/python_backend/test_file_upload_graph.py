"""
test_file_upload_graph.py — Teste e Demonstração do Grafo de Upload

Exemplifica como integrar o grafo de upload com o agente principal.
Mostra:
1. Como preparar arquivos em base64
2. Como invocar o grafo
3. Como usar os URIs retornados nas mensagens do agente
"""

import asyncio
import base64
import logging
from pathlib import Path

from core.state import AgentState, SessionContext
from agents.file_upload_graph import file_upload_graph

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


# ─── Helpers ────────────────────────────────────────────────────────────────

def file_to_base64(file_path: str) -> str:
    """Converte arquivo para base64."""
    with open(file_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def create_sample_pdf_base64() -> str:
    """Cria um PDF de exemplo em base64 (mínimo válido)."""
    # Mínimo PDF válido
    pdf_content = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
100 700 Td
(Hello World) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000229 00000 n
0000000319 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
412
%%EOF"""
    return base64.b64encode(pdf_content).decode("utf-8")


# ─── Test Cases ────────────────────────────────────────────────────────────

async def test_single_file_upload():
    """Testa upload de um único arquivo."""
    print("\n" + "="*80)
    print("TEST 1: Upload de um único arquivo PDF")
    print("="*80)

    # Prepara estado inicial
    state = AgentState(
        session=SessionContext(
            user_id="user-123",
            tenant_id="tenant-456",
        ),
        messages=[],
        domain_data={
            "files": [
                {
                    "base64": create_sample_pdf_base64(),
                    "filename": "documento_fiscal.pdf",
                    "mime_type": "application/pdf",
                }
            ]
        }
    )

    # Invoca grafo
    print("\n🚀 Invocar grafo de upload...")
    result = file_upload_graph.invoke(state)

    # Verifica resultado
    print(f"\n📊 Resultado:")
    print(f"  Status: {result.get('domain_data', {}).get('upload_status')}")
    print(f"  Arquivos enviados: {len(result.get('domain_data', {}).get('uploaded_files', []))}")

    uploaded = result.get("domain_data", {}).get("uploaded_files", [])
    if uploaded:
        for f in uploaded:
            print(f"  - {f['filename']}: {f['uri']}")

    errors = result.get("domain_data", {}).get("upload_summary", {}).get("upload_errors", [])
    if errors:
        print(f"\n⚠️ Erros:")
        for error in errors:
            print(f"  - {error}")


async def test_multiple_files_upload():
    """Testa upload paralelo de múltiplos arquivos."""
    print("\n" + "="*80)
    print("TEST 2: Upload paralelo de múltiplos arquivos")
    print("="*80)

    pdf_base64 = create_sample_pdf_base64()

    state = AgentState(
        session=SessionContext(
            user_id="user-123",
            tenant_id="tenant-456",
        ),
        messages=[],
        domain_data={
            "files": [
                {
                    "base64": pdf_base64,
                    "filename": "nfe_2024_01.pdf",
                    "mime_type": "application/pdf",
                },
                {
                    "base64": pdf_base64,
                    "filename": "nfe_2024_02.pdf",
                    "mime_type": "application/pdf",
                },
                {
                    "base64": base64.b64encode(b"Dados do cliente\nNome: João\nCPF: 123.456.789-00").decode(),
                    "filename": "dados_cliente.txt",
                    "mime_type": "text/plain",
                },
            ]
        }
    )

    print("\n🚀 Invocar grafo de upload (3 arquivos em paralelo)...")
    result = file_upload_graph.invoke(state)

    print(f"\n📊 Resultado:")
    print(f"  Status: {result.get('domain_data', {}).get('upload_status')}")

    summary = result.get("domain_data", {}).get("upload_summary", {})
    print(f"  Processados: {summary.get('total_provided')}")
    print(f"  Sucesso: {summary.get('successful')}")
    print(f"  Falha: {summary.get('failed')}")

    uploaded = result.get("domain_data", {}).get("uploaded_files", [])
    if uploaded:
        print(f"\n✅ Arquivos enviados:")
        for f in uploaded:
            print(f"  - {f['filename']}")
            print(f"    URI: {f['uri']}")
            print(f"    Tipo: {f['mime_type']}")

    # Mostra contexto pronto para usar nas mensagens
    file_context = result.get("domain_data", {}).get("file_context", "")
    if file_context:
        print(f"\n📝 Contexto para adicionar à mensagem do usuário:")
        print(file_context)


async def test_invalid_files():
    """Testa validação de arquivos inválidos."""
    print("\n" + "="*80)
    print("TEST 3: Validação de arquivos inválidos")
    print("="*80)

    state = AgentState(
        session=SessionContext(
            user_id="user-123",
            tenant_id="tenant-456",
        ),
        messages=[],
        domain_data={
            "files": [
                {
                    "base64": "not_a_valid_base64!!!",
                    "filename": "invalido.pdf",
                    "mime_type": "application/pdf",
                },
                {
                    "base64": create_sample_pdf_base64(),
                    "filename": "valido.pdf",
                    "mime_type": "application/pdf",
                },
                {
                    "base64": create_sample_pdf_base64(),
                    "filename": "mime_type_errado.pdf",
                    "mime_type": "application/octet-stream",  # Não suportado
                },
            ]
        }
    )

    print("\n🚀 Invocar grafo com arquivos inválidos...")
    result = file_upload_graph.invoke(state)

    print(f"\n📊 Resultado:")
    print(f"  Status: {result.get('domain_data', {}).get('upload_status')}")

    validation_errors = result.get("domain_data", {}).get("validation_errors", [])
    if validation_errors:
        print(f"\n❌ Erros de validação:")
        for error in validation_errors:
            print(f"  - {error}")

    invalid = result.get("domain_data", {}).get("invalid_files", [])
    if invalid:
        print(f"\n⚠️ Arquivos inválidos detectados:")
        for f in invalid:
            print(f"  - {f['filename']}: {f['errors']}")


async def test_integration_with_agent():
    """
    Demonstra como integrar o grafo com um agente principal.

    Fluxo esperado:
    1. Agente recebe mensagem do usuário com arquivos em base64
    2. Agente prepara domain_data com lista de arquivos
    3. Agente invoca file_upload_graph
    4. Grafo retorna URIs dos arquivos
    5. Agente adiciona file_context às mensagens do usuário
    6. Agente passa URIs para o modelo (via system prompt ou contexto)
    """
    print("\n" + "="*80)
    print("TEST 4: Integração com Agente Principal (Exemplo)")
    print("="*80)

    # Simula estado que um agente prepararia
    state = AgentState(
        session=SessionContext(
            user_id="user-123",
            tenant_id="tenant-456",
            client_name="Empresa XYZ",
        ),
        messages=[],
        domain_data={
            "files": [
                {
                    "base64": create_sample_pdf_base64(),
                    "filename": "nfe_entrada.pdf",
                    "mime_type": "application/pdf",
                },
                {
                    "base64": create_sample_pdf_base64(),
                    "filename": "nfe_saida.pdf",
                    "mime_type": "application/pdf",
                },
            ]
        }
    )

    print("\n🚀 Agente invoca file_upload_graph...")
    result = file_upload_graph.invoke(state)

    # Agora o agente pode usar os URIs
    uploaded_files = result.get("domain_data", {}).get("uploaded_files", [])
    file_context = result.get("domain_data", {}).get("file_context", "")

    if uploaded_files:
        print(f"\n✅ Agente recebeu URIs de upload:")
        print(f"\nPrepara mensagem do usuário com contexto:")
        user_message = f"""Analise os documentos fiscais fornecidos.
{file_context}

Por favor, verifique:
1. Se as NFes estão válidas
2. Se os valores conferem
3. Se há inconsistências"""

        print(user_message)

        print(f"\n📌 Próximos passos do agente:")
        print(f"  1. Adicionar URIs aos mensagens do sistema")
        print(f"  2. Enviar URIs para o modelo (Gemini recebe file:// URIs)")
        print(f"  3. Modelo processa com acesso aos conteúdos dos arquivos")
        print(f"  4. Retornar análise ao usuário")


# ─── Main ───────────────────────────────────────────────────────────────────

async def main():
    """Executa todos os testes."""
    print("\n🔧 Teste do Grafo de Upload de Arquivos")
    print("=" * 80)

    try:
        # Test 1
        await test_single_file_upload()

        # Test 2
        await test_multiple_files_upload()

        # Test 3
        await test_invalid_files()

        # Test 4 (integração)
        await test_integration_with_agent()

        print("\n" + "="*80)
        print("✅ Todos os testes completados!")
        print("="*80)

    except Exception as e:
        logger.error(f"Erro durante testes: {str(e)}", exc_info=True)
        print(f"\n❌ Erro: {str(e)}")


if __name__ == "__main__":
    asyncio.run(main())
