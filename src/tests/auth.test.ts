import { describe, expect, it } from 'vitest';
import { SessionModel } from '../models/Session.model.js';
import { UserModel } from '../models/User.model.js';
import { PasswordResetModel } from '../models/PasswordReset.model.js';
import { hashToken } from '../utils/tokens.js';
import { adminClient, client, studentClient } from './helpers.js';

describe('authentication', () => {
  it('registers a student with a hashed password and an HttpOnly session cookie', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', { name: 'Asha', email: 'Asha@Example.com', password: 'Passw0rd1' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('student');
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/cs_session=.*HttpOnly/i);

    const user = await UserModel.findOne({ normalizedEmail: 'asha@example.com' }).select('+passwordHash');
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('ignores a role sent by the client during registration', async () => {
    const c = await client();
    const res = await c.post('/api/auth/register', { name: 'Hacker', email: 'h@example.com', password: 'Passw0rd1', role: 'superadmin' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('student');
  });

  it('rejects duplicate emails and weak passwords', async () => {
    await studentClient('dup@example.com');
    const c = await client();
    expect((await c.post('/api/auth/register', { name: 'Dup', email: 'DUP@example.com', password: 'Passw0rd1' })).status).toBe(409);
    const weak = await c.post('/api/auth/register', { name: 'Weak', email: 'weak@example.com', password: 'short' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires a CSRF token for state-changing requests', async () => {
    const c = await client();
    const res = await c.agent.post('/api/auth/login').send({ email: 'x@example.com', password: 'whatever1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('logs in, returns the current user and invalidates the session on logout', async () => {
    const { c } = await studentClient('login@example.com');
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).body.data.user).toBeNull();

    const fresh = await client();
    const bad = await fresh.post('/api/auth/login', { email: 'login@example.com', password: 'wrongPass1' });
    expect(bad.status).toBe(401);
    const ok = await fresh.post('/api/auth/login', { email: 'login@example.com', password: 'Passw0rd1' });
    expect(ok.status).toBe(200);
    await fresh.refreshCsrf();
    expect((await fresh.get('/api/auth/me')).body.data.user.email).toBe('login@example.com');

    await fresh.post('/api/auth/logout');
    expect(await SessionModel.countDocuments({ revokedAt: null })).toBe(0);
    expect((await fresh.get('/api/student/dashboard')).status).toBe(401);
  });

  it('locks the account after repeated failed logins', async () => {
    await studentClient('lock@example.com');
    const c = await client();
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: 'lock@example.com', password: 'wrongPass1' });
    const res = await c.post('/api/auth/login', { email: 'lock@example.com', password: 'Passw0rd1' });
    expect(res.status).toBe(423);
  });

  it('keeps admins and students on separate login portals', async () => {
    await adminClient('boss@example.com', 'Adm1nPassword');
    const c = await client();
    expect((await c.post('/api/auth/login', { email: 'boss@example.com', password: 'Adm1nPassword' })).status).toBe(403);

    await studentClient('pupil@example.com');
    const s = await client();
    expect((await s.post('/api/auth/admin/login', { email: 'pupil@example.com', password: 'Passw0rd1' })).status).toBe(401);
  });

  it('blocks students from admin APIs', async () => {
    const { c } = await studentClient();
    expect((await c.get('/api/admin/dashboard')).status).toBe(403);
    const anon = await client();
    expect((await anon.get('/api/admin/dashboard')).status).toBe(401);
  });

  it('resets a password with a single-use token and revokes sessions', async () => {
    const { c } = await studentClient('reset@example.com');
    const forgot = await c.post('/api/auth/forgot-password', { email: 'reset@example.com' });
    expect(forgot.status).toBe(200);
    // Unknown emails get the same response.
    expect((await c.post('/api/auth/forgot-password', { email: 'nobody@example.com' })).status).toBe(200);

    const user = await UserModel.findOne({ normalizedEmail: 'reset@example.com' });
    const token = 'known-token-for-testing-purposes-1234567890';
    await PasswordResetModel.create({ userId: user!._id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60000) });

    const res = await c.post('/api/auth/reset-password', { token, password: 'NewPassw0rd' });
    expect(res.status).toBe(200);
    expect((await c.post('/api/auth/reset-password', { token, password: 'NewPassw0rd2' })).status).toBe(400);
    expect((await c.get('/api/student/dashboard')).status).toBe(401);

    const fresh = await client();
    expect((await fresh.post('/api/auth/login', { email: 'reset@example.com', password: 'NewPassw0rd' })).status).toBe(200);
  });

  it('changes the password when the current one is correct', async () => {
    const { c } = await studentClient('change@example.com');
    expect((await c.post('/api/auth/change-password', { currentPassword: 'bad', newPassword: 'Another1pass' })).status).toBe(422);
    expect((await c.post('/api/auth/change-password', { currentPassword: 'Passw0rd1', newPassword: 'Another1pass' })).status).toBe(200);
    // Current session stays valid.
    expect((await c.get('/api/student/dashboard')).status).toBe(200);
  });
});
