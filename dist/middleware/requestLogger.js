import crypto from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '../config/logger.js';
export const requestLogger = pinoHttp({
    logger,
    genReqId(req, res) {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        req.requestId = id;
        return id;
    },
    customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500)
            return 'error';
        if (res.statusCode >= 400)
            return 'warn';
        return 'info';
    },
    autoLogging: { ignore: (req) => req.url === '/api/health' },
    serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
    },
});
//# sourceMappingURL=requestLogger.js.map