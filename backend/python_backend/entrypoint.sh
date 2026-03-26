#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# ORGAS AI Agent - Docker Entrypoint
# Version: 3.0.0
# Description: Initializes and runs the ORGAS AI Agent with LangGraph
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# ─── Colors for output ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ─── Logging functions ────────────────────────────────────────────────────────
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# ─── Configuration ────────────────────────────────────────────────────────────
PROJECT_NAME="ORGAS AI Agent"
PROJECT_VERSION="3.0.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Default environment variables ────────────────────────────────────────────
export PYTHONUNBUFFERED=1
export PYTHONDONTWRITEBYTECODE=1

# Set defaults if not provided
HOST=${HOST:-0.0.0.0}
PORT=${PORT:-8000}
DEBUG=${DEBUG:-false}
ENVIRONMENT=${ENVIRONMENT:-development}
WORKERS=${WORKERS:-4}
LOG_LEVEL=${LOG_LEVEL:-INFO}
TIMEOUT_SECONDS=${TIMEOUT_SECONDS:-30}
MAX_WORKERS=${MAX_WORKERS:-5}

# ─── LLM APIs ─────────────────────────────────────────────────────────────────
# Read from secrets if available (Docker Swarm)
if [ -f "/run/secrets/GEMINI_API_KEY_FILE" ]; then
    export GOOGLE_API_KEY=$(cat /run/secrets/GEMINI_API_KEY_FILE)
    log_info "Loaded GEMINI_API_KEY from Docker secret"
fi

if [ -f "/run/secrets/OPENAI_API_KEY_FILE" ]; then
    export OPENAI_API_KEY=$(cat /run/secrets/OPENAI_API_KEY_FILE)
    log_info "Loaded OPENAI_API_KEY from Docker secret"
fi

if [ -f "/run/secrets/ANTHROPIC_API_KEY_FILE" ]; then
    export ANTHROPIC_API_KEY=$(cat /run/secrets/ANTHROPIC_API_KEY_FILE)
    log_info "Loaded ANTHROPIC_API_KEY from Docker secret"
fi

# ─── Database Configuration ───────────────────────────────────────────────────
if [ -n "$DATABASE_URL" ]; then
    log_info "Using DATABASE_URL from environment"
elif [ -n "$DB_HOST" ] && [ -n "$DB_USER" ] && [ -n "$DB_PASSWORD" ] && [ -n "$DB_NAME" ]; then
    DB_PORT=${DB_PORT:-5432}
    DB_SSL=${DB_SSL:-false}
    export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=$([ "$DB_SSL" = "true" ] && echo "require" || echo "disable")"
    log_info "Constructed DATABASE_URL from individual components"
else
    log_warn "No database configuration provided. Some features may be unavailable."
fi

# ─── Redis Configuration ──────────────────────────────────────────────────────
if [ -n "$REDIS_URL" ]; then
    log_info "Using REDIS_URL from environment"
elif [ -n "$REDIS_HOST" ] && [ -n "$REDIS_PORT" ]; then
    REDIS_DB=${REDIS_DB:-0}
    export REDIS_URL="redis://${REDIS_HOST}:${REDIS_PORT}/${REDIS_DB}"
    log_info "Constructed REDIS_URL from components"
fi

# ─── Supabase Storage Configuration ────────────────────────────────────────────
if [ -z "$SUPABASE_STORAGE_URL" ]; then
    log_warn "SUPABASE_STORAGE_URL not configured"
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    log_warn "SUPABASE_SERVICE_ROLE_KEY not configured"
fi

# ─── Agent Configuration ──────────────────────────────────────────────────────
STORAGE_CACHE_TTL=${STORAGE_CACHE_TTL:-3000}

# ─── Display Configuration ────────────────────────────────────────────────────
log_info "╔════════════════════════════════════════════════════════════════════════════╗"
log_info "║                   ${PROJECT_NAME} - Initializing                   ║"
log_info "╚════════════════════════════════════════════════════════════════════════════╝"

echo ""
log_info "📋 Configuration:"
echo "   Version:           $PROJECT_VERSION"
echo "   Environment:       $ENVIRONMENT"
echo "   Host:              $HOST"
echo "   Port:              $PORT"
echo "   Debug Mode:        $DEBUG"
echo "   Log Level:         $LOG_LEVEL"
echo "   Workers:           $WORKERS"
echo "   Max Workers:       $MAX_WORKERS"
echo "   Timeout:           ${TIMEOUT_SECONDS}s"
echo "   Cache TTL:         ${STORAGE_CACHE_TTL}ms"
echo ""

