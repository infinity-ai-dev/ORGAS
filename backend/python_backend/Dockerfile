# Build Stage - Otimizado para produção
# Multi-architecture support: amd64, arm64
ARG BUILDPLATFORM
ARG TARGETPLATFORM
ARG TARGETARCH

FROM python:3.10-slim as builder

# Instalar dependências do sistema necessárias
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar UV para gerenciamento de dependências
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    export PATH="$HOME/.local/bin:$PATH" && \
    uv --version

# Set working directory
WORKDIR /build

# Copiar requirements
COPY requirements.txt requirements-llm.txt ./

# Instalar dependências com UV
RUN export PATH="$HOME/.local/bin:$PATH" && \
    uv pip install --system --no-cache-dir -r requirements.txt -r requirements-llm.txt

# Runtime Stage - Imagem final enxuta
FROM python:3.10-slim

# Labels de metadados
LABEL maintainer="ORGAS AI Team"
LABEL description="ORGAS Agent API - FastAPI + LangGraph"
LABEL version="2.0.0"

# Instalar dependências mínimas de runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    redis-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Criar usuário não-root para segurança
RUN useradd -m -u 1000 appuser

# Set working directory
WORKDIR /app

# Copiar dependências Python do builder
COPY --from=builder /usr/local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copiar código da aplicação
COPY --chown=appuser:appuser . .

# Copiar entrypoint script
COPY --chown=appuser:appuser entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Mudar para usuário não-root
USER appuser

# Healthcheck (reduced frequency to avoid overhead)
HEALTHCHECK --interval=60s --timeout=5s --start-period=45s --retries=2 \
    CMD curl -f http://localhost:8000/health || exit 1

# Expose port
EXPOSE 8000

# Environment variables padrão (sobrescrever com .env em produção)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000 \
    HOST=0.0.0.0 \
    ENVIRONMENT=production \
    DEBUG=false \
    WORKERS=4 \
    LOG_LEVEL=INFO

# Entrypoint: script que inicializa o agente com variáveis de ambiente
ENTRYPOINT ["/app/entrypoint.sh"]
