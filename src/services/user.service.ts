import { Types } from 'mongoose';
import { EnrollmentModel } from '../models/Enrollment.model.js';
import { OrderModel } from '../models/Order.model.js';
import { PasswordResetModel } from '../models/PasswordReset.model.js';
import { QuestionReportModel } from '../models/QuestionReport.model.js';
import { ResultModel } from '../models/Result.model.js';
import { SessionModel } from '../models/Session.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { UserModel } from '../models/User.model.js';
import type { AccountStatus } from '../types/enums.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, escapeRegex, pageParams } from '../utils/pagination.js';
import { hashPassword } from '../utils/password.js';
import { normalizeEmail } from '../utils/sanitize.js';
import { grantEnrollment } from './access.service.js';
import { assertMobileFree, revokeAllSessions } from './auth.service.js';

export type StudentSort = 'newest' | 'oldest' | 'name' | 'lastLogin';
const SORTS: Record<StudentSort, Record<string, 1 | -1>> = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { name: 1, createdAt: -1 },
  lastLogin: { lastLoginAt: -1, createdAt: -1 },
};

function studentFilter(q: { search?: string; status?: AccountStatus }) {
  const filter: Record<string, unknown> = { role: 'student' };
  if (q.status) filter.accountStatus = q.status;
  if (q.search) {
    const rx = { $regex: escapeRegex(q.search), $options: 'i' };
    filter.$or = [{ name: rx }, { email: rx }, { mobile: rx }];
  }
  return filter;
}

export async function listStudents(q: { page: number; limit: number; search?: string; status?: AccountStatus; sort?: StudentSort }) {
  const { page, limit, skip } = pageParams(q.page, q.limit);
  const filter = studentFilter(q);
  const [items, total] = await Promise.all([
    UserModel.find(filter).sort(SORTS[q.sort ?? 'newest']).skip(skip).limit(limit).lean(),
    UserModel.countDocuments(filter),
  ]);
  const attemptCounts = await TestAttemptModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { studentId: { $in: items.map((i) => i._id) } } },
    { $group: { _id: '$studentId', n: { $sum: 1 } } },
  ]);
  const ac = new Map(attemptCounts.map((a) => [String(a._id), a.n]));
  const enrollCounts = await EnrollmentModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { studentId: { $in: items.map((i) => i._id) }, revokedAt: null } },
    { $group: { _id: '$studentId', n: { $sum: 1 } } },
  ]);
  const ec = new Map(enrollCounts.map((a) => [String(a._id), a.n]));
  return {
    items: items.map(({ passwordHash: _p, failedLoginAttempts: _f, lockUntil: _l, ...u }) => ({
      ...u,
      attemptCount: ac.get(String(u._id)) ?? 0,
      enrollmentCount: ec.get(String(u._id)) ?? 0,
    })),
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

/** Headline numbers for the Students page. */
export async function studentStats() {
  const week = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [byStatus, newThisWeek, activeThisWeek, withoutMobile] = await Promise.all([
    UserModel.aggregate<{ _id: string; n: number }>([{ $match: { role: 'student' } }, { $group: { _id: '$accountStatus', n: { $sum: 1 } } }]),
    UserModel.countDocuments({ role: 'student', createdAt: { $gte: week } }),
    UserModel.countDocuments({ role: 'student', lastLoginAt: { $gte: week } }),
    UserModel.countDocuments({ role: 'student', $or: [{ mobile: { $exists: false } }, { mobile: null }, { mobile: '' }] }),
  ]);
  const counts = Object.fromEntries(byStatus.map((b) => [b._id, b.n])) as Record<string, number>;
  return {
    total: byStatus.reduce((t, b) => t + b.n, 0),
    active: counts.active ?? 0,
    suspended: counts.suspended ?? 0,
    deactivated: counts.deactivated ?? 0,
    newThisWeek,
    activeThisWeek,
    withoutMobile,
  };
}

async function assertEmailFree(email: string, exceptId?: string) {
  const filter: Record<string, unknown> = { normalizedEmail: normalizeEmail(email) };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await UserModel.exists(filter)) throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
}

type StudentInput = { name: string; email: string; mobile: string; password: string; accountStatus?: AccountStatus; preferredLanguage?: 'en' | 'hi' };

