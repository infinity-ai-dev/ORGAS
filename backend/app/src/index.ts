/**
 * ORGAS Backend API v2.0.44
 * Express + TypeScript
 *
 * Integração com:
 * - PostgreSQL/Supabase para dados
 * - Redis para cache
 * - Agente IA em Python (FastAPI) para análises
 */

import './config/env';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { dbQuery, reportsQuery, isPgEnabled, isReportsDbEnabled } from './config/database';
import { gerarHtmlParecer } from './reports/parecerTemplate';
import { generatePdfFromHtml } from './reports/pdfService';
import {
  saveRelatorioPendente,
  getRelatoriosPendentes,
  getRelatoriosAprovados,
  getRelatoriosReprovados,
  getRelatorioDetalhes,
  aprovarRelatorio,
  reprovarRelatorio,
  getFeedbackStats,
  getProblematicFields,
  type AgentResponse as ApprovalAgentResponse,
} from './services/approvalService';
import {
  consumeEmailToken,
  createAppUser,
  findAppUserByEmail,
  findAppUserById,
  issueEmailToken,
  listAuthEmailEvents,
  listAppUsers,
  logAuthEmailEvent,
  setAppUserPassword,
  updateAppUserRole,
  verifyAppUserPassword,
} from './services/appAuthService';
import { getSmtpSummary, sendEmail } from './services/emailService';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProduction = (process.env.NODE_ENV || 'development') === 'production';

app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÕES
// ─────────────────────────────────────────────────────────────────────────

const AUTH_REQUIRED = (process.env.AUTH_REQUIRED || 'true').toLowerCase() === 'true';
const ALLOW_LEGACY_TOKEN = (process.env.ALLOW_LEGACY_TOKEN || 'true').toLowerCase() === 'true';
const ENABLE_ADMIN_ROUTES = (process.env.ENABLE_ADMIN_ROUTES || 'false').toLowerCase() === 'true';
const REQUIRE_HANDSHAKE = (process.env.REQUIRE_HANDSHAKE || 'false').toLowerCase() === 'true';
const JWT_ISSUER = process.env.JWT_ISSUER || 'orgas-api';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'orgas-app';
const JWT_EXPIRES_IN = parseInt(process.env.JWT_EXPIRES_IN || '604800', 10);
const JWT_HANDSHAKE_TTL = parseInt(process.env.JWT_HANDSHAKE_TTL || '60', 10);
const JWT_DOWNLOAD_TTL = parseInt(process.env.JWT_DOWNLOAD_TTL || '120', 10);
const AUTH_MAGIC_LINK_TTL = parseInt(process.env.AUTH_MAGIC_LINK_TTL || '900', 10);
const AUTH_RESET_TTL = parseInt(process.env.AUTH_RESET_TTL || '1800', 10);

// Agente IA Python
let AGENT_API_URL = (process.env.AGENT_API_URL || 'http://orgas-ai-agents:8000').trim();
// Remove trailing /api se existir, pois vamos adicionar /agent depois
AGENT_API_URL = AGENT_API_URL.replace(/\/api\/?$/, '');
const AGENT_API_TIMEOUT = parseInt(process.env.AGENT_API_TIMEOUT || '180000', 10);

// ─────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────

app.use(cors({
  origin: getFrontendUrl(),
  credentials: true
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Middleware de autenticação
app.use((req, res, next) => {
  if (!AUTH_REQUIRED) {
    return next();
  }

  // Rotas públicas (sem autenticação necessária)
  // Nota: O Traefik remove o prefixo /api, então as rotas aqui não têm /api
  const publicPaths = [
    '/health',
    '/',
    '/webhook/ai-submit',
    // Autenticação
    '/auth/handshake',
    '/auth/login',
    '/auth/signin',
    '/auth/logout',
    '/auth/reset-password',
    '/auth/magic-link/consume',
    '/login',
    '/signin',
    '/signup',
    '/register',
    '/forgot-password',
    '/reset-password'
  ];

  // Verifica se o caminho é público (exato ou prefixo)
  const isPublicPath = publicPaths.some(path =>
    req.path === path || req.path.startsWith(path + '/')
  );

  const isPublicDownloadPath =
    req.method === 'GET' && /^\/relatorios\/[^/]+\/pdf-download$/.test(req.path);

  if (isPublicPath || isPublicDownloadPath) {
    return next();
  }

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const verifiedIdentity = getVerifiedJwtIdentity(token);
  if (verifiedIdentity) {
    setRequestAuthIdentity(req, verifiedIdentity);
    return next();
  }

  const staticTokenIdentity = getStaticTokenIdentity(token);
  if (staticTokenIdentity) {
    setRequestAuthIdentity(req, staticTokenIdentity);
    return next();
  }

  res.status(403).json({ error: 'Token inválido' });
});

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

function readEnvOrFile(name: string): string {
  const direct = (process.env[name] || '').trim();
  if (direct) return direct;

  const fileVar = `${name}_FILE`;
  const filePath = (process.env[fileVar] || '').trim();
  if (!filePath) return '';

  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function getFrontendUrl(): string {
  const fallback = isProduction ? 'https://app.orgahold.com' : 'http://localhost:8080';
  return (process.env.FRONTEND_URL || fallback).trim();
}

function getStaticAuthTokens(): string[] {
  const raw = readEnvOrFile('AUTH_STATIC_TOKENS');
  if (!raw) return [];
  return raw.split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getAgentServiceToken(): string {
  const token = readEnvOrFile('AI_AGENT_TOKEN') || readEnvOrFile('AGENT_API_KEY');
  if (!token && isProduction) {
    throw new Error('AI_AGENT_TOKEN não configurado para comunicação com o agente');
  }
  return token || 'orgas-ai-agent-dev-token';
}

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return auth.substring(7);
  }
  return (req.query.token as string) || null;
}

function getHeaderString(req: Request, headerName: string): string {
  const value = req.headers[headerName.toLowerCase()];
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  return '';
}

type AuthIdentity = {
  email?: string;
  nome?: string;
  sub?: string;
  role?: string;
  admin?: boolean;
};

type RequestWithAuthIdentity = Request & {
  authIdentity?: AuthIdentity;
};

function normalizeAppRole(role: unknown): string | undefined {
  const normalized = String(role || '').trim().toLowerCase();
  if (!normalized) return undefined;

  if (normalized === 'administrador' || normalized === 'administrator') {
    return 'admin';
  }
  if (normalized === 'desenvolvedor' || normalized === 'developer' || normalized === 'dev') {
    return 'analista';
  }

  return normalized;
}

function setRequestAuthIdentity(req: Request, authIdentity: AuthIdentity) {
  (req as RequestWithAuthIdentity).authIdentity = authIdentity;
}

function getRequestAuthIdentity(req: Request): AuthIdentity | undefined {
  return (req as RequestWithAuthIdentity).authIdentity;
}

function buildAuthIdentityFromJwtPayload(decoded: jwt.JwtPayload | Record<string, any>): AuthIdentity {
  return {
    email: typeof decoded.email === 'string' ? decoded.email : undefined,
    nome:
      typeof decoded.nome === 'string'
        ? decoded.nome
        : typeof decoded.name === 'string'
          ? decoded.name
          : undefined,
    sub: typeof decoded.sub === 'string' ? decoded.sub : undefined,
    role: normalizeAppRole(
      typeof decoded.role === 'string'
        ? decoded.role
        : typeof decoded.cargo === 'string'
          ? decoded.cargo
          : undefined
    ),
    admin: decoded.admin === true,
  };
}

function verifyJwtPayload(token: string): jwt.JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });

    if (!decoded || typeof decoded !== 'object') {
      return null;
    }

    return decoded as jwt.JwtPayload;
  } catch {
    return null;
  }
}

function getVerifiedJwtIdentity(token: string): AuthIdentity | null {
  const payload = verifyJwtPayload(token);
  return payload ? buildAuthIdentityFromJwtPayload(payload) : null;
}

function getStaticTokenIdentity(token: string): AuthIdentity | null {
  const staticTokens = getStaticAuthTokens();
  if (staticTokens.length > 0 && staticTokens.includes(token)) {
    return {
      sub: 'static-token',
      role: 'service',
      admin: false,
    };
  }

  return null;
}

function hasValidFrontendProxySecret(req: Request): boolean {
  const expected = readEnvOrFile('FRONTEND_PROXY_SECRET');
  const received = getHeaderString(req, 'x-frontend-secret');
  if (!expected || !received) {
    return false;
  }
  return safeEquals(received, expected);
}

function hasValidWebhookToken(req: Request): boolean {
  const expected = readEnvOrFile('WEBHOOK_TOKEN');
  const received = extractToken(req);
  if (!expected || !received) {
    return false;
  }
  return safeEquals(received, expected);
}

function extractAuthIdentity(req: Request): AuthIdentity {
  const requestIdentity = getRequestAuthIdentity(req);
  if (requestIdentity) {
    return requestIdentity;
  }

  const token = extractToken(req);
  if (!token) return {};

  const verifiedIdentity = getVerifiedJwtIdentity(token);
  if (verifiedIdentity) {
    return verifiedIdentity;
  }

  return getStaticTokenIdentity(token) || {};
}

async function resolveAuthIdentity(req: Request): Promise<AuthIdentity> {
  const baseIdentity = extractAuthIdentity(req);
  const email = pickFirstNonEmptyString(baseIdentity.email);

  if (!email) {
    return baseIdentity;
  }

  try {
    const result = await dbQuery(
      'SELECT email, nome, admin, role FROM "usuariosApp" WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email]
    );

    const user = result.rows?.[0];
    if (!user) {
      return baseIdentity;
    }

    return {
      ...baseIdentity,
      email: user.email || email,
      nome: pickFirstNonEmptyString(user.nome, baseIdentity.nome) || undefined,
      role: normalizeAppRole(user.role || (user.admin ? 'admin' : baseIdentity.role)) || baseIdentity.role,
      admin: Boolean(user.admin),
    };
  } catch (error: any) {
    console.error('Erro ao resolver identidade autenticada:', error.message);
    return baseIdentity;
  }
}

