import { z } from 'zod';
import { ACCOUNT_STATUSES } from '../types/enums.js';
import { emailSchema, mobileSchema, nameSchema, passwordSchema, requiredMobileSchema } from './auth.validator.js';
import { pageQuery, searchString } from './common.js';

export const updateProfileSchema = z.object({
  name: nameSchema.optional(),
  mobile: mobileSchema,
  preferredLanguage: z.enum(['en', 'hi']).optional(),
});

export const listStudentsQuery = z.object({
  ...pageQuery,
  search: searchString,
  status: z.enum(ACCOUNT_STATUSES).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'lastLogin']).optional(),
});

export const createStudentSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  mobile: requiredMobileSchema,
  password: passwordSchema,
  accountStatus: z.enum(ACCOUNT_STATUSES).optional(),
  preferredLanguage: z.enum(['en', 'hi']).optional(),
});

export const updateStudentSchema = createStudentSchema
  .omit({ password: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const resetStudentPasswordSchema = z.object({ password: passwordSchema });

export const updateStudentStatusSchema = z.object({
  accountStatus: z.enum(ACCOUNT_STATUSES),
});

export const grantAccessSchema = z.object({
  testSeriesId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
  validityDays: z.coerce.number().int().min(1).max(3650).optional(),
});
