import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { IMPORT_STATUSES } from '../types/enums.js';

const rowErrorSchema = new Schema(
  {
    row: { type: Number, required: true },
    field: { type: String, default: '' },
    message: { type: String, required: true },
  },
  { _id: false },
);

const importJobSchema = new Schema(
  {
    fileName: { type: String, required: true, maxlength: 255 },
    fileType: { type: String, enum: ['csv', 'xlsx'], required: true },
    status: { type: String, enum: IMPORT_STATUSES, default: 'validated' },
    /** Optional test to append imported questions to. */
    targetTestId: { type: Schema.Types.ObjectId, ref: 'Test', default: null },
    defaults: {
      subject: { type: String, default: '' },
      topic: { type: String, default: '' },
      sourceExam: { type: String, default: '' },
      sourceYear: { type: Number, default: null },
      language: { type: String, default: 'en' },
      categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    },
    totalRows: { type: Number, default: 0 },
    validRows: { type: Number, default: 0 },
    invalidRows: { type: Number, default: 0 },
    duplicateRows: { type: Number, default: 0 },
    importedCount: { type: Number, default: 0 },
    /** Where the valid rows will appear: one entry per category with the number of questions. */
    destinations: {
      type: [{ _id: false, categoryId: String, label: String, moduleType: String, count: Number }],
      default: [],
    },
    /** Valid rows without any category - they only reach the website when added to a test. */
    uncategorizedRows: { type: Number, default: 0 },
    rowErrors: { type: [rowErrorSchema], default: [] },
    /** Normalised, validated question payloads waiting to be committed. Cleared after commit. */
    payload: { type: [Schema.Types.Mixed], default: [], select: false },
    createdQuestionIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    committedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

importJobSchema.index({ createdAt: -1 });

export type ImportJob = InferSchemaType<typeof importJobSchema>;
export type ImportJobDocument = HydratedDocument<ImportJob>;
export const ImportJobModel = model('ImportJob', importJobSchema);
