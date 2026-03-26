export type AuthUser = {
  id: string;
  nome: string;
  email: string;
  role?: string;
  cargo?: string;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

const AUTH_STORAGE_KEY = 'orgas_auth_session';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
const API_PREFIX = import.meta.env.VITE_API_PREFIX || '/api';
const FRONTEND_SECRET = import.meta.env.VITE_FRONTEND_PROXY_SECRET || '';

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function getAuthSession(): AuthSession | null {
  return safeJsonParse<AuthSession>(localStorage.getItem(AUTH_STORAGE_KEY));
}

export function setAuthSession(session: AuthSession) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function getAuthToken(): string | null {
  return getAuthSession()?.token || null;
}

export function buildApiUrl(path: string, usePrefix = true) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = API_BASE_URL.replace(/\/$/, '');
  const prefix = usePrefix ? API_PREFIX.replace(/\/$/, '') : '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${prefix}${normalizedPath}`;
}

export type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  skipAuth?: boolean;
  usePrefix?: boolean;
};

export class ApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export async function apiFetch<T = any>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { skipAuth, usePrefix = true, body, headers, ...rest } = options;
  const url = buildApiUrl(path, usePrefix);

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined)
  };

  const token = getAuthToken();
  if (!skipAuth && token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  if (FRONTEND_SECRET) {
    requestHeaders['X-Frontend-Secret'] = FRONTEND_SECRET;
  }

  const response = await fetch(url, {
    ...rest,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const data = safeJsonParse<T>(text) ?? (text as unknown as T);

  if (!response.ok) {
    const message = (data as any)?.error || (data as any)?.message || text || 'Erro na requisição';
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}
