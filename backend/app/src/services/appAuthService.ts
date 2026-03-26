import crypto from 'crypto';
import { dbQuery, withDbClient } from '../config/database';

export type AppUserRecord = {
  id: string;
  email: string;
  nome: string | null;
  admin: boolean;
  role: string | null;
  created_at?: string | null;
};

export type AuthEmailEventRecord = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  email_type: string;
  delivery_status: string;
  action_url: string | null;
  smtp_message_id: string | null;
  error_message: string | null;
  created_at: string;
};

function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function findAppUserByEmail(email: string): Promise<AppUserRecord | null> {
  const result = await dbQuery(
    `
      select
        id::text as id,
        email,
        nome,
        coalesce(admin, false) as admin,
        role,
        created_at
      from public."usuariosApp"
      where lower(email) = lower($1)
      limit 1
    `,
    [email]
  );

  return result.rows?.[0] || null;
}

export async function findAppUserById(userId: string | number): Promise<AppUserRecord | null> {
  const result = await dbQuery(
    `
      select
        id::text as id,
        email,
        nome,
        coalesce(admin, false) as admin,
        role,
        created_at
      from public."usuariosApp"
      where id = $1::bigint
      limit 1
    `,
    [userId]
  );

  return result.rows?.[0] || null;
}

export async function verifyAppUserPassword(email: string, password: string): Promise<AppUserRecord | null> {
  const result = await dbQuery(
    `
      select
        ua.id::text as id,
        ua.email,
        ua.nome,
        coalesce(ua.admin, false) as admin,
        ua.role,
        ua.created_at
      from public."usuariosApp" ua
      inner join public.user_credentials uc
        on uc.user_id = ua.id
      where lower(ua.email) = lower($1)
        and uc.password_hash is not null
        and uc.password_hash = crypt($2, uc.password_hash)
      limit 1
    `,
    [email, password]
  );

  return result.rows?.[0] || null;
}

export async function listAppUsers(): Promise<AppUserRecord[]> {
  const result = await dbQuery(
    `
      select
        id::text as id,
        email,
        nome,
        coalesce(admin, false) as admin,
        role,
        created_at
      from public."usuariosApp"
      order by created_at desc, id desc
    `
  );

  return result.rows || [];
}

