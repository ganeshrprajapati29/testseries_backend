import { Schema, model } from 'mongoose';
const gradeSchema = new Schema({
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    selectedOption: { type: String, default: null },
    correctOption: { type: String, required: true },
    isCorrect: { type: Boolean, required: true },
    isAttempted: { type: Boolean, required: true },
    marksAwarded: { type: Number, required: true },
    timeSpentSeconds: { type: Number, default: 0 },
}, { _id: false });
const resultSchema = new Schema({
    attemptId: { type: Schema.Types.ObjectId, ref: 'TestAttempt', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    testId: { type: Schema.Types.ObjectId, ref: 'Test', required: true },
    seriesId: { type: Schema.Types.ObjectId, ref: 'TestSeries', default: null },
    testTitle: { type: String, required: true },
    totalQuestions: { type: Number, required: true },
    attemptedCount: { type: Number, required: true },
    correctCount: { type: Number, required: true },
    incorrectCount: { type: Number, required: true },
    unansweredCount: { type: Number, required: true },
    totalScore: { type: Number, required: true },
    maximumMarks: { type: Number, required: true },
    percentage: { type: Number, required: true },
    accuracy: { type: Number, required: true },
    timeTakenSeconds: { type: Number, required: true },
    grades: { type: [gradeSchema], default: [] },
    evaluatedAt: { type: Date, required: true },
}, { timestamps: true });
resultSchema.index({ attemptId: 1 }, { unique: true });
resultSchema.index({ studentId: 1, evaluatedAt: -1 });
resultSchema.index({ testId: 1, totalScore: -1 });
resultSchema.index({ evaluatedAt: -1 });
export const ResultModel = model('Result', resultSchema);
//# sourceMappingURL=Result.model.js.map