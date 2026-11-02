import { TestModel } from '../models/Test.model.js';
import { tagQuestionsWithTestCategory } from '../services/questionCategory.service.js';
import { translateQuestionsInBackground } from '../services/questionTranslate.service.js';
import { translationEnabled } from '../services/translate.service.js';
import { syncForQuestions } from '../services/practiceSet.service.js';
import type { Request, Response } from 'express';
import * as importService from '../services/import.service.js';
import { audit } from '../services/audit.service.js';
import { ApiError } from '../utils/ApiError.js';
import { created, ok, paginated } from '../utils/ApiResponse.js';

export async function template(_req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="civil-sansad-question-template.csv"');
  return res.send(importService.templateCsv());
}

export async function upload(req: Request, res: Response) {
  if (!req.file) throw ApiError.badRequest('Choose a .csv or .xlsx file to import');
  const { targetTestId, subject, topic, sourceExam, sourceYear, language, categoryId } = req.body;
  const job = await importService.createImportJob({
    buffer: req.file.buffer,
    fileName: req.file.originalname,
    targetTestId,
    defaults: { subject, topic, sourceExam, sourceYear, language, categoryId },
    userId: req.auth!.user._id,
  });
  await audit(req, {
    action: 'import.upload',
    entityType: 'ImportJob',
    entityId: String(job._id),
    summary: `${job.fileName}: ${job.validRows} valid / ${job.invalidRows} invalid`,
  });
  return created(res, job, 'File validated. Review and commit the import.');
}

export async function commit(req: Request, res: Response) {
  const { questionIds, ...result } = await importService.commitImportJob(String(req.params.id), req.body.skipDuplicates, req.auth!.user._id);
  if (result.targetTestId && questionIds.length) {
    const test = await TestModel.findById(result.targetTestId, { categoryId: 1, categoryPath: 1 }).lean();
    if (test) await tagQuestionsWithTestCategory(questionIds, test);
  }
  await syncForQuestions(questionIds);
  const translating = req.body.autoTranslate && translationEnabled() && questionIds.length > 0;
  if (translating) translateQuestionsInBackground(questionIds);
  await audit(req, { action: 'import.commit', entityType: 'ImportJob', entityId: String(req.params.id), metadata: { ...result, autoTranslate: !!translating } });
  const linked = result.linkedExisting ? `, ${result.linkedExisting} already in the bank filed under the chosen categories` : '';
  const msg = `${result.importedCount} question(s) imported${linked}${translating ? ' - Hindi translation is running in the background' : ''}`;
  return ok(res, { ...result, translating: !!translating }, msg);
}

export async function cancel(req: Request, res: Response) {
  await importService.cancelImportJob(String(req.params.id));
  await audit(req, { action: 'import.cancel', entityType: 'ImportJob', entityId: String(req.params.id) });
  return ok(res, null, 'Import cancelled');
}

export async function list(req: Request, res: Response) {
  const { items, meta } = await importService.listImportJobs(req.query as never);
  return paginated(res, items, meta);
}

export async function get(req: Request, res: Response) {
  return ok(res, await importService.getImportJob(String(req.params.id)));
}