function canViewAllReports(authIdentity: AuthIdentity) {
  const role = normalizeAppRole(authIdentity.role);
  return authIdentity.admin === true || role === 'admin' || role === 'revisor';
}

function canManageAuth(authIdentity: AuthIdentity) {
  const role = normalizeAppRole(authIdentity.role);
  return authIdentity.admin === true || role === 'admin';
}

function getRequestIp(req: Request): string | null {
  const forwarded = getHeaderString(req, 'x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || null;
  }

  return req.ip || null;
}

function buildFrontendAuthUrl(mode: 'magic' | 'reset', token: string): string {
  const url = new URL('/auth', getFrontendUrl());
  url.searchParams.set('mode', mode);
  url.searchParams.set('token', token);
  return url.toString();
}

function buildMagicLinkEmail(input: { nome?: string | null; actionUrl: string; expiresInSeconds: number }) {
  const recipientName = pickFirstNonEmptyString(input.nome, 'usuário') || 'usuário';
  const minutes = Math.max(1, Math.round(input.expiresInSeconds / 60));
  return {
    subject: 'ORGAS | Link de acesso',
    text:
      `Olá, ${recipientName}.\n\n` +
      `Use o link abaixo para acessar sua conta no ORGAS:\n${input.actionUrl}\n\n` +
      `Este link expira em ${minutes} minuto(s).\n\n` +
      `Se você não solicitou este acesso, ignore este e-mail.`,
    html:
      `<p>Olá, ${recipientName}.</p>` +
      `<p>Use o link abaixo para acessar sua conta no ORGAS:</p>` +
      `<p><a href="${input.actionUrl}">${input.actionUrl}</a></p>` +
      `<p>Este link expira em ${minutes} minuto(s).</p>` +
      `<p>Se você não solicitou este acesso, ignore este e-mail.</p>`,
  };
}

function buildPasswordResetEmail(input: { nome?: string | null; actionUrl: string; expiresInSeconds: number }) {
  const recipientName = pickFirstNonEmptyString(input.nome, 'usuário') || 'usuário';
  const minutes = Math.max(1, Math.round(input.expiresInSeconds / 60));
  return {
    subject: 'ORGAS | Redefinição de senha',
    text:
      `Olá, ${recipientName}.\n\n` +
      `Use o link abaixo para redefinir sua senha no ORGAS:\n${input.actionUrl}\n\n` +
      `Este link expira em ${minutes} minuto(s).\n\n` +
      `Se você não solicitou esta redefinição, ignore este e-mail.`,
    html:
      `<p>Olá, ${recipientName}.</p>` +
      `<p>Use o link abaixo para redefinir sua senha no ORGAS:</p>` +
      `<p><a href="${input.actionUrl}">${input.actionUrl}</a></p>` +
      `<p>Este link expira em ${minutes} minuto(s).</p>` +
      `<p>Se você não solicitou esta redefinição, ignore este e-mail.</p>`,
  };
}

