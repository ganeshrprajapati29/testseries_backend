import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/category.controller.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { MODULE_TYPES } from '../types/enums.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  createCategorySchema,
  listCategoriesQuery,
  publicCategoryQuery,
  reorderCategoriesSchema,
  updateCategorySchema,
} from '../validators/category.validator.js';
import { idParams } from '../validators/common.js';

export const publicCategoryRouter = Router();

publicCategoryRouter.get('/', validate({ query: publicCategoryQuery }), asyncHandler(c.publicTree));
publicCategoryRouter.get(
  '/resolve',
  validate({ query: z.object({ moduleType: z.enum(MODULE_TYPES).default('TEST_SERIES'), path: z.string().trim().min(1).max(400) }) }),
  asyncHandler(c.resolve),
);

export const adminCategoryRouter = Router();

adminCategoryRouter.get('/', requirePermission('content:read'), validate({ query: listCategoriesQuery }), asyncHandler(c.adminTree));
adminCategoryRouter.post('/', requirePermission('content:write'), validate({ body: createCategorySchema }), asyncHandler(c.create));
adminCategoryRouter.put('/reorder', requirePermission('content:write'), validate({ body: reorderCategoriesSchema }), asyncHandler(c.reorder));
adminCategoryRouter.patch('/:id', requirePermission('content:write'), validate({ params: idParams, body: updateCategorySchema }), asyncHandler(c.update));
adminCategoryRouter.post('/:id/activate', requirePermission('content:write'), validate({ params: idParams }), asyncHandler(c.activate));
adminCategoryRouter.post('/:id/deactivate', requirePermission('content:write'), validate({ params: idParams }), asyncHandler(c.deactivate));
adminCategoryRouter.post('/:id/archive', requirePermission('content:write'), validate({ params: idParams }), asyncHandler(c.archive));
adminCategoryRouter.post('/:id/restore', requirePermission('content:write'), validate({ params: idParams }), asyncHandler(c.restore));
adminCategoryRouter.delete('/:id', requirePermission('content:write'), validate({ params: idParams }), asyncHandler(c.remove));
