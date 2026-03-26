const http = require('http');
const path = require('path');
const fs = require('fs');

function startMockAgentServer(port = 0) {
  const requests = [];

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || (req.url !== '/agente-ia' && req.url !== '/api/agente-ia')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'not_found' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch (_error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'invalid_json' }));
        return;
      }

      const documents = Array.isArray(payload.documents) ? payload.documents : [];
      const docCount = documents.length;
      const docName = documents[0]?.name || 'documento';
      requests.push({ docCount, docName, requestId: payload.requestId });

      if (docCount !== 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `expected 1 document, got ${docCount}` }));
        return;
      }

      const responsePayload = {
        requestId: payload.requestId || 'mock',
        response: `mock response for ${docName}`,
        referencesUsed: 0,
        dbContext: [],
        redisContext: {}
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result: responsePayload }));
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port, requests });
    });
  });
}

function injectMockModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject
  };
}

function buildDocs() {
  return [
    { name: 'doc-1.txt', content: Buffer.from('doc1').toString('base64'), mimeType: 'text/plain' },
    { name: 'doc-2.txt', content: Buffer.from('doc2').toString('base64'), mimeType: 'text/plain' },
    { name: 'doc-3.txt', content: Buffer.from('doc3').toString('base64'), mimeType: 'text/plain' }
  ];
}

function buildDocsFromDir(dirPath) {
  if (!dirPath) return [];
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath);
  const files = entries
    .filter((name) => /\.(pdf|txt|xml)$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  return files.map((name) => {
    const full = path.join(dirPath, name);
    const content = fs.readFileSync(full);
    return {
      name,
      content: content.toString('base64'),
      mimeType: name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain',
      size: content.length,
      lastModified: fs.statSync(full).mtimeMs
    };
  });
}

function logLine(message) {
  process.stdout.write(`${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS || '600000');

  const useMockAgent = (process.env.USE_MOCK_AGENT || 'true').toLowerCase() === 'true';
  let mockAgent = null;
  let requests = [];

  if (useMockAgent) {
    const mock = await startMockAgentServer();
    mockAgent = mock.server;
    requests = mock.requests;
    logLine(`mock agent server on http://127.0.0.1:${mock.port}`);
    process.env.AGENT_SERVICE_URL = `http://127.0.0.1:${mock.port}`;
    process.env.AGENT_SERVICE_PATH = '/agente-ia';
    process.env.AGENT_FALLBACK_LOCAL = 'false';
  } else {
    if (!process.env.AGENT_SERVICE_URL) {
      process.env.AGENT_FALLBACK_LOCAL = 'true';
    }
    if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY_FILE) {
      throw new Error('GEMINI_API_KEY (ou GEMINI_API_KEY_FILE) é obrigatório para usar agente real.');
    }
  }

  process.env.PORT = '3111';
  process.env.AUTH_REQUIRED = 'false';
  process.env.WEBHOOK_TOKEN = 'mock-token';
  process.env.AGENT_ISOLATE_DOCS = 'true';
  process.env.AGENT_CALC_WITH_CODE_EXECUTION = 'true';

  const reportsQueries = [];
  const databaseMock = {
    dbQuery: async () => ({ rows: [] }),
    reportsQuery: async (text, params) => {
      reportsQueries.push({ text, params });
      return { rows: [] };
    },
    isPgEnabled: () => false,
    isReportsDbEnabled: () => true
  };

  const redisMock = {
    redisClient: { on() {}, disconnect() {} },
    redisSub: { disconnect() {} },
    redisPub: { disconnect() {} },
    testRedisConnection: async () => false
  };

  const databasePath = path.join(__dirname, '..', 'dist', 'config', 'database.js');
  const redisPath = path.join(__dirname, '..', 'dist', 'config', 'redis.js');

  injectMockModule(databasePath, databaseMock);
  injectMockModule(redisPath, redisMock);

  require(path.join(__dirname, '..', 'dist', 'index.js'));

  await sleep(800);

  const defaultDocsDir = path.join(__dirname, '..', '..', '..', 'docs-teste');
  const docsDir = process.env.DOCS_DIR || defaultDocsDir;
  const docsFromDir = buildDocsFromDir(docsDir);
  const documents = docsFromDir.length > 0 ? docsFromDir : buildDocs();

  logLine(`docs source=${docsFromDir.length > 0 ? docsDir : 'inline'}`);
  logLine(`docs count=${documents.length}`);

  const payload = {
    analista_id: '1',
    analista_nome: 'Teste',
    cliente_id: '123',
    cliente_nome: 'Cliente Mock',
    categoria: 'teste',
    documents,
    message: 'teste webhook com arquivos locais'
  };

  const { status, bodyText } = await postJson(
    'http://127.0.0.1:3111/webhook/ai-submit',
    payload,
    {
      'Content-Type': 'application/json',
      Authorization: 'Bearer mock-token'
    },
    timeoutMs
  );

  logLine(`webhook status=${status}`);
  logLine(`webhook response=${bodyText.slice(0, 500)}`);

  const parsed = JSON.parse(bodyText || '{}');
  const analysis = parsed?.agent?.result?.response || '';
  const docsMeta = parsed?.agent?.result?.documents || [];

  logLine(`agent response chars=${analysis.length}`);
  logLine(`agent documents=${docsMeta.length}`);
  if (useMockAgent) {
    logLine(`mock requests received=${requests.length}`);
    const bad = requests.filter((r) => r.docCount !== 1);
    if (bad.length > 0) {
      logLine('FAILED: some requests had docCount != 1');
      process.exitCode = 1;
    } else {
      logLine('OK: each request had exactly 1 document');
    }
  } else {
    logLine('mock agent not used; real agent mode');
  }

  const updateQuery = reportsQueries.find((q) => typeof q.text === 'string' && q.text.includes('UPDATE relatorios_pendentes'));
  if (updateQuery?.params?.[1]) {
    try {
      const parsedJson = JSON.parse(updateQuery.params[1]);
      const previewDocs = parsedJson?.analise_previa?.documentos || [];
      logLine(`db analise_previa documentos=${previewDocs.length}`);
    } catch (_error) {
      logLine('db analise_previa parse failed');
    }
  } else {
    logLine('db update not captured');
  }

  if (mockAgent) {
    mockAgent.close();
  }
  await sleep(200);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function postJson(url, payload, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const data = JSON.stringify(payload || {});
    const request = http.request(
      {
        method: 'POST',
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, bodyText: body });
        });
      }
    );

    request.on('error', (err) => reject(err));
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('timeout'));
    });
    request.write(data);
    request.end();
  });
}
