import { z } from 'zod';
import { DIFFICULTIES, LANGUAGES, OPTION_KEYS } from '../types/enums.js';
import { booleanQuery, imageUrl, objectId, pageQuery, searchString } from './common.js';

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
  sourceExam: z.string().trim().max(120).default(''),
  sourceYear: z.union([z.coerce.number().int().min(1950).max(2100), z.literal(''), z.null()]).optional().transform((v) => (typeof v === 'number' ? v : null)),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  isActive: z.boolean().default(true),
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
});
