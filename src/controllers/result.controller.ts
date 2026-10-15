import type { Request, Response } from 'express';
import * as resultService from '../services/result.service.js';
import { audit } from '../services/audit.service.js';
import { ok, paginated } from '../utils/ApiResponse.js';

// ---------- student
export async function myResult(req: Request, res: Response) {
  return ok(res, await resultService.getStudentResult(String(req.params.attemptId), req.auth!.user.id));
}

export async function mySolutions(req: Request, res: Response) {
  return ok(res, await resultService.getSolutions(String(req.params.attemptId), req.auth!.user.id));
}

// ---------- admin
export async function adminList(req: Request, res: Response) {
  const { items, meta } = await resultService.adminListResults(req.query as never);
  return paginated(res, items, meta);
}

export async function adminExport(req: Request, res: Response) {
  const csv = await resultService.adminResultsCsv(req.query as never);
  await audit(req, { action: 'results.export', entityType: 'Result', metadata: { query: req.query } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="results-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(`${String.fromCharCode(0xfeff)}${csv}`);
}

export async function adminAttempts(req: Request, res: Response) {
  const { items, meta } = await resultService.adminListAttempts(req.query as never);
  return paginated(res, items, meta);
}

export async function adminAttemptDetail(req: Request, res: Response) {
  return ok(res, await resultService.adminAttemptDetail(String(req.params.id)));
}