async function sendAuthEmail(options: {
  user: { id: string; email: string; nome?: string | null };
  purpose: 'password_reset' | 'magic_link';
  authIdentity?: AuthIdentity | null;
  req: Request;
}) {
  const expiresInSeconds = options.purpose === 'magic_link' ? AUTH_MAGIC_LINK_TTL : AUTH_RESET_TTL;
  const issued = await issueEmailToken({
    userId: options.user.id,
    userEmail: options.user.email,
    purpose: options.purpose,
    expiresInSeconds,
    createdByUserId: null,
    requestedByIp: getRequestIp(options.req),
    requestedUserAgent: getHeaderString(options.req, 'user-agent'),
    metadata: {
      created_by_email: options.authIdentity?.email || null,
      created_by_name: options.authIdentity?.nome || null,
    },
  });

  const mode = options.purpose === 'magic_link' ? 'magic' : 'reset';
  const actionUrl = buildFrontendAuthUrl(mode, issued.rawToken);
  const emailContent = options.purpose === 'magic_link'
    ? buildMagicLinkEmail({
        nome: options.user.nome,
        actionUrl,
        expiresInSeconds,
      })
    : buildPasswordResetEmail({
        nome: options.user.nome,
        actionUrl,
        expiresInSeconds,
      });

  try {
    const delivery = await sendEmail({
      to: options.user.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    await logAuthEmailEvent({
      userId: options.user.id,
      userEmail: options.user.email,
      emailType: options.purpose,
      deliveryStatus: 'sent',
      actionUrl,
      smtpMessageId: delivery.messageId,
      metadata: {
        token_id: issued.id,
        expires_at: issued.expiresAt,
      },
    });
  } catch (emailError: any) {
    await logAuthEmailEvent({
      userId: options.user.id,
      userEmail: options.user.email,
      emailType: options.purpose,
      deliveryStatus: 'failed',
      actionUrl,
      errorMessage: emailError.message,
      metadata: {
        token_id: issued.id,
        expires_at: issued.expiresAt,
      },
    });
    throw emailError;
  }

  return {
    actionUrl,
    expiresAt: issued.expiresAt,
  };
}

function normalizeComparableEmail(value: unknown) {
  const email = pickFirstNonEmptyString(value);
  return email ? email.trim().toLowerCase() : null;
}

function extractReportOwner(row: any) {
  const responseData = ensureObject(row?.response_data);
  const secoesJson = ensureObject(row?.secoes_json);
  const responseCriador = ensureObject(responseData?.criador);
  const secoesCriador = ensureObject(secoesJson?.criador);
  const responseMeta = ensureObject(responseData?.meta);
  const secoesMeta = ensureObject(secoesJson?.meta);

  return {
    email: pickFirstNonEmptyString(
      row?.user_email,
      responseData?.user_email,
      responseData?.owner_email,
      responseData?.analista_email,
      responseCriador?.email,
      responseMeta?.user_email,
      secoesJson?.user_email,
      secoesJson?.owner_email,
      secoesJson?.analista_email,
      secoesCriador?.email,
      secoesMeta?.user_email,
      row?.analista_email
    ),
    nome: pickFirstNonEmptyString(
      row?.user_name,
      responseData?.user_name,
      responseData?.owner_name,
      responseData?.analista_nome,
      responseCriador?.nome,
      secoesJson?.user_name,
      secoesJson?.owner_name,
      secoesJson?.analista_nome,
      secoesCriador?.nome,
      row?.analista_nome
    ),
  };
}

function canAccessReportRow(row: any, authIdentity: AuthIdentity) {
  if (canViewAllReports(authIdentity)) {
    return true;
  }

  const viewerEmail = normalizeComparableEmail(authIdentity.email);
  if (!viewerEmail) {
    return false;
  }

  const owner = extractReportOwner(row);
  return normalizeComparableEmail(owner.email) === viewerEmail;
}

function filterReportRowsByAccess<T>(rows: T[], authIdentity: AuthIdentity) {
  if (canViewAllReports(authIdentity)) {
    return rows;
  }

  return rows.filter((row) => canAccessReportRow(row, authIdentity));
}

async function resolveAccessibleApprovalReport(
  req: Request,
  relatorioId: string
): Promise<{ authIdentity: AuthIdentity; relatorio: any | null }> {
  const authIdentity = await resolveAuthIdentity(req);
  const relatorio = await getRelatorioDetalhes(relatorioId);

  if (!relatorio) {
    return { authIdentity, relatorio: null };
  }

  if (!canAccessReportRow(relatorio, authIdentity)) {
    return { authIdentity, relatorio: null };
  }

  return { authIdentity, relatorio };
}

async function getResolvedReportAccess(req: Request, relatorioId: string) {
  const authIdentity = await resolveAuthIdentity(req);
  const unrestricted = canViewAllReports(authIdentity);

  const resolvedApprovalId = await resolveApprovalWorkflowRelatorioId(relatorioId);
  if (resolvedApprovalId) {
    const relatorio = await getRelatorioDetalhes(resolvedApprovalId);
    return {
      allowed: Boolean(relatorio && (unrestricted || canAccessReportRow(relatorio, authIdentity))),
      exists: Boolean(relatorio),
    };
  }

  const legacyResult = await dbQuery(
    `
      SELECT
        id,
        analista_nome,
        analista_email,
        secoes_json
      FROM public.relatorios_aprovados
      WHERE id::text = $1::text
      LIMIT 1
    `,
    [relatorioId]
  );

  const legacyRow = legacyResult.rows?.[0];
  return {
    allowed: Boolean(legacyRow && (unrestricted || canAccessReportRow(legacyRow, authIdentity))),
    exists: Boolean(legacyRow),
  };
}

function generateMockToken(email: string, options?: { nome?: string | null; role?: string | null; admin?: boolean | null }): string {
  const normalizedRole = normalizeAppRole(options?.role) || (options?.admin ? 'admin' : 'user');
  const payload = {
    sub: email.split('@')[0],
    email,
    role: normalizedRole,
    nome: pickFirstNonEmptyString(options?.nome, email.split('@')[0]) || email.split('@')[0],
    admin: options?.admin === true || normalizedRole === 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRES_IN,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE
  };

  return jwt.sign(payload, getJwtSecret());
}

function getJwtSecret(): string {
  const secret = readEnvOrFile('JWT_SECRET');
  if (secret) {
    return secret;
  }

  if (isProduction) {
    throw new Error('JWT_SECRET não configurado');
  }

  return 'orgas-handshake-dev-secret';
}

function generateHandshakeToken(): string {
  return jwt.sign(
    { type: 'handshake' },
    getJwtSecret(),
    {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: JWT_HANDSHAKE_TTL
    }
  );
}

function generateDownloadToken(reportId: string): string {
  return jwt.sign(
    {
      type: 'report_pdf_download',
      reportId: String(reportId),
    },
    getJwtSecret(),
    {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: JWT_DOWNLOAD_TTL,
    }
  );
}

function pickFirstNonEmptyString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function ensureObject(value: unknown): Record<string, any> {
  if (!value) return {};

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
      return {};
    } catch {
      return {};
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }

  return {};
}

function sanitizeFileNamePart(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function buildReportFileName(input: {
  explicitName?: string | null;
  clienteNome?: string | null;
  tipoParecer?: string | null;
  competencia?: string | null;
}) {
  const explicitName = pickFirstNonEmptyString(input.explicitName);
  if (explicitName) {
    return explicitName.toLowerCase().endsWith('.pdf') ? explicitName : `${explicitName}.pdf`;
  }

  const tipo = sanitizeFileNamePart(input.tipoParecer, 'relatorio');
  const cliente = sanitizeFileNamePart(input.clienteNome, 'cliente');
  const competencia = sanitizeFileNamePart(
    String(input.competencia || '').replace(/\//g, '-'),
    'sem_competencia'
  );

  return `PARECER_${tipo}_${cliente}_${competencia}.pdf`;
}

type ResolvedReportDocument = {
  html: string;
  fileName: string;
  source: 'legacy' | 'approval';
  url?: string | null;
};

async function resolveReportDocument(relatorioId: string): Promise<ResolvedReportDocument | null> {
  const legacyResult = await dbQuery(
    `
      SELECT
        id,
        arquivo_nome,
        arquivo_url,
        html_content,
        secoes_json,
        cliente_nome,
        competencia,
        type,
        relatorio_type
      FROM relatorios_aprovados
      WHERE id = $1
      LIMIT 1
    `,
    [relatorioId]
  );

  const legacyRow = legacyResult.rows?.[0];
  if (legacyRow) {
    const html =
      pickFirstNonEmptyString(legacyRow.html_content) ||
      gerarHtmlParecer({ secoes_json: legacyRow.secoes_json });

    return {
      html,
      fileName: buildReportFileName({
        explicitName: legacyRow.arquivo_nome,
        clienteNome: legacyRow.cliente_nome,
        tipoParecer: legacyRow.type || legacyRow.relatorio_type,
        competencia: legacyRow.competencia,
      }),
      source: 'legacy',
      url: legacyRow.arquivo_url || null,
    };
  }

  if (!isReportsDbEnabled()) {
    return null;
  }

  const approvalResult = await reportsQuery(
    `
      SELECT
        rap.id,
        rap.request_id,
        rap.cliente_nome,
        rap.tipo_parecer,
        rap.response_data,
        rap.data_geracao,
        ra.id AS aprovado_id
      FROM public.relatorios_em_aprovacao rap
      LEFT JOIN public.relatorios_aprovados ra
        ON COALESCE(
          NULLIF(to_jsonb(ra)->>'relatorio_id', ''),
          NULLIF(to_jsonb(ra)->>'relatorio_original_id', '')
        ) = rap.id::text
      WHERE rap.id = $1 OR ra.id = $1
      ORDER BY rap.data_geracao DESC
      LIMIT 1
    `,
    [relatorioId]
  );

  const approvalRow = approvalResult.rows?.[0];
  if (!approvalRow) {
    return null;
  }

  const responseData = ensureObject(approvalRow.response_data);
  const dadosCabecalho = ensureObject(responseData.dadosCabecalho);
  const html =
    pickFirstNonEmptyString(responseData.html_output, responseData.htmlOutput) ||
    gerarHtmlParecer({ secoes_json: responseData });

  return {
    html,
    fileName: buildReportFileName({
      explicitName: pickFirstNonEmptyString(responseData.arquivo_nome, responseData.fileName),
      clienteNome: pickFirstNonEmptyString(
        approvalRow.cliente_nome,
        responseData.cliente_nome,
        responseData.clientName,
        dadosCabecalho.clienteNome,
        dadosCabecalho.razaoSocial,
        dadosCabecalho.razao_social
      ),
      tipoParecer: pickFirstNonEmptyString(
        approvalRow.tipo_parecer,
        responseData.tipo_parecer,
        responseData.tipoParecer,
        responseData.agent
      ),
      competencia: pickFirstNonEmptyString(
        responseData.competencia,
        dadosCabecalho.competencia,
        dadosCabecalho.periodoApuracao,
        dadosCabecalho.periodo
      ),
    }),
    source: 'approval',
    url: null,
  };
}

function normalizeHistoricoAcao(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'criado';

  if (normalized === 'em_aprovacao') return 'enviado_aprovacao';
  if (normalized === 'observacoes_alteradas') return 'comentario_atualizado';

  return normalized;
}

function inferHistoricoStatus(acao: string) {
  switch (acao) {
    case 'aprovado':
      return 'aprovado';
    case 'rejeitado':
    case 'reprovado':
      return 'rejeitado';
    case 'enviado_aprovacao':
      return 'pendente_aprovacao';
    case 'comentario_atualizado':
      return 'pendente_aprovacao';
    default:
      return 'pendente_aprovacao';
  }
}

function getAnalystCommentFromPayload(rawValue: unknown) {
  const payload = ensureObject(rawValue);
  const comentarios = ensureObject(payload.comentarios);
  const dadosSecao9 = ensureObject(payload.dadosSecao9);

  return {
    comentario: pickFirstNonEmptyString(
      dadosSecao9.comentario,
      dadosSecao9.observacoes,
      comentarios.analista
    ),
    analista: pickFirstNonEmptyString(
      dadosSecao9.analista,
      payload.aprovado_por,
      payload.analista_nome
    ),
    dataComentario: pickFirstNonEmptyString(
      dadosSecao9.dataComentario,
      dadosSecao9.data_comentario
    ),
  };
}

function buildPayloadWithAnalystComment(
  rawValue: unknown,
  comentario: string,
  analista: string,
  dataComentario: string
) {
  const payload = ensureObject(rawValue);
  const comentarios = ensureObject(payload.comentarios);
  const dadosSecao9 = ensureObject(payload.dadosSecao9);

  return {
    ...payload,
    comentarios: {
      ...comentarios,
      analista: comentario,
    },
    dadosSecao9: {
      ...dadosSecao9,
      titulo: pickFirstNonEmptyString(dadosSecao9.titulo, 'Comentário do Analista') || 'Comentário do Analista',
      comentario,
      observacoes: comentario,
      analista,
      dataComentario,
    },
  };
}

async function resolveApprovalWorkflowRelatorioId(relatorioId: string): Promise<string | null> {
  const pendingResult = await reportsQuery(
    `
      SELECT id
      FROM public.relatorios_em_aprovacao
      WHERE id::text = $1::text
      LIMIT 1
    `,
    [relatorioId]
  );

  if (pendingResult.rows?.[0]?.id != null) {
    return String(pendingResult.rows[0].id);
  }

  const approvedResult = await dbQuery(
    `
      SELECT
        COALESCE(
          NULLIF(to_jsonb(ra)->>'relatorio_id', ''),
          NULLIF(to_jsonb(ra)->>'relatorio_original_id', ''),
          to_jsonb(ra)->>'id'
        ) AS relatorio_id
      FROM public.relatorios_aprovados ra
      WHERE to_jsonb(ra)->>'id' = $1::text
         OR COALESCE(
              NULLIF(to_jsonb(ra)->>'relatorio_id', ''),
              NULLIF(to_jsonb(ra)->>'relatorio_original_id', '')
            ) = $1::text
      LIMIT 1
    `,
    [relatorioId]
  );

  if (approvedResult.rows?.[0]?.relatorio_id) {
    return String(approvedResult.rows[0].relatorio_id);
  }

  const rejectedResult = await reportsQuery(
    `
      SELECT
        COALESCE(
          NULLIF(to_jsonb(rr)->>'relatorio_id', ''),
          NULLIF(to_jsonb(rr)->>'relatorio_original_id', ''),
          NULLIF(to_jsonb(rr)->>'id', '')
        ) AS relatorio_id
      FROM public.relatorios_reprovados rr
      WHERE to_jsonb(rr)->>'id' = $1::text
         OR COALESCE(
              NULLIF(to_jsonb(rr)->>'relatorio_id', ''),
              NULLIF(to_jsonb(rr)->>'relatorio_original_id', ''),
              NULLIF(to_jsonb(rr)->>'id', '')
            ) = $1::text
      LIMIT 1
    `,
    [relatorioId]
  );

  if (rejectedResult.rows?.[0]?.relatorio_id) {
    return String(rejectedResult.rows[0].relatorio_id);
  }

  return null;
}

async function getRelatorioHistorico(relatorioId: string) {
  const resolvedId = await resolveApprovalWorkflowRelatorioId(relatorioId);
  if (!resolvedId) {
    return [];
  }

  try {
    const auditResult = await reportsQuery(
      `
        SELECT
          to_jsonb(ar)->>'id' AS id,
          to_jsonb(ar)->>'relatorio_id' AS relatorio_id,
          to_jsonb(ar)->>'acao' AS acao,
          to_jsonb(ar)->>'usuario_id' AS usuario_id,
          COALESCE(
            to_jsonb(ar)->>'usuario_nome',
            to_jsonb(ar)->>'usuario_email'
          ) AS usuario_nome,
          ar.detalhes,
          COALESCE(
            to_jsonb(ar)->>'criado_em',
            to_jsonb(ar)->>'created_at'
          ) AS created_at
        FROM public.auditoria_relatorios ar
        WHERE to_jsonb(ar)->>'relatorio_id' = $1::text
        ORDER BY COALESCE(
          to_jsonb(ar)->>'criado_em',
          to_jsonb(ar)->>'created_at'
        ) DESC NULLS LAST
      `,
      [resolvedId]
    );

    if (auditResult.rows?.length) {
      return auditResult.rows.map((row: any) => {
        const detalhes = ensureObject(row.detalhes);
        const acao = normalizeHistoricoAcao(row.acao);

        return {
          id: String(row.id || `${acao}-${row.created_at || Date.now()}`),
          relatorio_id: String(row.relatorio_id || resolvedId),
          usuario_id: String(row.usuario_id || ''),
          usuario_nome: pickFirstNonEmptyString(
            row.usuario_nome,
            detalhes.usuario_nome,
            detalhes.usuario_email
          ),
          acao,
          status_anterior: pickFirstNonEmptyString(
            detalhes.status_anterior,
            detalhes.statusAnterior
          ),
          status_novo:
            pickFirstNonEmptyString(
              detalhes.status_novo,
              detalhes.statusNovo
            ) || inferHistoricoStatus(acao),
          comentario: pickFirstNonEmptyString(
            detalhes.comentario,
            detalhes.observacoes,
            detalhes.justificativa,
            detalhes.motivo_rejeicao
          ),
          created_at: pickFirstNonEmptyString(row.created_at) || new Date().toISOString(),
        };
      });
    }
  } catch (error: any) {
    console.error('Erro ao buscar auditoria do relatório:', error.message);
  }

  const pendingResult = await reportsQuery(
    `
      SELECT
        id,
        response_data,
        data_geracao,
        status_aprovacao
      FROM public.relatorios_em_aprovacao
      WHERE id::text = $1::text
      LIMIT 1
    `,
    [resolvedId]
  );

  const pendingRow = pendingResult.rows?.[0];
  if (!pendingRow) {
    return [];
  }

  const historico: Array<Record<string, string | null>> = [
    {
      id: `criado-${resolvedId}`,
      relatorio_id: String(resolvedId),
      usuario_id: 'sistema',
      usuario_nome: 'Sistema',
      acao: 'criado',
      status_anterior: null,
      status_novo: 'pendente_aprovacao',
      comentario: null,
      created_at: pickFirstNonEmptyString(pendingRow.data_geracao) || new Date().toISOString(),
    },
  ];

  const approvedResult = await dbQuery(
    `
      SELECT
        COALESCE(
          to_jsonb(ra)->>'data_aprovacao',
          to_jsonb(ra)->>'aprovado_em',
          to_jsonb(ra)->>'created_at'
        ) AS data_aprovacao,
        COALESCE(
          to_jsonb(ra)->>'aprovado_por',
          to_jsonb(ra)->>'analista_nome',
          to_jsonb(ra)->>'analista_email'
        ) AS aprovado_por,
        COALESCE(
          to_jsonb(ra)->>'observacoes_aprovacao',
          to_jsonb(ra)->>'observacoes'
        ) AS observacoes
      FROM public.relatorios_aprovados ra
      WHERE COALESCE(
        NULLIF(to_jsonb(ra)->>'relatorio_id', ''),
        NULLIF(to_jsonb(ra)->>'relatorio_original_id', ''),
        to_jsonb(ra)->>'id'
      ) = $1::text
      ORDER BY COALESCE(
        to_jsonb(ra)->>'data_aprovacao',
        to_jsonb(ra)->>'aprovado_em',
        to_jsonb(ra)->>'created_at'
      ) DESC NULLS LAST
      LIMIT 1
    `,
    [resolvedId]
  );

  const approvedRow = approvedResult.rows?.[0];
  if (approvedRow?.data_aprovacao) {
    historico.push({
      id: `aprovado-${resolvedId}`,
      relatorio_id: String(resolvedId),
      usuario_id: pickFirstNonEmptyString(approvedRow.aprovado_por) || '',
      usuario_nome: pickFirstNonEmptyString(approvedRow.aprovado_por),
      acao: 'aprovado',
      status_anterior: 'pendente_aprovacao',
      status_novo: 'aprovado',
      comentario: pickFirstNonEmptyString(approvedRow.observacoes),
      created_at: String(approvedRow.data_aprovacao),
    });
  }

  const rejectedResult = await reportsQuery(
    `
      SELECT
        COALESCE(
          to_jsonb(rr)->>'data_rejeicao',
          to_jsonb(rr)->>'created_at'
        ) AS data_rejeicao,
        COALESCE(
          to_jsonb(rr)->>'reprovado_por',
          to_jsonb(rr)->>'user_name',
          to_jsonb(rr)->>'user_email'
        ) AS reprovado_por,
        COALESCE(
          to_jsonb(rr)->>'justificativa',
          to_jsonb(rr)->>'motivo_rejeicao',
          to_jsonb(rr)->>'motivo'
        ) AS justificativa
      FROM public.relatorios_reprovados rr
      WHERE COALESCE(
        NULLIF(to_jsonb(rr)->>'relatorio_id', ''),
        NULLIF(to_jsonb(rr)->>'relatorio_original_id', ''),
        NULLIF(to_jsonb(rr)->>'id', '')
      ) = $1::text
      ORDER BY COALESCE(
        to_jsonb(rr)->>'data_rejeicao',
        to_jsonb(rr)->>'created_at'
      ) DESC NULLS LAST
      LIMIT 1
    `,
    [resolvedId]
  );

  const rejectedRow = rejectedResult.rows?.[0];
  if (rejectedRow?.data_rejeicao) {
    historico.push({
      id: `rejeitado-${resolvedId}`,
      relatorio_id: String(resolvedId),
      usuario_id: pickFirstNonEmptyString(rejectedRow.reprovado_por) || '',
      usuario_nome: pickFirstNonEmptyString(rejectedRow.reprovado_por),
      acao: 'rejeitado',
      status_anterior: 'pendente_aprovacao',
      status_novo: 'rejeitado',
      comentario: pickFirstNonEmptyString(rejectedRow.justificativa),
      created_at: String(rejectedRow.data_rejeicao),
    });
  }

  const commentData = getAnalystCommentFromPayload(pendingRow.response_data);
  if (commentData.comentario) {
    historico.push({
      id: `comentario-${resolvedId}`,
      relatorio_id: String(resolvedId),
      usuario_id: pickFirstNonEmptyString(commentData.analista) || '',
      usuario_nome: pickFirstNonEmptyString(commentData.analista),
      acao: 'comentario_atualizado',
      status_anterior: null,
      status_novo:
        pendingRow.status_aprovacao === 'aprovado'
          ? 'aprovado'
          : pendingRow.status_aprovacao === 'reprovado'
            ? 'rejeitado'
            : 'pendente_aprovacao',
      comentario: commentData.comentario,
      created_at:
        pickFirstNonEmptyString(commentData.dataComentario, pendingRow.data_geracao) ||
        new Date().toISOString(),
    });
  }

  return historico.sort((a, b) => {
    const aTime = new Date(String(a.created_at || 0)).getTime();
    const bTime = new Date(String(b.created_at || 0)).getTime();
    return bTime - aTime;
  });
}

async function saveRelatorioComentarioAnalista(
  relatorioId: string,
  comentario: string,
  authIdentity: { email?: string; nome?: string; sub?: string },
  preferredAnalystName?: string | null
) {
  const resolvedId = await resolveApprovalWorkflowRelatorioId(relatorioId);
  if (!resolvedId) {
    throw new Error('Relatório não encontrado');
  }

  const pendingResult = await reportsQuery(
    `
      SELECT
        id,
        response_data,
        status_aprovacao
      FROM public.relatorios_em_aprovacao
      WHERE id::text = $1::text
      LIMIT 1
    `,
    [resolvedId]
  );

  const pendingRow = pendingResult.rows?.[0];
  if (!pendingRow) {
    throw new Error('Relatório não encontrado');
  }

  const analista =
    pickFirstNonEmptyString(
      preferredAnalystName,
      authIdentity.nome,
      authIdentity.email,
      authIdentity.sub
    ) || 'Sistema';
  const dataComentario = new Date().toISOString();
  const updatedPayload = buildPayloadWithAnalystComment(
    pendingRow.response_data,
    comentario,
    analista,
    dataComentario
  );

  await reportsQuery(
    `
      UPDATE public.relatorios_em_aprovacao
      SET response_data = $2
      WHERE id::text = $1::text
    `,
    [resolvedId, JSON.stringify(updatedPayload)]
  );

  try {
    await dbQuery(
      `
        UPDATE public.relatorios_aprovados
        SET
          secoes_json = $2,
          observacoes = $3,
          html_content = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE COALESCE(
          NULLIF(to_jsonb(relatorios_aprovados)->>'relatorio_id', ''),
          NULLIF(to_jsonb(relatorios_aprovados)->>'relatorio_original_id', ''),
          to_jsonb(relatorios_aprovados)->>'id'
        ) = $1::text
      `,
      [resolvedId, JSON.stringify(updatedPayload), comentario]
    );
  } catch (error: any) {
    console.error('Erro ao sincronizar comentário no relatório aprovado:', error.message);
  }

  try {
    await reportsQuery(
      `
        INSERT INTO public.auditoria_relatorios (
          relatorio_id,
          acao,
          usuario_id,
          detalhes
        )
        VALUES ($1, $2, $3, $4)
      `,
      [
        resolvedId,
        'observacoes_alteradas',
        pickFirstNonEmptyString(authIdentity.email, authIdentity.sub, analista) || analista,
        JSON.stringify({
          comentario,
          usuario_nome: analista,
          status_novo:
            pendingRow.status_aprovacao === 'aprovado'
              ? 'aprovado'
              : pendingRow.status_aprovacao === 'reprovado'
                ? 'rejeitado'
                : 'pendente_aprovacao',
        }),
      ]
    );
  } catch (error: any) {
    console.error('Erro ao registrar auditoria do comentário:', error.message);
  }

  return {
    relatorio_id: resolvedId,
    comentario,
    analista,
    dataComentario,
  };
}

function validateHandshakeToken(token?: string): boolean {
  if (!REQUIRE_HANDSHAKE) {
    return true;
  }

  if (!token) {
    return false;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    }) as jwt.JwtPayload;

    return decoded?.type === 'handshake';
  } catch {
    return false;
  }
}

function validateDownloadToken(token: unknown, reportId: string): boolean {
  if (typeof token !== 'string' || !token.trim()) {
    return false;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    }) as jwt.JwtPayload;

    return (
      decoded?.type === 'report_pdf_download' &&
      String(decoded.reportId || '') === String(reportId)
    );
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// ROTAS - HEALTH & INFO
// ─────────────────────────────────────────────────────────────────────────

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '2.0.44',
    service: 'orgas-api',
    timestamp: new Date().toISOString(),
    db: isPgEnabled() ? 'connected' : 'disabled',
    agent: 'configured'
  });
});

