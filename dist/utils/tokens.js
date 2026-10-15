import crypto from 'node:crypto';
import { env } from '../config/env.js';
/** Cryptographically random URL-safe token. */
export function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}
/** Keyed hash so a database leak does not reveal usable session / reset tokens. */
export function hashToken(token) {
    return crypto.createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}
export function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length)
        return false;
    return crypto.timingSafeEqual(ab, bb);
}
//# sourceMappingURL=tokens.js.map