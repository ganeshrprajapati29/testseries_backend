import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { getRedis } from '../config/redis.js';
/** Counters live in Redis when available so limits hold across restarts and multiple processes. */
function store(name) {
    const redis = getRedis();
    if (!redis)
        return {};
    return {
        store: new RedisStore({
            prefix: `rl:${name}:`,
            sendCommand: (command, ...args) => redis.call(command, ...args),
        }),
        // If Redis is briefly unavailable, let requests through instead of failing them.
        passOnStoreError: true,
    };
}
const base = {
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.isTest,
    handler: (_req, res, _next, options) => {
        res.status(options.statusCode).json({
            success: false,
            error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later.' },
        });
    },
};
/** General API limiter. */
export const apiLimiter = rateLimit({ ...base, ...store('api'), windowMs: 60 * 1000, limit: 300 });
/** Login / register - protects against credential stuffing. */
export const authLimiter = rateLimit({ ...base, ...store('auth'), windowMs: 15 * 60 * 1000, limit: 20 });
/** Forgot-password - prevents email bombing. */
export const passwordResetLimiter = rateLimit({ ...base, ...store('reset'), windowMs: 60 * 60 * 1000, limit: 5 });
/** Answer autosave can be chatty during an exam. */
export const examLimiter = rateLimit({ ...base, ...store('exam'), windowMs: 60 * 1000, limit: 240 });
export const uploadLimiter = rateLimit({ ...base, ...store('upload'), windowMs: 60 * 60 * 1000, limit: 60 });
/** Machine translation calls an external provider - keep admins well inside its free limits. */
export const translateLimiter = rateLimit({ ...base, ...store('translate'), windowMs: 60 * 1000, limit: 30 });
//# sourceMappingURL=rateLimiter.js.map