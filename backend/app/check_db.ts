import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'supabase_db',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'ecdb0882661323177373c6270710e676',
  ssl: false
});

async function checkSchema() {
  try {
    console.log('\n🔍 Conectando ao banco de dados...\n');
    
    // Listar todas as tabelas
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('=== TABELAS ENCONTRADAS ===\n');
    for (const row of tablesResult.rows) {
      console.log(`📋 ${row.table_name}`);
    }
    
    // Para cada tabela, listar as colunas
    for (const { table_name } of tablesResult.rows) {
      const columnsResult = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [table_name]);
      
      console.log(`\n📊 Tabela: ${table_name}`);
      console.log('─'.repeat(70));
      for (const col of columnsResult.rows) {
        const nullable = col.is_nullable === 'YES' ? '✓' : '✗';
        console.log(`  ${col.column_name.padEnd(25)} ${col.data_type.padEnd(20)} [NULL: ${nullable}]`);
      }
    }
    
    console.log('\n✅ Schema verificado com sucesso!\n');
  } catch (error: any) {
    console.error('❌ Erro ao conectar ao banco:', error.message);
    console.error('Detalhes:', error);
  } finally {
    await pool.end();
  }
}

checkSchema();
