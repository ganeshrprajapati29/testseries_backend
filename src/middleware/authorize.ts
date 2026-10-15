import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../types/enums.js';
import { ApiError } from '../utils/ApiError.js';

export type Permission =
  | 'content:read'
  | 'content:write'
  | 'students:read'
  | 'students:write'
  | 'results:read'
  | 'settings:write'
  | 'audit:read'
  | 'payments:read'
  | 'admins:manage';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
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

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Restricts a route to the given roles. Roles always come from the server-side session. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(ApiError.unauthorized());
    if (!roles.includes(req.auth.user.role)) return next(ApiError.forbidden());
    next();
  };
}

/** Admin routes additionally require that the session was created through the admin login. */
export function requireAdminSession(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(ApiError.unauthorized());
  if (req.auth.scope !== 'admin' || !['admin', 'superadmin'].includes(req.auth.user.role)) {
    return next(ApiError.forbidden('Admin access required'));
  }
  next();
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(ApiError.unauthorized());
    const allowed = permissions.every((p) => hasPermission(req.auth!.user.role, p));
    if (!allowed) return next(ApiError.forbidden());
    next();
  };
}
