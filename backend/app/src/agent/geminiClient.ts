export type GeminiConfig = {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  enableCodeExecution?: boolean;
};

export type GeminiResponse = {
  text: string;
  raw: unknown;
};

export async function callGemini(
  prompt: string,
  systemInstruction: string,
  config: GeminiConfig,
  logTask: (task: string, detail?: string) => void
): Promise<GeminiResponse> {
  logTask('gemini_chamada_iniciada', `model=${config.model}`);

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  const generationConfig: Record<string, unknown> = {
    temperature: config.temperature
  };
  if (typeof config.maxOutputTokens === 'number') {
    generationConfig.maxOutputTokens = config.maxOutputTokens;
  }

  const enableCodeExecution =
    typeof config.enableCodeExecution === 'boolean'
      ? config.enableCodeExecution
      : (process.env.GEMINI_CODE_EXECUTION || 'false').toLowerCase() === 'true';
  const forceCodeExecution =
    (process.env.GEMINI_CODE_EXECUTION_FORCE || 'false').toLowerCase() === 'true';

  const finalSystemInstruction = enableCodeExecution
    ? `${systemInstruction}\n\n${
        forceCodeExecution
          ? 'You MUST use the code_execution tool in this response. It is mandatory.'
          : 'Use code execution (Python) for calculations when needed.'
      }`
    : systemInstruction;

  const body = {
    systemInstruction: {
      parts: [{ text: finalSystemInstruction }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig,
    ...(enableCodeExecution ? { tools: [{ code_execution: {} }] } : {})
  };

  const timeoutMs = getNumberEnv('GEMINI_REQUEST_TIMEOUT_MS', 30000);
  const maxRetries = getNumberEnv('GEMINI_REQUEST_RETRIES', 1);
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

    logTask('gemini_chamada_request', `attempt=${attempt} timeoutMs=${timeoutMs}`);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller?.signal
      });

      const elapsedMs = Date.now() - startedAt;
      logTask('gemini_chamada_response', `attempt=${attempt} status=${res.status} ms=${elapsedMs}`);

      if (!res.ok) {
        const errText = await res.text();
        const retryable = shouldRetryStatus(res.status);
        logTask(
          'gemini_chamada_erro',
          `attempt=${attempt} status=${res.status} retryable=${retryable} body=${errText.slice(0, 500)}`
        );
        if (retryable && attempt <= maxRetries) {
          continue;
        }
        throw new Error(`Gemini error ${res.status}: ${errText}`);
      }

      data = (await res.json()) as any;
      lastError = null;
      break;
    } catch (error: any) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const isAbort = error?.name === 'AbortError';
      if (isAbort) {
        logTask('gemini_chamada_timeout', `attempt=${attempt} ms=${elapsedMs}`);
      } else {
        logTask('gemini_chamada_erro', `attempt=${attempt} err=${error?.message || String(error)}`);
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
    throw lastError || new Error('Gemini falhou sem resposta');
  }
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    const blockReason = data?.promptFeedback?.blockReason;
    logTask(
      'gemini_resposta_sem_texto',
      `finish=${finishReason || 'n/a'} block=${blockReason || 'n/a'}`
    );
    const rawSnippet = safeJsonSnippet(data);
    if (rawSnippet) {
      logTask('gemini_resposta_raw', rawSnippet);
    }
    throw new Error('Gemini response sem conteúdo de texto');
  }
  const text = extractGeminiTextFromParts(parts);

  logTask('gemini_chamada_sucesso', `chars=${text.length}`);
  return { text, raw: data };
}

function safeJsonSnippet(value: unknown, limit = 2000) {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return '';
    return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
  } catch (_error) {
    return '[unserializable]';
  }
}

function extractGeminiTextFromParts(parts: any[]): string {
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

function getNumberEnv(name: string, fallback: number) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function shouldRetryStatus(status: number) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}
