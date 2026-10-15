import { Router } from 'express';
import * as c from '../controllers/user.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { updateProfileSchema } from '../validators/user.validator.js';
const router = Router();
router.use(authenticate);
router.get('/me', asyncHandler(c.getProfile));
router.patch('/me', validate({ body: updateProfileSchema }), asyncHandler(c.updateProfile));
export default router;
//# sourceMappingURL=user.routes.js.map