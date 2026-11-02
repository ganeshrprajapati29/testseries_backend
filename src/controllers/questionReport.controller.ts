import type { Request, Response } from 'express';
import { audit } from '../services/audit.service.js';
import * as reportService from '../services/questionReport.service.js';
import { created, ok, paginated } from '../utils/ApiResponse.js';

// ---------- student ----------
export async function create(req: Request, res: Response) {
  const { report, updated } = await reportService.reportQuestion(req.auth!.user.id, String(req.params.attemptId), req.body);
  const message = 'Thanks! Our team will review this question.';
  return updated ? ok(res, report, message) : created(res, report, message);
}

export async function mine(req: Request, res: Response) {
  return ok(res, await reportService.myAttemptReports(req.auth!.user.id, String(req.params.attemptId)));
}

// ---------- admin ----------
export async function counts(_req: Request, res: Response) {
  return ok(res, await reportService.reportCounts());
}

export async function byQuestion(req: Request, res: Response) {
  const { items, meta } = await reportService.reportsByQuestion(req.query as never);
  return paginated(res, items, meta);
}

export async function forQuestion(req: Request, res: Response) {
  return ok(res, await reportService.reportsForQuestion(String(req.params.questionId), req.query.status as never));
}

export async function update(req: Request, res: Response) {
  const report = await reportService.updateReport(String(req.params.id), req.body, req.auth!.user._id);
  await audit(req, { action: 'question_report.update', entityType: 'QuestionReport', entityId: String(report._id), summary: `Report -> ${report.status}` });
  return ok(res, report, `Report marked ${report.status}`);
}

export async function closeForQuestion(req: Request, res: Response) {
  const result = await reportService.closeQuestionReports(String(req.params.questionId), req.body, req.auth!.user._id);
  await audit(req, {
    action: 'question_report.close_all',
    entityType: 'Question',
    entityId: String(req.params.questionId),
    summary: `${result.updated} report(s) ${req.body.status}`,
  });
  return ok(res, result, `${result.updated} report(s) marked ${req.body.status}`);
}
