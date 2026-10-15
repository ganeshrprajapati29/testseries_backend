import pino from 'pino';
import { env } from './env.js';
export const logger = pino({
    level: env.isTest ? 'silent' : env.LOG_LEVEL,
    redact: {
        paths: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers["x-csrf-token"]',
            'res.headers["set-cookie"]',
            '*.password',
            '*.passwordHash',
            '*.token',
        ],
        censor: '[redacted]',
    },
    transport: !env.isProd && !env.isTest ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } : undefined,
});
//# sourceMappingURL=logger.js.map