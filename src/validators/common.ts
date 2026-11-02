import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const optionalObjectId = z.union([objectId, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
export const idParams = z.object({ id: objectId });
export const slugParams = z.object({ slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/, 'Invalid slug') });

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const searchString = z.string().trim().max(120).optional();

export const booleanQuery = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'));

/**
 * Optional date that accepts ISO strings, '' or null. Empty values are normalised to null
 * *before* coercion - `z.coerce.date()` would otherwise turn null into 1 Jan 1970.
 */
export const optionalDate = z
  .preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.date({ message: 'Invalid date' }).nullable())
  .optional()
  .transform((v) => v ?? null);

/** A required image reference: an uploaded file (/uploads/...) or an https:// link. */
export const imageRef = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v.startsWith('/uploads/') || /^https:\/\/\S+$/i.test(v), 'Must be an https:// URL or an uploaded file');

export const imageList = z.array(imageRef).max(10, 'At most 10 images').default([]);

export const pdfRef = z
  .object({
    key: z.string().regex(/^pdfs\/[\w\-/]+\.pdf$/, 'Invalid PDF reference'),
    fileName: z.string().trim().min(1).max(160),
    size: z.number().int().min(0).max(30 * 1024 * 1024),
  })
  .nullable();

export const imageUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === '' || v.startsWith('/uploads/') || /^https:\/\//i.test(v), 'Must be an https:// URL or an uploaded file')
  .default('');
