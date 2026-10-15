import { audit } from '../services/audit.service.js';
import * as settingsService from '../services/settings.service.js';
import { ok } from '../utils/ApiResponse.js';
export async function publicSettings(_req, res) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return ok(res, await settingsService.getSettings(true));
}
export async function adminSettings(_req, res) {
    return ok(res, { values: await settingsService.getSettings(false), descriptors: settingsService.settingsDescriptors() });
}
export async function update(req, res) {
    const values = await settingsService.updateSettings(req.body ?? {}, req.auth.user._id);
    await audit(req, { action: 'settings.update', entityType: 'SiteSetting', summary: `Updated ${Object.keys(req.body ?? {}).join(', ')}` });
    return ok(res, values, 'Settings saved');
}
//# sourceMappingURL=settings.controller.js.map