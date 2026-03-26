import { Router } from 'express';
import { runAgent } from './agentService';

export function createAgentRouter(authMiddleware?: (req: any, res: any, next: any) => void) {
  const router = Router();

  const middlewares = authMiddleware ? [authMiddleware] : [];

  router.post(['/agente-ia', '/api/agente-ia'], ...middlewares, async (req, res) => {
    const logTask = (task: string, detail?: string) => {
      const prefix = detail ? ` - ${detail}` : '';
      console.log(`🧠 [AGENTE-IA] ${task}${prefix}`);
    };

    try {
      logTask('request_recebida', `ip=${req.ip}`);
      const result = await runAgent(req.body || {}, logTask);
      res.json({ success: true, ...result });
    } catch (error: any) {
      logTask('erro', error?.message || String(error));
      res.status(500).json({
        success: false,
        error: error?.message || 'Erro interno'
      });
    }
  });

  return router;
}
