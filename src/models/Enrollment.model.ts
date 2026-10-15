import { Schema, model, type InferSchemaType } from 'mongoose';
import { ENROLLMENT_SOURCES } from '../types/enums.js';

/** Grants a student access to a test series (free enrolment, purchase or admin grant). */
const enrollmentSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    testSeriesId: { type: Schema.Types.ObjectId, ref: 'TestSeries', required: true },
    source: { type: String, enum: ENROLLMENT_SOURCES, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

enrollmentSchema.index({ studentId: 1, testSeriesId: 1 }, { unique: true });
enrollmentSchema.index({ testSeriesId: 1 });

export type Enrollment = InferSchemaType<typeof enrollmentSchema>;
export const EnrollmentModel = model('Enrollment', enrollmentSchema);
