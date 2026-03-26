const http = require('http');
const path = require('path');

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
      } catch (error) {
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

function buildDocs() {
  return [
    { name: 'doc-1.txt', content: Buffer.from('doc1').toString('base64'), mimeType: 'text/plain' },
    { name: 'doc-2.txt', content: Buffer.from('doc2').toString('base64'), mimeType: 'text/plain' },
    { name: 'doc-3.txt', content: Buffer.from('doc3').toString('base64'), mimeType: 'text/plain' }
  ];
}

function logLine(message) {
  process.stdout.write(`${message}\n`);
}

async function main() {
  const { server, port, requests } = await startMockAgentServer();
  logLine(`mock agent server on http://127.0.0.1:${port}`);

  process.env.AGENT_SERVICE_URL = `http://127.0.0.1:${port}`;
  process.env.AGENT_SERVICE_PATH = '/agente-ia';
  process.env.AGENT_FALLBACK_LOCAL = 'false';

  const orchestratorPath = path.join(__dirname, '..', 'dist', 'agent', 'agent-orchestrator.js');
  const { runAgentForDocuments } = require(orchestratorPath);

  const docs = buildDocs();
  const baseRequest = {
    message: 'teste de orquestracao',
    requestId: 'test-batch',
    reportId: 123
  };

  const logs = [];
  const logTask = (task, detail) => {
    logs.push({ task, detail });
  };

  const result = await runAgentForDocuments(baseRequest, docs, logTask);

  logLine(`result requestId=${result.requestId}`);
  logLine(`documents total=${result.documents.length}`);
  logLine(`errors total=${result.errors.length}`);

  const bad = requests.filter((r) => r.docCount !== 1);
  if (bad.length > 0) {
    logLine('FAILED: some requests had docCount != 1');
    process.exitCode = 1;
  } else {
    logLine('OK: each request had exactly 1 document');
  }

  logLine(`mock requests received=${requests.length}`);
  requests.forEach((r, idx) => {
    logLine(`request ${idx + 1}: docCount=${r.docCount} name=${r.docName} requestId=${r.requestId}`);
  });

  server.close();
  await shutdownRedis();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function shutdownRedis() {
  try {
    const redisPath = path.join(__dirname, '..', 'dist', 'config', 'redis.js');
    const redis = require(redisPath);
    if (redis.redisClient?.disconnect) {
      redis.redisClient.disconnect();
    }
    if (redis.redisSub?.disconnect) {
      redis.redisSub.disconnect();
    }
    if (redis.redisPub?.disconnect) {
      redis.redisPub.disconnect();
    }
  } catch (_error) {
    // ignore shutdown errors
  }
}
