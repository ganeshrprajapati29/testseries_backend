import { CSRF_COOKIE, CSRF_HEADER, csrfCookieOptions } from '../config/security.js';
import { ApiError } from '../utils/ApiError.js';
import { randomToken, safeEqual } from '../utils/tokens.js';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Paths that are called server-to-server and authenticate with their own signature. */
const EXEMPT_PATHS = ['/api/payments/webhook'];
export function issueCsrfToken(res) {
    const token = randomToken(24);
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
    return token;
}
/**
 * Double-submit cookie CSRF protection. The SPA reads the non-HttpOnly `cs_csrf` cookie and
 * echoes it in the `X-CSRF-Token` header. A cross-site attacker can neither read the cookie
 * nor set the custom header.
 */
export function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) {
        if (!req.cookies?.[CSRF_COOKIE])
            issueCsrfToken(res);
        return next();
    }
    if (EXEMPT_PATHS.some((p) => req.originalUrl.startsWith(p)))
        return next();
    const cookieToken = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.get(CSRF_HEADER);
    if (typeof cookieToken !== 'string' || typeof headerToken !== 'string' || !safeEqual(cookieToken, headerToken)) {
        return next(new ApiError(403, 'Invalid or missing CSRF token. Please refresh the page and try again.', 'CSRF_FAILED'));
    }
    next();
}
//# sourceMappingURL=csrf.js.map