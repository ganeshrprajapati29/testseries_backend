import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/admin.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAdminSession, requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { ORDER_STATUSES } from '../types/enums.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { invalidate } from '../services/cache.service.js';
import { translateTexts, translationEnabled } from '../services/translate.service.js';
import { env } from '../config/env.js';
import { translateLimiter } from '../middleware/rateLimiter.js';
import { idParams, objectId, optionalDate, pageQuery, searchString } from '../validators/common.js';
import { createStudentSchema, grantAccessSchema, listStudentsQuery, resetStudentPasswordSchema, updateStudentSchema, updateStudentStatusSchema, } from '../validators/user.validator.js';
import { adminCategoryRouter } from './category.routes.js';
import { adminImportRouter } from './import.routes.js';
import { adminQuestionRouter } from './question.routes.js';
import { adminAttemptRouter, adminResultRouter } from './result.routes.js';
import { adminSettingsRouter } from './settings.routes.js';
import { adminTestRouter } from './test.routes.js';
import { adminSeriesRouter } from './testSeries.routes.js';
import { adminUploadRouter } from './upload.routes.js';
const router = Router();
// Every admin endpoint requires an admin session created through /auth/admin/login.
router.use(authenticate, requireAdminSession);
// Any successful admin change may affect public listings, so the public catalog cache is dropped.
router.use((req, res, next) => {
    if (req.method !== 'GET') {
        res.on('finish', () => {
            if (res.statusCode < 400)
                void invalidate('catalog');
        });
    }
    next();
});
router.get('/dashboard', requirePermission('content:read'), asyncHandler(c.dashboard));
router.use('/categories', adminCategoryRouter);
router.use('/test-series', adminSeriesRouter);
router.use('/tests', adminTestRouter);
router.use('/questions', adminQuestionRouter);
router.use('/imports', adminImportRouter);
router.use('/results', adminResultRouter);
router.use('/attempts', adminAttemptRouter);
router.use('/settings', adminSettingsRouter);
router.use('/uploads', adminUploadRouter);
router.get('/translate/status', requirePermission('content:read'), (_req, res) => {
    res.json({ success: true, data: { enabled: translationEnabled(), provider: env.TRANSLATE_PROVIDER } });
});
router.post('/translate', requirePermission('content:write'), translateLimiter, validate({ body: z.object({ texts: z.array(z.string().max(5000)).min(1).max(60), source: z.enum(['en', 'hi']).default('en'), target: z.enum(['en', 'hi']).default('hi') }) }), asyncHandler(async (req, res) => {
    const translations = await translateTexts(req.body.texts, req.body.source, req.body.target);
    res.json({ success: true, data: { translations } });
}));
router.get('/students', requirePermission('students:read'), validate({ query: listStudentsQuery }), asyncHandler(c.listStudents));
router.get('/students/stats', requirePermission('students:read'), asyncHandler(c.studentStats));
router.get('/students/export', requirePermission('students:read'), validate({ query: listStudentsQuery.omit({ page: true, limit: true }) }), asyncHandler(c.exportStudents));
router.post('/students', requirePermission('students:write'), validate({ body: createStudentSchema }), asyncHandler(c.createStudent));
router.get('/students/:id', requirePermission('students:read'), validate({ params: idParams }), asyncHandler(c.getStudent));
router.patch('/students/:id', requirePermission('students:write'), validate({ params: idParams, body: updateStudentSchema }), asyncHandler(c.updateStudent));
router.post('/students/:id/reset-password', requirePermission('students:write'), validate({ params: idParams, body: resetStudentPasswordSchema }), asyncHandler(c.resetStudentPassword));
router.delete('/students/:id', requirePermission('students:write'), validate({ params: idParams }), asyncHandler(c.deleteStudent));
router.patch('/students/:id/status', requirePermission('students:write'), validate({ params: idParams, body: updateStudentStatusSchema }), asyncHandler(c.setStudentStatus));
router.post('/students/:id/access', requirePermission('students:write'), validate({ params: idParams, body: grantAccessSchema }), asyncHandler(c.grantAccess));
router.delete('/students/:id/access/:seriesId', requirePermission('students:write'), validate({ params: z.object({ id: objectId, seriesId: objectId }) }), asyncHandler(c.revokeAccess));
router.get('/audit-logs', requirePermission('audit:read'), validate({
    query: z.object({
        ...pageQuery,
        action: z.string().trim().max(100).optional(),
        entityType: z.string().trim().max(60).optional(),
        actor: searchString,
        from: optionalDate,
        to: optionalDate,
    }),
}), asyncHandler(c.auditLogs));
router.get('/orders', requirePermission('payments:read'), validate({ query: z.object({ ...pageQuery, status: z.enum(ORDER_STATUSES).optional() }) }), asyncHandler(c.orders));
export default router;
//# sourceMappingURL=admin.routes.js.map