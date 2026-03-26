import crypto from 'crypto';
import fs from 'fs';
import { runAgent } from './agentService';
import type { AgentRequest, AgentResult } from './agentService';

type DocumentInput = NonNullable<AgentRequest['documents']>[number];

export type AgentDocumentOutcome = {
  index: number;
  name: string;
  requestId: string;
  success: boolean;
  response?: string;
  error?: string;
};

export type AgentBatchResult = AgentResult & {
  documents: AgentDocumentOutcome[];
  errors: Array<{ index: number; name: string; error: string }>;
};

type AgentInvokeLogger = (task: string, detail?: string) => void;

const DEFAULT_AGENT_PATH = '/api/agente-ia';
const DEFAULT_TIMEOUT_MS = 120000;

export async function runAgentForDocuments(
  baseRequest: AgentRequest,
  documents: DocumentInput[],
  logTask: AgentInvokeLogger
): Promise<AgentBatchResult> {
  const batchRequestId =
    String(baseRequest.requestId || baseRequest.reportId || baseRequest.threadId || '') ||
    crypto.randomUUID();
  const totalDocs = documents.length;

  const outcomes: AgentDocumentOutcome[] = [];
  const combinedParts: string[] = [];
  let referencesUsed = 0;

  for (const [idx, doc] of documents.entries()) {
    const docName = doc?.name || (doc as any)?.documentoNome || `documento_${idx + 1}`;
    const requestId = `${batchRequestId}_doc_${idx + 1}`;
    const message = buildDocumentMessage(baseRequest.message, docName, idx, totalDocs);
    const perRequest: AgentRequest = {
      ...baseRequest,
      requestId,
      message,
      documents: [doc]
    };

    const docLog: AgentInvokeLogger = (task, detail) => {
      logTask(`doc_${idx + 1}:${task}`, detail);
    };

    try {
      docLog('chamada_iniciada', docName);
      const result = await invokeAgent(perRequest, docLog);
      referencesUsed += result.referencesUsed || 0;
      outcomes.push({
        index: idx,
        name: docName,
        requestId: result.requestId || requestId,
        success: true,
        response: result.response
      });

      if (result.response) {
        combinedParts.push(formatDocumentResponse(docName, idx, totalDocs, result.response));
      }
      docLog('chamada_finalizada', `chars=${result.response?.length || 0}`);
    } catch (error: any) {
      const message = error?.message || String(error);
      outcomes.push({
        index: idx,
        name: docName,
        requestId,
        success: false,
        error: message
      });
      docLog('chamada_erro', message);
    }
  }

  const errors = outcomes
    .filter((item) => !item.success)
    .map((item) => ({ index: item.index, name: item.name, error: item.error || 'erro' }));

  const response = combinedParts.join('\n\n').trim();

  return {
    requestId: batchRequestId,
    response,
    referencesUsed,
    dbContext: [],
    redisContext: {},
    documents: outcomes,
    errors
  };
}

async function invokeAgent(request: AgentRequest, logTask: AgentInvokeLogger): Promise<AgentResult> {
  const serviceUrl = getAgentServiceUrl();
  if (serviceUrl) {
    return callRemoteAgent(serviceUrl, request, logTask);
  }

  if (!shouldFallbackToLocalAgent()) {
    throw new Error('AGENT_SERVICE_URL nao configurado e AGENT_FALLBACK_LOCAL=false');
  }

  logTask('fallback_local', 'runAgent');
  return runAgent(request, logTask);
}

async function callRemoteAgent(baseUrl: string, request: AgentRequest, logTask: AgentInvokeLogger): Promise<AgentResult> {
  const path = getAgentServicePath() || DEFAULT_AGENT_PATH;
  const url = joinUrl(baseUrl, path);
  const token = getWebhookToken();
  const timeoutMs = getNumberEnv('AGENT_SERVICE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => {
        controller.abort();
      }, timeoutMs)
    : null;

  logTask('agent_service_call', url);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller?.signal
    });

    const rawText = await response.text();
    let payload: any = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch (_error) {
      payload = null;
    }

    if (!response.ok) {
      const snippet = rawText ? rawText.slice(0, 500) : '';
      throw new Error(`Agent service HTTP ${response.status}: ${snippet}`);
    }

    if (payload?.success === false) {
      throw new Error(payload.error || 'agent_error');
    }

    const result = payload?.result || payload || {};
    return {
      requestId: result.requestId || request.requestId || crypto.randomUUID(),
      response: result.response || '',
      referencesUsed: result.referencesUsed || 0,
      dbContext: Array.isArray(result.dbContext) ? result.dbContext : [],
      redisContext: result.redisContext || {}
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function buildDocumentMessage(
  baseMessage: string | undefined,
  docName: string,
  index: number,
  total: number
) {
  const message = (baseMessage || '').trim();
  const header = `Documento ${index + 1}/${total}: ${docName}`;
  if (!message) {
    return header;
  }
  return `${header}\n\n${message}`;
}

function formatDocumentResponse(docName: string, index: number, total: number, response: string) {
  const header = `# Documento ${index + 1}/${total}: ${docName}`;
  return `${header}\n${response}`;
}

function readEnvOrFile(name: string) {
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

function getWebhookToken() {
  const token = readEnvOrFile('WEBHOOK_TOKEN');
  if (token) return token;
  return readEnvOrFile('VITE_WEBHOOK_TOKEN');
}

function getAgentServiceUrl() {
  return (process.env.AGENT_SERVICE_URL || '').trim();
}

function getAgentServicePath() {
  return (process.env.AGENT_SERVICE_PATH || '').trim();
}

function shouldFallbackToLocalAgent() {
  return (process.env.AGENT_FALLBACK_LOCAL || 'false').toLowerCase() === 'true';
}

function joinUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function getNumberEnv(name: string, fallback: number) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}
