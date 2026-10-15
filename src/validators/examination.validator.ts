import { z } from 'zod';
import { LANGUAGES, OPTION_KEYS } from '../types/enums.js';
import { objectId, pageQuery } from './common.js';

export const startAttemptSchema = z.object({
  language: z.enum(LANGUAGES).optional(),
});

export const saveAnswerSchema = z.object({
  questionId: objectId,
  selectedOption: z.enum(OPTION_KEYS).nullable().optional(),
  markedForReview: z.boolean().optional(),
  visited: z.boolean().optional(),
  /** Seconds spent on this question since the previous save (client measured, capped). */
  timeSpentDelta: z.coerce.number().int().min(0).max(3600).default(0),
});

export const saveAnswersBatchSchema = z.object({
  answers: z.array(saveAnswerSchema).min(1).max(200),
});

export const attemptHistoryQuery = z.object({
  ...pageQuery,
  testId: objectId.optional(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED']).optional(),
});