app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'ORGAS Backend API',
    version: '2.0.44',
    description: 'Backend API que integra com Banco de Dados e Agente IA em Python',
    endpoints: {
      clients: '/api/clients',
      relatorios: '/api/relatorios',
      economicGroups: '/economic-groups',
      health: '/health',
      diagnostic: '/api/diagnostic'
    },
    agentApi: 'configured',
    dbEnabled: isPgEnabled()
  });
});

// Endpoint de diagnóstico - lista todas as tabelas do banco
app.get('/diagnostic', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canViewAllReports(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const result = await dbQuery(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tables = result.rows.map((row: any) => row.table_name);

    // Para cada tabela, listar as colunas
    const tablesSchema: any = {};
    for (const tableName of tables) {
      const columnsResult = await dbQuery(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [tableName]);

      tablesSchema[tableName] = columnsResult.rows;
    }

    res.json({
      status: 'ok',
      database: {
        connected: true,
        tables: tables,
        schema: tablesSchema
      }
    });
  } catch (error: any) {
    console.error('Erro ao buscar diagnóstico:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ROTAS - AUTENTICAÇÃO
// ─────────────────────────────────────────────────────────────────────────

app.get('/auth/handshake', (req: Request, res: Response) => {
  res.json({
    success: true,
    handshakeToken: generateHandshakeToken(),
    expiresIn: JWT_HANDSHAKE_TTL
  });
});

app.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password, handshakeToken } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    if (!validateHandshakeToken(handshakeToken)) {
      return res.status(400).json({ error: 'Handshake inválido ou expirado' });
    }

    let authUser: any = null;
    try {
      authUser = await verifyAppUserPassword(normalizedEmail, String(password));
    } catch (authError: any) {
      console.error('Erro ao autenticar usuário do app:', authError.message);
      return res.status(503).json({ error: 'Falha ao validar credenciais' });
    }

    if (!authUser?.email) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = generateMockToken(authUser.email || normalizedEmail, {
      nome: authUser.nome,
      role: authUser.role || (authUser.admin ? 'admin' : 'user'),
      admin: Boolean(authUser.admin),
    });

    return res.json({
      success: true,
      token,
      user: {
        id: authUser.id,
        email: authUser.email,
        nome: authUser.nome,
        admin: Boolean(authUser.admin),
        role: authUser.role || (authUser.admin ? 'admin' : 'user')
      }
    });
  } catch (error: any) {
    console.error('Erro ao fazer login:', error);
    res.status(500).json({ error: 'Erro ao processar login' });
  }
});

