import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/examination.controller.js';
import * as reports from '../controllers/questionReport.controller.js';
import { createReportSchema } from '../validators/questionReport.validator.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { examLimiter, reportLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';
import { LANGUAGES } from '../types/enums.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { objectId } from '../validators/common.js';
import { saveAnswerSchema, saveAnswersBatchSchema, startAttemptSchema } from '../validators/examination.validator.js';

const router = Router();

router.use(authenticate, requireRole('student'), examLimiter);

const attemptParams = z.object({ attemptId: objectId });

router.post('/tests/:testId/start', validate({ params: z.object({ testId: objectId }), body: startAttemptSchema }), asyncHandler(c.start));
router.get('/attempts/:attemptId', validate({ params: attemptParams }), asyncHandler(c.get));
router.put('/attempts/:attemptId/answer', validate({ params: attemptParams, body: saveAnswerSchema }), asyncHandler(c.saveAnswer));
router.put('/attempts/:attemptId/answers', validate({ params: attemptParams, body: saveAnswersBatchSchema }), asyncHandler(c.saveAnswersBatch));
router.patch('/attempts/:attemptId/language', validate({ params: attemptParams, body: z.object({ language: z.enum(LANGUAGES) }) }), asyncHandler(c.setLanguage));
router.get('/attempts/:attemptId/reports', validate({ params: attemptParams }), asyncHandler(reports.mine));
router.post('/attempts/:attemptId/reports', reportLimiter, validate({ params: attemptParams, body: createReportSchema }), asyncHandler(reports.create));
router.post('/attempts/:attemptId/submit', validate({ params: attemptParams }), asyncHandler(c.submit));

export default router;
