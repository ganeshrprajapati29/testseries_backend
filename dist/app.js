import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { corsOptions } from './config/cors.js';
import { env } from './config/env.js';
import { helmetMiddleware } from './config/security.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { requestLogger } from './middleware/requestLogger.js';
import routes from './routes/index.js';
export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    if (env.TRUST_PROXY)
        app.set('trust proxy', env.TRUST_PROXY);
    app.set('query parser', 'simple');
    app.use(requestLogger);
    app.use((req, _res, next) => {
        req.requestId = String(req.id);
        next();
    });
    app.use(helmetMiddleware);
    app.use(cors(corsOptions));
    app.use(compression());
    // The payment webhook signature is computed over the exact raw bytes.
    app.use('/api/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (req, _res, next) => {
        if (Buffer.isBuffer(req.body)) {
            req.rawBody = req.body;
            req.body = {};
        }
        next();
    });
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: false, limit: '1mb' }));
    app.use(cookieParser());
    if (env.STORAGE_DRIVER === 'local') {
        app.use(env.PUBLIC_UPLOAD_BASE_URL, express.static(path.resolve(env.UPLOAD_DIR), {
            index: false,
            dotfiles: 'deny',
            maxAge: '30d',
            immutable: true,
            setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
        }));
    }
    app.use('/api', apiLimiter, csrfProtection, routes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map