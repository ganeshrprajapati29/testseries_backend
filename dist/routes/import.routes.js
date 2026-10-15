import { Router } from 'express';
import * as c from '../controllers/import.controller.js';
import { requirePermission } from '../middleware/authorize.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { spreadsheetUpload } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { idParams } from '../validators/common.js';
import { commitImportSchema, createImportSchema, listImportsQuery } from '../validators/import.validator.js';
export const adminImportRouter = Router();
const write = requirePermission('content:write');
adminImportRouter.get('/', requirePermission('content:read'), validate({ query: listImportsQuery }), asyncHandler(c.list));
adminImportRouter.get('/template', requirePermission('content:read'), asyncHandler(c.template));
// multer must run before validation so the multipart text fields are available in req.body.
adminImportRouter.post('/', write, uploadLimiter, spreadsheetUpload.single('file'), validate({ body: createImportSchema }), asyncHandler(c.upload));
adminImportRouter.get('/:id', requirePermission('content:read'), validate({ params: idParams }), asyncHandler(c.get));
adminImportRouter.post('/:id/commit', write, validate({ params: idParams, body: commitImportSchema }), asyncHandler(c.commit));
adminImportRouter.post('/:id/cancel', write, validate({ params: idParams }), asyncHandler(c.cancel));
//# sourceMappingURL=import.routes.js.map