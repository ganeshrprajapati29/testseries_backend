import { describe, expect, it } from 'vitest';
import { createAdminAccount } from '../services/auth.service.js';
import { adminClient, client, studentClient } from './helpers.js';

async function adminLogin(email: string, password: string) {
  const c = await client();
  const res = await c.post('/api/auth/admin/login', { email, password });
  await c.refreshCsrf();
  return { c, status: res.status };
}

describe('admin account settings', () => {
  it('lets an admin change their own login email and password', async () => {
    const admin = await adminClient('owner@example.com', 'Adm1nPassword');

    expect((await admin.post('/api/auth/change-email', { currentPassword: 'wrong', newEmail: 'new.owner@example.com' })).status).toBe(422);
    const changed = await admin.post('/api/auth/change-email', { currentPassword: 'Adm1nPassword', newEmail: 'New.Owner@example.com' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.user.email).toBe('New.Owner@example.com');
    // Still signed in on this device.
    expect((await admin.get('/api/admin/dashboard')).status).toBe(200);
    expect((await adminLogin('owner@example.com', 'Adm1nPassword')).status).toBe(401);
    expect((await adminLogin('new.owner@example.com', 'Adm1nPassword')).status).toBe(200);

    const pw = await admin.post('/api/auth/change-password', { currentPassword: 'Adm1nPassword', newPassword: 'Br4ndNewPass' });
    expect(pw.status).toBe(200);
    expect((await adminLogin('new.owner@example.com', 'Br4ndNewPass')).status).toBe(200);

    // Email already used by someone else.
    await studentClient('taken@example.com');
    const taken = await admin.post('/api/auth/change-email', { currentPassword: 'Br4ndNewPass', newEmail: 'taken@example.com' });
    expect(taken.status).toBe(422);
  });

  it('lets a super admin add admins, change their email and reset their password', async () => {
    const owner = await adminClient('owner@example.com', 'Adm1nPassword');
    const created = await owner.post('/api/admin/admins', { name: 'Content Admin', email: 'content@example.com', password: 'Content123', role: 'admin' });
    expect(created.status).toBe(201);
    const id = created.body.data._id;
    expect(created.body.data.passwordHash).toBeUndefined();
    expect((await owner.get('/api/admin/admins')).body.data.map((a: { email: string }) => a.email)).toEqual(['owner@example.com', 'content@example.com']);

    const { c: content } = await adminLogin('content@example.com', 'Content123');
    // Normal admins cannot manage admins.
    expect((await content.get('/api/admin/admins')).status).toBe(403);

    await owner.patch(`/api/admin/admins/${id}`, { email: 'editor@example.com' });
    expect((await content.get('/api/admin/dashboard')).status).toBe(401); // signed out after the email change
    await owner.post(`/api/admin/admins/${id}/reset-password`, { password: 'Reset12345' });
    expect((await adminLogin('editor@example.com', 'Reset12345')).status).toBe(200);
  });

  it('never removes the last active super admin', async () => {
    const owner = await adminClient('owner@example.com', 'Adm1nPassword');
    const me = (await owner.get('/api/auth/me')).body.data.user.id;
    expect((await owner.patch(`/api/admin/admins/${me}`, { accountStatus: 'suspended' })).status).toBe(400);
    expect((await owner.patch(`/api/admin/admins/${me}`, { role: 'admin' })).status).toBe(400);

    await createAdminAccount({ name: 'Second', email: 'second@example.com', password: 'Second123', role: 'superadmin' });
    const { c: second } = await adminLogin('second@example.com', 'Second123');
    // The other super admin can be demoted while the owner stays.
    const ownerId = me;
    expect((await second.patch(`/api/admin/admins/${ownerId}`, { role: 'admin' })).status).toBe(200);
    // Now "second" is the only super admin and cannot be removed by anyone.
    const secondId = (await second.get('/api/auth/me')).body.data.user.id;
    expect((await second.patch(`/api/admin/admins/${secondId}`, { role: 'admin' })).status).toBe(400);
  });
});