app.post('/auth/logout', (req: Request, res: Response) => {
  res.json({ success: true, message: 'Logout realizado' });
});

app.get('/auth/me', async (req: Request, res: Response) => {
  const authIdentity = await resolveAuthIdentity(req);
  if (!authIdentity.email && !authIdentity.sub) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  res.json({
    email: authIdentity.email || null,
    name: authIdentity.nome || null,
    role: authIdentity.role || null,
    admin: authIdentity.admin === true,
    sub: authIdentity.sub || null,
  });
});

app.get('/auth/admin/email-events', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canManageAuth(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100));
    const email = pickFirstNonEmptyString(req.query.email);
    const events = await listAuthEmailEvents(limit, email || undefined);

    return res.json({
      success: true,
      smtp: getSmtpSummary(),
      events,
    });
  } catch (error: any) {
    console.error('Erro ao listar eventos de e-mail:', error.message);
    return res.status(500).json({ error: 'Erro ao listar eventos de e-mail' });
  }
});

app.post('/auth/admin/set-password', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canManageAuth(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const newPassword = String(req.body?.newPassword || '');

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email e nova senha são obrigatórios' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
    }

    const user = await findAppUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    await setAppUserPassword(user.id, newPassword, { source: 'admin_set_password' });

    return res.json({
      success: true,
      message: 'Senha atualizada com sucesso',
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome,
      },
    });
  } catch (error: any) {
    console.error('Erro ao definir senha do usuário:', error.message);
    return res.status(500).json({ error: 'Erro ao atualizar senha' });
  }
});

app.post('/auth/admin/send-reset-link', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canManageAuth(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const user = await findAppUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    let deliveryInfo: { actionUrl: string; expiresAt: string | null };
    try {
      deliveryInfo = await sendAuthEmail({
        user,
        purpose: 'password_reset',
        authIdentity,
        req,
      });
    } catch {
      return res.status(503).json({ error: 'Falha ao enviar e-mail de redefinição' });
    }

    return res.json({
      success: true,
      message: 'Link de redefinição enviado',
      email: user.email,
      actionUrl: deliveryInfo.actionUrl,
      expiresAt: deliveryInfo.expiresAt,
    });
  } catch (error: any) {
    console.error('Erro ao enviar link de redefinição:', error.message);
    return res.status(500).json({ error: 'Erro ao enviar link de redefinição' });
  }
});

app.post('/auth/admin/send-magic-link', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canManageAuth(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const user = await findAppUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    let deliveryInfo: { actionUrl: string; expiresAt: string | null };
    try {
      deliveryInfo = await sendAuthEmail({
        user,
        purpose: 'magic_link',
        authIdentity,
        req,
      });
    } catch {
      return res.status(503).json({ error: 'Falha ao enviar magic link' });
    }

    return res.json({
      success: true,
      message: 'Magic link enviado',
      email: user.email,
      actionUrl: deliveryInfo.actionUrl,
      expiresAt: deliveryInfo.expiresAt,
    });
  } catch (error: any) {
    console.error('Erro ao enviar magic link:', error.message);
    return res.status(500).json({ error: 'Erro ao enviar magic link' });
  }
});

