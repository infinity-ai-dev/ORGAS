import '../config/env';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { createAgentRouter } from './agentRouter';

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const frontendUrl = (process.env.FRONTEND_URL || (isProduction ? 'https://app.orgahold.com' : 'http://localhost:8080')).trim();

app.set('trust proxy', 1);
app.use(
  cors({
    origin: frontendUrl,
    credentials: true
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

function getAuthToken(req: express.Request) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '').trim();
  }
  return '';
}

function requireWebhookToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = getAuthToken(req);
  const webhookToken = readEnvOrFile('WEBHOOK_TOKEN');
  if (!webhookToken) {
    return res.status(500).json({ success: false, error: 'WEBHOOK_TOKEN não configurado' });
  }
  if (!token) {
    return res.status(401).json({ success: false, error: 'Token de autorização não fornecido' });
  }
  if (token !== webhookToken) {
    return res.status(403).json({ success: false, error: 'Token de autorização inválido' });
  }
  return next();
}

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'orgas-ai-agent',
    timestamp: new Date().toISOString()
  });
});

app.use(createAgentRouter(requireWebhookToken));

app.listen(PORT, () => {
  console.log('🤖 Agent server rodando na porta', PORT);
  console.log('🔐 Agent endpoints: /agente-ia e /api/agente-ia');
});
