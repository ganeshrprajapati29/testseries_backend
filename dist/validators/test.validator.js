import { z } from 'zod';
import { LANGUAGES, MODULE_TYPES, PUBLICATION_STATUSES, RESULT_VISIBILITY, TEST_TYPES } from '../types/enums.js';
import { objectId, optionalDate, optionalObjectId, pageQuery, pdfRef, searchString } from './common.js';
const testBase = z.object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
    description: z.string().trim().max(5000).default(''),
    instructions: z.string().trim().max(10000).default(''),
    moduleType: z.enum(MODULE_TYPES).default('TEST_SERIES'),
    seriesId: optionalObjectId,
    categoryId: objectId.optional(),
    testType: z.enum(TEST_TYPES).default('FULL_LENGTH'),
    paperYear: z.union([z.coerce.number().int().min(1950).max(2100), z.literal(''), z.null()]).optional().transform((v) => (typeof v === 'number' ? v : null)),
    paperName: z.string().trim().max(120).default(''),
    languageOptions: z.array(z.enum(LANGUAGES)).min(1).max(2).default(['en']),
    durationMinutes: z.coerce.number().int().min(1, 'Duration must be at least 1 minute').max(360),
    marksPerCorrect: z.coerce.number().min(0).max(100).default(1),
    negativeMarks: z.coerce.number().min(0).max(100).default(0),
    maxAttempts: z.coerce.number().int().min(0).max(100).default(1),
    isFree: z.boolean().default(false),
    availableFrom: optionalDate,
    availableUntil: optionalDate,
    randomizeQuestions: z.boolean().default(false),
    randomizeOptions: z.boolean().default(false),
    resultVisibility: z.enum(RESULT_VISIBILITY).default('IMMEDIATE'),
    questionPaperPdf: pdfRef.optional(),
    solutionPdf: pdfRef.optional(),
    sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
    hi: z
        .object({
        title: z.string().trim().max(400).default(''),
        description: z.string().trim().max(8000).default(''),
        instructions: z.string().trim().max(15000).default(''),
    })
        .optional(),
    autoTranslate: z.boolean().optional(),
});
function refineTest(schema, requireLink) {
    return schema
        .refine((d) => !requireLink || !!d.seriesId || !!d.categoryId, {
        message: 'Select a test series or a category',
        path: ['categoryId'],
    })
        .refine((d) => !d.availableFrom || !d.availableUntil || d.availableFrom < d.availableUntil, {
        message: 'Available until must be after available from',
        path: ['availableUntil'],
    });
}
export const createTestSchema = refineTest(testBase, true);
export const updateTestSchema = refineTest(testBase.partial(), false);
export const setQuestionsSchema = z.object({
    questionIds: z.array(objectId).max(500),
});
export const addQuestionsSchema = z.object({
    questionIds: z.array(objectId).min(1).max(500),
});
export const testPublishSchema = z.object({ publicationStatus: z.enum(PUBLICATION_STATUSES) });
export const listTestsAdminQuery = z.object({
    ...pageQuery,
    search: searchString,
    seriesId: objectId.optional(),
    categoryId: objectId.optional(),
    moduleType: z.enum(MODULE_TYPES).optional(),
    status: z.enum(PUBLICATION_STATUSES).optional(),
});
//# sourceMappingURL=test.validator.js.map