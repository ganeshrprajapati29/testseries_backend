import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAdminSession, requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { ORDER_STATUSES } from '../types/enums.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { idParams, objectId, optionalDate, pageQuery, searchString } from '../validators/common.js';
import { grantAccessSchema, listStudentsQuery, updateStudentStatusSchema } from '../validators/user.validator.js';
import { adminCategoryRouter } from './category.routes.js';
import { adminImportRouter } from './import.routes.js';
import { adminQuestionRouter } from './question.routes.js';
import { adminAttemptRouter, adminResultRouter } from './result.routes.js';
import { adminSettingsRouter } from './settings.routes.js';
import { adminTestRouter } from './test.routes.js';
import { adminSeriesRouter } from './testSeries.routes.js';

const router = Router();

// Every admin endpoint requires an admin session created through /auth/admin/login.
router.use(authenticate, requireAdminSession);

router.get('/dashboard', requirePermission('content:read'), asyncHandler(c.dashboard));

router.use('/categories', adminCategoryRouter);
router.use('/test-series', adminSeriesRouter);
router.use('/tests', adminTestRouter);
router.use('/questions', adminQuestionRouter);
router.use('/imports', adminImportRouter);
router.use('/results', adminResultRouter);
router.use('/attempts', adminAttemptRouter);
router.use('/settings', adminSettingsRouter);

router.get('/students', requirePermission('students:read'), validate({ query: listStudentsQuery }), asyncHandler(c.listStudents));
router.get('/students/:id', requirePermission('students:read'), validate({ params: idParams }), asyncHandler(c.getStudent));
router.patch(
  '/students/:id/status',
  requirePermission('students:write'),
  validate({ params: idParams, body: updateStudentStatusSchema }),
  asyncHandler(c.setStudentStatus),
);
router.post('/students/:id/access', requirePermission('students:write'), validate({ params: idParams, body: grantAccessSchema }), asyncHandler(c.grantAccess));
router.delete(
  '/students/:id/access/:seriesId',
  requirePermission('students:write'),
  validate({ params: z.object({ id: objectId, seriesId: objectId }) }),
  asyncHandler(c.revokeAccess),
);

router.get(
  '/audit-logs',
  requirePermission('audit:read'),
  validate({
    query: z.object({
      ...pageQuery,
      action: z.string().trim().max(100).optional(),
      entityType: z.string().trim().max(60).optional(),
      actor: searchString,
      from: optionalDate,
      to: optionalDate,
    }),
  }),
  asyncHandler(c.auditLogs),
);

router.get(
  '/orders',
  requirePermission('payments:read'),
  validate({ query: z.object({ ...pageQuery, status: z.enum(ORDER_STATUSES).optional() }) }),
  asyncHandler(c.orders),
);

export default router;