export async function createAppUser(input: {
  nome: string;
  email: string;
  role: string;
  admin: boolean;
  password?: string | null;
}) {
  return withDbClient(async (client) => {
    await client.query('begin');
    try {
      const normalizedEmail = String(input.email || '').trim().toLowerCase();
      const normalizedName = String(input.nome || '').trim();
      const normalizedRole = String(input.role || '').trim().toLowerCase() || 'analista';
      const password = String(input.password || '').trim();

      const existing = await client.query(
        `
          select id
          from public."usuariosApp"
          where lower(email) = lower($1)
          limit 1
        `,
        [normalizedEmail]
      );

      if ((existing.rowCount || 0) > 0) {
        throw new Error('Já existe um usuário com este e-mail');
      }

      await client.query('lock table public."usuariosApp" in share row exclusive mode');
      const nextIdResult = await client.query(
        `select coalesce(max(id), 0) + 1 as next_id from public."usuariosApp"`
      );
      const nextId = Number(nextIdResult.rows?.[0]?.next_id || 1);

      const userInsert = await client.query(
        `
          insert into public."usuariosApp" (
            id,
            created_at,
            nome,
            email,
            admin,
            senha,
            "loginToken",
            role
          )
          values (
            $1::bigint,
            now(),
            $2,
            $3,
            $4,
            null,
            null,
            $5
          )
          returning
            id::text as id,
            email,
            nome,
            coalesce(admin, false) as admin,
            role,
            created_at
        `,
        [nextId, normalizedName, normalizedEmail, input.admin, normalizedRole]
      );

      if (password) {
        await client.query(
          `
            insert into public.user_credentials (
              user_id,
              password_hash,
              password_source,
              password_updated_at,
              updated_at
            )
            values (
              $1::bigint,
              crypt($2, gen_salt('bf', 10)),
              'admin_create_user',
              now(),
              now()
            )
            on conflict (user_id) do update
            set
              password_hash = excluded.password_hash,
              password_source = excluded.password_source,
              password_updated_at = now(),
              updated_at = now()
          `,
          [nextId, password]
        );
      }

      await client.query('commit');
      return userInsert.rows?.[0] || null;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  });
}

export async function updateAppUserRole(userId: string | number, role: string) {
  const normalizedRole = String(role || '').trim().toLowerCase() || 'user';
  const admin = normalizedRole === 'admin';

  const result = await dbQuery(
    `
      update public."usuariosApp"
      set
        role = $2,
        admin = $3
      where id = $1::bigint
      returning
        id::text as id,
        email,
        nome,
        coalesce(admin, false) as admin,
        role,
        created_at
    `,
    [userId, normalizedRole, admin]
  );

  return result.rows?.[0] || null;
}

export async function setAppUserPassword(userId: string | number, password: string, options?: { source?: string | null }) {
  await dbQuery(
    `
      insert into public.user_credentials (
        user_id,
        password_hash,
        password_source,
        password_updated_at,
        updated_at
      )
      values (
        $1::bigint,
        crypt($2, gen_salt('bf', 10)),
        coalesce($3, 'manual_admin_reset'),
        now(),
        now()
      )
      on conflict (user_id) do update
      set
        password_hash = excluded.password_hash,
        password_source = excluded.password_source,
        password_updated_at = now(),
        updated_at = now()
    `,
    [userId, password, options?.source || null]
  );
}

export async function issueEmailToken(options: {
  userId: string | number;
  userEmail: string;
  purpose: 'password_reset' | 'magic_link';
  expiresInSeconds: number;
  createdByUserId?: string | null;
  requestedByIp?: string | null;
  requestedUserAgent?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashOpaqueToken(rawToken);

  const result = await dbQuery(
    `
      insert into public.auth_email_tokens (
        user_id,
        user_email,
        purpose,
        token_hash,
        expires_at,
        created_by_user_id,
        requested_by_ip,
        requested_user_agent,
        action_url,
        metadata
      )
      values (
        $1::bigint,
        $2,
        $3,
        $4,
        now() + make_interval(secs => $5::int),
        nullif($6, '')::bigint,
        nullif($7, ''),
        nullif($8, ''),
        nullif($9, ''),
        coalesce($10::jsonb, '{}'::jsonb)
      )
      returning
        id::text as id,
        expires_at,
        action_url
    `,
    [
      options.userId,
      options.userEmail,
      options.purpose,
      tokenHash,
      options.expiresInSeconds,
      options.createdByUserId || '',
      options.requestedByIp || '',
      options.requestedUserAgent || '',
      options.actionUrl || '',
      JSON.stringify(options.metadata || {}),
    ]
  );

  return {
    rawToken,
    id: result.rows?.[0]?.id || null,
    expiresAt: result.rows?.[0]?.expires_at || null,
    actionUrl: result.rows?.[0]?.action_url || options.actionUrl || null,
  };
}

export async function consumeEmailToken(rawToken: string, purpose: 'password_reset' | 'magic_link') {
  const tokenHash = hashOpaqueToken(rawToken);
  const result = await dbQuery(
    `
      update public.auth_email_tokens aet
      set
        used_at = now(),
        updated_at = now()
      where aet.token_hash = $1
        and aet.purpose = $2
        and aet.used_at is null
        and aet.expires_at > now()
      returning
        aet.id::text as id,
        aet.user_id::text as user_id,
        aet.user_email,
        aet.action_url,
        aet.metadata,
        aet.expires_at
    `,
    [tokenHash, purpose]
  );

  return result.rows?.[0] || null;
}

export async function logAuthEmailEvent(options: {
  userId?: string | number | null;
  userEmail?: string | null;
  emailType: string;
  deliveryStatus: 'queued' | 'sent' | 'failed';
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  smtpMessageId?: string | null;
  errorMessage?: string | null;
}) {
  const result = await dbQuery(
    `
      insert into public.auth_email_events (
        user_id,
        user_email,
        email_type,
        delivery_status,
        action_url,
        metadata,
        smtp_message_id,
        error_message
      )
      values (
        nullif($1, '')::bigint,
        nullif($2, ''),
        $3,
        $4,
        nullif($5, ''),
        coalesce($6::jsonb, '{}'::jsonb),
        nullif($7, ''),
        nullif($8, '')
      )
      returning id::text as id
    `,
    [
      options.userId ? String(options.userId) : '',
      options.userEmail || '',
      options.emailType,
      options.deliveryStatus,
      options.actionUrl || '',
      JSON.stringify(options.metadata || {}),
      options.smtpMessageId || '',
      options.errorMessage || '',
    ]
  );

  return result.rows?.[0]?.id || null;
}

export async function listAuthEmailEvents(limit = 20, email?: string): Promise<AuthEmailEventRecord[]> {
  const normalizedLimit = Math.max(1, Math.min(limit, 100));
  if (email && String(email).trim()) {
    const result = await dbQuery(
      `
        select
          id::text as id,
          user_id::text as user_id,
          user_email,
          email_type,
          delivery_status,
          action_url,
          smtp_message_id,
          error_message,
          created_at
        from public.auth_email_events
        where lower(user_email) = lower($1)
        order by created_at desc
        limit $2
      `,
      [email, normalizedLimit]
    );
    return result.rows || [];
  }

  const result = await dbQuery(
    `
      select
        id::text as id,
        user_id::text as user_id,
        user_email,
        email_type,
        delivery_status,
        action_url,
        smtp_message_id,
        error_message,
        created_at
      from public.auth_email_events
      order by created_at desc
      limit $1
    `,
    [normalizedLimit]
  );

  return result.rows || [];
}
