import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const REPORT_REASONS = ['wrong_answer', 'wrong_question', 'wrong_options', 'typo', 'translation', 'image', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** A student's report that a question is wrong (bad answer key, typo, missing image ...). */
const questionReportSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    testId: { type: Schema.Types.ObjectId, ref: 'Test', required: true },
    attemptId: { type: Schema.Types.ObjectId, ref: 'TestAttempt', required: true },
    /** Number of the question in the student's paper, for context. */
    questionNumber: { type: Number, min: 1, default: null },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    comment: { type: String, trim: true, maxlength: 1000, default: '' },
    language: { type: String, enum: ['en', 'hi'], default: 'en' },
    status: { type: String, enum: REPORT_STATUSES, default: 'open', required: true },
    /** Reply shown to the student once the report is resolved / dismissed. */
    adminNote: { type: String, trim: true, maxlength: 1000, default: '' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One report per student per question per attempt - re-reporting updates it.
questionReportSchema.index({ attemptId: 1, questionId: 1 }, { unique: true });
questionReportSchema.index({ status: 1, createdAt: -1 });
questionReportSchema.index({ questionId: 1, status: 1 });
questionReportSchema.index({ studentId: 1, createdAt: -1 });

export type QuestionReport = InferSchemaType<typeof questionReportSchema>;
export type QuestionReportDocument = HydratedDocument<QuestionReport>;
export const QuestionReportModel = model('QuestionReport', questionReportSchema);
