import { Types } from 'mongoose';
import { QuestionModel } from '../models/Question.model.js';
import { ResultModel } from '../models/Result.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, escapeRegex, pageParams } from '../utils/pagination.js';
import { toSolutionQuestion } from '../utils/safeQuestion.js';
import { round2 } from '../utils/scoring.js';
import { UserModel } from '../models/User.model.js';

/** Visibility uses the live test setting so admins can release HIDDEN results later. */
async function visibilityFor(testId: Types.ObjectId) {
  const test = await TestModel.findById(testId, { resultVisibility: 1, availableUntil: 1, slug: 1, seriesId: 1 }).lean();
  const mode = test?.resultVisibility ?? 'IMMEDIATE';
  if (mode === 'HIDDEN') return { visible: false, releaseAt: null as Date | null, reason: 'Results for this test will be published by Civil Sansad soon.', test };
  if (mode === 'AFTER_WINDOW' && test?.availableUntil && test.availableUntil > new Date()) {
    return { visible: false, releaseAt: test.availableUntil, reason: 'Results will be available after the test window closes.', test };
  }
  return { visible: true, releaseAt: null, reason: '', test };
}

async function rankFor(testId: Types.ObjectId, score: number, timeTaken: number) {
  const [better, total] = await Promise.all([
    ResultModel.countDocuments({
      testId,
      $or: [{ totalScore: { $gt: score } }, { totalScore: score, timeTakenSeconds: { $lt: timeTaken } }],
    }),
    ResultModel.countDocuments({ testId }),
  ]);
  const rank = better + 1;
  const percentile = total > 1 ? round2(((total - rank) / (total - 1)) * 100) : 100;
  return { rank, totalCandidates: total, percentile };
}

async function ownedResult(attemptId: string, studentId: string) {
  if (!Types.ObjectId.isValid(attemptId)) throw ApiError.notFound('Result not found');
  const attempt = await TestAttemptModel.findOne({ _id: attemptId, studentId }).lean();
  if (!attempt) throw ApiError.notFound('Result not found');
  if (attempt.status === 'IN_PROGRESS') throw ApiError.badRequest('This attempt has not been submitted yet');
  const result = await ResultModel.findOne({ attemptId: attempt._id }).lean();
  if (!result) throw ApiError.notFound('Result is being prepared. Please refresh in a moment.');
  return { attempt, result };
}

async function subjectBreakdown(grades: { questionId: Types.ObjectId; isCorrect: boolean; isAttempted: boolean; marksAwarded: number }[]) {
  const questions = await QuestionModel.find({ _id: { $in: grades.map((g) => g.questionId) } }, { subject: 1, topic: 1 }).lean();
  const subjectById = new Map(questions.map((q) => [String(q._id), q.subject || 'General']));
  const map = new Map<string, { subject: string; total: number; attempted: number; correct: number; incorrect: number; score: number }>();
  for (const g of grades) {
    const subject = subjectById.get(String(g.questionId)) ?? 'General';
    const row = map.get(subject) ?? { subject, total: 0, attempted: 0, correct: 0, incorrect: 0, score: 0 };
    row.total += 1;
    if (g.isAttempted) row.attempted += 1;
    if (g.isCorrect) row.correct += 1;
    else if (g.isAttempted) row.incorrect += 1;
    row.score = round2(row.score + g.marksAwarded);
    map.set(subject, row);
  }
  return [...map.values()].map((r) => ({ ...r, accuracy: r.attempted ? round2((r.correct / r.attempted) * 100) : 0 }));
}

export async function getStudentResult(attemptId: string, studentId: string) {
  const { attempt, result } = await ownedResult(attemptId, studentId);
  const visibility = await visibilityFor(result.testId);
  const base = {
    attemptId: String(attempt._id),
    testId: String(result.testId),
    testSlug: visibility.test?.slug ?? null,
    testTitle: result.testTitle,
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    resultVisible: visibility.visible,
    releaseAt: visibility.releaseAt,
    message: visibility.reason,
  };
  if (!visibility.visible) return base;

  const [rank, breakdown] = await Promise.all([rankFor(result.testId, result.totalScore, result.timeTakenSeconds), subjectBreakdown(result.grades)]);
  const topper = await ResultModel.findOne({ testId: result.testId }).sort({ totalScore: -1, timeTakenSeconds: 1 }).select('totalScore').lean();
  const avg = await ResultModel.aggregate<{ avg: number }>([{ $match: { testId: result.testId } }, { $group: { _id: null, avg: { $avg: '$totalScore' } } }]);

  return {
    ...base,
    totalQuestions: result.totalQuestions,
    attemptedCount: result.attemptedCount,
    correctCount: result.correctCount,
    incorrectCount: result.incorrectCount,
    unansweredCount: result.unansweredCount,
    totalScore: result.totalScore,
    maximumMarks: result.maximumMarks,
    percentage: result.percentage,
    accuracy: result.accuracy,
    timeTakenSeconds: result.timeTakenSeconds,
    marksPerCorrect: attempt.scoringConfigurationSnapshot!.marksPerCorrect,
    negativeMarks: attempt.scoringConfigurationSnapshot!.negativeMarks,
    evaluatedAt: result.evaluatedAt,
    ...rank,
    topperScore: topper?.totalScore ?? result.totalScore,
    averageScore: round2(avg[0]?.avg ?? result.totalScore),
    subjectBreakdown: breakdown,
  };
}