/** Admin creates a student account directly (e.g. offline / walk-in students). */
export async function createStudent(input: StudentInput) {
  await assertEmailFree(input.email);
  await assertMobileFree(input.mobile);
  return UserModel.create({
    name: input.name,
    email: input.email.trim(),
    normalizedEmail: normalizeEmail(input.email),
    mobile: input.mobile,
    passwordHash: await hashPassword(input.password),
    role: 'student',
    accountStatus: input.accountStatus ?? 'active',
    preferredLanguage: input.preferredLanguage ?? 'en',
  });
}

export async function updateStudent(id: string, input: Partial<Omit<StudentInput, 'password'>>) {
  const user = await UserModel.findOne({ _id: id, role: 'student' });
  if (!user) throw ApiError.notFound('Student not found');
  if (input.email !== undefined && normalizeEmail(input.email) !== user.normalizedEmail) {
    await assertEmailFree(input.email, id);
    user.email = input.email.trim();
    user.normalizedEmail = normalizeEmail(input.email);
  }
  if (input.mobile !== undefined && input.mobile !== user.mobile) {
    await assertMobileFree(input.mobile, id);
    user.mobile = input.mobile;
  }
  if (input.name !== undefined) user.name = input.name;
  if (input.preferredLanguage !== undefined) user.preferredLanguage = input.preferredLanguage;
  const statusChanged = input.accountStatus !== undefined && input.accountStatus !== user.accountStatus;
  if (input.accountStatus !== undefined) user.accountStatus = input.accountStatus;
  await user.save();
  if (statusChanged && user.accountStatus !== 'active') await revokeAllSessions(id);
  return user;
}

/** Sets a password chosen by the admin, unlocks the account and signs the student out everywhere. */
export async function adminResetPassword(id: string, password: string) {
  const user = await UserModel.findOne({ _id: id, role: 'student' });
  if (!user) throw ApiError.notFound('Student not found');
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.set({ failedLoginAttempts: 0, lockUntil: null });
  await user.save();
  await revokeAllSessions(id);
  return user;
}

/**
 * Permanently deletes a student with their attempts, results, enrolments and sessions.
 * Students with payment records are kept for accounting - deactivate them instead.
 */
export async function deleteStudent(id: string) {
  const user = await UserModel.findOne({ _id: id, role: 'student' }).lean();
  if (!user) throw ApiError.notFound('Student not found');
  const studentId = user._id;
  if (await OrderModel.exists({ studentId, orderStatus: { $in: ['paid', 'refunded'] } })) {
    throw ApiError.conflict('This student has payment records. Deactivate the account instead of deleting it.', 'HAS_PAYMENTS');
  }
  const [attempts, results, enrollments] = await Promise.all([
    TestAttemptModel.deleteMany({ studentId }),
    ResultModel.deleteMany({ studentId }),
    EnrollmentModel.deleteMany({ studentId }),
    OrderModel.deleteMany({ studentId }),
    SessionModel.deleteMany({ userId: studentId }),
    PasswordResetModel.deleteMany({ userId: studentId }),
    QuestionReportModel.deleteMany({ studentId }),
  ]);
  await UserModel.deleteOne({ _id: studentId });
  return { email: user.email, removed: { attempts: attempts.deletedCount, results: results.deletedCount, enrollments: enrollments.deletedCount } };
}

function csvCell(v: unknown) {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  // Values that look like formulas are prefixed so spreadsheets never execute them.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV of the students matching the current list filters (max 50k rows). */
export async function exportStudentsCsv(q: { search?: string; status?: AccountStatus; sort?: StudentSort }) {
  const rows = await UserModel.find(studentFilter(q)).sort(SORTS[q.sort ?? 'newest']).limit(50_000).lean();
  const header = ['Name', 'Email', 'Mobile', 'Status', 'Language', 'Registered', 'Last login'];
  const lines = rows.map((u) => [u.name, u.email, u.mobile ?? '', u.accountStatus, u.preferredLanguage, u.createdAt, u.lastLoginAt].map(csvCell).join(','));
  return String.fromCharCode(0xfeff) + [header.join(','), ...lines].join('\r\n');
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
