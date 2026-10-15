import { z } from 'zod';
import { ACCOUNT_STATUSES } from '../types/enums.js';
import { mobileSchema, nameSchema } from './auth.validator.js';
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
});
export const updateStudentStatusSchema = z.object({
    accountStatus: z.enum(ACCOUNT_STATUSES),
});
export const grantAccessSchema = z.object({
    testSeriesId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
    validityDays: z.coerce.number().int().min(1).max(3650).optional(),
});
//# sourceMappingURL=user.validator.js.map