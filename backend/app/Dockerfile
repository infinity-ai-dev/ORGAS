FROM node:20-slim

LABEL maintainer="ORGAS Team"
LABEL description="ORGAS Backend API - Express + TypeScript"
LABEL version="2.0.4"

WORKDIR /app

# Instalar curl para healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Criar usuário não-root
RUN useradd -m -u 1001 appuser

# Copiar package e dist já buildado
COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit

# Copiar código e scripts
COPY --chown=appuser:appuser dist ./dist
COPY --chown=appuser:appuser references ./references
COPY --chown=appuser:appuser scripts ./scripts
COPY --chown=appuser:appuser entrypoint.sh ./
RUN chmod +x ./entrypoint.sh

# Cambiar a usuário não-root
USER appuser

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Environment
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

# Entrypoint
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/index.js"]
