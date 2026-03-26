'use strict';

const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 8080);

const headerName = (process.env.API_KEY_HEADER || 'x-api-key').toLowerCase();
const tableName = sanitizeIdent(process.env.API_KEYS_TABLE || 'api_keys');
const keyField = sanitizeIdent(process.env.API_KEY_FIELD || 'apikey');
const userField = sanitizeIdent(process.env.API_USER_FIELD || 'user');
const activeField = process.env.API_ACTIVE_FIELD
  ? sanitizeIdent(process.env.API_ACTIVE_FIELD)
  : null;
const logTable = process.env.API_LOG_TABLE
  ? sanitizeIdent(process.env.API_LOG_TABLE)
  : null;

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'html2pdf_credentials',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || '',
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_POOL_CONN_MS || 2000)
});

app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

app.all('/verify', async (req, res) => {
  const apiKey = req.get(headerName);
  if (!apiKey) {
    return res.status(401).send('missing api key');
  }

  const sql = buildLookupQuery(tableName, keyField, userField, activeField);

  try {
    const result = await pool.query(sql, [apiKey]);
    if (result.rowCount === 0) {
      await maybeLog(false, null, apiKey, req);
      return res.status(403).send('invalid api key');
    }

    const row = result.rows[0] || {};
    const apiKeyId = row.id || null;
    const username = row.username || null;
    await maybeLog(true, apiKeyId, apiKey, req, username);

    if (username) {
      res.set('X-Api-User', String(username));
    }
    return res.status(200).send('ok');
  } catch (err) {
    console.error('auth error', err);
    return res.status(500).send('auth error');
  }
});

app.listen(port, () => {
  console.log(`html2pdf-auth listening on ${port}`);
});

function sanitizeIdent(value) {
  const val = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(val)) {
    throw new Error(`Invalid SQL identifier: ${val}`);
  }
  return val;
}

function buildLookupQuery(table, keyFieldName, userFieldName, activeFieldName) {
  const where = activeFieldName
    ? `"${keyFieldName}" = $1 AND "${activeFieldName}" = true`
    : `"${keyFieldName}" = $1`;

  return (
    `SELECT id, "${userFieldName}" as username ` +
    `FROM "${table}" ` +
    `WHERE ${where} ` +
    `LIMIT 1`
  );
}

async function maybeLog(ok, apiKeyId, apiKey, req, username) {
  if (!logTable) return;

  const sql =
    `INSERT INTO "${logTable}" ` +
    `(api_key_id, api_key, username, path, method, ip, ok, created_at) ` +
    `VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`;

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
  try {
    await pool.query(sql, [
      apiKeyId,
      apiKey,
      username || null,
      req.originalUrl || req.url || null,
      req.method || null,
      ip,
      ok
    ]);
  } catch (err) {
    console.error('log error', err);
  }
}
