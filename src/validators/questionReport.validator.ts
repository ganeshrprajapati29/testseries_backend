import { z } from 'zod';
import { REPORT_REASONS, REPORT_STATUSES } from '../models/QuestionReport.model.js';
import { objectId, pageQuery, searchString } from './common.js';

export const createReportSchema = z
  .object({
    questionId: objectId,
    reason: z.enum(REPORT_REASONS),
    comment: z.string().trim().max(1000, 'Keep the note under 1000 characters').default(''),
  })
  .refine((d) => d.reason !== 'other' || d.comment.length >= 5, { message: 'Please describe the problem', path: ['comment'] });

export const listReportsQuery = z.object({
  ...pageQuery,
  status: z.enum([...REPORT_STATUSES, 'all']).optional(),
  reason: z.enum(REPORT_REASONS).optional(),
  testId: objectId.optional(),
  search: searchString,
});

export const questionReportsQuery = z.object({ status: z.enum(REPORT_STATUSES).optional() });

export const updateReportSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  adminNote: z.string().trim().max(1000).optional(),
});

export const closeQuestionReportsSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  adminNote: z.string().trim().max(1000).default(''),
});
