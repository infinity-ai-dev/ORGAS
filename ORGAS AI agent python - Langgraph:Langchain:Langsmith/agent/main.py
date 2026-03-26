"""
main.py — FastAPI Application

Entrypoint da aplicação Python backend com LangGraph.

Modos de execução:
    python main.py                  → Servidor FastAPI em localhost:8000
    python main.py --dev            → Modo desenvolvimento com reload
    python main.py --console        → Console interativo
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from fastapi.security import HTTPBearer
from typing import Any
from langchain_core.messages import HumanMessage

from core.config import settings
from utils.html_generator import HtmlGenerator

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)

# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="ORGAS Agent API",
    description="Universal Agent Framework com LangGraph + LangChain",
    version="2.0.0",
)

# Estado global não necessário - cada request invoca sub-grafo direto


# ─── Models ───────────────────────────────────────────────────────────────────

class AgentRequest(BaseModel):
    """Request para o agente."""
    message: str
    session_id: str | None = None
    user_id: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    tipo_parecer: str | None = None  # fiscal, contabil, pessoal, atendimento
    documents: list[dict] | None = None


class AgentResponse(BaseModel):
    """Response do agente - com estrutura específica por tipo_parecer."""
    request_id: str
    session_id: str
    response: dict | str  # Pode ser JSON estruturado ou texto
    tipo_parecer: str | None = None
    steps: int = 0
    documents_used: int = 0
    html_output: str | None = None  # Pre-generated HTML report to avoid rework

    # Validação: se tipo_parecer é "pessoal", response deve ser dict com campos específicos
    # se é "fiscal", response deve ser dict com campos fiscais, etc.



# ─── Security & Authentication ────────────────────────────────────────────────

security = HTTPBearer()

# Token validation (in production, validate against a real token store)
VALID_TOKENS = {
    settings.ai_agent_token if hasattr(settings, 'ai_agent_token') and settings.ai_agent_token else "default-dev-token"
}

def verify_token(credentials: Any = Depends(security)) -> str:
    """Verifica se o token é válido."""
    token = credentials.credentials
    
    # In production, validate against database or external auth service
    if token not in VALID_TOKENS:
        logger.warning(f"Invalid token attempt: {token[:10]}...")
        raise HTTPException(status_code=403, detail="Invalid authentication credentials")
    
    return token


# ─── Health Check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "2.0.0"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "ORGAS Agent API",
        "version": "2.0.0",
        "endpoints": {
            "health": "/health",
            "agent": "/agent",
            "console": "/console",
        }
    }


# ─── Agent Endpoint ───────────────────────────────────────────────────────────

@app.post("/agent", response_model=AgentResponse)
async def agent_endpoint(
    request: AgentRequest,
    token: str = Depends(verify_token)
):
    """
    Processa relatório com sub-grafo especializado.

    ✨ Arquitetura Simplificada:
    - SEM memória semântica (apenas leitura/execução)
    - tipo_parecer OBRIGATÓRIO (passa direto para o sub-grafo)
    - Invoca sub-grafo específico: fiscal, accounting, personal, support
    - Gera HTML do resultado

    Args:
        request: AgentRequest com tipo_parecer obrigatório

    Returns:
        AgentResponse com response estruturado + html_output
    """
    session_id = request.session_id or str(uuid4())
    request_id = str(uuid4())
    tipo_parecer = request.tipo_parecer or "generico"

    logger.info(f"Request {request_id} (authenticated): {request.message[:50]}... [{tipo_parecer}]")

    try:
        # Validar tipo_parecer
        valid_types = ["fiscal", "pessoal", "contabil", "atendimento", "generico"]
        if tipo_parecer not in valid_types:
            tipo_parecer = "generico"
            logger.warning(f"tipo_parecer inválido, usando 'generico'")

        # ─── Invoca sub-grafo direto (sem detecção de intenção) ───────────────
        from agents.fiscal_agent import get_fiscal_subgraph
        from agents.personal_agent import get_personal_subgraph
        from agents.accounting_agent import get_accounting_subgraph
        from agents.support_agent import get_support_subgraph
        from agents.generic_agent import get_generic_subgraph

        subgraph_map = {
            "fiscal": get_fiscal_subgraph,
            "pessoal": get_personal_subgraph,
            "contabil": get_accounting_subgraph,
            "atendimento": get_support_subgraph,
            "generico": get_generic_subgraph,
        }

        get_subgraph = subgraph_map[tipo_parecer]
        subgraph = await get_subgraph()

        logger.info(f"Invocando sub-grafo: {tipo_parecer}")

        # Estado simples: sem memória, apenas contexto
        state = {
            "messages": [HumanMessage(content=request.message)],
            "session": {
                "session_id": session_id,
                "user_id": request.user_id,
                "client_id": request.client_id,
                "client_name": request.client_name,
            },
            "tipo_parecer": tipo_parecer,
            "documents": request.documents or [],
        }

        result = await subgraph.ainvoke(state)

        # Extrai resposta final
        final_response = result.get("final_response") or result.get("domain_data") or {}
        iteration_count = result.get("iteration_count", 0)

        logger.info(f"Request {request_id}: Sucesso [{tipo_parecer}]")

        # ─── Gera HTML ──────────────────────────────────────────────────────
        html_output = None
        if isinstance(final_response, dict) and tipo_parecer:
            try:
                html_output = HtmlGenerator.generate(final_response, tipo_parecer)
                logger.info(f"Request {request_id}: HTML gerado")
            except Exception as html_error:
                logger.warning(f"Request {request_id}: HTML falhou - {html_error}")

        return AgentResponse(
            request_id=request_id,
            session_id=session_id,
            response=final_response,
            tipo_parecer=tipo_parecer,
            steps=iteration_count,
            documents_used=len(request.documents or []),
            html_output=html_output,
        )

    except Exception as e:
        logger.error(f"Request {request_id}: Erro - {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ─── Console Interativo ───────────────────────────────────────────────────────

@app.get("/console")
async def console_endpoint():
    """
    Retorna interface HTML para console interativo.
    """
    return HTMLResponse("""
