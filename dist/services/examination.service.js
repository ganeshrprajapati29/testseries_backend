import { Types } from 'mongoose';
import { QuestionModel } from '../models/Question.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { ApiError } from '../utils/ApiError.js';
import { SUBMISSION_GRACE_MS } from '../utils/dateTime.js';
import { shuffle, toSafeQuestion } from '../utils/safeQuestion.js';
import { hasTestAccess } from './access.service.js';
import { finalizeAttempt } from './scoring.service.js';
import { availabilityState } from './test.service.js';
function isExpired(attempt, now = new Date()) {
    return now.getTime() > attempt.deadlineAt.getTime() + SUBMISSION_GRACE_MS;
}
async function loadOwnedAttempt(attemptId, studentId) {
    if (!Types.ObjectId.isValid(attemptId))
        throw ApiError.notFound('Attempt not found');
    const attempt = await TestAttemptModel.findOne({ _id: attemptId, studentId });
    // 404 rather than 403 so ids belonging to other students are not revealed.
    if (!attempt)
        throw ApiError.notFound('Attempt not found');
    return attempt;
}
/** Starts a new attempt or resumes the running one. */
export async function startAttempt(testId, studentId, language) {
    const test = await TestModel.findOne({ _id: testId, publicationStatus: 'published' }).lean();
    if (!test)
        throw ApiError.notFound('Test not found');
    if (test.seriesId) {
        const series = await TestSeriesModel.findById(test.seriesId, { publicationStatus: 1 }).lean();
        if (!series || series.publicationStatus !== 'published')
            throw ApiError.notFound('Test not found');
    }
    const running = await TestAttemptModel.findOne({ studentId, testId: test._id, status: 'IN_PROGRESS' });
    if (running) {
        if (!isExpired(running))
            return { attemptId: String(running._id), resumed: true };
        await finalizeAttempt(String(running._id), 'timeout');
    }
    const availability = availabilityState(test);
    if (availability === 'UPCOMING')
        throw ApiError.badRequest('This test has not started yet');
    if (availability === 'CLOSED')
        throw ApiError.badRequest('This test is no longer available');
    if (!(await hasTestAccess(studentId, test)))
        throw ApiError.paymentRequired();
    const completed = await TestAttemptModel.countDocuments({ studentId, testId: test._id, status: { $ne: 'IN_PROGRESS' } });
    if (test.maxAttempts > 0 && completed >= test.maxAttempts) {
        throw ApiError.conflict(`You have used all ${test.maxAttempts} attempt(s) for this test`, 'ATTEMPT_LIMIT_REACHED');
    }
    const questions = await QuestionModel.find({ _id: { $in: test.questionIds }, isActive: true }, { options: 1, correctOption: 1 }).lean();
    if (!questions.length)
        throw ApiError.badRequest('This test has no questions yet');
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    const usable = test.questionIds.filter((id) => byId.has(String(id)));
    const order = (test.randomizeQuestions ? shuffle(usable) : usable).map((qid) => {
        const keys = byId.get(String(qid)).options.map((o) => o.key);
        return { questionId: qid, optionOrder: test.randomizeOptions ? shuffle(keys) : keys };
    });
    const languageOptions = (test.languageOptions?.length ? test.languageOptions : ['en']);
    const chosenLanguage = language && languageOptions.includes(language) ? language : languageOptions[0];
    const now = new Date();
    try {
        const attempt = await TestAttemptModel.create({
            studentId,
            testId: test._id,
            seriesId: test.seriesId ?? null,
            attemptNumber: completed + 1,
            status: 'IN_PROGRESS',
            language: chosenLanguage,
            startedAt: now,
            deadlineAt: new Date(now.getTime() + test.durationSeconds * 1000),
            persistedQuestionOrder: order,
            answerStates: order.map((o) => ({ questionId: o.questionId })),
            answerKeySnapshot: order.map((o) => ({ questionId: o.questionId, correctOption: byId.get(String(o.questionId)).correctOption })),
            scoringConfigurationSnapshot: {
                marksPerCorrect: test.marksPerCorrect,
                negativeMarks: test.negativeMarks,
                totalQuestions: order.length,
                maximumMarks: Math.round(order.length * test.marksPerCorrect * 100) / 100,
            },
            testConfigurationSnapshot: {
                title: test.title,
                durationSeconds: test.durationSeconds,
                resultVisibility: test.resultVisibility,
                availableUntil: test.availableUntil ?? null,
                languageOptions,
            },
        });
        return { attemptId: String(attempt._id), resumed: false };
    }
    catch (err) {
        // Two "start" clicks at the same time: the unique partial index lets only one through.
        if (err.code === 11000) {
            const existing = await TestAttemptModel.findOne({ studentId, testId: test._id, status: 'IN_PROGRESS' }).lean();
            if (existing)
                return { attemptId: String(existing._id), resumed: true };
        }
        throw err;
    }
}
function attemptSummary(attempt) {
    return {
        id: String(attempt._id),
        testId: String(attempt.testId),
        status: attempt.status,
        attemptNumber: attempt.attemptNumber,
        language: attempt.language,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        submittedAt: attempt.submittedAt,
        title: attempt.testConfigurationSnapshot.title,
        durationSeconds: attempt.testConfigurationSnapshot.durationSeconds,
        languageOptions: attempt.testConfigurationSnapshot.languageOptions,
        marksPerCorrect: attempt.scoringConfigurationSnapshot.marksPerCorrect,
        negativeMarks: attempt.scoringConfigurationSnapshot.negativeMarks,
        totalQuestions: attempt.scoringConfigurationSnapshot.totalQuestions,
        maximumMarks: attempt.scoringConfigurationSnapshot.maximumMarks,
    };
}
/** Exam payload: questions without answers, the saved answer states and the server clock. */
export async function getAttemptForExam(attemptId, studentId) {
    let attempt = await loadOwnedAttempt(attemptId, studentId);
    if (attempt.status === 'IN_PROGRESS' && isExpired(attempt)) {
        await finalizeAttempt(attemptId, 'timeout');
        attempt = await loadOwnedAttempt(attemptId, studentId);
    }
    const now = new Date();
    if (attempt.status !== 'IN_PROGRESS') {
        return { attempt: attemptSummary(attempt), finished: true, serverNow: now, remainingSeconds: 0, questions: [], answers: [] };
    }
    const ids = attempt.persistedQuestionOrder.map((q) => q.questionId);
    const questions = await QuestionModel.find({ _id: { $in: ids } }).select('-correctOption -explanation -translations.explanation -contentHash').lean();
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    return {
        attempt: attemptSummary(attempt),
        finished: false,
        serverNow: now,
        remainingSeconds: Math.max(0, Math.floor((attempt.deadlineAt.getTime() - now.getTime()) / 1000)),
        questions: attempt.persistedQuestionOrder
            .map((o) => {
            const q = byId.get(String(o.questionId));
            return q ? toSafeQuestion(q, o.optionOrder) : null;
        })
            .filter(Boolean),
        answers: attempt.answerStates.map((s) => ({
            questionId: String(s.questionId),
            selectedOption: s.selectedOption ?? null,
            markedForReview: s.markedForReview,
            visited: s.visited,
            timeSpentSeconds: s.timeSpentSeconds,
        })),
    };
}
/** Autosaves one or more answers. Rejects writes after the deadline (+ small grace period). */
export async function saveAnswers(attemptId, studentId, updates) {
    const attempt = await loadOwnedAttempt(attemptId, studentId);
    if (attempt.status !== 'IN_PROGRESS')
        throw ApiError.conflict('This attempt has already been submitted', 'ATTEMPT_CLOSED');
    if (isExpired(attempt)) {
        await finalizeAttempt(attemptId, 'timeout');
        throw ApiError.conflict('Time is up. Your test has been submitted automatically.', 'ATTEMPT_EXPIRED');
    }
    const allowed = new Set(attempt.persistedQuestionOrder.map((q) => String(q.questionId)));
    const optionKeys = new Map(attempt.persistedQuestionOrder.map((q) => [String(q.questionId), new Set(q.optionOrder)]));
    for (const u of updates) {
        if (!allowed.has(u.questionId))
            throw ApiError.badRequest('Question does not belong to this attempt');
        if (u.selectedOption && !optionKeys.get(u.questionId).has(u.selectedOption)) {
            throw ApiError.badRequest('Invalid option for this question');
        }
    }
    const deadlineGuard = new Date(Date.now() - SUBMISSION_GRACE_MS);
    const ops = updates.map((u) => {
        const set = {};
        if (u.selectedOption !== undefined) {
            set['answerStates.$[a].selectedOption'] = u.selectedOption;
            set['answerStates.$[a].answeredAt'] = u.selectedOption ? new Date() : null;
        }
        if (u.markedForReview !== undefined)
            set['answerStates.$[a].markedForReview'] = u.markedForReview;
        if (u.visited !== undefined)
            set['answerStates.$[a].visited'] = u.visited;
        const update = {};
        if (Object.keys(set).length)
            update.$set = set;
        if (u.timeSpentDelta > 0)
            update.$inc = { 'answerStates.$[a].timeSpentSeconds': Math.min(u.timeSpentDelta, 3600) };
        return {
            updateOne: {
                filter: { _id: attempt._id, studentId: attempt.studentId, status: 'IN_PROGRESS', lockedForSubmit: false, deadlineAt: { $gt: deadlineGuard } },
                update,
                arrayFilters: [{ 'a.questionId': new Types.ObjectId(u.questionId) }],
            },
        };
    }).filter((op) => Object.keys(op.updateOne.update).length > 0);
    if (ops.length) {
        const res = await TestAttemptModel.bulkWrite(ops, { ordered: true });
        if (res.matchedCount === 0)
            throw ApiError.conflict('This attempt is no longer accepting answers', 'ATTEMPT_CLOSED');
    }
    return { saved: updates.length, serverNow: new Date() };
}
export async function submitAttempt(attemptId, studentId) {
    const attempt = await loadOwnedAttempt(attemptId, studentId);
    if (attempt.status !== 'IN_PROGRESS') {
        return { attemptId, alreadySubmitted: true };
    }
    await finalizeAttempt(attemptId, isExpired(attempt) ? 'timeout' : 'manual');
    return { attemptId, alreadySubmitted: false };
}
export async function changeAttemptLanguage(attemptId, studentId, language) {
    const attempt = await loadOwnedAttempt(attemptId, studentId);
    if (!attempt.testConfigurationSnapshot.languageOptions.includes(language))
        throw ApiError.badRequest('Language not available for this test');
    attempt.language = language;
    await attempt.save();
    return { language };
}
/** Finalises attempts whose time ran out while the browser was closed. */
export async function expireOverdueAttempts(limit = 100) {
    const cutoff = new Date(Date.now() - SUBMISSION_GRACE_MS);
    const overdue = await TestAttemptModel.find({ status: 'IN_PROGRESS', lockedForSubmit: false, deadlineAt: { $lt: cutoff } })
        .select('_id')
        .limit(limit)
        .lean();
    let finalized = 0;
    for (const a of overdue) {
        try {
            await finalizeAttempt(String(a._id), 'timeout');
            finalized += 1;
        }
        catch {
            // Logged inside finalizeAttempt; retried on the next run.
        }
    }
    return finalized;
}
//# sourceMappingURL=examination.service.js.map