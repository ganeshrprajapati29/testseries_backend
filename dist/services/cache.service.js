import { logger } from '../config/logger.js';
import { getRedis, redisReady } from '../config/redis.js';
async function namespaceVersion(ns) {
    const redis = getRedis();
    if (!redis)
        return '0';
    return (await redis.get(`ns:${ns}:version`)) ?? '0';
}
export async function cached(ns, key, ttlSeconds, load) {
    const redis = getRedis();
    if (!redis || !redisReady())
        return load();
    let fullKey = null;
    try {
        fullKey = `ns:${ns}:v${await namespaceVersion(ns)}:${key}`;
        const hit = await redis.get(fullKey);
        if (hit !== null)
            return JSON.parse(hit);
    }
    catch (err) {
        logger.warn({ err: err.message, key }, 'Cache read failed - using database');
        return load();
    }
    const value = await load();
    // JSON round-trip so cache hits and misses return exactly the same shape.
    const serialised = JSON.stringify(value);
    redis.set(fullKey, serialised, 'EX', ttlSeconds).catch((err) => logger.warn({ err: err.message }, 'Cache write failed'));
    return JSON.parse(serialised);
}
export async function invalidate(...namespaces) {
    const redis = getRedis();
    if (!redis || !redisReady())
        return;
    try {
        await Promise.all(namespaces.map((ns) => redis.incr(`ns:${ns}:version`)));
    }
    catch (err) {
        logger.warn({ err: err.message }, 'Cache invalidation failed');
    }
}
/** Stable cache key from query parameters. */
export function keyFrom(prefix, params) {
    const parts = Object.keys(params)
        .sort()
        .filter((k) => params[k] !== undefined && params[k] !== '')
        .map((k) => `${k}=${String(params[k])}`);
    return `${prefix}?${parts.join('&')}`;
}
//# sourceMappingURL=cache.service.js.map