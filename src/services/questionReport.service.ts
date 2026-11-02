import { Types } from 'mongoose';
import { QuestionModel } from '../models/Question.model.js';
import { QuestionReportModel, type ReportReason, type ReportStatus } from '../models/QuestionReport.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, escapeRegex, pageParams } from '../utils/pagination.js';
import { categoryLabels } from './questionCategory.service.js';

const oid = (v: string) => new Types.ObjectId(v);

/** What a student sees about their own reports (never other students' data). */
function studentView(r: { questionId: Types.ObjectId; reason: string; comment: string; status: string; adminNote: string; createdAt?: Date; resolvedAt?: Date | null }) {
  return {
    questionId: String(r.questionId),
    reason: r.reason,
    comment: r.comment,
    status: r.status,
    adminNote: r.status === 'open' ? '' : r.adminNote,
    reportedAt: r.createdAt,
    resolvedAt: r.resolvedAt ?? null,
  };
}

/**
 * A student reports a question of one of their own attempts (during the test or from the solutions).
 * Reporting the same question again in the same attempt updates the earlier report.
 */
export async function reportQuestion(studentId: string, attemptId: string, input: { questionId: string; reason: ReportReason; comment: string }) {
  const attempt = await TestAttemptModel.findOne({ _id: attemptId, studentId }, { persistedQuestionOrder: 1, testId: 1, language: 1 }).lean();
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const index = attempt.persistedQuestionOrder.findIndex((q) => String(q.questionId) === input.questionId);
  if (index < 0) throw ApiError.badRequest('This question is not part of your test');

  const existing = await QuestionReportModel.findOne({ attemptId: attempt._id, questionId: oid(input.questionId) });
  if (existing && existing.status !== 'open') {
    throw ApiError.conflict('This report has already been reviewed by our team.', 'REPORT_CLOSED');
  }
  const report = await QuestionReportModel.findOneAndUpdate(
    { attemptId: attempt._id, questionId: oid(input.questionId) },
    {
      $set: { reason: input.reason, comment: input.comment, language: attempt.language ?? 'en' },
      $setOnInsert: { studentId: oid(studentId), testId: attempt.testId, questionNumber: index + 1, status: 'open' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return { report: studentView(report!), updated: !!existing };
}

/** The student's reports for one attempt (to show "Reported" badges and the admin's reply). */
export async function myAttemptReports(studentId: string, attemptId: string) {
  const owns = await TestAttemptModel.exists({ _id: attemptId, studentId });
  if (!owns) throw ApiError.notFound('Attempt not found');
  const reports = await QuestionReportModel.find({ attemptId, studentId }).lean();
  return reports.map(studentView);
}

export async function reportCounts() {
  const rows = await QuestionReportModel.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n])) as Record<string, number>;
  const openQuestions = (await QuestionReportModel.distinct('questionId', { status: 'open' })).length;
  return { open: by.open ?? 0, resolved: by.resolved ?? 0, dismissed: by.dismissed ?? 0, openQuestions };
}

/**
 * Admin list grouped by question - most reported first. Each row has the question, how many
 * students reported it, the reasons and the tests it was reported from.
 */
export async function reportsByQuestion(q: { page: number; limit: number; status?: ReportStatus | 'all'; reason?: ReportReason; testId?: string; search?: string }) {
  const { page, limit, skip } = pageParams(q.page, q.limit);
  const match: Record<string, unknown> = {};
  if (q.status !== 'all') match.status = q.status ?? 'open';
  if (q.reason) match.reason = q.reason;
  if (q.testId) match.testId = oid(q.testId);
  if (q.search) {
    const ids = await QuestionModel.find({ questionText: { $regex: escapeRegex(q.search), $options: 'i' } }, { _id: 1 }).limit(500).lean();
    match.questionId = { $in: ids.map((i) => i._id) };
  }

  const [rows, totalRows] = await Promise.all([
    QuestionReportModel.aggregate<{ _id: Types.ObjectId; count: number; reasons: string[]; tests: Types.ObjectId[]; latestAt: Date; statuses: string[] }>([
      { $match: match },
      { $group: { _id: '$questionId', count: { $sum: 1 }, reasons: { $push: '$reason' }, tests: { $addToSet: '$testId' }, latestAt: { $max: '$createdAt' }, statuses: { $addToSet: '$status' } } },
      { $sort: { count: -1, latestAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]),
    QuestionReportModel.aggregate<{ n: number }>([{ $match: match }, { $group: { _id: '$questionId' } }, { $count: 'n' }]),
  ]);

  const questions = await QuestionModel.find({ _id: { $in: rows.map((r) => r._id) } })
    .select('questionText options correctOption explanation subject topic categoryIds isActive imageUrl images language translations')
    .lean();
  const qMap = new Map(questions.map((x) => [String(x._id), x]));
  const tests = await TestModel.find({ _id: { $in: [...new Set(rows.flatMap((r) => r.tests.map(String)))] } }, { title: 1, moduleType: 1 }).lean();
  const tMap = new Map(tests.map((t) => [String(t._id), t]));
  const labels = await categoryLabels(questions.flatMap((x) => x.categoryIds ?? []));

  const items = rows.map((r) => {
    const question = qMap.get(String(r._id));
    const reasonCounts: Record<string, number> = {};
    for (const reason of r.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    return {
      questionId: String(r._id),
      count: r.count,
      reasonCounts,
      statuses: r.statuses,
      latestAt: r.latestAt,
      tests: r.tests.map((t) => tMap.get(String(t))).filter(Boolean),
      question: question
        ? { ...question, categories: (question.categoryIds ?? []).map((id) => labels.get(String(id))).filter(Boolean) }
        : null,
    };
  });
  return { items, meta: buildMeta(page, limit, totalRows[0]?.n ?? 0) };
}

/** Every report of one question (with student and test) for the admin detail view. */
export async function reportsForQuestion(questionId: string, status?: ReportStatus) {
  const filter: Record<string, unknown> = { questionId: oid(questionId) };
  if (status) filter.status = status;
  return QuestionReportModel.find(filter)
    .populate('studentId', 'name email mobile')
    .populate('testId', 'title moduleType')
    .populate('resolvedBy', 'name')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
}

/** Resolve / dismiss (or re-open) a single report. */
export async function updateReport(id: string, input: { status: ReportStatus; adminNote?: string }, adminId: Types.ObjectId) {
  const closing = input.status !== 'open';
  const report = await QuestionReportModel.findByIdAndUpdate(
    id,
    {
      $set: {
        status: input.status,
        ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
        resolvedBy: closing ? adminId : null,
        resolvedAt: closing ? new Date() : null,
      },
    },
    { new: true },
  ).lean();
  if (!report) throw ApiError.notFound('Report not found');
  return report;
}

/** Closes every open report of a question at once (e.g. after fixing the answer key). */
export async function closeQuestionReports(questionId: string, input: { status: 'resolved' | 'dismissed'; adminNote: string }, adminId: Types.ObjectId) {
  const res = await QuestionReportModel.updateMany(
    { questionId: oid(questionId), status: 'open' },
    { $set: { status: input.status, adminNote: input.adminNote, resolvedBy: adminId, resolvedAt: new Date() } },
  );
  return { updated: res.modifiedCount };
}
