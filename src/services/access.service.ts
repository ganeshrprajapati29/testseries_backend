import type { Types } from 'mongoose';
import { EnrollmentModel } from '../models/Enrollment.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { DAY } from '../utils/dateTime.js';

type SeriesLike = { _id: Types.ObjectId; accessType?: string | null };
type TestLike = { isFree?: boolean | null; seriesId?: Types.ObjectId | null };

export async function activeEnrollment(studentId: string | Types.ObjectId, seriesId: string | Types.ObjectId) {
  return EnrollmentModel.findOne({
    studentId,
    testSeriesId: seriesId,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).lean();
}

/** Free series are open to every logged-in student; paid series need an active enrolment. */
export async function hasSeriesAccess(studentId: string | undefined, series: SeriesLike): Promise<boolean> {
  if (series.accessType !== 'paid') return true;
  if (!studentId) return false;
  return !!(await activeEnrollment(studentId, series._id));
}

export async function hasTestAccess(studentId: string | undefined, test: TestLike): Promise<boolean> {
  if (test.isFree || !test.seriesId) return true;
  const series = await TestSeriesModel.findById(test.seriesId, { accessType: 1 }).lean();
  if (!series) return false;
  return hasSeriesAccess(studentId, series);
}

/** Creates or extends an enrolment (purchase or admin grant). */
export async function grantEnrollment(params: {
  studentId: string | Types.ObjectId;
  seriesId: string | Types.ObjectId;
  validityDays: number;
  source: 'free' | 'purchase' | 'admin';
  orderId?: Types.ObjectId | null;
  grantedBy?: Types.ObjectId | null;
  session?: import('mongoose').ClientSession;
}) {
  const existing = await EnrollmentModel.findOne({ studentId: params.studentId, testSeriesId: params.seriesId }).session(params.session ?? null);
  const base = existing?.expiresAt && existing.expiresAt > new Date() && !existing.revokedAt ? existing.expiresAt : new Date();
  const expiresAt = new Date(base.getTime() + params.validityDays * DAY);

  return EnrollmentModel.findOneAndUpdate(
    { studentId: params.studentId, testSeriesId: params.seriesId },
    {
      $set: {
        source: params.source,
        orderId: params.orderId ?? existing?.orderId ?? null,
        grantedBy: params.grantedBy ?? null,
        expiresAt,
        revokedAt: null,
      },
    },
    { upsert: true, new: true, session: params.session },
  );
}