<!DOCTYPE html>
<html>
<head>
    <title>ORGAS Agent Console</title>
    <style>
        * { font-family: monospace; }
        body { background: #000; color: #0f0; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        input, textarea { background: #111; color: #0f0; border: 1px solid #0f0; padding: 10px; width: 100%; }
        button { background: #0f0; color: #000; border: none; padding: 10px 20px; cursor: pointer; }
        #output { margin-top: 20px; height: 400px; overflow-y: auto; border: 1px solid #0f0; padding: 10px; }
        .response { color: #0ff; margin: 10px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧠 ORGAS Agent Console</h1>
        <textarea id="input" placeholder="Digite sua pergunta..." rows="4"></textarea>
        <button onclick="sendMessage()">Enviar</button>
        <div id="output"></div>
    </div>
    <script>
        async function sendMessage() {
            const msg = document.getElementById('input').value;
            if (!msg) return;

            const output = document.getElementById('output');
            const userDiv = document.createElement('div');
            userDiv.className = 'response';
            userDiv.textContent = 'Você: ' + msg;
            output.appendChild(userDiv);
            document.getElementById('input').value = '';

            try {
                const res = await fetch('/agent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: msg })
                });
                const data = await res.json();
                const agentDiv = document.createElement('div');
            agentDiv.className = 'response';
            agentDiv.textContent = 'Agente: ' + data.response;
            output.appendChild(agentDiv);
                output.scrollTop = output.scrollHeight;
            } catch (e) {
                const errorDiv = document.createElement('div');
            errorDiv.className = 'response';
            errorDiv.style.color = '#f00';
            errorDiv.textContent = 'Erro: ' + String(e);
            output.appendChild(errorDiv);
            }
        }
    </script>
</body>
</html>
    """)


from fastapi.responses import HTMLResponse


# ─── Main ─────────────────────────────────────────────────────────────────────

async def run_console():
    """Modo console interativo (simplificado - sem memória)."""
    print("\n" + "="*55)
    print("  ORGAS Agent Framework v3.0")
    print("="*55)
    print("  Use: /fiscal | /pessoal | /contabil | /atendimento")
    print("  Digite 'sair' para encerrar\n")

    while True:
        try:
            user_input = input("Você: ").strip()
        except (KeyboardInterrupt, EOFError):
            break

        if not user_input:
            continue
        if user_input.lower() in ("sair", "exit", "quit"):
            break

        # Detecta tipo_parecer pelo prefixo
        tipo_parecer = "generico"
        if user_input.startswith("/fiscal"):
            tipo_parecer = "fiscal"
            message = user_input.replace("/fiscal", "").strip()
        elif user_input.startswith("/pessoal"):
            tipo_parecer = "pessoal"
            message = user_input.replace("/pessoal", "").strip()
        elif user_input.startswith("/contabil"):
            tipo_parecer = "contabil"
            message = user_input.replace("/contabil", "").strip()
        elif user_input.startswith("/atendimento"):
            tipo_parecer = "atendimento"
            message = user_input.replace("/atendimento", "").strip()
        else:
            message = user_input

        try:
            # Simula request
            request = AgentRequest(
                message=message or user_input,
                tipo_parecer=tipo_parecer,
                user_id="console_user",
            )

            response = await agent_endpoint(request, token="dev-token")
            print(f"\nAssistente [{tipo_parecer}]: {response.response}\n")

        except Exception as e:
            print(f"\n[Erro] {e}\n")

    print("\nEncerrando...")


def main():
    """Main entrypoint."""
    parser = argparse.ArgumentParser(description="ORGAS Agent Framework")
    parser.add_argument("--dev", action="store_true", help="Modo desenvolvimento")
    parser.add_argument("--console", action="store_true", help="Console interativo")
    parser.add_argument("--host", default=settings.host, help="Host do servidor")
    parser.add_argument("--port", type=int, default=settings.port, help="Porta do servidor")
    args = parser.parse_args()

    if args.console:
        asyncio.run(run_console())
    else:
        uvicorn.run(
            "main:app",
            host=args.host,
            port=args.port,
            reload=args.dev,
        )


if __name__ == "__main__":
    main()