export async function getSolutions(attemptId: string, studentId: string, isAdmin = false) {
  const attempt = isAdmin
    ? await TestAttemptModel.findById(attemptId).lean()
    : (await ownedResult(attemptId, studentId)).attempt;
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const result = await ResultModel.findOne({ attemptId: attempt._id }).lean();
  if (!result) throw ApiError.notFound('Result not found');

  if (!isAdmin) {
    const visibility = await visibilityFor(result.testId);
    if (!visibility.visible) throw ApiError.forbidden(visibility.reason || 'Solutions are not available yet');
  }

  const questions = await QuestionModel.find({ _id: { $in: attempt.persistedQuestionOrder.map((q) => q.questionId) } }).lean();
  const byId = new Map(questions.map((q) => [String(q._id), q]));
  const gradeById = new Map(result.grades.map((g) => [String(g.questionId), g]));
  const stateById = new Map(attempt.answerStates.map((s) => [String(s.questionId), s]));

  return {
    attemptId: String(attempt._id),
    testTitle: result.testTitle,
    language: attempt.language,
    languageOptions: attempt.testConfigurationSnapshot?.languageOptions ?? ['en'],
    totalScore: result.totalScore,
    maximumMarks: result.maximumMarks,
    questions: attempt.persistedQuestionOrder
      .map((o, index) => {
        const q = byId.get(String(o.questionId));
        const g = gradeById.get(String(o.questionId));
        if (!q || !g) return null;
        return {
          number: index + 1,
          ...toSolutionQuestion(q, o.optionOrder),
          // The answer key is the one frozen in the result, not the possibly edited question.
          correctOption: g.correctOption,
          selectedOption: g.selectedOption ?? null,
          isCorrect: g.isCorrect,
          isAttempted: g.isAttempted,
          marksAwarded: g.marksAwarded,
          markedForReview: stateById.get(String(o.questionId))?.markedForReview ?? false,
          timeSpentSeconds: g.timeSpentSeconds ?? 0,
        };
      })
      .filter(Boolean),
  };
}

export async function studentAttemptHistory(studentId: string, q: { page: number; limit: number; testId?: string; status?: 'IN_PROGRESS' | 'COMPLETED' }) {
  const { page, limit, skip } = pageParams(q.page, q.limit);
  const filter: Record<string, unknown> = { studentId: new Types.ObjectId(studentId) };
  if (q.testId) filter.testId = new Types.ObjectId(q.testId);
  if (q.status === 'IN_PROGRESS') filter.status = 'IN_PROGRESS';
  if (q.status === 'COMPLETED') filter.status = { $ne: 'IN_PROGRESS' };

  const [attempts, total] = await Promise.all([
    TestAttemptModel.find(filter)
      .select('testId seriesId status attemptNumber startedAt deadlineAt submittedAt finalScore testConfigurationSnapshot.title scoringConfigurationSnapshot.maximumMarks')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    TestAttemptModel.countDocuments(filter),
  ]);
  const results = await ResultModel.find({ attemptId: { $in: attempts.map((a) => a._id) } })
    .select('attemptId totalScore maximumMarks percentage accuracy correctCount incorrectCount unansweredCount timeTakenSeconds testId')
    .lean();
  const tests = await TestModel.find({ _id: { $in: attempts.map((a) => a.testId) } }, { slug: 1, resultVisibility: 1, availableUntil: 1 }).lean();
  const testById = new Map(tests.map((t) => [String(t._id), t]));
  const resultByAttempt = new Map(results.map((r) => [String(r.attemptId), r]));

  return {
    items: attempts.map((a) => {
      const t = testById.get(String(a.testId));
      const hidden = t?.resultVisibility === 'HIDDEN' || (t?.resultVisibility === 'AFTER_WINDOW' && t.availableUntil && t.availableUntil > new Date());
      const r = resultByAttempt.get(String(a._id));
      return {
        id: String(a._id),
        testId: String(a.testId),
        testSlug: t?.slug ?? null,
        title: a.testConfigurationSnapshot?.title ?? '',
        status: a.status,
        attemptNumber: a.attemptNumber,
        startedAt: a.startedAt,
        deadlineAt: a.deadlineAt,
        submittedAt: a.submittedAt,
        resultVisible: !hidden,
        result: r && !hidden ? { ...r, attemptId: undefined, _id: undefined } : null,
      };
    }),
    meta: buildMeta(page, limit, total),
  };
}

