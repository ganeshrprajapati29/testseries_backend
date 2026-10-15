import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/result.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { ATTEMPT_STATUSES } from '../types/enums.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { idParams, objectId, optionalDate, pageQuery, searchString } from '../validators/common.js';
export const studentResultRouter = Router();
studentResultRouter.use(authenticate, requireRole('student'));
studentResultRouter.get('/:attemptId', validate({ params: z.object({ attemptId: objectId }) }), asyncHandler(c.myResult));
studentResultRouter.get('/:attemptId/solutions', validate({ params: z.object({ attemptId: objectId }) }), asyncHandler(c.mySolutions));
export const adminResultRouter = Router();
const resultsQuery = z.object({
    ...pageQuery,
    testId: objectId.optional(),
    studentId: objectId.optional(),
    search: searchString,
    from: optionalDate,
    to: optionalDate,
});
adminResultRouter.get('/', requirePermission('results:read'), validate({ query: resultsQuery }), asyncHandler(c.adminList));
adminResultRouter.get('/export', requirePermission('results:read'), validate({ query: resultsQuery }), asyncHandler(c.adminExport));
export const adminAttemptRouter = Router();
adminAttemptRouter.get('/', requirePermission('results:read'), validate({
    query: z.object({
        ...pageQuery,
        testId: objectId.optional(),
        studentId: objectId.optional(),
        status: z.enum(ATTEMPT_STATUSES).optional(),
        from: optionalDate,
        to: optionalDate,
    }),
}), asyncHandler(c.adminAttempts));
adminAttemptRouter.get('/:id', requirePermission('results:read'), validate({ params: idParams }), asyncHandler(c.adminAttemptDetail));
//# sourceMappingURL=result.routes.js.map