app.post('/auth/reset-password', async (req: Request, res: Response) => {
  try {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token e nova senha são obrigatórios' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
    }

    const consumed = await consumeEmailToken(token, 'password_reset');
    if (!consumed?.user_id) {
      return res.status(400).json({ error: 'Token inválido ou expirado' });
    }

    const user = await findAppUserById(consumed.user_id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    await setAppUserPassword(user.id, newPassword, { source: 'password_reset' });

    return res.json({
      success: true,
      message: 'Senha redefinida com sucesso',
    });
  } catch (error: any) {
    console.error('Erro ao redefinir senha:', error.message);
    return res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

app.post('/auth/magic-link/consume', async (req: Request, res: Response) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Token é obrigatório' });
    }

    const consumed = await consumeEmailToken(token, 'magic_link');
    if (!consumed?.user_id) {
      return res.status(400).json({ error: 'Token inválido ou expirado' });
    }

    const user = await findAppUserById(consumed.user_id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const tokenJwt = generateMockToken(user.email, {
      nome: user.nome,
      role: user.role || (user.admin ? 'admin' : 'user'),
      admin: Boolean(user.admin),
    });

    return res.json({
      success: true,
      token: tokenJwt,
      user: {
        id: user.id,
        email: user.email,
        nome: user.nome,
        admin: Boolean(user.admin),
        role: user.role || (user.admin ? 'admin' : 'user')
      }
    });
  } catch (error: any) {
    console.error('Erro ao consumir magic link:', error.message);
    return res.status(500).json({ error: 'Erro ao consumir magic link' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ROTAS - USUÁRIOS
// ─────────────────────────────────────────────────────────────────────────

app.get('/usuarios', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canManageAuth(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const users = await listAppUsers();
    return res.json({ users });
  } catch (error: any) {
    console.error('Erro ao listar usuários:', error.message);
    return res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

app.post('/usuarios', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canManageAuth(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const nome = String(req.body?.nome || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = normalizeAppRole(req.body?.role) || 'analista';
    const password = String(req.body?.password || '').trim();
    const sendMagicLink = req.body?.sendMagicLink === true;
    const sendResetLink = req.body?.sendResetLink === true;
    const admin = role === 'admin' || req.body?.admin === true;

    if (!nome || !email) {
      return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
    }

    if (!['analista', 'revisor', 'admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Role inválida' });
    }

    if (password && password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
    }

    const user = await createAppUser({
      nome,
      email,
      role,
      admin,
      password: password || null,
    });

    let deliveryInfo: { actionUrl: string; expiresAt: string | null } | null = null;
    if (sendMagicLink) {
      try {
        deliveryInfo = await sendAuthEmail({
          user,
          purpose: 'magic_link',
          authIdentity,
          req,
        });
      } catch {
        return res.status(503).json({
          error: 'Usuário criado, mas houve falha ao enviar o magic link',
          user,
        });
      }
    } else if (sendResetLink) {
      try {
        deliveryInfo = await sendAuthEmail({
          user,
          purpose: 'password_reset',
          authIdentity,
          req,
        });
      } catch {
        return res.status(503).json({
          error: 'Usuário criado, mas houve falha ao enviar o link de redefinição',
          user,
        });
      }
    }

    return res.status(201).json({
      success: true,
      user,
      invitation: deliveryInfo,
    });
  } catch (error: any) {
    const message = error?.message || 'Erro ao criar usuário';
    if (message.includes('Já existe')) {
      return res.status(409).json({ error: message });
    }
    console.error('Erro ao criar usuário:', message);
    return res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

app.put('/usuarios/:id/role', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canManageAuth(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const userId = String(req.params.id || '').trim();
    const role = normalizeAppRole(req.body?.role) || 'user';

    if (!userId) {
      return res.status(400).json({ error: 'Usuário inválido' });
    }

    if (!['analista', 'revisor', 'admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Role inválida' });
    }

    const updated = await updateAppUserRole(userId, role);
    if (!updated) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    return res.json({ success: true, user: updated });
  } catch (error: any) {
    console.error('Erro ao atualizar role do usuário:', error.message);
    return res.status(500).json({ error: 'Erro ao atualizar role do usuário' });
  }
});

app.post('/usuarios/:id/send-magic-link', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canManageAuth(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const user = await findAppUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    let deliveryInfo: { actionUrl: string; expiresAt: string | null };
    try {
      deliveryInfo = await sendAuthEmail({
        user,
        purpose: 'magic_link',
        authIdentity,
        req,
      });
    } catch {
      return res.status(503).json({ error: 'Falha ao enviar magic link' });
    }

    return res.json({ success: true, user, invitation: deliveryInfo });
  } catch (error: any) {
    console.error('Erro ao enviar magic link do usuário:', error.message);
    return res.status(500).json({ error: 'Erro ao enviar magic link' });
  }
});

app.post('/usuarios/:id/send-reset-link', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canManageAuth(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const user = await findAppUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    let deliveryInfo: { actionUrl: string; expiresAt: string | null };
    try {
      deliveryInfo = await sendAuthEmail({
        user,
        purpose: 'password_reset',
        authIdentity,
        req,
      });
    } catch {
      return res.status(503).json({ error: 'Falha ao enviar e-mail de redefinição' });
    }

    return res.json({ success: true, user, invitation: deliveryInfo });
  } catch (error: any) {
    console.error('Erro ao enviar reset do usuário:', error.message);
    return res.status(500).json({ error: 'Erro ao enviar reset do usuário' });
  }
});

app.post('/usuarios/:id/set-password', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    if (!canManageAuth(authIdentity)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const user = await findAppUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres' });
    }

    await setAppUserPassword(user.id, newPassword, { source: 'admin_set_password' });
    return res.json({ success: true, user });
  } catch (error: any) {
    console.error('Erro ao definir senha do usuário:', error.message);
    return res.status(500).json({ error: 'Erro ao definir senha do usuário' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ROTAS - CLIENTES
// ─────────────────────────────────────────────────────────────────────────

app.get('/clients', async (req: Request, res: Response) => {
  try {
    // Parse limit and offset from query params for pagination
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 500);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    // Busca da tabela clientesPJ com os campos reais
    const result = await dbQuery(`
      SELECT
        id,
        "createdAt" as created_at,
        "cnpjMatriz" as cnpj_matriz,
        "razaoSocial" as razao_social,
        "nomeFantasia" as nome_fantasia,
        "regimeTributario" as regime_tributario,
        "cnpjsFiliais" as cnpjs_filiais,
        somente_prestador_servicos,
        aliquota_faturamento,
        aliquota_folha,
        "CNAE_principal" as cnae_principal,
        "CNAE_secundario" as cnae_secundario,
        "fator_R" as fator_r
      FROM "clientesPJ"
      ORDER BY "razaoSocial" ASC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    return res.json(result.rows || []);
  } catch (error: any) {
    console.error('Erro ao buscar clientes:', error.message);
    // Se houver erro, retorna lista vazia em vez de 500
    return res.json([]);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ROTAS - GRUPOS ECONÔMICOS
// ─────────────────────────────────────────────────────────────────────────

app.get('/economic-groups', async (req: Request, res: Response) => {
  try {
    if (!isPgEnabled()) {
      return res.json([]);
    }

    const result = await dbQuery(
      'SELECT id, name, description FROM economic_groups ORDER BY name'
    );
    res.json(result.rows);
  } catch (error: any) {
    console.error('Erro ao buscar grupos econômicos:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ROTAS - RELATÓRIOS / PARECERES
// ─────────────────────────────────────────────────────────────────────────

app.get('/relatorios', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    // Parse limit and offset from query params for pagination
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 500);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    // Busca da tabela relatorios_aprovados com os campos reais
    const result = await dbQuery(`
      SELECT
        id,
        relatorio_id,
        titulo,
        categoria,
        cliente_id,
        cliente_nome,
        cnpj_matriz,
        analista_id,
        analista_nome,
        analista_email,
        arquivo_nome,
        arquivo_url,
        bucket_key,
        observacoes,
        ai_comment,
        html_content,
        aprovado_em,
        created_at,
        updated_at,
        grupo_economico,
        competencia,
        secoes_json,
        type,
        relatorio_type
      FROM relatorios_aprovados
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    return res.json(filterReportRowsByAccess(result.rows || [], authIdentity));
  } catch (error: any) {
    console.error('Erro ao buscar relatórios:', error.message);
    // Se houver erro, retorna lista vazia em vez de 500
    return res.json([]);
  }
});

app.get('/relatorios/:id/html', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const access = await getResolvedReportAccess(req, id);
    if (!access.exists) {
      return res.status(404).json({
        success: false,
        error: 'Relatório não encontrado'
      });
    }
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado a este relatório'
      });
    }

    const report = await resolveReportDocument(id);

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Relatório não encontrado'
      });
    }

    return res.json({
      success: true,
      html: report.html,
      fileName: report.fileName,
      source: report.source
    });
  } catch (error: any) {
    console.error('Erro ao gerar HTML do relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar HTML do relatório',
      detail: error.message
    });
  }
});

app.get('/relatorios/:id/pdf-download', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const downloadToken =
      pickFirstNonEmptyString(
        req.query.downloadToken,
        req.query.download_token,
        req.query.token
      ) || '';

    if (!validateDownloadToken(downloadToken, id)) {
      return res.status(401).json({
        success: false,
        error: 'Link de download inválido ou expirado'
      });
    }

    const report = await resolveReportDocument(id);

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Relatório não encontrado'
      });
    }

    const pdf = await generatePdfFromHtml(report.html, { fileName: report.fileName });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.fileName.replace(/"/g, '')}"`
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.send(Buffer.from(pdf.bytes));
  } catch (error: any) {
    console.error('Erro ao processar download nativo do relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao processar download do relatório',
      detail: error.message
    });
  }
});

app.get('/relatorios/:id/pdf', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const access = await getResolvedReportAccess(req, id);
    if (!access.exists) {
      return res.status(404).json({
        success: false,
        error: 'Relatório não encontrado'
      });
    }
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado a este relatório'
      });
    }

    const report = await resolveReportDocument(id);

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Relatório não encontrado'
      });
    }

    const fileName = report.fileName;
    const downloadRequested =
      String(req.query.download || '').toLowerCase() === '1' ||
      String(req.query.download || '').toLowerCase() === 'true';

    if (!downloadRequested) {
      const downloadToken = generateDownloadToken(id);
      return res.json({
        success: true,
        url: `/api/relatorios/${encodeURIComponent(id)}/pdf-download?downloadToken=${encodeURIComponent(downloadToken)}`,
        fileName,
        source: report.source
      });
    }

    const pdf = await generatePdfFromHtml(report.html, { fileName });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName.replace(/"/g, '')}"`
    );
    return res.send(Buffer.from(pdf.bytes));
  } catch (error: any) {
    console.error('Erro ao gerar PDF do relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar PDF do relatório',
      detail: error.message
    });
  }
});

app.get('/relatorios/:id/historico', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const access = await getResolvedReportAccess(req, id);
    if (!access.exists) {
      return res.status(404).json({
        success: false,
        error: 'Relatório não encontrado'
      });
    }
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado a este relatório'
      });
    }

    const historico = await getRelatorioHistorico(id);

    return res.json({
      success: true,
      historico,
    });
  } catch (error: any) {
    console.error('Erro ao buscar histórico do relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar histórico do relatório',
      detail: error.message,
    });
  }
});

app.post('/relatorios/:id/comentario', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const access = await getResolvedReportAccess(req, id);
    if (!access.exists) {
      return res.status(404).json({
        success: false,
        error: 'Relatório não encontrado'
      });
    }
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado a este relatório'
      });
    }

    const comentario = pickFirstNonEmptyString(req.body?.comentario);
    const analistaNome = pickFirstNonEmptyString(req.body?.analista_nome, req.body?.usuario_nome);

    if (!comentario) {
      return res.status(400).json({
        success: false,
        error: 'Campo "comentario" é obrigatório',
      });
    }

    const result = await saveRelatorioComentarioAnalista(
      id,
      comentario,
      extractAuthIdentity(req),
      analistaNome
    );

    return res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Erro ao salvar comentário do relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao salvar comentário do relatório',
      detail: error.message,
    });
  }
});

