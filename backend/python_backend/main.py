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
from hmac import compare_digest
from uuid import uuid4

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict
from langchain_core.messages import HumanMessage

from core.config import get_agent_service_token, settings
from core.document_processing import normalize_tipo_parecer
from runtime.orchestrator import build_orchestrator

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

bearer_scheme = HTTPBearer(auto_error=False)

# Estado global (em produção, usar dependency injection)
_orchestrator = None


async def get_orchestrator():
    """Retorna instância do orquestrador (lazy loading)."""
    global _orchestrator
    if _orchestrator is None:
        logger.info("Compilando orquestrador...")
        _orchestrator = build_orchestrator()
    return _orchestrator


def require_agent_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    expected_token = get_agent_service_token()

    if not expected_token:
        if settings.environment.lower() == "production":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI agent auth not configured",
            )
        return

    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization bearer token required",
        )

    if not compare_digest(credentials.credentials, expected_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid AI agent token",
        )


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if settings.environment.lower() == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    return response


def build_request_message(request: AgentRequest, tipo_parecer: str | None) -> str:
    message = (request.message or "").strip()
    client_name = request.client_name or "cliente"

    if not message or message.lower().startswith("gerar relatório"):
        if tipo_parecer == "pessoal":
            message = f"Gerar parecer pessoal (Departamento Pessoal) para {client_name}."
        elif tipo_parecer == "fiscal":
            message = f"Gerar parecer fiscal para {client_name}."
        elif tipo_parecer == "contabil":
            message = f"Gerar parecer contábil para {client_name}."
        else:
            message = f"Gerar relatório para {client_name}."

    extras: list[str] = []
    if request.competencia:
        extras.append(f"Competência: {request.competencia}")
    if request.cliente_cnpj:
        extras.append(f"CNPJ do cliente: {request.cliente_cnpj}")
    if request.observacoes:
        extras.append(f"Observações do analista: {request.observacoes}")
    if request.documentos_pendentes:
        pendencias = ", ".join(
            str(item.get("tipo") or item.get("key") or "documento")
            for item in request.documentos_pendentes
        )
        extras.append(f"Documentos pendentes informados: {pendencias}")

    if extras:
        return message + "\n\n" + "\n".join(extras)
    return message


# ─── Models ───────────────────────────────────────────────────────────────────

class AgentRequest(BaseModel):
    """Request para o agente."""
    model_config = ConfigDict(extra="allow")

    message: str
    session_id: str | None = None
    user_id: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    tipo_parecer: str | None = None  # fiscal, contabil, pessoal, atendimento
    documents: list[dict] | None = None
    categoria: str | None = None
    competencia: str | None = None
    cliente_cnpj: str | None = None
    fiscal_tributation: str | None = None
    observacoes: str | None = None
    documentos_pendentes: list[dict] | None = None
    user_name: str | None = None
    user_email: str | None = None


class AgentResponse(BaseModel):
    """Response do agente."""
    request_id: str
    session_id: str
    user_id: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    response: str | dict  # Can be string or structured dict (domain_data)
    tipo_parecer: str | None = None
    steps: int = 0
    documents_used: int = 0
    domain_data: dict | None = None  # Structured response from orchestrator


# ─── Health Check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "2.0.0"}


@app.get("/")
async def root():
    """Root endpoint."""
    endpoints = {
        "health": "/health",
        "agent": "/agent",
    }
    if settings.environment.lower() != "production" and settings.expose_console:
        endpoints["console"] = "/console"

    return {
        "name": "ORGAS Agent API",
        "version": "2.0.0",
        "endpoints": endpoints,
    }


# ─── Agent Endpoint ───────────────────────────────────────────────────────────

