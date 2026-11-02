import type { Request, Response } from 'express';
import * as testService from '../services/test.service.js';
import { audit } from '../services/audit.service.js';
import { created, ok, paginated } from '../utils/ApiResponse.js';
import type { PdfKind } from '../services/test.service.js';

// ---------- public
export async function categoryTests(req: Request, res: Response) {
  const { items, meta } = await testService.publicCategoryTests(req.query as never);
  return paginated(res, items, meta);
}

export async function detail(req: Request, res: Response) {
  return ok(res, await testService.publicTestDetail(String(req.params.slug), req.auth?.user.id));
}

/** Streams a question paper / solutions PDF after the access check. ?download=1 forces a download. */
async function sendPdf(req: Request, res: Response, file: { stream: NodeJS.ReadableStream; size?: number; fileName: string }) {
  const ascii = file.fileName.replace(/[^ -~]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  if (file.size) res.setHeader('Content-Length', String(file.size));
  file.stream.on('error', () => res.destroy());
  file.stream.pipe(res);
}

export async function pdf(req: Request, res: Response) {
  const file = await testService.getTestPdf({ slug: String(req.params.slug) }, req.params.kind as PdfKind, req.auth!.user.id, req.auth!.scope === 'admin');
  return sendPdf(req, res, file);
}

export async function paper(req: Request, res: Response) {
  return ok(res, await testService.getPrintablePaper(String(req.params.slug), req.auth!.user.id));
}

// ---------- admin
export async function adminPdf(req: Request, res: Response) {
  const file = await testService.getTestPdf({ id: String(req.params.id) }, req.params.kind as PdfKind, undefined, true);
  return sendPdf(req, res, file);
}

export async function adminPaper(req: Request, res: Response) {
  return ok(res, await testService.getPrintablePaperAdmin(String(req.params.id)));
}

export async function adminList(req: Request, res: Response) {
  const { items, meta } = await testService.adminListTests(req.query as never);
  return paginated(res, items, meta);
}

export async function adminGet(req: Request, res: Response) {
  return ok(res, await testService.adminGetTest(String(req.params.id)));
}

export async function create(req: Request, res: Response) {
  const test = await testService.createTest(req.body, req.auth!.user._id);
  await audit(req, { action: 'test.create', entityType: 'Test', entityId: test.id, summary: `Created "${test.title}"` });
  return created(res, test, (test.$locals.translationWarning as string | undefined) ?? 'Test created');
}

export async function update(req: Request, res: Response) {
  const test = await testService.updateTest(String(req.params.id), req.body, req.auth!.user._id);
  await audit(req, { action: 'test.update', entityType: 'Test', entityId: test.id, summary: `Updated "${test.title}"` });
  return ok(res, test, (test.$locals.translationWarning as string | undefined) ?? 'Test updated');
}

export async function setQuestions(req: Request, res: Response) {
  const test = await testService.setTestQuestions(String(req.params.id), req.body.questionIds, req.auth!.user._id);
  await audit(req, { action: 'test.questions_set', entityType: 'Test', entityId: test.id, metadata: { count: test.questionIds.length } });
  return ok(res, { questionCount: test.questionIds.length, totalMarks: test.totalMarks }, 'Questions updated');
}

export async function addQuestions(req: Request, res: Response) {
  const result = await testService.addTestQuestions(String(req.params.id), req.body.questionIds, req.auth!.user._id);
  await audit(req, { action: 'test.questions_add', entityType: 'Test', entityId: String(req.params.id), metadata: result });
  return ok(res, result, `${result.added} question(s) added`);
}

export async function removeQuestion(req: Request, res: Response) {
  const test = await testService.removeTestQuestion(String(req.params.id), String(req.params.questionId), req.auth!.user._id);
  await audit(req, { action: 'test.question_remove', entityType: 'Test', entityId: test.id, metadata: { questionId: req.params.questionId } });
  return ok(res, { questionCount: test.questionIds.length }, 'Question removed from test');
}

export async function setPublication(req: Request, res: Response) {
  const test = await testService.setTestPublication(String(req.params.id), req.body.publicationStatus, req.auth!.user._id);
  await audit(req, { action: `test.${req.body.publicationStatus}`, entityType: 'Test', entityId: test.id, summary: `"${test.title}" -> ${test.publicationStatus}` });
  return ok(res, test, `Test ${test.publicationStatus}`);
}

export async function duplicate(req: Request, res: Response) {
  const copy = await testService.duplicateTest(String(req.params.id), req.auth!.user._id);
  await audit(req, { action: 'test.duplicate', entityType: 'Test', entityId: copy.id, metadata: { sourceId: req.params.id } });
  return created(res, copy, 'Test duplicated as draft');
}

export async function preview(req: Request, res: Response) {
  return ok(res, await testService.previewTest(String(req.params.id)));
}

export async function remove(req: Request, res: Response) {
  const result = await testService.removeTest(String(req.params.id), req.auth!.user._id);
  await audit(req, { action: result.archived ? 'test.archive' : 'test.delete', entityType: 'Test', entityId: String(req.params.id) });
  return ok(res, result, result.archived ? 'Test has attempts, so it was archived instead of deleted' : 'Test deleted');
}
