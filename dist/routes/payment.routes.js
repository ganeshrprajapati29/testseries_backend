import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/payment.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { objectId } from '../validators/common.js';
const router = Router();
router.get('/config', asyncHandler(c.config));
// Raw body + signature verification is configured in app.ts for this path.
router.post('/webhook', asyncHandler(c.webhook));
router.post('/orders', authenticate, requireRole('student'), validate({ body: z.object({ testSeriesId: objectId }) }), asyncHandler(c.createOrder));
router.post('/verify', authenticate, requireRole('student'), validate({
    body: z.object({
        razorpayOrderId: z.string().trim().min(5).max(100),
        razorpayPaymentId: z.string().trim().min(5).max(100),
        razorpaySignature: z.string().trim().regex(/^[a-f0-9]{64}$/i, 'Invalid signature'),
    }),
}), asyncHandler(c.verify));
export default router;
//# sourceMappingURL=payment.routes.js.map