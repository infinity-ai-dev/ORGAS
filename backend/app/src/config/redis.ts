import './env';
import Redis from 'ioredis';

const REDIS_CONFIG = {
  host: (process.env.REDIS_HOST || 'localhost').trim(),
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
  showFriendlyErrorStack: process.env.NODE_ENV !== 'production'
};

export const redisClient = new Redis(REDIS_CONFIG);
export const redisSub = new Redis(REDIS_CONFIG);
export const redisPub = new Redis(REDIS_CONFIG);

redisClient.on('error', (err) => {
  console.error('❌ Erro no Redis:', err.message);
});
redisClient.on('close', () => {
  console.log('⚠️ Conexão Redis fechada');
});

export async function testRedisConnection() {
  try {
    const pong = await redisClient.ping();
    console.log('🏓 Redis PING:', pong);
    return pong === 'PONG';
  } catch (error) {
    console.error('❌ Redis não conectado:', error instanceof Error ? error.message : error);
    return false;
  }
}

process.on('SIGTERM', async () => {
  console.log('🔄 Desconectando Redis...');
  await redisClient.quit();
  await redisSub.quit();
  await redisPub.quit();
  console.log('👋 Redis desconectado');
});

process.on('SIGINT', async () => {
  console.log('🔄 Desconectando Redis...');
  await redisClient.quit();
  await redisSub.quit();
  await redisPub.quit();
  console.log('👋 Redis desconectado');
  process.exit(0);
});
