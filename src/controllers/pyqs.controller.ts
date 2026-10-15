import type { Request, Response } from 'express';
import * as pyqsService from '../services/pyqs.service.js';
import * as testService from '../services/test.service.js';
import { ok } from '../utils/ApiResponse.js';

export async function home(_req: Request, res: Response) {
  return ok(res, await pyqsService.pyqHome());
}

/** /api/pyqs/category/nda or /api/pyqs/category/nda/maths */
export async function category(req: Request, res: Response) {
  const raw = req.params.path as unknown;
  const path = Array.isArray(raw) ? raw.join('/') : String(raw ?? '');
  return ok(res, await pyqsService.pyqCategory(path));
}

export async function paper(req: Request, res: Response) {
  await pyqsService.assertPyqPaper(String(req.params.slug));
  return ok(res, await testService.publicTestDetail(String(req.params.slug), req.auth?.user.id));
}