app.get('/relatorios/:id/secoes', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isReportsDbEnabled()) {
      return res.json([]);
    }

    const result = await reportsQuery(
      `SELECT id, relatorio_id, title, content, status, order_index
       FROM relatorio_secoes WHERE relatorio_id = $1 ORDER BY order_index`,
      [id]
    );
    res.json(result.rows);
  } catch (error: any) {
    console.error('Erro ao buscar seções:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/relatorios/:id/secoes/:secaoId/aprovar', async (req: Request, res: Response) => {
  try {
    const { id, secaoId } = req.params;
    if (!isReportsDbEnabled()) {
      return res.status(400).json({ error: 'Database não configurado' });
    }

    await reportsQuery(
      `UPDATE relatorio_secoes SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND relatorio_id = $2`,
      [secaoId, id]
    );

    res.json({ success: true, message: 'Seção aprovada' });
  } catch (error: any) {
    console.error('Erro ao aprovar seção:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/relatorios/:id/secoes/:secaoId/rejeitar', async (req: Request, res: Response) => {
  try {
    const { id, secaoId } = req.params;
    const { reason } = req.body;

    if (!isReportsDbEnabled()) {
      return res.status(400).json({ error: 'Database não configurado' });
    }

    await reportsQuery(
      `UPDATE relatorio_secoes SET status = 'rejected', rejection_reason = $1, updated_at = NOW()
       WHERE id = $2 AND relatorio_id = $3`,
      [reason, secaoId, id]
    );

    res.json({ success: true, message: 'Seção rejeitada' });
  } catch (error: any) {
    console.error('Erro ao rejeitar seção:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/relatorios/:id/secoes/:secaoId/editar', async (req: Request, res: Response) => {
  try {
    const { id, secaoId } = req.params;
    const { content } = req.body;

    if (!isReportsDbEnabled()) {
      return res.status(400).json({ error: 'Database não configurado' });
    }

    await reportsQuery(
      `UPDATE relatorio_secoes SET content = $1, updated_at = NOW()
       WHERE id = $2 AND relatorio_id = $3`,
      [content, secaoId, id]
    );

    res.json({ success: true, message: 'Seção atualizada' });
  } catch (error: any) {
    console.error('Erro ao editar seção:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/relatorios/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!isReportsDbEnabled()) {
      return res.status(400).json({ error: 'Database não configurado' });
    }

    await reportsQuery('DELETE FROM relatorios WHERE id = $1', [id]);
    res.json({ success: true, message: 'Relatório deletado' });
  } catch (error: any) {
    console.error('Erro ao deletar relatório:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ROTAS - AGENTE IA (PROXY)
// ─────────────────────────────────────────────────────────────────────────

app.post('/analyze', async (req: Request, res: Response) => {
  try {
    // Chamada ao agente IA para análise
    const agentUrl = `${AGENT_API_URL}/agent`;

    console.log(`[Analyze] Chamando agente em: ${agentUrl}`);

    // Transformar payload para formato esperado pelo agente (AgentRequest)
    const agentPayload = {
      message: req.body.message || req.body.prompt || req.body.query || 'Analisar documentos',
      session_id: req.body.session_id,
      user_id: req.body.user_id,
      client_id: req.body.client_id,
      client_name: req.body.client_name,
      tipo_parecer: req.body.tipo_parecer,
      documents: req.body.documents
    };

    console.log(`[Analyze] Payload transformado:`, JSON.stringify(agentPayload).substring(0, 200));

    const headers: any = {
      'Content-Type': 'application/json'
    };

    // Agente usa HTTPBearer() - requer Authorization: Bearer <token>
    const AI_AGENT_TOKEN = getAgentServiceToken();
    headers['Authorization'] = `Bearer ${AI_AGENT_TOKEN}`;

    const response = await axios({
      method: 'post',
      url: agentUrl,
      data: agentPayload,
      timeout: AGENT_API_TIMEOUT,
      headers
    });

    console.log(`[Analyze] Agente respondeu com status ${response.status}`);
    res.json(response.data);
  } catch (error: any) {
    console.error('[Analyze] Erro ao chamar Agente IA:', error.message);
    const payload = isProduction
      ? { error: 'Erro ao processar requisição no agente IA' }
      : {
          error: 'Erro ao processar requisição no agente IA',
          detail: error.message,
          agentUrl: `${AGENT_API_URL}/agent`
        };
    res.status(500).json(payload);
  }
});

app.post('/webhook/ai-submit', async (req: Request, res: Response) => {
  try {
    const authIdentity = extractAuthIdentity(req);
    const authenticatedUser = Boolean(authIdentity.email || authIdentity.sub);
    const trustedProxyRequest = hasValidFrontendProxySecret(req);
    const trustedWebhookRequest = hasValidWebhookToken(req);

    if (!authenticatedUser && !trustedProxyRequest && !trustedWebhookRequest) {
      return res.status(403).json({ error: 'Acesso negado ao webhook de submissão' });
    }

    // Webhook para submissão de documento ao agente IA
    const agentUrl = `${AGENT_API_URL}/agent`;

    console.log(`[Webhook AI-Submit] Chamando agente em: ${agentUrl}`);
    console.log(`[Webhook AI-Submit] Payload recebido:`, JSON.stringify(req.body).substring(0, 200));

    // Transformar payload para formato esperado pelo agente (AgentRequest)
    // Frontend envia: clientId, cliente_nome; Backend espera: client_id, client_name
    const clientId =
      req.body.client_id ||
      req.body.clientId ||
      req.body.cliente_id ||
      '';
    const clientName =
      req.body.client_name ||
      req.body.clientName ||
      req.body.cliente_nome ||
      req.body.clienteNome ||
      '';

    const tipoParecer = req.body.tipo_parecer || req.body.tipoParecer;
    const competencia = req.body.competencia;
    const promptBase =
      req.body.message ||
      req.body.prompt ||
      (tipoParecer
        ? `Gerar parecer ${tipoParecer} para ${clientName || 'cliente'}`
        : `Gerar relatório para ${clientName || 'cliente'}`);

    const agentPayload = {
      message: promptBase,
      session_id: req.body.session_id || req.body.sessionId,
      user_id: req.body.user_id,
      client_id: clientId,
      client_name: clientName,
      tipo_parecer: tipoParecer,
      categoria: req.body.categoria,
      competencia,
      cliente_cnpj: req.body.cliente_cnpj,
      fiscal_tributation: req.body.fiscal_tributation,
      observacoes: req.body.observacoes,
      documentos_pendentes: req.body.documentos_pendentes,
      user_name: req.body.user_name,
      user_email: req.body.user_email,
      documents: req.body.documents
    };

    console.log(`[Webhook AI-Submit] Payload transformado:`, JSON.stringify(agentPayload).substring(0, 200));

    const headers: any = {
      'Content-Type': 'application/json'
    };

    // Agente usa HTTPBearer() - requer Authorization: Bearer <token>
    // Token lido de AI_AGENT_TOKEN environment variable
    const AI_AGENT_TOKEN = getAgentServiceToken();
    headers['Authorization'] = `Bearer ${AI_AGENT_TOKEN}`;

    const response = await axios({
      method: 'post',
      url: agentUrl,
      data: agentPayload,
      timeout: AGENT_API_TIMEOUT,
      headers
    });

    console.log(`[Webhook AI-Submit] Agente respondeu com status ${response.status}`);

    // Save response to relatorios_em_aprovacao table for approval workflow
    try {
      const agentResponse: ApprovalAgentResponse = response.data;
      const relatorioId = await saveRelatorioPendente(
        agentResponse,
        clientId,
        clientName,
        {
          competencia,
          clienteCnpj: req.body.cliente_cnpj || null,
          userEmail:
            pickFirstNonEmptyString(
              req.body.user_email,
              req.body.analista_email,
              authIdentity.email
            ) || null,
          userName:
            pickFirstNonEmptyString(
              req.body.user_name,
              req.body.analista_nome,
              authIdentity.nome
            ) || null,
        }
      );

      console.log(`[Webhook AI-Submit] Relatório salvo em aprovação: ${relatorioId}`);

      // Return both agent response and the new report ID
      res.json({
        ...response.data,
        relatorio_id: relatorioId,  // Add the saved report ID
        workflow_status: 'em_aprovacao'
      });
    } catch (saveError: any) {
      console.error(`[Webhook AI-Submit] Erro ao salvar relatório em aprovação:`, saveError.message);
      // Still return agent response even if save fails
      res.json({
        ...response.data,
        warning: 'Resposta do agente recebida, mas falha ao salvar em aprovação'
      });
    }
  } catch (error: any) {
    console.error(`[Webhook AI-Submit] Erro ao chamar agente IA:`, error.message);
    if (error.response) {
      console.error(`[Webhook AI-Submit] Status: ${error.response.status}, Data:`, error.response.data);
    }
    res.status(500).json({
      error: 'Erro ao processar webhook no agente IA',
      detail: error.message,
      agentUrl: `${AGENT_API_URL}/agent`
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// APPROVAL WORKFLOW ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /relatorios/approval/pendentes
 * Retrieves reports pending approval
 */
app.get('/relatorios/approval/pendentes', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const tipoParecerFilter = req.query.tipo_parecer as string;

    const relatorios = filterReportRowsByAccess(
      await getRelatoriosPendentes(limit, offset, tipoParecerFilter),
      authIdentity
    );
    return res.json({
      success: true,
      count: relatorios.length,
      data: relatorios
    });
  } catch (error: any) {
    console.error('Erro ao buscar relatórios pendentes:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar relatórios pendentes',
      detail: error.message
    });
  }
});

/**
 * GET /relatorios/approval/aprovados
 * Retrieves approved reports
 */
app.get('/relatorios/approval/aprovados', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const tipoParecerFilter = req.query.tipo_parecer as string;

    const relatorios = filterReportRowsByAccess(
      await getRelatoriosAprovados(limit, offset, tipoParecerFilter),
      authIdentity
    );
    return res.json({
      success: true,
      count: relatorios.length,
      data: relatorios
    });
  } catch (error: any) {
    console.error('Erro ao buscar relatórios aprovados:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar relatórios aprovados',
      detail: error.message
    });
  }
});

/**
 * GET /relatorios/approval/reprovados
 * Retrieves rejected reports
 */
app.get('/relatorios/approval/reprovados', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const tipoParecerFilter = req.query.tipo_parecer as string;

    const relatorios = filterReportRowsByAccess(
      await getRelatoriosReprovados(limit, offset, tipoParecerFilter),
      authIdentity
    );
    return res.json({
      success: true,
      count: relatorios.length,
      data: relatorios
    });
  } catch (error: any) {
    console.error('Erro ao buscar relatórios reprovados:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar relatórios reprovados',
      detail: error.message
    });
  }
});

/**
 * GET /relatorios/approval/:id/detalhes
 * Retrieves detailed report data for review
 */
app.get('/relatorios/approval/:id/detalhes', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const authIdentity = await resolveAuthIdentity(req);
    const relatorio = await getRelatorioDetalhes(id);

    if (!relatorio) {
      return res.status(404).json({
        success: false,
        error: 'Relatório não encontrado'
      });
    }

    if (!canAccessReportRow(relatorio, authIdentity)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado a este relatório'
      });
    }

    return res.json({
      success: true,
      data: relatorio
    });
  } catch (error: any) {
    console.error('Erro ao buscar detalhes do relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar detalhes do relatório',
      detail: error.message
    });
  }
});

/**
 * POST /relatorios/approval/:id/aprovar
 * Approves a report and moves it to relatorios_aprovados
 */
app.post('/relatorios/approval/:id/aprovar', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { aprovado_por, observacoes_aprovacao } = req.body;
    const authIdentity = await resolveAuthIdentity(req);

    if (!canViewAllReports(authIdentity)) {
      return res.status(403).json({
        success: false,
        error: 'Apenas revisores e administradores podem aprovar relatórios'
      });
    }

    if (!aprovado_por) {
      return res.status(400).json({
        success: false,
        error: 'Campo "aprovado_por" é obrigatório'
      });
    }

    const aprovadoId = await aprovarRelatorio({
      relatorio_id: id,
      aprovado_por,
      aprovado_email:
        authIdentity.email ||
        (typeof aprovado_por === 'string' && aprovado_por.includes('@') ? aprovado_por : undefined),
      observacoes_aprovacao
    });

    return res.json({
      success: true,
      message: 'Relatório aprovado com sucesso',
      id: aprovadoId
    });
  } catch (error: any) {
    console.error('Erro ao aprovar relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao aprovar relatório',
      detail: error.message
    });
  }
});

