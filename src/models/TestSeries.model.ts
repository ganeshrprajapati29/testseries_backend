import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ACCESS_TYPES, LANGUAGES, MODULE_TYPES, PUBLICATION_STATUSES } from '../types/enums.js';

const testSeriesSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 200 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 10000, default: '' },
    highlights: [{ type: String, trim: true, maxlength: 200 }],
    /** Hindi version of the title / description / highlights (typed or machine translated). */
    hi: {
      title: { type: String, trim: true, maxlength: 400, default: '' },
      description: { type: String, trim: true, maxlength: 15000, default: '' },
      highlights: [{ type: String, trim: true, maxlength: 400 }],
    },
    moduleType: { type: String, enum: MODULE_TYPES, required: true, default: 'TEST_SERIES' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    /** Category + all of its ancestors - lets a parent category list every series below it. */
    categoryPath: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    examName: { type: String, trim: true, maxlength: 120, default: '' },
    subject: { type: String, trim: true, maxlength: 120, default: '' },
    coverImage: { type: String, trim: true, maxlength: 1000, default: '' },
    languageOptions: { type: [{ type: String, enum: LANGUAGES }], default: ['en'] },
    accessType: { type: String, enum: ACCESS_TYPES, default: 'free', required: true },
    price: { type: Number, min: 0, max: 1000000, default: 0 },
    /** Original price shown with a strike-through when discounted. */
    mrp: { type: Number, min: 0, max: 1000000, default: 0 },
    validityDays: { type: Number, min: 1, max: 3650, default: 365 },
    availableFrom: { type: Date, default: null },
    availableUntil: { type: Date, default: null },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    publicationStatus: { type: String, enum: PUBLICATION_STATUSES, default: 'draft' },
    publishedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

testSeriesSchema.index({ slug: 1 }, { unique: true });
testSeriesSchema.index({ publicationStatus: 1, categoryPath: 1, sortOrder: 1 });
testSeriesSchema.index({ moduleType: 1, publicationStatus: 1, isFeatured: -1 });
testSeriesSchema.index({ title: 'text', examName: 'text', subject: 'text' });

export type TestSeries = InferSchemaType<typeof testSeriesSchema>;
export type TestSeriesDocument = HydratedDocument<TestSeries>;
export const TestSeriesModel = model('TestSeries', testSeriesSchema);
