import { Schema, model } from 'mongoose';
import { LANGUAGES, MODULE_TYPES, PUBLICATION_STATUSES, RESULT_VISIBILITY, TEST_TYPES } from '../types/enums.js';
const testSchema = new Schema({
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    instructions: { type: String, trim: true, maxlength: 10000, default: '' },
    moduleType: { type: String, enum: MODULE_TYPES, default: 'TEST_SERIES', required: true },
    /** Optional: PYQ papers may live directly under a subject category without a series. */
    seriesId: { type: Schema.Types.ObjectId, ref: 'TestSeries', default: null },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    categoryPath: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    testType: { type: String, enum: TEST_TYPES, default: 'FULL_LENGTH' },
    /** PYQ metadata */
    paperYear: { type: Number, min: 1950, max: 2100, default: null },
    paperName: { type: String, trim: true, maxlength: 120, default: '' },
    questionIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
    languageOptions: { type: [{ type: String, enum: LANGUAGES }], default: ['en'] },
    durationSeconds: { type: Number, required: true, min: 60, max: 6 * 60 * 60, default: 3600 },
    marksPerCorrect: { type: Number, required: true, min: 0, max: 100, default: 1 },
    negativeMarks: { type: Number, required: true, min: 0, max: 100, default: 0 },
    totalMarks: { type: Number, min: 0, default: 0 },
    /** 0 = unlimited */
    maxAttempts: { type: Number, min: 0, max: 100, default: 1 },
    isFree: { type: Boolean, default: false },
    availableFrom: { type: Date, default: null },
    availableUntil: { type: Date, default: null },
    randomizeQuestions: { type: Boolean, default: false },
    randomizeOptions: { type: Boolean, default: false },
    resultVisibility: { type: String, enum: RESULT_VISIBILITY, default: 'IMMEDIATE' },
    sortOrder: { type: Number, default: 0 },
    publicationStatus: { type: String, enum: PUBLICATION_STATUSES, default: 'draft' },
    publishedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
testSchema.pre('save', function () {
    this.totalMarks = Math.round(this.questionIds.length * this.marksPerCorrect * 100) / 100;
});
testSchema.index({ slug: 1 }, { unique: true });
testSchema.index({ seriesId: 1, sortOrder: 1 });
testSchema.index({ moduleType: 1, publicationStatus: 1, categoryPath: 1, paperYear: -1 });
testSchema.index({ title: 'text' });
export const TestModel = model('Test', testSchema);
//# sourceMappingURL=Test.model.js.map