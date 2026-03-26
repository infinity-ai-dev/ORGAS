#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.join(__dirname, '..', '.env.development') });

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

const ddl = `
create table if not exists public.user_credentials (
  user_id bigint primary key references public."usuariosApp"(id) on delete cascade,
  password_hash text not null,
  password_source text not null default 'migrated_from_auth_users',
  password_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_credentials_password_updated_at_idx
  on public.user_credentials (password_updated_at desc);

create table if not exists public.auth_email_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references public."usuariosApp"(id) on delete cascade,
  user_email text not null,
  purpose text not null check (purpose in ('password_reset', 'magic_link')),
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by_user_id bigint references public."usuariosApp"(id) on delete set null,
  requested_by_ip text,
  requested_user_agent text,
  action_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists auth_email_tokens_token_hash_idx
  on public.auth_email_tokens (token_hash);

create index if not exists auth_email_tokens_user_id_idx
  on public.auth_email_tokens (user_id, created_at desc);

create index if not exists auth_email_tokens_active_idx
  on public.auth_email_tokens (purpose, expires_at)
  where used_at is null;

create table if not exists public.auth_email_events (
  id uuid primary key default gen_random_uuid(),
  user_id bigint references public."usuariosApp"(id) on delete set null,
  user_email text,
  email_type text not null,
  delivery_status text not null check (delivery_status in ('queued', 'sent', 'failed')),
  action_url text,
  metadata jsonb not null default '{}'::jsonb,
  smtp_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists auth_email_events_user_email_idx
  on public.auth_email_events (lower(user_email), created_at desc);
`;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pool = new Pool(getDbConfig());

  try {
    await pool.query('begin');

    await pool.query(ddl);

    const before = await pool.query(
      `
        select count(*)::int as total
        from public.user_credentials
      `
    );

    const migrationResult = await pool.query(
      `
        insert into public.user_credentials (
          user_id,
          password_hash,
          password_source,
          password_updated_at,
          updated_at
        )
        select
          ua.id,
          au.encrypted_password,
          'migrated_from_auth_users',
          now(),
          now()
        from public."usuariosApp" ua
        inner join auth.users au
          on lower(ua.email) = lower(au.email)
        where coalesce(au.encrypted_password, '') <> ''
        on conflict (user_id) do update
        set
          password_hash = excluded.password_hash,
          password_source = excluded.password_source,
          password_updated_at = now(),
          updated_at = now()
        returning user_id
      `
    );

    const after = await pool.query(
      `
        select count(*)::int as total
        from public.user_credentials
      `
    );

    if (dryRun) {
      await pool.query('rollback');
    } else {
      await pool.query('commit');
    }

    console.log(JSON.stringify({
      dryRun,
      credentialsBefore: before.rows?.[0]?.total || 0,
      migratedRows: migrationResult.rowCount || 0,
      credentialsAfter: after.rows?.[0]?.total || 0,
    }, null, 2));
  } catch (error) {
    await pool.query('rollback').catch(() => {});
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
