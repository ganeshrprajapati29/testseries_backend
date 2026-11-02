import { Schema, model } from 'mongoose';
import { DIFFICULTIES, LANGUAGES, OPTION_KEYS } from '../types/enums.js';
const optionSchema = new Schema({
    key: { type: String, enum: OPTION_KEYS, required: true },
    text: { type: String, trim: true, maxlength: 2000, default: '' },
    imageUrl: { type: String, trim: true, maxlength: 1000, default: '' },
}, { _id: false });
const translationSchema = new Schema({
    language: { type: String, enum: LANGUAGES, required: true },
    questionText: { type: String, trim: true, maxlength: 10000, required: true },
    options: [{ key: { type: String, enum: OPTION_KEYS, required: true }, text: { type: String, trim: true, maxlength: 2000 }, _id: false }],
    explanation: { type: String, trim: true, maxlength: 10000, default: '' },
}, { _id: false });
const questionSchema = new Schema({
    questionText: { type: String, required: true, trim: true, maxlength: 10000 },
    options: {
        type: [optionSchema],
        validate: {
            validator: (opts) => opts.length >= 2 && opts.length <= 6 && new Set(opts.map((o) => o.key)).size === opts.length,
            message: 'A question needs 2-6 options with unique keys',
        },
    },
    correctOption: { type: String, enum: OPTION_KEYS, required: true },
    explanation: { type: String, trim: true, maxlength: 10000, default: '' },
    subject: { type: String, trim: true, maxlength: 120, default: '' },
    topic: { type: String, trim: true, maxlength: 160, default: '' },
    difficulty: { type: String, enum: DIFFICULTIES, default: 'medium' },
    language: { type: String, enum: LANGUAGES, default: 'en' },
    translations: { type: [translationSchema], default: [] },
    imageUrl: { type: String, trim: true, maxlength: 1000, default: '' },
    /** Additional figures shown with the question (imageUrl is always shown first). */
    images: { type: [{ type: String, trim: true, maxlength: 1000 }], default: [] },
    /** Figures shown with the explanation in solutions. */
    explanationImages: { type: [{ type: String, trim: true, maxlength: 1000 }], default: [] },
    /** Categories / sub-categories this question belongs to (both Test Series and PYQ trees). */
    categoryIds: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    /** The categories above plus all their ancestors - lets a parent category list every question below it. */
    categoryPaths: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    sourceExam: { type: String, trim: true, maxlength: 120, default: '' },
    sourceYear: { type: Number, min: 1950, max: 2100, default: null },
    tags: [{ type: String, trim: true, maxlength: 60 }],
    /** Hash of normalised content - used to detect duplicates during bulk import. */
    contentHash: { type: String, index: true },
    isActive: { type: Boolean, default: true },
    archivedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
questionSchema.path('correctOption').validate(function (value) {
    return this.options.some((o) => o.key === value);
}, 'correctOption must match one of the option keys');
questionSchema.index({ subject: 1, topic: 1, isActive: 1 });
questionSchema.index({ categoryPaths: 1, isActive: 1, createdAt: -1 });
questionSchema.index({ sourceExam: 1, sourceYear: -1 });
questionSchema.index({ questionText: 'text', topic: 'text', subject: 'text' });
export const QuestionModel = model('Question', questionSchema);
//# sourceMappingURL=Question.model.js.map