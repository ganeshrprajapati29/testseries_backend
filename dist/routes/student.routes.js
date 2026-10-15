import { Router } from 'express';
import * as c from '../controllers/student.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { attemptHistoryQuery } from '../validators/examination.validator.js';
const router = Router();
router.use(authenticate, requireRole('student'));
router.get('/dashboard', asyncHandler(c.dashboard));
router.get('/my-tests', asyncHandler(c.myTests));
router.get('/attempts', validate({ query: attemptHistoryQuery }), asyncHandler(c.attempts));
router.get('/orders', asyncHandler(c.orders));
export default router;
//# sourceMappingURL=student.routes.js.map