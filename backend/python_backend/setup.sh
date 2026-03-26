#!/bin/bash
set -e

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  🚀 Setup ORGAS Agent Framework com UV                    ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Cores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Verificar UV
echo -e "${BLUE}1️⃣  Verificando UV...${NC}"
if ! command -v uv &> /dev/null; then
    echo -e "${YELLOW}⚠️  UV não encontrado. Instalando...${NC}"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

UV_VERSION=$(uv --version)
echo -e "${GREEN}✓ $UV_VERSION${NC}"

# 2. Configurar ambiente Python
echo ""
echo -e "${BLUE}2️⃣  Configurando ambiente Python...${NC}"
uv sync --python 3.10

echo -e "${GREEN}✓ Virtual environment criado em .venv${NC}"

# 3. Ativar venv
echo ""
echo -e "${BLUE}3️⃣  Ativando virtual environment...${NC}"
source .venv/bin/activate

echo -e "${GREEN}✓ venv ativo${NC}"

# 4. Verificar instalação
echo ""
echo -e "${BLUE}4️⃣  Verificando dependências...${NC}"
PYTHON_VERSION=$(python --version)
PACKAGE_COUNT=$(uv pip list | wc -l)

echo -e "${GREEN}✓ Python: $PYTHON_VERSION${NC}"
echo -e "${GREEN}✓ Pacotes instalados: ~$PACKAGE_COUNT${NC}"

# 5. Teste rápido
echo ""
echo -e "${BLUE}5️⃣  Testando importações principais...${NC}"

python -c "import langgraph; print('✓ langgraph')" 2>/dev/null || echo "✗ langgraph"
python -c "import langchain; print('✓ langchain')" 2>/dev/null || echo "✗ langchain"
python -c "import fastapi; print('✓ fastapi')" 2>/dev/null || echo "✗ fastapi"
python -c "import pydantic; print('✓ pydantic')" 2>/dev/null || echo "✗ pydantic"

# 6. Gerar lock file
echo ""
echo -e "${BLUE}6️⃣  Gerando uv.lock...${NC}"
uv lock
echo -e "${GREEN}✓ uv.lock criado${NC}"

# 7. Resumo final
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo -e "${GREEN}║  ✅ Setup Completo!${NC}                                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${YELLOW}Próximos passos:${NC}"
echo "  1. Configurar .env:"
echo "     cp .env.example .env"
echo "     # Edite GOOGLE_API_KEY, REDIS_URL, etc"
echo ""
echo "  2. Rodar servidor:"
echo "     python main.py --console"
echo ""
echo -e "${BLUE}Comandos úteis com UV:${NC}"
echo "  • uv sync              → Sincronizar dependências"
echo "  • uv sync --upgrade    → Atualizar tudo"
echo "  • uv pip list          → Listar pacotes"
echo "  • uv pip audit         → Verificar vulnerabilidades"
echo "  • uv lock --upgrade    → Atualizar lock file"
echo ""
echo "📖 Leia UV_GUIDE.md para mais detalhes"
echo ""
