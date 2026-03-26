import './env';
import { Pool, PoolClient, PoolConfig } from 'pg';

const useInternalPg = (process.env.USE_INTERNAL_PG || 'false').toLowerCase() === 'true';

let supabasePool: Pool | null = null;
let reportsPool: Pool | null = null;

/**
 * Parse connection string and return pool config
 * Supports: postgresql://user:password@host:port/database?sslmode=require
 */
function parseConnectionString(connectionString: string): PoolConfig {
  const url = new URL(connectionString);

  return {
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : 5432,
    database: url.pathname.slice(1) || 'postgres',
    user: url.username || 'postgres',
    password: url.password || '',
    ssl: url.searchParams.get('sslmode') === 'require' ? { rejectUnauthorized: false } : false,
  };
}

/**
 * Get pool configuration from either DATABASE_URL or individual env vars
 */
function getPoolConfig(prefix = ''): PoolConfig {
  const envPrefix = prefix ? `${prefix}_` : '';

  // Try DATABASE_URL first (supports both direct and transaction pooler)
  const databaseUrl = process.env[`${envPrefix}DATABASE_URL`];
  if (databaseUrl) {
    console.log(`ℹ️ Using ${envPrefix}DATABASE_URL for database connection`);
    return parseConnectionString(databaseUrl);
  }

  // Fallback to individual env vars
  const serviceRoleKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_SECRET ||
    process.env.SERVICE_ROLE_KEY ||
    ''
  ).trim();

  return {
    host: process.env[`${envPrefix}DB_HOST`] || 'supabase_db',
    port: parseInt(process.env[`${envPrefix}DB_PORT`] || '5432', 10),
    database: process.env[`${envPrefix}DB_NAME`] || 'postgres',
    user: process.env[`${envPrefix}DB_USER`] || 'postgres',
    password: process.env[`${envPrefix}DB_PASSWORD`] || serviceRoleKey || '',
    ssl: (process.env[`${envPrefix}DB_SSL`] || 'false').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false,
  };
}

if (useInternalPg) {
  const supabaseCfg = getPoolConfig('');
  const poolMax = parseInt(process.env.DB_POOL_MAX || '10', 10);

  supabasePool = new Pool({
    ...supabaseCfg,
    max: poolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  supabasePool.on('error', (err) => {
    console.error('🔴 Supabase pool error:', err);
  });

  // Check if reports DB has separate configuration
  const hasReportsOverride = Boolean(
    process.env.REPORTS_DATABASE_URL ||
    process.env.REPORTS_DB_HOST ||
    process.env.REPORTS_DB_PORT ||
    process.env.REPORTS_DB_NAME ||
    process.env.REPORTS_DB_USER ||
    process.env.REPORTS_DB_PASSWORD ||
    process.env.REPORTS_DB_SSL ||
    process.env.REPORTS_DB_POOL_MAX
  );

  if (hasReportsOverride) {
    const reportsCfg = getPoolConfig('REPORTS');
    const reportsPoolMax = parseInt(process.env.REPORTS_DB_POOL_MAX || process.env.DB_POOL_MAX || '10', 10);

    reportsPool = new Pool({
      ...reportsCfg,
      max: reportsPoolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    reportsPool.on('error', (err) => {
      console.error('🔴 Reports pool error:', err);
    });
  } else {
    reportsPool = supabasePool;
  }
}

export async function dbQuery(text: string, params?: unknown[]) {
  if (!supabasePool) {
    throw new Error('Supabase pool não configurado. Defina USE_INTERNAL_PG=true e DB_HOST + SUPABASE_SERVICE_ROLE_KEY (ou DB_PASSWORD).');
  }
  const client = await supabasePool.connect();
  try {
    const res = await client.query(text, params);
    return { rows: res.rows };
  } finally {
    client.release();
  }
}

export async function withDbClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!supabasePool) {
    throw new Error('Supabase pool não configurado. Defina USE_INTERNAL_PG=true e DB_HOST + SUPABASE_SERVICE_ROLE_KEY (ou DB_PASSWORD).');
  }

  const client = await supabasePool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function reportsQuery(text: string, params?: unknown[]) {
  if (!reportsPool) {
    throw new Error('Reports pool não configurado. Defina USE_INTERNAL_PG=true e variáveis REPORTS_DB_* (ou use DB_*).');
  }
  const client = await reportsPool.connect();
  try {
    const res = await client.query(text, params);
    return { rows: res.rows };
  } finally {
    client.release();
  }
}

export function isPgEnabled() {
  return !!supabasePool;
}

export function isReportsDbEnabled() {
  return !!reportsPool;
}
