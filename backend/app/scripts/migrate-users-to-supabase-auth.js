#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.join(__dirname, '..', '.env.development') });

function readEnvOrFile(name) {
  const direct = String(process.env[name] || '').trim();
  if (direct) return direct;

  const filePath = String(process.env[`${name}_FILE`] || '').trim();
  if (!filePath) return '';

  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function getDbConfig() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: String(process.env.DB_SSL || 'false').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: 10000,
  };
}

function getSupabaseAuthUrl() {
  return (
    readEnvOrFile('SUPABASE_AUTH_URL') ||
    process.env.SUPABASE_AUTH_URL ||
    'https://supabase.dev.orgahold.com/auth/v1'
  ).replace(/\/$/, '');
}

function getSupabaseServiceRoleKey() {
  const key = readEnvOrFile('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY nao configurado');
  }
  return key;
}

async function adminCreateUser(baseUrl, apiKey, user) {
  const res = await fetch(`${baseUrl}/admin/users`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: user.email,
      password: user.senha,
      email_confirm: true,
      user_metadata: {
        full_name: user.nome || user.email,
        legacy_user_id: String(user.id),
      },
      app_metadata: {
        role: user.role || (user.admin ? 'admin' : 'analista'),
        admin: Boolean(user.admin),
      },
    }),
  });

  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`createUser ${res.status}: ${payload.msg || payload.error || text}`);
  }
  return payload;
}

async function getLegacyUsers(pool) {
  const result = await pool.query(`
    select
      id,
      email,
      nome,
      admin,
      role,
      senha
    from public."usuariosApp"
    where coalesce(nullif(btrim(email), ''), '') <> ''
    order by id
  `);
  return result.rows;
}

async function getExistingAuthUsers(pool) {
  const result = await pool.query(`
    select
      id,
      lower(email) as email
    from auth.users
    where email is not null
  `);
  return new Map(result.rows.map((row) => [row.email, row.id]));
}

async function clearLegacySecrets(pool, legacyUserId) {
  await pool.query(
    `
      update public."usuariosApp"
      set
        senha = null,
        "loginToken" = null
      where id = $1::bigint
    `,
    [legacyUserId]
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pool = new Pool(getDbConfig());
  const authUrl = getSupabaseAuthUrl();
  const apiKey = getSupabaseServiceRoleKey();

  try {
    const legacyUsers = await getLegacyUsers(pool);
    const existingAuthUsers = await getExistingAuthUsers(pool);

    const summary = {
      totalLegacy: legacyUsers.length,
      created: 0,
      linkedExisting: 0,
      updatedLegacy: 0,
      skippedNoPassword: 0,
      failures: [],
    };

    for (const user of legacyUsers) {
      const normalizedEmail = String(user.email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        continue;
      }

      try {
        let authUserId = existingAuthUsers.get(normalizedEmail) || null;

        if (!authUserId) {
          if (!user.senha || !String(user.senha).trim()) {
            summary.skippedNoPassword += 1;
            summary.failures.push({ email: user.email, reason: 'Usuario sem senha legada para migrar' });
            continue;
          }

          if (!dryRun) {
            const created = await adminCreateUser(authUrl, apiKey, user);
            authUserId = created.id;
            existingAuthUsers.set(normalizedEmail, authUserId);
          }
          summary.created += 1;
        } else {
          summary.linkedExisting += 1;
        }

        if (!dryRun && authUserId) {
          await clearLegacySecrets(pool, user.id);
        }
        summary.updatedLegacy += 1;
      } catch (error) {
        summary.failures.push({
          email: user.email,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(JSON.stringify(summary, null, 2));

    if (summary.failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
