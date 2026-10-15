import type { Response } from 'express';
import type { PageMeta } from './pagination.js';

export function ok<T>(res: Response, data: T, message?: string, status = 200) {
  return res.status(status).json({ success: true, message, data });
}

export function created<T>(res: Response, data: T, message = 'Created successfully') {
  return ok(res, data, message, 201);
}

export function paginated<T>(res: Response, items: T[], meta: PageMeta) {
  return res.status(200).json({ success: true, data: items, meta });
}

export function noContent(res: Response) {
  return res.status(204).end();
}
