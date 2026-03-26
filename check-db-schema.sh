#!/bin/bash

# Script para verificar o schema do banco de dados em produção
# Execute dentro do container Portainer

DB_HOST=${DB_HOST:-supabase_db}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-ecdb0882661323177373c6270710e676}
DB_NAME=${DB_NAME:-postgres}

echo "🔍 Conectando ao banco de dados: $DB_HOST:$DB_PORT"
echo "=================================================="

cat > /tmp/check_schema.sql << EOF
-- Listar todas as tabelas
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Para cada tabela, mostrar as colunas
SELECT
  t.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name
WHERE t.table_schema = 'public'
ORDER BY t.table_name, c.ordinal_position;
EOF

PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f /tmp/check_schema.sql
