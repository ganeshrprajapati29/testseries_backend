import type { Request, Response } from 'express';
import * as resultService from '../services/result.service.js';
import * as userService from '../services/user.service.js';
import { studentOrders } from '../services/payment.service.js';
import { ok, paginated } from '../utils/ApiResponse.js';

export async function dashboard(req: Request, res: Response) {
  const [data, enrollments] = await Promise.all([
    resultService.studentDashboard(req.auth!.user.id),
    userService.myEnrollments(req.auth!.user.id),
  ]);
  return ok(res, { ...data, enrollments });
}

export async function myTests(req: Request, res: Response) {
  return ok(res, await userService.myEnrollments(req.auth!.user.id));
}

export async function attempts(req: Request, res: Response) {
  const { items, meta } = await resultService.studentAttemptHistory(req.auth!.user.id, req.query as never);
  return paginated(res, items, meta);
}

export async function orders(req: Request, res: Response) {
  return ok(res, await studentOrders(req.auth!.user.id));
}
