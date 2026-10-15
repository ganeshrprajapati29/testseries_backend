import { Types } from 'mongoose';
import { EnrollmentModel } from '../models/Enrollment.model.js';
import { ResultModel } from '../models/Result.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { UserModel } from '../models/User.model.js';
import type { AccountStatus } from '../types/enums.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, escapeRegex, pageParams } from '../utils/pagination.js';
import { grantEnrollment } from './access.service.js';
import { revokeAllSessions } from './auth.service.js';

export async function listStudents(q: { page: number; limit: number; search?: string; status?: AccountStatus }) {
  const { page, limit, skip } = pageParams(q.page, q.limit);
  const filter: Record<string, unknown> = { role: 'student' };
  if (q.status) filter.accountStatus = q.status;
  if (q.search) {
    const rx = { $regex: escapeRegex(q.search), $options: 'i' };
    filter.$or = [{ name: rx }, { email: rx }, { mobile: rx }];
  }
  const [items, total] = await Promise.all([
    UserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    UserModel.countDocuments(filter),
  ]);
  const attemptCounts = await TestAttemptModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { studentId: { $in: items.map((i) => i._id) } } },
    { $group: { _id: '$studentId', n: { $sum: 1 } } },
  ]);
  const ac = new Map(attemptCounts.map((a) => [String(a._id), a.n]));
  return {
    items: items.map(({ passwordHash: _p, failedLoginAttempts: _f, lockUntil: _l, ...u }) => ({ ...u, attemptCount: ac.get(String(u._id)) ?? 0 })),
    meta: buildMeta(page, limit, total),
  };
}

export async function studentDetail(id: string) {
  const user = await UserModel.findOne({ _id: id, role: 'student' }).lean();
  if (!user) throw ApiError.notFound('Student not found');
  const { passwordHash: _p, failedLoginAttempts: _f, lockUntil: _l, ...safe } = user;
  const [enrollments, results, attempts] = await Promise.all([
    EnrollmentModel.find({ studentId: user._id }).populate('testSeriesId', 'title slug accessType').sort({ createdAt: -1 }).lean(),
    ResultModel.find({ studentId: user._id }).select('-grades').sort({ evaluatedAt: -1 }).limit(50).lean(),
    TestAttemptModel.countDocuments({ studentId: user._id }),
  ]);
  return { student: safe, enrollments, results, attemptCount: attempts };
}

export async function setStudentStatus(id: string, accountStatus: AccountStatus) {
  const user = await UserModel.findOneAndUpdate({ _id: id, role: 'student' }, { accountStatus }, { new: true });
  if (!user) throw ApiError.notFound('Student not found');
  if (accountStatus !== 'active') await revokeAllSessions(id);
  return user;
}

export async function grantSeriesAccess(studentId: string, seriesId: string, adminId: Types.ObjectId, validityDays?: number) {
  const [student, series] = await Promise.all([
    UserModel.exists({ _id: studentId, role: 'student' }),
    TestSeriesModel.findById(seriesId).lean(),
  ]);
  if (!student) throw ApiError.notFound('Student not found');
  if (!series) throw ApiError.notFound('Test series not found');
  return grantEnrollment({ studentId, seriesId, validityDays: validityDays ?? series.validityDays ?? 365, source: 'admin', grantedBy: adminId });
}

export async function revokeSeriesAccess(studentId: string, seriesId: string) {
  const res = await EnrollmentModel.updateOne({ studentId, testSeriesId: seriesId, revokedAt: null }, { revokedAt: new Date() });
  if (!res.matchedCount) throw ApiError.notFound('Enrolment not found');
}

/** "My Tests": series the student is enrolled in plus their per-series progress. */
export async function myEnrollments(studentId: string) {
  const enrollments = await EnrollmentModel.find({
    studentId,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  })
    .populate({ path: 'testSeriesId', select: 'title slug coverImage accessType examName publicationStatus categoryId', populate: { path: 'categoryId', select: 'name' } })
    .sort({ updatedAt: -1 })
    .lean();
  const seriesIds = enrollments.map((e) => (e.testSeriesId as unknown as { _id: Types.ObjectId } | null)?._id).filter(Boolean) as Types.ObjectId[];

  const [testTotals, done] = await Promise.all([
    TestModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { seriesId: { $in: seriesIds }, publicationStatus: 'published' } },
      { $group: { _id: '$seriesId', n: { $sum: 1 } } },
    ]),
    TestAttemptModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { studentId: new Types.ObjectId(studentId), seriesId: { $in: seriesIds }, status: { $ne: 'IN_PROGRESS' } } },
      { $group: { _id: { s: '$seriesId', t: '$testId' } } },
      { $group: { _id: '$_id.s', n: { $sum: 1 } } },
    ]),
  ]);
  const tt = new Map(testTotals.map((t) => [String(t._id), t.n]));
  const dd = new Map(done.map((t) => [String(t._id), t.n]));

  return enrollments
    .filter((e) => e.testSeriesId && (e.testSeriesId as unknown as { publicationStatus: string }).publicationStatus === 'published')
    .map((e) => {
      const s = e.testSeriesId as unknown as { _id: Types.ObjectId };
      return {
        _id: String(e._id),
        source: e.source,
        expiresAt: e.expiresAt,
        enrolledAt: e.createdAt,
        series: e.testSeriesId,
        totalTests: tt.get(String(s._id)) ?? 0,
        completedTests: dd.get(String(s._id)) ?? 0,
      };
    });
}
