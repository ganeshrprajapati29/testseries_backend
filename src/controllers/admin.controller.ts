import type { Request, Response } from 'express';
import { adminDashboard } from '../services/analytics.service.js';
import { audit, listAuditLogs } from '../services/audit.service.js';
import * as userService from '../services/user.service.js';
import { adminListOrders } from '../services/payment.service.js';
import { created, ok, paginated } from '../utils/ApiResponse.js';

export async function dashboard(_req: Request, res: Response) {
  return ok(res, await adminDashboard());
}

export async function listStudents(req: Request, res: Response) {
  const { items, meta } = await userService.listStudents(req.query as never);
  return paginated(res, items, meta);
}

export async function getStudent(req: Request, res: Response) {
  return ok(res, await userService.studentDetail(String(req.params.id)));
}

export async function studentStats(_req: Request, res: Response) {
  return ok(res, await userService.studentStats());
}

export async function exportStudents(req: Request, res: Response) {
  const csv = await userService.exportStudentsCsv(req.query as never);
  await audit(req, { action: 'student.export', entityType: 'User', summary: 'Exported students CSV', metadata: { query: req.query } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="students-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}

export async function createStudent(req: Request, res: Response) {
  const user = await userService.createStudent(req.body);
  await audit(req, { action: 'student.create', entityType: 'User', entityId: user.id, summary: user.email });
  return created(res, user, 'Student created');
}

export async function updateStudent(req: Request, res: Response) {
  const user = await userService.updateStudent(String(req.params.id), req.body);
  await audit(req, { action: 'student.update', entityType: 'User', entityId: user.id, summary: user.email, metadata: { fields: Object.keys(req.body) } });
  return ok(res, user, 'Student updated');
}

export async function resetStudentPassword(req: Request, res: Response) {
  const user = await userService.adminResetPassword(String(req.params.id), req.body.password);
  await audit(req, { action: 'student.reset_password', entityType: 'User', entityId: user.id, summary: user.email });
  return ok(res, null, 'Password reset. The student has been signed out of all devices.');
}

export async function deleteStudent(req: Request, res: Response) {
  const out = await userService.deleteStudent(String(req.params.id));
  await audit(req, { action: 'student.delete', entityType: 'User', entityId: String(req.params.id), summary: out.email, metadata: out.removed });
  return ok(res, out, 'Student deleted');
}

export async function setStudentStatus(req: Request, res: Response) {
  const user = await userService.setStudentStatus(String(req.params.id), req.body.accountStatus);
  await audit(req, {
    action: 'student.status',
    entityType: 'User',
    entityId: user.id,
    summary: `${user.email} -> ${user.accountStatus}`,
  });
  return ok(res, user, 'Student status updated');
}

export async function grantAccess(req: Request, res: Response) {
  const enrollment = await userService.grantSeriesAccess(String(req.params.id), req.body.testSeriesId, req.auth!.user._id, req.body.validityDays);
  await audit(req, { action: 'student.grant_access', entityType: 'User', entityId: String(req.params.id), metadata: { testSeriesId: req.body.testSeriesId } });
  return ok(res, enrollment, 'Access granted');
}

export async function revokeAccess(req: Request, res: Response) {
  await userService.revokeSeriesAccess(String(req.params.id), String(req.params.seriesId));
  await audit(req, { action: 'student.revoke_access', entityType: 'User', entityId: String(req.params.id), metadata: { testSeriesId: req.params.seriesId } });
  return ok(res, null, 'Access revoked');
}

export async function auditLogs(req: Request, res: Response) {
  const { items, meta } = await listAuditLogs(req.query as never);
  return paginated(res, items, meta);
}

export async function orders(req: Request, res: Response) {
  const { items, meta } = await adminListOrders(req.query as never);
  return paginated(res, items, meta);
}
