import { describe, expect, it } from 'vitest';
import { OrderModel } from '../models/Order.model.js';
import { ResultModel } from '../models/Result.model.js';
import { UserModel } from '../models/User.model.js';
import { adminClient, client, makePublishedTest, studentClient } from './helpers.js';

const newStudent = { name: 'Walk In', email: 'walkin@example.com', mobile: '+91-9811122233', password: 'Passw0rd1' };

describe('admin student management', () => {
  it('creates, lists, updates and resets the password of a student', async () => {
    const admin = await adminClient();
    const res = await admin.post('/api/admin/students', newStudent);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Walk In', mobile: '9811122233', role: 'student' });
    expect(res.body.data.passwordHash).toBeUndefined();
    const id = res.body.data._id;

    // Email and mobile must stay unique.
    expect((await admin.post('/api/admin/students', { ...newStudent, mobile: '9811122299' })).body.error.code).toBe('EMAIL_TAKEN');
    expect((await admin.post('/api/admin/students', { ...newStudent, email: 'other@example.com' })).body.error.code).toBe('MOBILE_TAKEN');

    // The student can sign in with the password the admin set.
    const s = await client();
    expect((await s.post('/api/auth/login', { email: newStudent.email, password: newStudent.password })).status).toBe(200);

    const upd = await admin.patch(`/api/admin/students/${id}`, { name: 'Walk In Renamed', mobile: '9811100000', preferredLanguage: 'hi' });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ name: 'Walk In Renamed', mobile: '9811100000', preferredLanguage: 'hi' });

    const list = await admin.get('/api/admin/students?search=renamed&sort=name');
    expect(list.body.data.map((u: { email: string }) => u.email)).toEqual(['walkin@example.com']);
    expect(list.body.data[0]).toHaveProperty('enrollmentCount', 0);

    const stats = await admin.get('/api/admin/students/stats');
    expect(stats.body.data).toMatchObject({ total: 1, active: 1, newThisWeek: 1 });

    // Resetting the password signs the student out everywhere.
    expect((await admin.post(`/api/admin/students/${id}/reset-password`, { password: 'NewPassw0rd' })).status).toBe(200);
    expect((await s.get('/api/auth/me')).body.data.user).toBeNull();
    const s2 = await client();
    expect((await s2.post('/api/auth/login', { email: newStudent.email, password: 'NewPassw0rd' })).status).toBe(200);

    // Deactivating through PATCH also signs the student out.
    await s2.refreshCsrf();
    await admin.patch(`/api/admin/students/${id}`, { accountStatus: 'suspended' });
    expect((await s2.get('/api/auth/me')).body.data.user).toBeNull();
  });

  it('exports students as CSV with formula injection neutralised', async () => {
    const admin = await adminClient();
    await admin.post('/api/admin/students', { ...newStudent, name: '=HYPERLINK("x")' });
    const res = await admin.get('/api/admin/students/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Name,Email,Mobile');
    expect(res.text).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('deletes a student with their results, but keeps students who paid', async () => {
    const admin = await adminClient();
    const { test, series } = await makePublishedTest({ questions: 2 });
    const { c, user } = await studentClient('del@example.com');
    const start = await c.post(`/api/exams/tests/${test._id}/start`);
    expect(start.status).toBe(201);
    await c.post(`/api/exams/attempts/${start.body.data.attemptId}/submit`);
    expect(await ResultModel.countDocuments({ studentId: user.id })).toBe(1);

    const del = await admin.del(`/api/admin/students/${user.id}`);
    expect(del.status).toBe(200);
    expect(del.body.data.removed).toMatchObject({ attempts: 1, results: 1 });
    expect(await UserModel.exists({ _id: user.id })).toBeNull();
    expect(await ResultModel.countDocuments({ studentId: user.id })).toBe(0);

    const { user: payer } = await studentClient('payer@example.com');
    await OrderModel.create({ studentId: payer.id, testSeriesId: series._id, amount: 49900, currency: 'INR', orderStatus: 'paid', receipt: 'r1', providerOrderId: 'order_1' });
    const blocked = await admin.del(`/api/admin/students/${payer.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('HAS_PAYMENTS');
  });

  it('never lets the student endpoints touch admin accounts', async () => {
    const admin = await adminClient();
    const adminUser = await UserModel.findOne({ role: 'superadmin' }).lean();
    expect((await admin.patch(`/api/admin/students/${adminUser!._id}`, { name: 'Hacked' })).status).toBe(404);
    expect((await admin.del(`/api/admin/students/${adminUser!._id}`)).status).toBe(404);
  });
});
