import { z } from 'zod';
import { DIFFICULTIES, LANGUAGES, OPTION_KEYS } from '../types/enums.js';
import { booleanQuery, imageList, imageUrl, objectId, pageQuery, searchString } from './common.js';
const optionSchema = z.object({
    key: z.enum(OPTION_KEYS),
    text: z.string().trim().max(2000).default(''),
    imageUrl: imageUrl,
});
const translationSchema = z.object({
    language: z.enum(LANGUAGES),
    questionText: z.string().trim().min(1).max(10000),
    options: z.array(z.object({ key: z.enum(OPTION_KEYS), text: z.string().trim().max(2000) })).max(6).default([]),
    explanation: z.string().trim().max(10000).default(''),
});
const questionBase = z.object({
    questionText: z.string().trim().min(1, 'Question text is required').max(10000),
    options: z
        .array(optionSchema)
        .min(2, 'At least 2 options are required')
        .max(6, 'At most 6 options are allowed')
        .refine((opts) => new Set(opts.map((o) => o.key)).size === opts.length, 'Option keys must be unique')
        .refine((opts) => opts.every((o) => o.text || o.imageUrl), 'Every option needs text or an image'),
    correctOption: z.enum(OPTION_KEYS),
    explanation: z.string().trim().max(10000).default(''),
    subject: z.string().trim().max(120).default(''),
    topic: z.string().trim().max(160).default(''),
    difficulty: z.enum(DIFFICULTIES).default('medium'),
    language: z.enum(LANGUAGES).default('en'),
    translations: z.array(translationSchema).max(2).default([]),
    imageUrl: imageUrl,
    images: imageList,
    explanationImages: imageList,
    sourceExam: z.string().trim().max(120).default(''),
    sourceYear: z.union([z.coerce.number().int().min(1950).max(2100), z.literal(''), z.null()]).optional().transform((v) => (typeof v === 'number' ? v : null)),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    categoryIds: z.array(objectId).max(10, 'At most 10 categories').default([]),
    isActive: z.boolean().default(true),
    /** Machine-translate English -> Hindi on save when the Hindi version is empty. */
    autoTranslate: z.boolean().optional(),
});
export const createQuestionSchema = questionBase.refine((q) => q.options.some((o) => o.key === q.correctOption), {
    message: 'Correct option must be one of the options',
    path: ['correctOption'],
});
export const updateQuestionSchema = questionBase
    .partial()
    .refine((q) => !q.options || !q.correctOption || q.options.some((o) => o.key === q.correctOption), {
    message: 'Correct option must be one of the options',
    path: ['correctOption'],
});
export const listQuestionsQuery = z.object({
    ...pageQuery,
    search: searchString,
    subject: z.string().trim().max(120).optional(),
    topic: z.string().trim().max(160).optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    language: z.enum(LANGUAGES).optional(),
    sourceExam: z.string().trim().max(120).optional(),
    sourceYear: z.coerce.number().int().min(1950).max(2100).optional(),
    isActive: booleanQuery,
    excludeTestId: objectId.optional(),
    /** A category id (includes its sub-categories) or "none" for uncategorised questions. */
    category: z.union([objectId, z.literal('none')]).optional(),
    /** Only the questions of this test / paper. */
    testId: objectId.optional(),
    /** "yes" = has a Hindi version, "no" = English only. */
    hindi: z.enum(['yes', 'no']).optional(),
});
export const bulkTranslateSchema = z.object({
    questionIds: z.array(objectId).min(1).max(100, 'Translate at most 100 questions at a time'),
    overwrite: z.boolean().default(false),
});
export const bulkCategoriesSchema = z.object({
    questionIds: z.array(objectId).min(1).max(500),
    categoryIds: z.array(objectId).max(10),
    mode: z.enum(['add', 'replace', 'remove']),
});
//# sourceMappingURL=question.validator.js.map