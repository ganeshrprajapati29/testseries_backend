import { Router } from 'express';
import * as c from '../controllers/question.controller.js';
import { requirePermission } from '../middleware/authorize.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { imageUpload } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { idParams } from '../validators/common.js';
import { createQuestionSchema, listQuestionsQuery, updateQuestionSchema } from '../validators/question.validator.js';

export const adminQuestionRouter = Router();

const read = requirePermission('content:read');
const write = requirePermission('content:write');

adminQuestionRouter.get('/', read, validate({ query: listQuestionsQuery }), asyncHandler(c.list));
adminQuestionRouter.get('/facets', read, asyncHandler(c.facets));
adminQuestionRouter.post('/', write, validate({ body: createQuestionSchema }), asyncHandler(c.create));
adminQuestionRouter.post('/upload-image', write, uploadLimiter, imageUpload.single('file'), asyncHandler(c.uploadImage));
adminQuestionRouter.get('/:id', read, validate({ params: idParams }), asyncHandler(c.get));
adminQuestionRouter.patch('/:id', write, validate({ params: idParams, body: updateQuestionSchema }), asyncHandler(c.update));
adminQuestionRouter.post('/:id/archive', write, validate({ params: idParams }), asyncHandler(c.archive));
adminQuestionRouter.post('/:id/restore', write, validate({ params: idParams }), asyncHandler(c.restore));
adminQuestionRouter.delete('/:id', write, validate({ params: idParams }), asyncHandler(c.remove));
