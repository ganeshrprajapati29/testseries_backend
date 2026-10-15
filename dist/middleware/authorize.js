import { ApiError } from '../utils/ApiError.js';
const ROLE_PERMISSIONS = {
    student: [],
    admin: ['content:read', 'content:write', 'students:read', 'students:write', 'results:read', 'payments:read'],
    superadmin: [
        'content:read',
        'content:write',
        'students:read',
        'students:write',
        'results:read',
        'settings:write',
        'audit:read',
        'payments:read',
        'admins:manage',
    ],
};
export function hasPermission(role, permission) {
    return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
/** Restricts a route to the given roles. Roles always come from the server-side session. */
export function requireRole(...roles) {
    return (req, _res, next) => {
        if (!req.auth)
            return next(ApiError.unauthorized());
        if (!roles.includes(req.auth.user.role))
            return next(ApiError.forbidden());
        next();
    };
}
/** Admin routes additionally require that the session was created through the admin login. */
export function requireAdminSession(req, _res, next) {
    if (!req.auth)
        return next(ApiError.unauthorized());
    if (req.auth.scope !== 'admin' || !['admin', 'superadmin'].includes(req.auth.user.role)) {
        return next(ApiError.forbidden('Admin access required'));
    }
    next();
}
export function requirePermission(...permissions) {
    return (req, _res, next) => {
        if (!req.auth)
            return next(ApiError.unauthorized());
        const allowed = permissions.every((p) => hasPermission(req.auth.user.role, p));
        if (!allowed)
            return next(ApiError.forbidden());
        next();
    };
}
//# sourceMappingURL=authorize.js.map