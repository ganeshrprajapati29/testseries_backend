import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/upload.controller.js';
import { requirePermission } from '../middleware/authorize.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { imageUpload, pdfUpload } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const adminUploadRouter = Router();

const write = requirePermission('content:write');
const fromUrl = z.object({
  url: z.string().trim().min(8, 'Enter a link').max(2000).regex(/^https?:\/\//i, 'The link must start with http:// or https://'),
  folder: z.enum(['questions', 'covers', 'categories', 'misc']).optional(),
});

adminUploadRouter.post('/images', write, uploadLimiter, imageUpload.array('files', 10), asyncHandler(c.uploadImages));
adminUploadRouter.post('/images/from-url', write, uploadLimiter, validate({ body: fromUrl }), asyncHandler(c.importImage));
adminUploadRouter.post('/pdf', write, uploadLimiter, pdfUpload.single('file'), asyncHandler(c.uploadPdf));
adminUploadRouter.post('/pdf/from-url', write, uploadLimiter, validate({ body: fromUrl }), asyncHandler(c.importPdf));
