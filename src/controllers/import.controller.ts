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
  const { targetTestId, subject, topic, sourceExam, sourceYear, language } = req.body;
  const job = await importService.createImportJob({
    buffer: req.file.buffer,
    fileName: req.file.originalname,
    targetTestId,
    defaults: { subject, topic, sourceExam, sourceYear, language },
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
  const result = await importService.commitImportJob(String(req.params.id), req.body.skipDuplicates, req.auth!.user._id);
  await audit(req, { action: 'import.commit', entityType: 'ImportJob', entityId: String(req.params.id), metadata: { ...result } });
  return ok(res, result, `${result.importedCount} question(s) imported`);
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
