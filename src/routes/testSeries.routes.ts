import { Router } from 'express';
import * as c from '../controllers/testSeries.controller.js';
import { authenticate, optionalAuth } from '../middleware/authenticate.js';
import { requirePermission, requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { z } from 'zod';
import { TEST_TYPES } from '../types/enums.js';
import { idParams, pageQuery, slugParams } from '../validators/common.js';
import {
  createTestSeriesSchema,
  listSeriesAdminQuery,
  listSeriesPublicQuery,
  publishSchema,
  updateTestSeriesSchema,
} from '../validators/testSeries.validator.js';

export const publicSeriesRouter = Router();

publicSeriesRouter.get('/', optionalAuth, validate({ query: listSeriesPublicQuery }), asyncHandler(c.list));
publicSeriesRouter.get('/home', asyncHandler(c.home));
publicSeriesRouter.get('/:slug', optionalAuth, validate({ params: slugParams }), asyncHandler(c.detail));
publicSeriesRouter.get(
  '/:slug/tests',
  optionalAuth,
  validate({ params: slugParams, query: z.object({ ...pageQuery, limit: z.coerce.number().int().min(1).max(50).default(10), type: z.enum(TEST_TYPES).optional() }) }),
  asyncHandler(c.tests),
);
publicSeriesRouter.post('/:id/enroll', authenticate, requireRole('student'), validate({ params: idParams }), asyncHandler(c.enroll));

export const adminSeriesRouter = Router();

adminSeriesRouter.get('/', requirePermission('content:read'), validate({ query: listSeriesAdminQuery }), asyncHandler(c.adminList));
adminSeriesRouter.post('/', requirePermission('content:write'), validate({ body: createTestSeriesSchema }), asyncHandler(c.create));
adminSeriesRouter.get('/:id', requirePermission('content:read'), validate({ params: idParams }), asyncHandler(c.adminGet));
adminSeriesRouter.patch('/:id', requirePermission('content:write'), validate({ params: idParams, body: updateTestSeriesSchema }), asyncHandler(c.update));
adminSeriesRouter.post('/:id/publication', requirePermission('content:write'), validate({ params: idParams, body: publishSchema }), asyncHandler(c.setPublication));
adminSeriesRouter.post('/:id/duplicate', requirePermission('content:write'), validate({ params: idParams }), asyncHandler(c.duplicate));
adminSeriesRouter.delete('/:id', requirePermission('content:write'), validate({ params: idParams }), asyncHandler(c.remove));
