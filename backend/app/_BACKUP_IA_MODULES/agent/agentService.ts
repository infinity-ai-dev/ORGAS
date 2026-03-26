import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { dbQuery } from '../config/database';
import { redisClient } from '../config/redis';
import { loadReferences } from './context';
import { callGemini } from './geminiClient';
import { runDocumentWorkflow } from './langgraphWorkflow';

type DbQueryRequest = { name?: string; sql: string; params?: unknown[] };
type DocumentInput = {
  name?: string;
  content?: string;
  mimeType?: string;
  type?: string;
  size?: number;
  lastModified?: number;
  contentSize?: number;
  file_uri?: string;
  mime_type?: string;
};
type RedisReadRequest =
  | { kind: 'get'; keys: string[] }
  | { kind: 'mget'; keys: string[] }
  | { kind: 'hgetall'; keys: string[] }
  | { kind: 'smembers'; keys: string[] }
  | { kind: 'lrange'; key: string; start: number; stop: number };

export type AgentRequest = {
  message?: string;
  userId?: string;
  threadId?: string;
  requestId?: string;
  reportId?: string | number;
  clientId?: string;
  clientName?: string;
  regimeTributario?: string;
  categoria?: string;
  tipoParecer?: string;
  competencia?: string;
  useLangGraph?: boolean;
  stage?: 'stage1' | 'stage2';
  dbQueries?: DbQueryRequest[];
  redisReads?: RedisReadRequest[];
  documents?: DocumentInput[];
  referencesDir?: string;
  referenceFiles?: string[];
  includeReferences?: boolean;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export type AgentResult = {
  requestId: string;
  response: string;
  referencesUsed: number;
  dbContext: Array<{ name?: string; rows: unknown[] }>;
  redisContext: Record<string, unknown>;
};

export async function runAgent(request: AgentRequest, logTask: (task: string, detail?: string) => void) {
  logTask('validar_request', 'iniciando');
  const message = (request.message || '').trim();

  const allowExternalContext = (process.env.AGENT_ALLOW_EXTERNAL_CONTEXT || 'false').toLowerCase() === 'true';

  const requestId = request.requestId || crypto.randomUUID();
  logTask('request_id', requestId);
  logTask('stage', request.stage || 'stage1');

  const hasDocuments = Array.isArray(request.documents) && request.documents.length > 0;
  const useLangGraphEnv = (process.env.AGENT_USE_LANGGRAPH || 'true').toLowerCase() === 'true';
  const useLangGraph = request.useLangGraph ?? useLangGraphEnv;

  if (useLangGraph && hasDocuments) {
    logTask('workflow_documentos', 'iniciado');
    const result = await runDocumentWorkflow({ ...request, requestId }, logTask);
    logTask('workflow_documentos', 'finalizado');
    return result;
  }

  if (!message) {
    throw new Error('message é obrigatório');
  }

  const referencesDir =
    (allowExternalContext && request.referencesDir) ||
    process.env.AGENT_REFERENCES_DIR ||
    path.join(process.cwd(), 'references');
  const includeReferences = request.includeReferences !== false;
  const maxRefChars = parseInt(process.env.AGENT_REF_MAX_CHARS || '140000', 10);

  const envRefFiles = (process.env.AGENT_REFERENCE_FILES || '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  const defaultRefFiles: string[] = [];
  let referenceFiles =
    allowExternalContext && request.referenceFiles && request.referenceFiles.length > 0
      ? request.referenceFiles
      : envRefFiles.length > 0
        ? envRefFiles
        : defaultRefFiles;

  const references = includeReferences
    ? await loadReferences(referencesDir, maxRefChars, logTask, referenceFiles)
    : { dir: referencesDir, files: [], merged: '' };
  logTask('referencias_carregadas', `count=${references.files.length} chars=${references.merged.length}`);

  const dbContext: Array<{ name?: string; rows: unknown[] }> = [];
  const dbQueries = allowExternalContext ? request.dbQueries : undefined;
  if (dbQueries && dbQueries.length > 0) {
    for (const [idx, q] of dbQueries.entries()) {
      const label = q.name || `db_query_${idx + 1}`;
      logTask('db_query', label);
      if (!/^\s*select/i.test(q.sql)) {
        throw new Error(`Query não permitida (apenas SELECT): ${label}`);
      }
      const result = await dbQuery(q.sql, q.params || []);
      dbContext.push({ name: label, rows: result.rows });
    }
  }
  logTask('db_context_pronto', `queries=${dbContext.length}`);

  const redisContext: Record<string, unknown> = {};
  const redisReads = allowExternalContext ? request.redisReads : undefined;
  if (redisReads && redisReads.length > 0) {
    for (const item of redisReads) {
      if (item.kind === 'get') {
        logTask('redis_get', item.keys.join(','));
        for (const key of item.keys) {
          redisContext[`get:${key}`] = await redisClient.get(key);
        }
      } else if (item.kind === 'mget') {
        logTask('redis_mget', item.keys.join(','));
        redisContext[`mget:${item.keys.join(',')}`] = await redisClient.mget(...item.keys);
      } else if (item.kind === 'hgetall') {
        logTask('redis_hgetall', item.keys.join(','));
        for (const key of item.keys) {
          redisContext[`hgetall:${key}`] = await redisClient.hgetall(key);
        }
      } else if (item.kind === 'smembers') {
        logTask('redis_smembers', item.keys.join(','));
        for (const key of item.keys) {
          redisContext[`smembers:${key}`] = await redisClient.smembers(key);
        }
      } else if (item.kind === 'lrange') {
        logTask('redis_lrange', `${item.key} ${item.start} ${item.stop}`);
        redisContext[`lrange:${item.key}:${item.start}:${item.stop}`] = await redisClient.lrange(
          item.key,
          item.start,
          item.stop
        );
      }
    }
  }
  logTask('redis_context_pronto', `keys=${Object.keys(redisContext).length}`);

  const docSummaries: Array<Record<string, unknown>> = [];
  if (request.documents && request.documents.length > 0) {
    const textLimit = parseInt(process.env.AGENT_DOC_TEXT_LIMIT || '6000', 10);
    const maxDocs = parseInt(process.env.AGENT_DOC_MAX_ITEMS || '10', 10);
    const docs = request.documents.slice(0, maxDocs);
    logTask('documentos_total', `recebidos=${request.documents.length} usados=${docs.length}`);
    for (const [idx, doc] of docs.entries()) {
      const name = doc.name || `documento_${idx + 1}`;
      const content = doc.content || '';
      const mimeType = doc.mimeType || '';
      logTask('documento_recebido', `${name} mime=${mimeType} chars=${content.length}`);

      let preview = '';
      let byteLength: number | null = null;
      let contentNote = '';
      try {
        const isDataUri = content.startsWith('data:') && content.includes(';base64,');
        const base64 = isDataUri ? content.split(',').pop() || '' : content;
        const buffer = Buffer.from(base64, 'base64');
        byteLength = buffer.length;
        const sample = buffer.slice(0, Math.min(buffer.length, 4096));
        const printable = sample.filter((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126));
        const printableRatio = sample.length ? printable.length / sample.length : 0;
        if (printableRatio > 0.85) {
          preview = buffer.toString('utf8').slice(0, textLimit);
          contentNote = 'texto_extraido';
        } else {
          contentNote = 'binario_base64';
        }
      } catch (error) {
        contentNote = `erro_leitura:${String(error)}`;
      }

      docSummaries.push({
        name,
        mimeType,
        byteLength,
        note: contentNote,
        preview
      });
    }
  }
  logTask('documentos_prontos', `count=${docSummaries.length}`);

  logTask('montar_prompt', 'compondo contexto');
  const stage = request.stage || 'stage1';
  const systemInstruction = [
    'Você é o Agente IA do backend Orgas.',
    'Responda sempre em pt-BR.',
    'Use os documentos de referência e o contexto de banco/redis quando disponíveis.',
    stage === 'stage1'
      ? 'Etapa 1: gere dados estruturados para o analista validar (resumo, inconsistências, riscos, perguntas).'
      : 'Etapa 2: finalize a análise para geração do parecer.',
    'Evite reproduzir trechos literais extensos; faça síntese com suas próprias palavras.',
    'Se houver dados pessoais sensíveis, mascare (ex.: ***).',
    'Se faltar informação, peça esclarecimentos objetivos.'
  ].join(' ');

  const contextBlocks = [
    request.userId ? `userId: ${request.userId}` : '',
    request.threadId ? `threadId: ${request.threadId}` : '',
    dbContext.length > 0 ? `DB Context:\n${JSON.stringify(dbContext)}` : '',
    Object.keys(redisContext).length > 0 ? `Redis Context:\n${JSON.stringify(redisContext)}` : '',
    docSummaries.length > 0 ? `Documentos:\n${JSON.stringify(docSummaries)}` : '',
    references.merged ? `Referências:\n${references.merged}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  const prompt = `${contextBlocks}\n\nMensagem do usuário:\n${message}`;

  const apiKey = readEnvOrFile('GEMINI_API_KEY', logTask);
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada (use GEMINI_API_KEY ou GEMINI_API_KEY_FILE)');
  }

  const forcedModel = 'gemini-2.5-pro';
  const requestedModel = request.model || process.env.GEMINI_MODEL;
  if (requestedModel && requestedModel !== forcedModel) {
    logTask('modelo_ignorado', `request=${requestedModel} fixado=${forcedModel}`);
  }
  const model = forcedModel;
  const temperature = request.temperature ?? Number(process.env.GEMINI_TEMPERATURE || 0.2);
  const maxOutputTokens =
    request.maxOutputTokens ??
    getOptionalNumberEnv('GEMINI_MAX_TOKENS') ??
    undefined;

  const { text } = await callGemini(
    prompt,
    systemInstruction,
    { apiKey, model, temperature, maxOutputTokens },
    logTask
  );

  logTask('finalizar_resposta', `chars=${text.length}`);

  return {
    requestId,
    response: text,
    referencesUsed: references.files.length,
    dbContext,
    redisContext
  } as AgentResult;
}

function readEnvOrFile(name: string, logTask?: (task: string, detail?: string) => void) {
  const direct = (process.env[name] || '').trim();
  if (direct) {
    return direct;
  }

  const fileVar = `${name}_FILE`;
  const filePath = (process.env[fileVar] || '').trim();
  if (!filePath) {
    return '';
  }

  try {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    if (value && logTask) {
      logTask('secret_lido', `${fileVar}=${filePath}`);
    }
    return value;
  } catch (error) {
    if (logTask) {
      logTask('secret_erro', `${fileVar}=${filePath} ${String(error)}`);
    }
    return '';
  }
}

function getOptionalNumberEnv(name: string) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}