@app.post("/agent", response_model=AgentResponse)
async def agent_endpoint(
    request: AgentRequest,
    _: None = Depends(require_agent_token),
):
    """
    Processa uma mensagem com o agente.

    Args:
        request: AgentRequest com mensagem e contexto

    Returns:
        AgentResponse com resposta e metadados
    """
    session_id = request.session_id or str(uuid4())
    request_id = str(uuid4())

    logger.info(f"Request {request_id}: {request.message[:50]}...")

    try:
        tipo_parecer = normalize_tipo_parecer(request.tipo_parecer)
        request_message = build_request_message(request, tipo_parecer)

        # Constrói input para o orquestrador (sem memória semântica para evitar erros de embedding)
        messages_for_graph = [HumanMessage(content=request_message)]

        # Invoca o orquestrador
        orchestrator = await get_orchestrator()
        run_config = {"configurable": {"thread_id": session_id}}

        result = await orchestrator.ainvoke(
            {
                "messages": messages_for_graph,
                "session": {
                    "session_id": session_id,
                    "user_id": request.user_id,
                    "client_id": request.client_id,
                    "client_name": request.client_name,
                    "regime_tributario": request.fiscal_tributation,
                    "categoria": request.categoria,
                    "metadata": {
                        "competencia": request.competencia,
                        "cliente_cnpj": request.cliente_cnpj,
                        "observacoes": request.observacoes,
                        "documentos_pendentes": request.documentos_pendentes or [],
                        "user_name": request.user_name,
                        "user_email": request.user_email,
                    },
                },
                "tipo_parecer": tipo_parecer,
                "documents": request.documents or [],
            },
            config=run_config,
        )

        # Extract response data
        domain_data = result.get("domain_data", {})
        final_response = result.get("final_response") or "Sem resposta."

        logger.info(f"Request {request_id}: OK")

        return AgentResponse(
            request_id=request_id,
            session_id=session_id,
            user_id=request.user_id,
            client_id=request.client_id,
            client_name=request.client_name,
            response=domain_data or final_response,  # Return structured data if available, else fallback to string
            tipo_parecer=result.get("tipo_parecer") or tipo_parecer,
            steps=result.get("iteration_count", 0),
            documents_used=len(request.documents or []),
            domain_data=domain_data,  # Also include domain_data explicitly
        )

    except Exception as e:
        logger.error(f"Request {request_id}: Erro - {e}")
        raise HTTPException(
            status_code=500,
            detail=str(e) if settings.debug else "Erro interno ao processar requisição",
        )


# ─── Console Interativo ───────────────────────────────────────────────────────

@app.get("/console")
async def console_endpoint():
    """
    Retorna interface HTML para console interativo.
    """
    if settings.environment.lower() == "production" or not settings.expose_console:
        raise HTTPException(status_code=404, detail="Not found")

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
            const userLine = document.createElement('div');
            userLine.className = 'response';
            userLine.textContent = 'Você: ' + msg;
            output.appendChild(userLine);
            document.getElementById('input').value = '';

            try {
                const res = await fetch('/agent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: msg })
                });
                const data = await res.json();
                const agentLine = document.createElement('div');
                agentLine.className = 'response';
                agentLine.textContent = 'Agente: ' + (typeof data.response === 'string' ? data.response : JSON.stringify(data.response));
                output.appendChild(agentLine);
                output.scrollTop = output.scrollHeight;
            } catch (e) {
                const errorLine = document.createElement('div');
                errorLine.className = 'response';
                errorLine.style.color = '#f00';
                errorLine.textContent = 'Erro: ' + e;
                output.appendChild(errorLine);
            }
        }
    </script>
</body>
</html>
    """)


# ─── Main ─────────────────────────────────────────────────────────────────────

async def run_console():
    """Modo console interativo."""
    print("\n" + "="*55)
    print("  ORGAS Agent Framework v2.0")
    print("="*55)
    print("  Digite 'sair' para encerrar")
    print("  Digite 'mem' para ver stats da memória\n")

    session_id = str(uuid4())
    orchestrator = await get_orchestrator()
    run_config = {"configurable": {"thread_id": session_id}}

    while True:
        try:
            user_input = input("Você: ").strip()
        except (KeyboardInterrupt, EOFError):
            break

        if not user_input:
            continue
        if user_input.lower() in ("sair", "exit", "quit"):
            break

        try:
            # Invoca orquestrador
            messages_for_graph = [HumanMessage(content=user_input)]

            result = await orchestrator.ainvoke(
                {
                    "messages": messages_for_graph,
                    "session": {"session_id": session_id},
                },
                config=run_config,
            )

            response = result.get("final_response") or "Sem resposta."

            print(f"\nAssistente: {response}\n")

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
