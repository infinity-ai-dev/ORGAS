#!/usr/bin/env python3
"""
Script para inspecionar o schema do banco de dados PostgreSQL/Supabase
Use para verificar as tabelas e colunas reais
"""

import psycopg2
import os
from psycopg2.extras import RealDictCursor

def connect_db():
    """Conectar ao banco de dados"""
    conn = psycopg2.connect(
        host=os.getenv('DB_HOST', 'supabase_db'),
        port=os.getenv('DB_PORT', '5432'),
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', 'ecdb0882661323177373c6270710e676'),
        database=os.getenv('DB_NAME', 'postgres')
    )
    return conn

def inspect_schema():
    """Inspecionar schema do banco de dados"""
    try:
        conn = connect_db()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        print("\n" + "="*80)
        print("🔍 INSPEÇÃO DO SCHEMA DO BANCO DE DADOS")
        print("="*80 + "\n")

        # Listar todas as tabelas
        cursor.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        """)

        tables = [row['table_name'] for row in cursor.fetchall()]

        if not tables:
            print("⚠️  Nenhuma tabela encontrada no schema public!")
            return

        print(f"📋 Total de tabelas: {len(tables)}\n")

        # Para cada tabela, listar as colunas
        for table_name in tables:
            cursor.execute("""
                SELECT
                  column_name,
                  data_type,
                  is_nullable,
                  column_default
                FROM information_schema.columns
                WHERE table_name = %s
                ORDER BY ordinal_position
            """, (table_name,))

            columns = cursor.fetchall()

            print(f"📊 Tabela: {table_name}")
            print("─" * 80)
            print(f"{'Column Name':<30} {'Data Type':<20} {'Nullable':<10} {'Default':<20}")
            print("─" * 80)

            for col in columns:
                col_name = col['column_name']
                data_type = col['data_type']
                nullable = col['is_nullable']
                default = col['column_default'] or '-'

                print(f"{col_name:<30} {data_type:<20} {nullable:<10} {str(default):<20}")

            print()

        # Verificar se há dados nas tabelas
        print("\n📈 Contagem de registros por tabela:")
        print("─" * 80)

        for table_name in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) as count FROM {table_name}")
                count = cursor.fetchone()['count']
                print(f"  {table_name:<40} {count:>10} registros")
            except Exception as e:
                print(f"  {table_name:<40} ❌ Erro ao contar")

        print("\n✅ Inspeção concluída com sucesso!\n")

        cursor.close()
        conn.close()

    except psycopg2.OperationalError as e:
        print(f"❌ Erro de conexão ao banco de dados:")
        print(f"   {str(e)}\n")
        print("Verifique as variáveis de ambiente:")
        print(f"  DB_HOST={os.getenv('DB_HOST', 'supabase_db')}")
        print(f"  DB_PORT={os.getenv('DB_PORT', '5432')}")
        print(f"  DB_USER={os.getenv('DB_USER', 'postgres')}")
        print(f"  DB_NAME={os.getenv('DB_NAME', 'postgres')}\n")
    except Exception as e:
        print(f"❌ Erro: {str(e)}\n")

if __name__ == '__main__':
    inspect_schema()