# ─── Check required environment variables ─────────────────────────────────────
check_env_var() {
    local var_name=$1
    local var_value=${!var_name}

    if [ -z "$var_value" ]; then
        log_warn "Optional: $var_name not set"
        return 1
    else
        log_success "$var_name is configured"
        return 0
    fi
}

log_info "🔍 Checking environment variables..."
check_env_var "GOOGLE_API_KEY" || log_warn "Google API (Gemini) not configured"
check_env_var "OPENAI_API_KEY" || log_warn "OpenAI API not configured"
check_env_var "ANTHROPIC_API_KEY" || log_warn "Anthropic API not configured"
check_env_var "DATABASE_URL" || log_warn "Database not configured"
check_env_var "REDIS_URL" || log_warn "Redis cache not configured"

echo ""

# ─── Check Python version ─────────────────────────────────────────────────────
log_info "✅ Python version:"
python --version

# ─── Check installed packages ─────────────────────────────────────────────────
log_info "✅ Checking required packages..."
python -c "from langgraph.graph import StateGraph; print('   ✓ langgraph installed')" 2>/dev/null || log_warn "   ✗ langgraph not installed"
python -c "import langchain; print('   ✓ langchain: ' + langchain.__version__)" 2>/dev/null || log_warn "   ✗ langchain not installed"
python -c "import fastapi; print('   ✓ fastapi installed')" 2>/dev/null || log_warn "   ✗ fastapi not installed"
python -c "import pydantic; print('   ✓ pydantic installed')" 2>/dev/null || log_warn "   ✗ pydantic not installed"

echo ""

# ─── Initialize database (if migrations needed) ────────────────────────────────
if [ "$RUN_MIGRATIONS" = "true" ] && [ -n "$DATABASE_URL" ]; then
    log_info "🗄️  Running database migrations..."
    # Uncomment if using Alembic or similar
    # alembic upgrade head || log_warn "Migration failed, continuing anyway"
    log_success "Database migrations skipped (not configured)"
else
    log_info "⏭️  Skipping database migrations"
fi

echo ""

# ─── Determine run mode ────────────────────────────────────────────────────────
RUN_MODE="production"
UVICORN_ARGS="--host $HOST --port $PORT --workers $WORKERS"

case "$1" in
    --dev|--development)
        log_info "🔄 Starting in DEVELOPMENT mode with auto-reload..."
        RUN_MODE="development"
        UVICORN_ARGS="--host $HOST --port $PORT --reload"
        ;;
    --console)
        log_info "💻 Starting in CONSOLE/REPL mode..."
        RUN_MODE="console"
        ;;
    --test)
        log_info "🧪 Starting in TEST mode..."
        RUN_MODE="test"
        ;;
    *)
        log_info "🚀 Starting in PRODUCTION mode..."
        ;;
esac

echo ""

# ─── Run based on mode ────────────────────────────────────────────────────────
case "$RUN_MODE" in
    development)
        log_success "Starting FastAPI with auto-reload..."
        python main.py --dev
        ;;
    console)
        log_success "Starting interactive console..."
        python main.py --console
        ;;
    test)
        log_success "Running tests..."
        python -m pytest tests/ -v --tb=short
        ;;
    *)
        log_success "Starting Uvicorn server with $WORKERS workers..."
        echo ""

        # Determine the public URL based on environment
        if [ "$ENVIRONMENT" = "production" ]; then
            # In production, use the Traefik/public endpoint
            PUBLIC_URL="${PRODUCTION_URL:-https://app.orgahold.com/api/ai}"
            INTERNAL_URL="http://${HOST}:${PORT}"
        else
            PUBLIC_URL="http://${HOST}:${PORT}"
            INTERNAL_URL="http://${HOST}:${PORT}"
        fi

        log_info "╔════════════════════════════════════════════════════════════════════════════╗"
        log_info "║                   ${PROJECT_NAME} v${PROJECT_VERSION}                       ║"
        log_info "║                          Server is Running                                   ║"
        log_info "╠════════════════════════════════════════════════════════════════════════════╣"
        log_info "║ 🌐 Public URL:     ${PUBLIC_URL}                                           ║"
        log_info "║ 📚 Docs:          ${PUBLIC_URL}/docs                                        ║"
        log_info "║ 🔍 ReDoc:         ${PUBLIC_URL}/redoc                                       ║"
        log_info "║ ❤️  Health:        ${PUBLIC_URL}/health                                      ║"
        log_info "║                                                                            ║"
        log_info "║ (Internal: ${INTERNAL_URL})                                                 ║"
        log_info "╚════════════════════════════════════════════════════════════════════════════╝"
        echo ""

        # Start with uvicorn
        exec python -m uvicorn main:app $UVICORN_ARGS --log-level ${LOG_LEVEL,,}
        ;;
esac
