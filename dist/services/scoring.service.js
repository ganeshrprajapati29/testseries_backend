import { logger } from '../config/logger.js';
import { withTransaction } from '../config/database.js';
import { ResultModel } from '../models/Result.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { ApiError } from '../utils/ApiError.js';
import { secondsBetween } from '../utils/dateTime.js';
import { scoreAnswers } from '../utils/scoring.js';
/**
 * Evaluates an attempt exactly once. A conditional update claims the attempt so concurrent
 * submissions (double click, timer + click, background job) cannot create duplicate results.
 */
export async function finalizeAttempt(attemptId, reason) {
    const claimed = await TestAttemptModel.findOneAndUpdate({ _id: attemptId, status: 'IN_PROGRESS', lockedForSubmit: false }, { $set: { lockedForSubmit: true } }, { new: true }).select('+answerKeySnapshot');
    if (!claimed) {
        const existing = await ResultModel.findOne({ attemptId }).lean();
        if (existing)
            return existing;
        const attempt = await TestAttemptModel.findById(attemptId).lean();
        if (!attempt)
            throw ApiError.notFound('Attempt not found');
        // Another request is evaluating right now.
        throw ApiError.conflict('This attempt is being submitted. Please wait a moment.', 'SUBMISSION_IN_PROGRESS');
    }
    try {
        const now = new Date();
        // Late submissions (within the grace period or by the expiry job) are capped at the deadline.
        const submittedAt = now < claimed.deadlineAt ? now : claimed.deadlineAt;
        const keyByQuestion = new Map((claimed.answerKeySnapshot ?? []).map((k) => [String(k.questionId), k.correctOption]));
        const stateByQuestion = new Map(claimed.answerStates.map((s) => [String(s.questionId), s]));
        const summary = scoreAnswers(claimed.persistedQuestionOrder.map((q) => ({
            questionId: String(q.questionId),
            selectedOption: stateByQuestion.get(String(q.questionId))?.selectedOption ?? null,
            correctOption: keyByQuestion.get(String(q.questionId)) ?? '',
        })), {
            marksPerCorrect: claimed.scoringConfigurationSnapshot.marksPerCorrect,
            negativeMarks: claimed.scoringConfigurationSnapshot.negativeMarks,
        });
        const timeTakenSeconds = Math.min(secondsBetween(claimed.startedAt, submittedAt), claimed.testConfigurationSnapshot.durationSeconds);
        return await withTransaction(async (session) => {
            const [result] = await ResultModel.create([
                {
                    attemptId: claimed._id,
                    studentId: claimed.studentId,
                    testId: claimed.testId,
                    seriesId: claimed.seriesId,
                    testTitle: claimed.testConfigurationSnapshot.title,
                    totalQuestions: summary.totalQuestions,
                    attemptedCount: summary.attemptedCount,
                    correctCount: summary.correctCount,
                    incorrectCount: summary.incorrectCount,
                    unansweredCount: summary.unansweredCount,
                    totalScore: summary.totalScore,
                    maximumMarks: summary.maximumMarks,
                    percentage: summary.percentage,
                    accuracy: summary.accuracy,
                    timeTakenSeconds,
                    grades: summary.grades.map((g) => ({
                        ...g,
                        timeSpentSeconds: stateByQuestion.get(g.questionId)?.timeSpentSeconds ?? 0,
                    })),
                    evaluatedAt: now,
                },
            ], { session });
            await TestAttemptModel.updateOne({ _id: claimed._id }, {
                $set: {
                    status: reason === 'timeout' ? 'AUTO_SUBMITTED' : 'SUBMITTED',
                    submittedAt,
                    finalScore: summary.totalScore,
                    finalizedAt: now,
                    lockedForSubmit: false,
                },
            }, { session });
            return result.toObject();
        });
    }
    catch (err) {
        await TestAttemptModel.updateOne({ _id: claimed._id, status: 'IN_PROGRESS' }, { $set: { lockedForSubmit: false } });
        logger.error({ err, attemptId }, 'Failed to finalize attempt');
        throw err;
    }
}
//# sourceMappingURL=scoring.service.js.map