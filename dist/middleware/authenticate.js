import { SESSION_COOKIE } from '../config/security.js';
import { resolveSession } from '../services/auth.service.js';
import { ApiError } from '../utils/ApiError.js';
async function attach(req) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || !token)
        return;
    const ctx = await resolveSession(token);
    if (ctx)
        req.auth = ctx;
}
/** Requires a valid session. Role checks are done by `authorize`. */
export async function authenticate(req, _res, next) {
    try {
        await attach(req);
        if (!req.auth)
            return next(ApiError.unauthorized());
        next();
    }
    catch (err) {
        next(err);
    }
}
/** Attaches the user when a session cookie is present but never rejects the request. */
export async function optionalAuth(req, _res, next) {
    try {
        await attach(req);
        next();
    }
    catch (err) {
        next(err);
    }
}
//# sourceMappingURL=authenticate.js.map