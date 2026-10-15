import type { Request, Response } from 'express';
import { SESSION_COOKIE, sessionCookieOptions } from '../config/security.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import * as authService from '../services/auth.service.js';
import { audit } from '../services/audit.service.js';
import { getSetting } from '../services/settings.service.js';
import { ApiError } from '../utils/ApiError.js';
import { ok, created } from '../utils/ApiResponse.js';

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? '' };
}

function setSessionCookie(res: Response, token: string, ttl: number) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(ttl));
  // Rotate the CSRF token whenever the session changes.
  issueCsrfToken(res);
}

function clearSessionCookie(res: Response) {
  const { maxAge: _m, ...opts } = sessionCookieOptions(0);
  res.clearCookie(SESSION_COOKIE, opts);
}

export async function csrf(_req: Request, res: Response) {
  const token = issueCsrfToken(res);
  return ok(res, { csrfToken: token });
}

export async function register(req: Request, res: Response) {
  if (!(await getSetting('registrationOpen'))) throw ApiError.forbidden('New registrations are currently closed');
  const { user, token, ttl } = await authService.registerStudent(req.body, meta(req));
  setSessionCookie(res, token, ttl);
  return created(res, { user: authService.publicUser(user) }, 'Account created successfully');
}

export async function login(req: Request, res: Response) {
  const { user, token, ttl } = await authService.login(req.body, 'student', meta(req));
  setSessionCookie(res, token, ttl);
  return ok(res, { user: authService.publicUser(user) }, 'Logged in successfully');
}

export async function adminLogin(req: Request, res: Response) {
  try {
    const { user, token, ttl } = await authService.login(req.body, 'admin', meta(req));
    setSessionCookie(res, token, ttl);
    req.auth = { user: { id: user.id, _id: user._id, name: user.name, email: user.email, role: user.role }, sessionId: '', scope: 'admin' };
    await audit(req, { action: 'admin.login', entityType: 'User', entityId: user.id, summary: 'Admin signed in' });
    return ok(res, { user: authService.publicUser(user) }, 'Logged in successfully');
  } catch (err) {
    await audit(req, { action: 'admin.login_failed', entityType: 'User', summary: `Failed admin login for ${String(req.body?.email ?? '').slice(0, 100)}` });
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  if (req.auth) await authService.revokeSession(req.auth.sessionId);
  clearSessionCookie(res);
  issueCsrfToken(res);
  return ok(res, null, 'Logged out');
}

export async function logoutAll(req: Request, res: Response) {
  await authService.revokeAllSessions(req.auth!.user.id);
  clearSessionCookie(res);
  return ok(res, null, 'Logged out from all devices');
}

export async function me(req: Request, res: Response) {
  if (!req.auth) return ok(res, { user: null });
  const user = await authService.getUserById(req.auth.user.id);
  return ok(res, { user: authService.publicUser(user), scope: req.auth.scope });
}

export async function forgotPassword(req: Request, res: Response) {
  await authService.requestPasswordReset(req.body.email, req.ip);
  return ok(res, null, 'If an account exists for this email, a password reset link has been sent.');
}

export async function resetPassword(req: Request, res: Response) {
  await authService.resetPassword(req.body.token, req.body.password);
  clearSessionCookie(res);
  return ok(res, null, 'Your password has been reset. Please sign in with your new password.');
}

export async function changePassword(req: Request, res: Response) {
  await authService.changePassword(req.auth!.user.id, req.auth!.sessionId, req.body.currentPassword, req.body.newPassword);
  if (req.auth!.scope === 'admin') await audit(req, { action: 'admin.password_changed', entityType: 'User', entityId: req.auth!.user.id });
  return ok(res, null, 'Password changed. Other devices have been signed out.');
}
