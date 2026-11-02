import type { Request, Response } from 'express';
import * as questionService from '../services/question.service.js';
import { audit } from '../services/audit.service.js';
import { storeImage } from '../services/storage.service.js';
import { bulkSetCategories } from '../services/questionCategory.service.js';
import { translateQuestions } from '../services/questionTranslate.service.js';
import { ApiError } from '../utils/ApiError.js';
import { created, noContent, ok, paginated } from '../utils/ApiResponse.js';

export async function list(req: Request, res: Response) {
  const { items, meta } = await questionService.listQuestions(req.query as never);
  return paginated(res, items, meta);
}

export async function bulkCategories(req: Request, res: Response) {
  const result = await bulkSetCategories(req.body.questionIds, req.body.categoryIds, req.body.mode);
  await audit(req, { action: 'question.bulk_categories', entityType: 'Question', summary: `${req.body.mode} categories on ${result.updated} question(s)` });
  return ok(res, result, `${result.updated} question(s) updated`);
}

export async function bulkTranslate(req: Request, res: Response) {
  const result = await translateQuestions(req.body.questionIds, req.body.overwrite);
  await audit(req, { action: 'question.bulk_translate', entityType: 'Question', summary: `Hindi translation for ${result.translated} question(s)`, metadata: result });
  const msg = result.failed ? `${result.translated} translated, ${result.failed} failed - try again later` : `${result.translated} question(s) translated to Hindi${result.skipped ? `, ${result.skipped} already had Hindi` : ''}`;
  return ok(res, result, msg);
}

export async function facets(_req: Request, res: Response) {
  return ok(res, await questionService.questionFacets());
}

export async function get(req: Request, res: Response) {
  return ok(res, await questionService.getQuestion(String(req.params.id)));
}

export async function create(req: Request, res: Response) {
  const { question, warning } = await questionService.createQuestion(req.body, req.auth!.user._id);
  await audit(req, { action: 'question.create', entityType: 'Question', entityId: question.id });
  return created(res, { ...question.toJSON(), translationWarning: warning ?? null }, warning ?? 'Question created');
}

export async function update(req: Request, res: Response) {
  const { question, warning } = await questionService.updateQuestion(String(req.params.id), req.body, req.auth!.user._id);
  await audit(req, { action: 'question.update', entityType: 'Question', entityId: question.id });
  return ok(res, { ...question.toJSON(), translationWarning: warning ?? null }, warning ?? 'Question updated');
}

export async function archive(req: Request, res: Response) {
  const question = await questionService.setQuestionActive(String(req.params.id), false, req.auth!.user._id);
  await audit(req, { action: 'question.archive', entityType: 'Question', entityId: question.id });
  return ok(res, question, 'Question archived');
}

export async function restore(req: Request, res: Response) {
  const question = await questionService.setQuestionActive(String(req.params.id), true, req.auth!.user._id);
  await audit(req, { action: 'question.restore', entityType: 'Question', entityId: question.id });
  return ok(res, question, 'Question restored');
}

export async function remove(req: Request, res: Response) {
  await questionService.deleteQuestion(String(req.params.id));
  await audit(req, { action: 'question.delete', entityType: 'Question', entityId: String(req.params.id) });
  return noContent(res);
}

export async function uploadImage(req: Request, res: Response) {
  if (!req.file) throw ApiError.badRequest('Choose an image to upload');
  const folder = req.query.folder === 'covers' ? 'covers' : 'questions';
  const stored = await storeImage(req.file.buffer, folder);
  await audit(req, { action: 'file.upload', entityType: 'File', entityId: stored.key });
  return created(res, stored, 'Image uploaded');
}
