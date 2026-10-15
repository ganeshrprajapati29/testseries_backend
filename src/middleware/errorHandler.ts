import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { zodIssuesToDetails } from './validate.js';

function normalize(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) return ApiError.validation(zodIssuesToDetails(err));
  if (err instanceof mongoose.Error.ValidationError) {
    return ApiError.validation(Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })));
  }
  if (err instanceof mongoose.Error.CastError) return ApiError.badRequest(`Invalid value for ${err.path}`);
  if (err instanceof MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
    return ApiError.badRequest(message);
  }
  if (typeof err === 'object' && err && 'code' in err && (err as { code: unknown }).code === 11000) {
    const keys = Object.keys((err as { keyValue?: Record<string, unknown> }).keyValue ?? {});
    return ApiError.conflict(keys.length ? `A record with this ${keys.join(', ')} already exists` : 'Duplicate record');
  }
  if (err instanceof SyntaxError && 'body' in err) return ApiError.badRequest('Malformed JSON body');
  if (typeof err === 'object' && err && 'type' in err && (err as { type: unknown }).type === 'entity.too.large') {
    return new ApiError(413, 'Request body too large', 'PAYLOAD_TOO_LARGE');
  }
  return new ApiError(500, 'Something went wrong. Please try again.', 'INTERNAL_ERROR');
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const apiError = normalize(err);
  if (apiError.statusCode >= 500) {
    logger.error({ err, requestId: req.requestId, path: req.originalUrl }, 'Unhandled error');
  } else {
    logger.debug({ code: apiError.code, path: req.originalUrl }, apiError.message);
  }

  res.status(apiError.statusCode).json({
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      details: apiError.details,
      requestId: req.requestId,
      ...(env.isProd || apiError.statusCode < 500 ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
  });
}
