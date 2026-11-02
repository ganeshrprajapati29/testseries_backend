import type { Request, Response } from 'express';
import { audit } from '../services/audit.service.js';
import { cached, invalidate } from '../services/cache.service.js';
import * as settingsService from '../services/settings.service.js';
import { ok } from '../utils/ApiResponse.js';

export async function publicSettings(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  return ok(res, await cached('settings', 'public', 600, () => settingsService.getSettings(true)));
}

export async function adminSettings(_req: Request, res: Response) {
  return ok(res, { values: await settingsService.getSettings(false), descriptors: settingsService.settingsDescriptors() });
}

export async function update(req: Request, res: Response) {
  const values = await settingsService.updateSettings(req.body ?? {}, req.auth!.user._id);
  await invalidate('settings');
  await audit(req, { action: 'settings.update', entityType: 'SiteSetting', summary: `Updated ${Object.keys(req.body ?? {}).join(', ')}` });
  return ok(res, values, 'Settings saved');
}
