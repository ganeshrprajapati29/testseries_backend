import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

let client: Redis | null = null;

/**
 * Optional Redis connection (REDIS_URL). Every feature that uses Redis falls back gracefully
 * when it is not configured or temporarily unavailable, so Redis is never a single point of failure.
 */
export function getRedis(): Redis | null {
  if (!env.REDIS_URL || env.isTest) return null;
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      keyPrefix: env.REDIS_PREFIX,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      retryStrategy: (times) => Math.min(times * 500, 10_000),
    });
    client.on('ready', () => logger.info('Redis connected'));
    client.on('error', (err) => logger.warn({ err: err.message }, 'Redis error'));
  }
  return client;
}

export function redisReady(): boolean {
  return client?.status === 'ready';
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}
