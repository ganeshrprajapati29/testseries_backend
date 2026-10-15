import { Schema, model } from 'mongoose';
import { ATTEMPT_STATUSES, OPTION_KEYS } from '../types/enums.js';
const answerStateSchema = new Schema({
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    selectedOption: { type: String, enum: OPTION_KEYS, default: null },
    markedForReview: { type: Boolean, default: false },
    visited: { type: Boolean, default: false },
    timeSpentSeconds: { type: Number, min: 0, default: 0 },
    answeredAt: { type: Date, default: null },
}, { _id: false });
const questionOrderSchema = new Schema({
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    /** Order in which option keys are displayed (randomised per attempt when enabled). */
    optionOrder: [{ type: String, enum: OPTION_KEYS }],
}, { _id: false });
const answerKeySchema = new Schema({
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    correctOption: { type: String, enum: OPTION_KEYS, required: true },
}, { _id: false });
const testAttemptSchema = new Schema({
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    testId: { type: Schema.Types.ObjectId, ref: 'Test', required: true },
    seriesId: { type: Schema.Types.ObjectId, ref: 'TestSeries', default: null },
    attemptNumber: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ATTEMPT_STATUSES, default: 'IN_PROGRESS', required: true },
    language: { type: String, enum: ['en', 'hi'], default: 'en' },
    startedAt: { type: Date, required: true },
    deadlineAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    persistedQuestionOrder: { type: [questionOrderSchema], required: true },
    answerStates: { type: [answerStateSchema], default: [] },
    /** Answer key frozen at start time - never sent to the client while in progress. */
    answerKeySnapshot: { type: [answerKeySchema], select: false },
    scoringConfigurationSnapshot: {
        marksPerCorrect: { type: Number, required: true },
        negativeMarks: { type: Number, required: true },
        totalQuestions: { type: Number, required: true },
        maximumMarks: { type: Number, required: true },
    },
    testConfigurationSnapshot: {
        title: { type: String, required: true },
        durationSeconds: { type: Number, required: true },
        resultVisibility: { type: String, required: true },
        availableUntil: { type: Date, default: null },
        languageOptions: [{ type: String }],
    },
    finalScore: { type: Number, default: null },
    finalizedAt: { type: Date, default: null },
    /** Prevents duplicate concurrent submissions. */
    lockedForSubmit: { type: Boolean, default: false },
}, { timestamps: true });
testAttemptSchema.index({ studentId: 1, testId: 1, status: 1 });
testAttemptSchema.index({ studentId: 1, createdAt: -1 });
testAttemptSchema.index({ status: 1, deadlineAt: 1 });
testAttemptSchema.index({ testId: 1, createdAt: -1 });
// Only one in-progress attempt per student per test.
testAttemptSchema.index({ studentId: 1, testId: 1 }, { unique: true, partialFilterExpression: { status: 'IN_PROGRESS' }, name: 'one_active_attempt' });
export const TestAttemptModel = model('TestAttempt', testAttemptSchema);
//# sourceMappingURL=TestAttempt.model.js.map