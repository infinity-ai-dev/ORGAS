#!/usr/bin/env node

/**
 * Script para testar a conexão do backend com Supabase
 * Execute dentro do container: node test-db-connection.js
 */

const { Pool } = require('pg');

async function testConnection() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 TESTE DE CONEXÃO DO BACKEND COM SUPABASE');
  console.log('='.repeat(80) + '\n');

  const config = {
    host: process.env.DB_HOST || 'supabase_db',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'ecdb0882661323177373c6270710e676',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  };

  console.log('📋 Configuração:');
  console.log(`  Host: ${config.host}`);
  console.log(`  Port: ${config.port}`);
  console.log(`  Database: ${config.database}`);
  console.log(`  User: ${config.user}`);
  console.log(`  SSL: ${config.ssl ? 'true' : 'false'}\n`);

  const pool = new Pool(config);

  try {
    // Teste 1: Conexão básica
    console.log('✓ Teste 1: Conexão básica...');
    const client = await pool.connect();
    console.log('  ✅ Conexão bem-sucedida!\n');
    client.release();

    // Teste 2: Listar tabelas
    console.log('✓ Teste 2: Listar tabelas do schema public...');
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 0) {
      console.log('  ⚠️  Nenhuma tabela encontrada!\n');
    } else {
      console.log(`  ✅ ${tablesResult.rows.length} tabelas encontradas:\n`);
      for (const row of tablesResult.rows) {
        console.log(`    - ${row.table_name}`);
      }
      console.log();
    }

    // Teste 3: Testar tabela clientesPJ
    console.log('✓ Teste 3: Consultar clientesPJ...');
    try {
      const clientesResult = await pool.query(`
        SELECT id, "razaoSocial", "cnpjMatriz"
        FROM "clientesPJ"
        LIMIT 5
      `);

      if (clientesResult.rows.length === 0) {
        console.log('  ⚠️  Tabela clientesPJ existe mas está vazia!\n');
      } else {
        console.log(`  ✅ ${clientesResult.rows.length} clientes encontrados:\n`);
        for (const row of clientesResult.rows) {
          console.log(`    - ID: ${row.id}, Razão Social: ${row.razaoSocial}, CNPJ: ${row.cnpjMatriz}`);
        }
        console.log();
      }
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}\n`);
    }

    // Teste 4: Testar tabela usuariosApp
    console.log('✓ Teste 4: Consultar usuariosApp...');
    try {
      const usuariosResult = await pool.query(`
        SELECT id, email, nome, admin
        FROM "usuariosApp"
        LIMIT 5
      `);

      if (usuariosResult.rows.length === 0) {
        console.log('  ⚠️  Tabela usuariosApp existe mas está vazia!\n');
      } else {
        console.log(`  ✅ ${usuariosResult.rows.length} usuários encontrados:\n`);
        for (const row of usuariosResult.rows) {
          console.log(`    - ID: ${row.id}, Email: ${row.email}, Nome: ${row.nome}, Admin: ${row.admin}`);
        }
        console.log();
      }
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}\n`);
    }

    // Teste 5: Testar tabela relatorios_aprovados
    console.log('✓ Teste 5: Consultar relatorios_aprovados...');
    try {
      const relatoriosResult = await pool.query(`
        SELECT id, titulo, cliente_nome, categoria
        FROM relatorios_aprovados
        LIMIT 5
      `);

      if (relatoriosResult.rows.length === 0) {
        console.log('  ⚠️  Tabela relatorios_aprovados existe mas está vazia!\n');
      } else {
        console.log(`  ✅ ${relatoriosResult.rows.length} relatórios encontrados:\n`);
        for (const row of relatoriosResult.rows) {
          console.log(`    - ID: ${row.id}, Título: ${row.titulo}, Cliente: ${row.cliente_nome}`);
        }
        console.log();
      }
    } catch (err) {
      console.log(`  ❌ Erro: ${err.message}\n`);
    }

    console.log('='.repeat(80));
    console.log('✅ Testes concluídos com sucesso!');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.log('\n❌ ERRO DE CONEXÃO:');
    console.log(`\n${error.message}\n`);
    console.log('Possíveis problemas:');
    console.log('  1. Host do banco de dados está incorreto');
    console.log('  2. Credenciais de autenticação estão erradas');
    console.log('  3. Banco de dados não está acessível da rede');
    console.log('  4. Firewall está bloqueando a conexão\n');
  } finally {
    await pool.end();
  }
}

testConnection();
