import crypto from 'crypto';

export type GeminiGenerationConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  responseMimeType?: string;
};

export type GeminiContentPart = {
  text?: string;
  file_data?: {
    file_uri: string;
    mime_type: string;
  };
};

export type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiContentPart[];
};

export type GeminiGenerateResponse = {
  text: string;
  raw: any;
};

export type GeminiFileInfo = {
  uri: string;
  mimeType: string;
  state: string;
  name?: string;
  sizeBytes?: number;
};

const DEFAULT_UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const DEFAULT_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function callGeminiGenerateContent(
  params: {
    apiKey: string;
    model: string;
    systemInstruction: string;
    contents: GeminiContent[];
    generationConfig?: GeminiGenerationConfig;
    forceDisableTools?: boolean;
  },
  logTask: (task: string, detail?: string) => void
): Promise<GeminiGenerateResponse> {
  logTask('gemini_generate_start', `model=${params.model}`);
  const url = `${DEFAULT_GENERATE_URL}/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(
    params.apiKey
  )}`;

  const timeoutMs = getNumberEnv('GEMINI_REQUEST_TIMEOUT_MS', 30000);
  const maxRetries = getNumberEnv('GEMINI_REQUEST_RETRIES', 1);

  const enableCodeExecution = (process.env.GEMINI_CODE_EXECUTION || 'false').toLowerCase() === 'true';
  const forceCodeExecution =
    (process.env.GEMINI_CODE_EXECUTION_FORCE || 'false').toLowerCase() === 'true';
  const allowJsonWithCodeExecution =
    (process.env.GEMINI_CODE_EXECUTION_ALLOW_JSON || 'false').toLowerCase() === 'true';
  const dropJsonForCodeExecution =
    (process.env.GEMINI_CODE_EXECUTION_DROP_JSON || 'false').toLowerCase() === 'true';
  const hasFileData = params.contents?.some((content) =>
    content?.parts?.some((part) => part && typeof part === 'object' && 'file_data' in part)
  );
  let generationConfig = params.generationConfig || {};
  const responseMimeType = generationConfig.responseMimeType;
  const forceDisableTools = params.forceDisableTools === true;
  let canUseCodeExecution =
    !forceDisableTools &&
    enableCodeExecution &&
    (forceCodeExecution || (!hasFileData && (!responseMimeType || allowJsonWithCodeExecution)));

  if (forceDisableTools) {
    logTask('code_execution_desativado', 'force_disable_tools');
  } else if (enableCodeExecution && hasFileData && !forceCodeExecution) {
    logTask('code_execution_desativado', 'file_data presente');
  } else if (enableCodeExecution && hasFileData && forceCodeExecution) {
    logTask('code_execution_forcado', 'file_data presente');
  }

  // Gemini nao aceita tools + responseMimeType. Remover sempre que code_execution estiver ativo.
  if (canUseCodeExecution && responseMimeType) {
    generationConfig = { ...generationConfig };
    delete generationConfig.responseMimeType;
    logTask('code_execution_json_desativado', 'tools+responseMimeType nao suportado');
  } else if (enableCodeExecution && responseMimeType && dropJsonForCodeExecution) {
    generationConfig = { ...generationConfig };
    delete generationConfig.responseMimeType;
    canUseCodeExecution = true;
    logTask('code_execution_json_desativado', 'responseMimeType removido');
  } else if (enableCodeExecution && responseMimeType && !allowJsonWithCodeExecution && !forceCodeExecution) {
    logTask('code_execution_desativado', 'responseMimeType em uso');
  } else if (enableCodeExecution && responseMimeType && !allowJsonWithCodeExecution && forceCodeExecution) {
    logTask('code_execution_forcado', 'responseMimeType em uso');
  }
  const finalSystemInstruction = canUseCodeExecution
    ? `${params.systemInstruction}\n\n${
        forceCodeExecution
          ? 'You MUST use the code_execution tool in this response. It is mandatory.'
          : 'Use code execution (Python) for calculations when needed.'
      }`
    : params.systemInstruction;
  if (canUseCodeExecution) {
    logTask('code_execution_ativado', `model=${params.model}`);
  }

  const body = {
    systemInstruction: {
      parts: [{ text: finalSystemInstruction }]
    },
    contents: params.contents,
    generationConfig,
    ...(canUseCodeExecution ? { tools: [{ code_execution: {} }] } : {})
  };

  let data: any = null;
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const startedAt = Date.now();
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

    logTask('gemini_generate_request', `attempt=${attempt} timeoutMs=${timeoutMs}`);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller?.signal
      });

      const elapsedMs = Date.now() - startedAt;
      logTask('gemini_generate_response', `attempt=${attempt} status=${res.status} ms=${elapsedMs}`);

      if (!res.ok) {
        const errText = await res.text();
        const retryable = shouldRetryStatus(res.status);
        logTask(
          'gemini_generate_error',
          `attempt=${attempt} status=${res.status} retryable=${retryable} body=${errText.slice(0, 500)}`
        );
        if (retryable && attempt <= maxRetries) {
          continue;
        }
        throw new Error(`Gemini generateContent error ${res.status}: ${errText}`);
      }

      data = (await res.json()) as any;
      lastError = null;
      break;
    } catch (error: any) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const isAbort = error?.name === 'AbortError';
      if (isAbort) {
        logTask('gemini_generate_timeout', `attempt=${attempt} ms=${elapsedMs}`);
      } else {
        logTask('gemini_generate_error', `attempt=${attempt} err=${error?.message || String(error)}`);
      }
      if (attempt <= maxRetries) {
        continue;
      }
      break;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  if (!data) {
    throw lastError || new Error('Gemini generateContent falhou sem resposta');
  }

  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    let codeChars = 0;
    for (const part of parts) {
      const output =
        part?.codeExecutionResult?.output ??
        part?.code_execution_result?.output ??
        part?.codeExecutionResult?.stdout ??
        part?.code_execution_result?.stdout;
      if (typeof output === 'string' && output.trim()) {
        codeChars += output.length;
      }
    }
    if (codeChars > 0) {
      logTask('code_execution_result', `chars=${codeChars}`);
    }
  }
  const text = extractGeminiText(data);
  if (!text || !text.trim()) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    const blockReason = data?.promptFeedback?.blockReason;
    const errorStatus = data?.promptFeedback?.blockReasonMessage;
    const rawSnippet = safeJsonSnippet(data, 1500);
    logTask(
      'gemini_generate_empty',
      `finish=${finishReason || 'n/a'} block=${blockReason || 'n/a'} msg=${errorStatus || 'n/a'}`
    );
    if (rawSnippet) {
      logTask('gemini_generate_raw', rawSnippet);
    }
  }

  logTask('gemini_generate_done', `chars=${text.length}`);
  return { text, raw: data };
}

