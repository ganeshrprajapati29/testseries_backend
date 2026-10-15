import type { Request, Response } from 'express';
import { adminDashboard } from '../services/analytics.service.js';
import { audit, listAuditLogs } from '../services/audit.service.js';
import * as userService from '../services/user.service.js';
import { adminListOrders } from '../services/payment.service.js';
import { ok, paginated } from '../utils/ApiResponse.js';

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
