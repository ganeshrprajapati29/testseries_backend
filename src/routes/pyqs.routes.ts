import { Router } from 'express';
import * as c from '../controllers/pyqs.controller.js';
import { optionalAuth } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { slugParams } from '../validators/common.js';

const router = Router();

router.get('/', asyncHandler(c.home));
router.get('/papers/:slug', optionalAuth, validate({ params: slugParams }), asyncHandler(c.paper));
// Express 5 named wildcard: /category/nda or /category/nda/maths
router.get('/category/*path', asyncHandler(c.category));

export default router;
