#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# ORGAS Backend API - Docker Entrypoint
# Version: 2.0.4
# Description: Initializes and runs the ORGAS Backend API (Express/TypeScript)
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
PROJECT_NAME="ORGAS Backend API"
PROJECT_VERSION="2.0.15"

# ─── Set defaults if not provided ──────────────────────────────────────────────
NODE_ENV=${NODE_ENV:-production}
PORT=${PORT:-3000}
HOST=${HOST:-0.0.0.0}
DEBUG=${DEBUG:-false}
LOG_LEVEL=${LOG_LEVEL:-info}

# ─── Display Configuration ────────────────────────────────────────────────────
log_info "╔════════════════════════════════════════════════════════════════════════════╗"
log_info "║              ${PROJECT_NAME} - Initializing                     ║"
log_info "╚════════════════════════════════════════════════════════════════════════════╝"

echo ""
log_info "📋 Configuration:"
echo "   Version:           $PROJECT_VERSION"
echo "   Environment:       $NODE_ENV"
echo "   Host:              $HOST"
echo "   Port:              $PORT"
echo "   Debug Mode:        $DEBUG"
echo "   Log Level:         $LOG_LEVEL"
echo ""

# ─── Check environment variables ───────────────────────────────────────────────
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
check_env_var "DATABASE_URL" || log_warn "Database not configured"
check_env_var "REDIS_HOST" || log_warn "Redis not configured"
check_env_var "AGENT_API_URL" || log_warn "AI Agent API not configured"
check_env_var "GEMINI_API_KEY" || log_warn "Gemini API not configured"
check_env_var "JWT_SECRET" || log_warn "JWT secret not configured"

echo ""

# ─── Check Node.js version ────────────────────────────────────────────────────
log_info "✅ Node.js version:"
node --version

echo ""

# ─── Display startup message ───────────────────────────────────────────────────
log_info "╔════════════════════════════════════════════════════════════════════════════╗"
log_info "║                   ${PROJECT_NAME} v${PROJECT_VERSION}                       ║"
log_info "║                          Server is Starting                                ║"
log_info "╠════════════════════════════════════════════════════════════════════════════╣"
log_info "║ 🌐 Server:        http://${HOST}:${PORT}                                     ║"
log_info "║ 📚 Docs:          http://${HOST}:${PORT}/api/docs                            ║"
log_info "║ ❤️  Health:        http://${HOST}:${PORT}/health                             ║"
log_info "║ 🧠 AI Agent:      ${AGENT_API_URL:-not configured}                           ║"
log_info "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# ─── Start the application ────────────────────────────────────────────────────
log_success "Starting Express server..."
exec node dist/index.js
