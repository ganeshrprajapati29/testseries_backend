import type { NextFunction, Request, Response } from 'express';
import type { z, ZodType } from 'zod';
import { ApiError } from '../utils/ApiError.js';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function zodIssuesToDetails(error: z.ZodError, prefix?: string) {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'),
    message: issue.message,
  }));
}

/**
 * Validates and replaces req.body / req.query / req.params with the parsed (typed, coerced,
 * stripped) values. Unknown keys are removed by zod objects by default.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const details: { path?: string; message: string }[] = [];

    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        details.push(...zodIssuesToDetails(result.error, part));
        continue;
      }
      if (part === 'body') {
        req.body = result.data;
      } else {
        // Express 5 exposes query/params through getters, so define an own property instead.
        Object.defineProperty(req, part, { value: result.data, writable: true, enumerable: true, configurable: true });
      }
    }

    if (details.length) return next(ApiError.validation(details));
    next();
  };
}

