import { logger } from '../config/logger.js';
import { getRedis, redisReady } from '../config/redis.js';

/**
 * Read-through cache for public, user-independent responses.
 *
 * Keys are versioned per namespace (`ns:<name>:v<version>:<key>`). Invalidation simply increments
 * the namespace version, so stale entries are never read again and expire through their TTL -
 * no KEYS/SCAN needed.
 */
export type CacheNamespace = 'catalog' | 'settings';

async function namespaceVersion(ns: CacheNamespace): Promise<string> {
  const redis = getRedis();
  if (!redis) return '0';
  return (await redis.get(`ns:${ns}:version`)) ?? '0';
}

export async function cached<T>(ns: CacheNamespace, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (!redis || !redisReady()) return load();

  let fullKey: string | null = null;
  try {
    fullKey = `ns:${ns}:v${await namespaceVersion(ns)}:${key}`;
    const hit = await redis.get(fullKey);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (err) {
    logger.warn({ err: (err as Error).message, key }, 'Cache read failed - using database');
    return load();
  }

  const value = await load();
  // JSON round-trip so cache hits and misses return exactly the same shape.
  const serialised = JSON.stringify(value);
  redis.set(fullKey, serialised, 'EX', ttlSeconds).catch((err) => logger.warn({ err: err.message }, 'Cache write failed'));
  return JSON.parse(serialised) as T;
}

export async function invalidate(...namespaces: CacheNamespace[]): Promise<void> {
  const redis = getRedis();
  if (!redis || !redisReady()) return;
  try {
    await Promise.all(namespaces.map((ns) => redis.incr(`ns:${ns}:version`)));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Cache invalidation failed');
  }
}

/** Stable cache key from query parameters. */
export function keyFrom(prefix: string, params: Record<string, unknown>): string {
  const parts = Object.keys(params)
    .sort()
    .filter((k) => params[k] !== undefined && params[k] !== '')
    .map((k) => `${k}=${String(params[k])}`);
  return `${prefix}?${parts.join('&')}`;
}
