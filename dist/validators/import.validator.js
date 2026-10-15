import { z } from 'zod';
import { LANGUAGES } from '../types/enums.js';
import { optionalObjectId, pageQuery } from './common.js';
/** Multipart text fields that accompany an uploaded spreadsheet. */
export const createImportSchema = z.object({
    targetTestId: optionalObjectId,
    subject: z.string().trim().max(120).default(''),
    topic: z.string().trim().max(160).default(''),
    sourceExam: z.string().trim().max(120).default(''),
    sourceYear: z
        .union([z.coerce.number().int().min(1950).max(2100), z.literal('')])
        .optional()
        .transform((v) => (typeof v === 'number' ? v : null)),
    language: z.enum(LANGUAGES).default('en'),
});
export const commitImportSchema = z.object({
    skipDuplicates: z.boolean().default(true),
});
export const listImportsQuery = z.object({ ...pageQuery });
//# sourceMappingURL=import.validator.js.map