export async function studentDashboard(studentId: string) {
  const sid = new Types.ObjectId(studentId);
  const [totals, recent, inProgress] = await Promise.all([
    ResultModel.aggregate<{ tests: number; avgPercentage: number; avgAccuracy: number; best: number; questions: number; correct: number; time: number }>([
      { $match: { studentId: sid } },
      {
        $group: {
          _id: null,
          tests: { $sum: 1 },
          avgPercentage: { $avg: '$percentage' },
          avgAccuracy: { $avg: '$accuracy' },
          best: { $max: '$percentage' },
          questions: { $sum: '$attemptedCount' },
          correct: { $sum: '$correctCount' },
          time: { $sum: '$timeTakenSeconds' },
        },
      },
    ]),
    ResultModel.find({ studentId: sid }).sort({ evaluatedAt: -1 }).limit(8).select('attemptId testTitle totalScore maximumMarks percentage accuracy evaluatedAt testId').lean(),
    TestAttemptModel.find({ studentId: sid, status: 'IN_PROGRESS', deadlineAt: { $gt: new Date() } })
      .select('testId deadlineAt testConfigurationSnapshot.title startedAt')
      .sort({ startedAt: -1 })
      .lean(),
  ]);
  const t = totals[0];
  return {
    stats: {
      testsTaken: t?.tests ?? 0,
      averagePercentage: round2(t?.avgPercentage ?? 0),
      averageAccuracy: round2(t?.avgAccuracy ?? 0),
      bestPercentage: round2(t?.best ?? 0),
      questionsAttempted: t?.questions ?? 0,
      correctAnswers: t?.correct ?? 0,
      timeSpentSeconds: t?.time ?? 0,
    },
    recentResults: recent.map((r) => ({ ...r, attemptId: String(r.attemptId) })),
    inProgress: inProgress.map((a) => ({ id: String(a._id), title: a.testConfigurationSnapshot?.title, deadlineAt: a.deadlineAt, startedAt: a.startedAt })),
  };
}

// ---------------------------------------------------------------- admin

export async function adminListResults(q: { page: number; limit: number; testId?: string; studentId?: string; from?: Date | null; to?: Date | null; search?: string }) {
  const { page, limit, skip } = pageParams(q.page, q.limit);
  const filter: Record<string, unknown> = {};
  if (q.testId) filter.testId = new Types.ObjectId(q.testId);
  if (q.studentId) filter.studentId = new Types.ObjectId(q.studentId);
  if (q.from || q.to) filter.evaluatedAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.search) {
    const users = await UserModel.find(
      { role: 'student', $or: [{ name: { $regex: escapeRegex(q.search), $options: 'i' } }, { email: { $regex: escapeRegex(q.search), $options: 'i' } }] },
      { _id: 1 },
    )
      .limit(200)
      .lean();
    filter.studentId = { $in: users.map((u) => u._id) };
  }
  const [items, total] = await Promise.all([
    ResultModel.find(filter).select('-grades').populate('studentId', 'name email').sort({ evaluatedAt: -1 }).skip(skip).limit(limit).lean(),
    ResultModel.countDocuments(filter),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
}

export async function adminResultsCsv(q: { testId?: string; from?: Date | null; to?: Date | null }) {
  const filter: Record<string, unknown> = {};
  if (q.testId) filter.testId = new Types.ObjectId(q.testId);
  if (q.from || q.to) filter.evaluatedAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const rows = await ResultModel.find(filter).select('-grades').populate('studentId', 'name email').sort({ evaluatedAt: -1 }).limit(20000).lean();
  const esc = (v: unknown) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // prevent spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Student', 'Email', 'Test', 'Score', 'Maximum', 'Percentage', 'Accuracy', 'Correct', 'Incorrect', 'Unanswered', 'Time (s)', 'Evaluated At'];
  const lines = rows.map((r) => {
    const s = r.studentId as unknown as { name?: string; email?: string } | null;
    return [s?.name, s?.email, r.testTitle, r.totalScore, r.maximumMarks, r.percentage, r.accuracy, r.correctCount, r.incorrectCount, r.unansweredCount, r.timeTakenSeconds, r.evaluatedAt.toISOString()]
      .map(esc)
      .join(',');
  });
  return [header.join(','), ...lines].join('\n');
}

export async function adminListAttempts(q: { page: number; limit: number; testId?: string; studentId?: string; status?: string; from?: Date | null; to?: Date | null }) {
  const { page, limit, skip } = pageParams(q.page, q.limit);
  const filter: Record<string, unknown> = {};
  if (q.testId) filter.testId = new Types.ObjectId(q.testId);
  if (q.studentId) filter.studentId = new Types.ObjectId(q.studentId);
  if (q.status) filter.status = q.status;
  if (q.from || q.to) filter.startedAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const [items, total] = await Promise.all([
    TestAttemptModel.find(filter)
      .select('studentId testId status attemptNumber startedAt deadlineAt submittedAt finalScore testConfigurationSnapshot.title scoringConfigurationSnapshot.maximumMarks')
      .populate('studentId', 'name email')
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    TestAttemptModel.countDocuments(filter),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
}

export async function adminAttemptDetail(attemptId: string) {
  const attempt = await TestAttemptModel.findById(attemptId).populate('studentId', 'name email').lean();
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const result = await ResultModel.findOne({ attemptId: attempt._id }).select('-grades').lean();
  const solutions = result ? await getSolutions(attemptId, '', true) : null;
  return { attempt: { ...attempt, answerKeySnapshot: undefined }, result, solutions };
}