function safeJsonSnippet(value: unknown, limit = 1500) {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return '';
    return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
  } catch (_error) {
    return '[unserializable]';
  }
}

function getNumberEnv(name: string, fallback: number) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function shouldRetryStatus(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export async function uploadFileToGemini(
  params: {
    apiKey: string;
    buffer: Buffer;
    mimeType: string;
    displayName?: string;
  },
  logTask: (task: string, detail?: string) => void
): Promise<GeminiFileInfo> {
  const normalizeDisplayName = (value: string) => {
    const fallback = `documento-${crypto.randomUUID()}.pdf`;
    if (!value) return fallback;
    const cleaned = String(value)
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .trim();
    if (!cleaned) return fallback;
    const ascii = cleaned.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const safe = ascii.replace(/[^\w.\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const limited = safe.slice(0, 120);
    return limited || fallback;
  };

  const normalizeMimeType = (value?: string) => {
    const raw = (value || '').trim();
    return raw || 'application/pdf';
  };

  const baseDisplayName = normalizeDisplayName(params.displayName || `documento-${crypto.randomUUID()}.pdf`);
  const baseMimeType = normalizeMimeType(params.mimeType);

  const attemptUpload = async (displayName: string, mimeType: string, attempt: number) => {
    logTask('gemini_upload_start', `${displayName} bytes=${params.buffer.length} mime=${mimeType} attempt=${attempt}`);

    const startRes = await fetch(`${DEFAULT_UPLOAD_URL}?key=${encodeURIComponent(params.apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(params.buffer.length),
        'X-Goog-Upload-Header-Content-Type': mimeType
      },
      body: JSON.stringify({ file: { display_name: displayName } })
    });

    if (!startRes.ok) {
      const errText = await startRes.text();
      logTask('gemini_upload_start_error', `status=${startRes.status} body=${errText.slice(0, 200)}`);
      throw new Error(`Gemini upload start error ${startRes.status}: ${errText}`);
    }

    const uploadUrl = startRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
      throw new Error('Gemini upload start response missing x-goog-upload-url header');
    }

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Content-Length': String(params.buffer.length),
        'Content-Length': String(params.buffer.length),
        'Content-Type': mimeType
      },
      body: params.buffer as unknown as BodyInit
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      logTask('gemini_upload_finalize_error', `status=${uploadRes.status} body=${errText.slice(0, 200)}`);
      throw new Error(`Gemini upload finalize error ${uploadRes.status}: ${errText}`);
    }

    const responseBody = (await uploadRes.json()) as any;
    const file = responseBody.file || responseBody;
    if (!file || !file.uri) {
      throw new Error('Gemini upload finalize response missing file info');
    }

    logTask('gemini_upload_done', `${file.uri} state=${file.state}`);
    return {
      uri: file.uri,
      mimeType: file.mimeType,
      state: file.state,
      name: file.name,
      sizeBytes: file.sizeBytes
    } as GeminiFileInfo;
  };

  try {
    return await attemptUpload(baseDisplayName, baseMimeType, 1);
  } catch (error) {
    const fallbackName = `documento-${crypto.randomUUID()}.pdf`;
    const fallbackMime = 'application/pdf';
    logTask('gemini_upload_retry', `fallback_name=${fallbackName} fallback_mime=${fallbackMime}`);
    return await attemptUpload(fallbackName, fallbackMime, 2);
  }
}

export async function waitForFileActive(
  params: {
    apiKey: string;
    fileUri: string;
    maxAttempts?: number;
    delayMs?: number;
  },
  logTask: (task: string, detail?: string) => void
): Promise<GeminiFileInfo> {
  const maxAttempts = params.maxAttempts ?? 10;
  const delayMs = params.delayMs ?? 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(`${params.fileUri}?key=${encodeURIComponent(params.apiKey)}`);
    if (!res.ok) {
      const errText = await res.text();
      logTask('gemini_file_status_error', `status=${res.status} body=${errText.slice(0, 200)}`);
      throw new Error(`Gemini file status error ${res.status}: ${errText}`);
    }

    const file = (await res.json()) as any;
    const state = file.state || 'UNKNOWN';
    logTask('gemini_file_status', `${params.fileUri} attempt=${attempt} state=${state}`);

    if (state === 'ACTIVE') {
      return {
        uri: file.uri,
        mimeType: file.mimeType,
        state: file.state,
        name: file.name,
        sizeBytes: file.sizeBytes
      };
    }

    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  throw new Error(`Arquivo não ficou ACTIVE após ${maxAttempts} tentativas`);
}

export function extractGeminiText(payload: any): string {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }
  const textParts: string[] = [];
  const codeOutputs: string[] = [];

  for (const part of parts) {
    if (typeof part?.text === 'string' && part.text) {
      textParts.push(part.text);
    }

    const output =
      part?.codeExecutionResult?.output ??
      part?.code_execution_result?.output ??
      part?.codeExecutionResult?.stdout ??
      part?.code_execution_result?.stdout;

    if (typeof output === 'string' && output.trim()) {
      codeOutputs.push(output);
    }
  }

  if (textParts.some((text) => text.trim().length > 0)) {
    return textParts.join('');
  }

  if (codeOutputs.length > 0) {
    return codeOutputs.join('\n');
  }

  return '';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
