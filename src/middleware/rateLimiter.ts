import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config/env.js';

const base: Partial<Options> = {
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
export const apiLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 300 });

/** Login / register - protects against credential stuffing. */
export const authLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 20 });

/** Forgot-password - prevents email bombing. */
export const passwordResetLimiter = rateLimit({ ...base, windowMs: 60 * 60 * 1000, limit: 5 });

/** Answer autosave can be chatty during an exam. */
export const examLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 240 });

export const uploadLimiter = rateLimit({ ...base, windowMs: 60 * 60 * 1000, limit: 60 });
