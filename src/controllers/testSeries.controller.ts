import type { Request, Response } from 'express';
import * as seriesService from '../services/testSeries.service.js';
import { audit } from '../services/audit.service.js';
import { created, ok, paginated } from '../utils/ApiResponse.js';

// ---------- public
export async function list(req: Request, res: Response) {
  const { items, meta } = await seriesService.publicListSeries(req.query as never, req.auth?.user.id);
  return paginated(res, items, meta);
}

export async function detail(req: Request, res: Response) {
  return ok(res, await seriesService.publicSeriesDetail(String(req.params.slug), req.auth?.user.id));
}

export async function enroll(req: Request, res: Response) {
  const enrollment = await seriesService.enrollFree(String(req.params.id), req.auth!.user.id);
  return ok(res, enrollment, 'Added to My Tests');
}

export async function home(_req: Request, res: Response) {
  return ok(res, await seriesService.featuredAndStats());
}

// ---------- admin
export async function adminList(req: Request, res: Response) {
  const { items, meta } = await seriesService.adminListSeries(req.query as never);
  return paginated(res, items, meta);
}

export async function adminGet(req: Request, res: Response) {
  return ok(res, await seriesService.adminGetSeries(String(req.params.id)));
}

export async function create(req: Request, res: Response) {
  const series = await seriesService.createSeries(req.body, req.auth!.user._id);
  await audit(req, { action: 'series.create', entityType: 'TestSeries', entityId: series.id, summary: `Created "${series.title}"` });
  return created(res, series);
}

export async function update(req: Request, res: Response) {
  const series = await seriesService.updateSeries(String(req.params.id), req.body, req.auth!.user._id);
  await audit(req, { action: 'series.update', entityType: 'TestSeries', entityId: series.id, summary: `Updated "${series.title}"` });
  return ok(res, series, 'Test series updated');
}

export async function setPublication(req: Request, res: Response) {
  const series = await seriesService.setSeriesPublication(String(req.params.id), req.body.publicationStatus, req.auth!.user._id);
  await audit(req, { action: `series.${req.body.publicationStatus}`, entityType: 'TestSeries', entityId: series.id, summary: `"${series.title}" -> ${series.publicationStatus}` });
  return ok(res, series, `Test series ${series.publicationStatus}`);
}

export async function duplicate(req: Request, res: Response) {
  const copy = await seriesService.duplicateSeries(String(req.params.id), req.auth!.user._id);
  await audit(req, { action: 'series.duplicate', entityType: 'TestSeries', entityId: copy.id, metadata: { sourceId: req.params.id } });
  return created(res, copy, 'Test series duplicated as draft');
}

export async function remove(req: Request, res: Response) {
  const result = await seriesService.removeSeries(String(req.params.id), req.auth!.user._id);
  await audit(req, { action: result.archived ? 'series.archive' : 'series.delete', entityType: 'TestSeries', entityId: String(req.params.id) });
  return ok(res, result, result.archived ? 'Series has student activity, so it was archived instead of deleted' : 'Test series deleted');
}