/**
 * POST /relatorios/approval/:id/reprovar
 * Rejects a report with feedback for model training
 */
app.post('/relatorios/approval/:id/reprovar', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      reprovado_por,
      comentario,
      motivo_rejeicao,
      justificativa,
      secoes_com_erro,
      campo_com_erro,
      valor_esperado,
      valor_recebido
    } = req.body;
    const authIdentity = await resolveAuthIdentity(req);

    if (!canViewAllReports(authIdentity)) {
      return res.status(403).json({
        success: false,
        error: 'Apenas revisores e administradores podem reprovar relatórios'
      });
    }
    const reprovadoPorResolved =
      reprovado_por ||
      authIdentity.nome ||
      authIdentity.email ||
      authIdentity.sub;
    const justificativaResolved = justificativa || comentario;
    const motivoRejeicaoResolved =
      motivo_rejeicao || (justificativaResolved ? 'dados_incompletos' : undefined);

    // Validate required fields
    if (!reprovadoPorResolved) {
      return res.status(400).json({
        success: false,
        error: 'Campo "reprovado_por" é obrigatório'
      });
    }

    if (!motivoRejeicaoResolved) {
      return res.status(400).json({
        success: false,
        error: 'Campo "motivo_rejeicao" é obrigatório'
      });
    }

    if (!justificativaResolved) {
      return res.status(400).json({
        success: false,
        error: 'Campo "justificativa" é obrigatório'
      });
    }

    const reprovadoId = await reprovarRelatorio({
      relatorio_id: id,
      reprovado_por: reprovadoPorResolved,
      reprovado_email:
        authIdentity.email ||
        (typeof reprovadoPorResolved === 'string' && reprovadoPorResolved.includes('@')
          ? reprovadoPorResolved
          : undefined),
      motivo_rejeicao: motivoRejeicaoResolved,
      justificativa: justificativaResolved,
      secoes_com_erro,
      campo_com_erro,
      valor_esperado,
      valor_recebido
    });

    return res.json({
      success: true,
      message: 'Relatório reprovado com sucesso',
      id: reprovadoId,
      note: 'Feedback armazenado para treinamento do modelo'
    });
  } catch (error: any) {
    console.error('Erro ao rejeitar relatório:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao rejeitar relatório',
      detail: error.message
    });
  }
});

/**
 * GET /relatorios/approval/feedback/stats
 * Gets feedback statistics for dashboard
 */
app.get('/relatorios/approval/feedback/stats', async (req: Request, res: Response) => {
  try {
    const tipoParecerFilter = req.query.tipo_parecer as string;
    const stats = await getFeedbackStats(tipoParecerFilter);

    return res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    console.error('Erro ao buscar estatísticas de feedback:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar estatísticas de feedback',
      detail: error.message
    });
  }
});

/**
 * GET /relatorios/approval/feedback/problematic-fields
 * Gets top problematic fields for model training analysis
 */
app.get('/relatorios/approval/feedback/problematic-fields', async (req: Request, res: Response) => {
  try {
    const tipo_parecer = req.query.tipo_parecer as string;

    if (!tipo_parecer) {
      return res.status(400).json({
        success: false,
        error: 'Parâmetro "tipo_parecer" é obrigatório'
      });
    }

    const fields = await getProblematicFields(tipo_parecer);

    return res.json({
      success: true,
      data: fields
    });
  } catch (error: any) {
    console.error('Erro ao buscar campos problemáticos:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erro ao buscar campos problemáticos',
      detail: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ROTAS ADICIONAIS - RELATÓRIOS PENDENTES E REPROVADOS
// ─────────────────────────────────────────────────────────────────────────

app.get('/relatorios/pendentes', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    const result = await dbQuery(`
      SELECT
        id,
        user_name,
        user_email,
        file_name,
        cnpjmatrizabreviado,
        competencia,
        relatorio,
        date_time,
        secoes_json,
        secoes_status,
        secao_atual,
        secoes_rejeitadas,
        total_secoes,
        type,
        relatorio_type,
        html_preview
      FROM relatorios_pendentes
      ORDER BY date_time DESC
      LIMIT 50
    `);
    return res.json(filterReportRowsByAccess(result.rows || [], authIdentity));
  } catch (error: any) {
    console.error('Erro ao buscar relatórios pendentes:', error.message);
    return res.json([]);
  }
});

app.get('/relatorios/reprovados', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    const result = await dbQuery(`
      SELECT
        id,
        created_at,
        base64,
        user_name,
        user_email,
        file_name,
        "cnpjMatrizAbreviado" as cnpj_matriz_abreviado,
        competencia,
        motivo
      FROM relatorios_reprovados
      ORDER BY created_at DESC
      LIMIT 50
    `);
    return res.json(filterReportRowsByAccess(result.rows || [], authIdentity));
  } catch (error: any) {
    console.error('Erro ao buscar relatórios reprovados:', error.message);
    return res.json([]);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ROTAS - DASHBOARD & ATIVIDADES
// ─────────────────────────────────────────────────────────────────────────

app.get('/atividades', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    // Retorna atividades recentes mock
    res.json([
      {
        id: '1',
        tipo: 'relatorio_criado',
        descricao: 'Relatório fiscal criado',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        usuario: 'admin'
      },
      {
        id: '2',
        tipo: 'analise_completa',
        descricao: 'Análise de documento concluída',
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        usuario: 'sistema'
      },
      {
        id: '3',
        tipo: 'relatorio_aprovado',
        descricao: 'Relatório aprovado',
        timestamp: new Date(Date.now() - 10800000).toISOString(),
        usuario: 'gestor'
      }
    ].slice(0, limit));
  } catch (error: any) {
    console.error('Erro ao buscar atividades:', error);
    res.status(500).json({ error: 'Erro ao buscar atividades' });
  }
});

app.get('/dashboard/stats', async (req: Request, res: Response) => {
  try {
    const authIdentity = await resolveAuthIdentity(req);
    const fromRaw = req.query.from as string | undefined;
    const fromDate = fromRaw ? new Date(fromRaw) : null;
    const fromParam = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate.toISOString() : null;

    if (!isReportsDbEnabled()) {
      return res.json({
        periodo: fromParam || new Date().toISOString(),
        documentosProcessados: 0,
        pareceresGerados: 0,
        pendentesAprovacao: 0,
        alertasAtivos: 0,
        ultimaAtualizacao: new Date().toISOString()
      });
    }

    const result = await reportsQuery(
      `
        SELECT
          documentos_analisados,
          status_aprovacao,
          response_data
        FROM public.relatorios_em_aprovacao
        WHERE (
          $1::timestamptz IS NULL
          OR COALESCE(data_geracao::timestamptz, created_at) >= $1::timestamptz
        )
      `,
      [fromParam]
    );

    const visibleRows = filterReportRowsByAccess(result.rows || [], authIdentity);
    const stats = visibleRows.reduce((acc, row: any) => {
      const responseData = ensureObject(row?.response_data);
      const validationErrors = Array.isArray(responseData?.validation_errors)
        ? responseData.validation_errors
        : [];
      const validacaoErros = Array.isArray(responseData?.validacao_erros)
        ? responseData.validacao_erros
        : [];
      const hasAlertaAtivo =
        String(row?.status_aprovacao || 'pendente') === 'reprovado' ||
        String(responseData?.is_valid || '').toLowerCase() === 'false' ||
        validationErrors.length > 0 ||
        validacaoErros.length > 0;

      acc.documentos_processados += Number(row?.documentos_analisados || 0);
      acc.pareceres_gerados += 1;
      if (String(row?.status_aprovacao || 'pendente') === 'pendente') {
        acc.pendentes_aprovacao += 1;
      }
      if (hasAlertaAtivo) {
        acc.alertas_ativos += 1;
      }

      return acc;
    }, {
      documentos_processados: 0,
      pareceres_gerados: 0,
      pendentes_aprovacao: 0,
      alertas_ativos: 0,
    });

    res.json({
      periodo: fromParam || new Date().toISOString(),
      documentosProcessados: stats.documentos_processados || 0,
      pareceresGerados: stats.pareceres_gerados || 0,
      pendentesAprovacao: stats.pendentes_aprovacao || 0,
      alertasAtivos: stats.alertas_ativos || 0,
      ultimaAtualizacao: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Erro ao buscar stats:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ERROR HANDLING
// ─────────────────────────────────────────────────────────────────────────

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

app.use((error: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Erro não tratado:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// ─────────────────────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          ORGAS Backend API v2.0.44 - Iniciado                ║
╠══════════════════════════════════════════════════════════════╣
║  🌐 Server:          http://0.0.0.0:${PORT}
║  📚 Health:          http://0.0.0.0:${PORT}/health
║  🧠 Agente IA:       ${AGENT_API_URL}
║  💾 Database:        ${isPgEnabled() ? '✅ Conectado' : '❌ Desabilitado'}
║  📦 Reports DB:      ${isReportsDbEnabled() ? '✅ Conectado' : '❌ Desabilitado'}
║  🔐 Auth Required:   ${AUTH_REQUIRED ? '✅ Sim' : '❌ Não'}
╚══════════════════════════════════════════════════════════════╝
  `);
});

export default app;
