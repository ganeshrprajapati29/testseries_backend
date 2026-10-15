import { Router } from 'express';
import * as c from '../controllers/settings.controller.js';
import { requirePermission } from '../middleware/authorize.js';
import { asyncHandler } from '../utils/asyncHandler.js';
export const publicSettingsRouter = Router();
publicSettingsRouter.get('/public', asyncHandler(c.publicSettings));
export const adminSettingsRouter = Router();
adminSettingsRouter.get('/', requirePermission('content:read'), asyncHandler(c.adminSettings));
// Values are validated per key by the settings registry.
adminSettingsRouter.put('/', requirePermission('settings:write'), asyncHandler(c.update));
//# sourceMappingURL=settings.routes.js.map