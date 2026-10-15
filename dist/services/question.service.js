import { QuestionModel } from '../models/Question.model.js';
import { ResultModel } from '../models/Result.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, escapeRegex, pageParams } from '../utils/pagination.js';
import { questionContentHash } from '../utils/safeQuestion.js';
export async function listQuestions(q) {
    const { page, limit, skip } = pageParams(q.page, q.limit);
    const filter = {};
    if (q.search)
        filter.questionText = { $regex: escapeRegex(q.search), $options: 'i' };
    if (q.subject)
        filter.subject = q.subject;
    if (q.topic)
        filter.topic = { $regex: escapeRegex(q.topic), $options: 'i' };
    if (q.difficulty)
        filter.difficulty = q.difficulty;
    if (q.language)
        filter.language = q.language;
    if (q.sourceExam)
        filter.sourceExam = q.sourceExam;
    if (q.sourceYear)
        filter.sourceYear = q.sourceYear;
    filter.isActive = q.isActive ?? true;
    if (q.excludeTestId) {
        const test = await TestModel.findById(q.excludeTestId, { questionIds: 1 }).lean();
        if (test?.questionIds.length)
            filter._id = { $nin: test.questionIds };
    }
    const [items, total] = await Promise.all([
        QuestionModel.find(filter).select('-contentHash').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        QuestionModel.countDocuments(filter),
    ]);
    const usage = await TestModel.aggregate([
        { $match: { questionIds: { $in: items.map((i) => i._id) } } },
        { $unwind: '$questionIds' },
        { $match: { questionIds: { $in: items.map((i) => i._id) } } },
        { $group: { _id: '$questionIds', n: { $sum: 1 } } },
    ]);
    const um = new Map(usage.map((u) => [String(u._id), u.n]));
    return { items: items.map((i) => ({ ...i, usedInTests: um.get(String(i._id)) ?? 0 })), meta: buildMeta(page, limit, total) };
}
export async function questionFacets() {
    const [subjects, sourceExams, years] = await Promise.all([
        QuestionModel.distinct('subject', { subject: { $ne: '' } }),
        QuestionModel.distinct('sourceExam', { sourceExam: { $ne: '' } }),
        QuestionModel.distinct('sourceYear', { sourceYear: { $ne: null } }),
    ]);
    return {
        subjects: subjects.sort(),
        sourceExams: sourceExams.sort(),
        years: years.sort((a, b) => b - a),
    };
}
export async function getQuestion(id) {
    const question = await QuestionModel.findById(id).lean();
    if (!question)
        throw ApiError.notFound('Question not found');
    const tests = await TestModel.find({ questionIds: question._id }).select('title slug publicationStatus').lean();
    return { ...question, tests };
}
export async function createQuestion(input, userId) {
    return QuestionModel.create({ ...input, contentHash: questionContentHash(input), createdBy: userId, updatedBy: userId });
}
export async function updateQuestion(id, input, userId) {
    const question = await QuestionModel.findById(id);
    if (!question)
        throw ApiError.notFound('Question not found');
    question.set({ ...input, updatedBy: userId });
    if (input.options && input.correctOption === undefined && !input.options.some((o) => o.key === question.correctOption)) {
        throw ApiError.validation([{ path: 'body.correctOption', message: 'Select a correct option that exists' }]);
    }
    question.contentHash = questionContentHash({ questionText: question.questionText, options: question.options });
    await question.save();
    // Note: running attempts use the answer key captured when they started; finished results are immutable.
    return question;
}
export async function setQuestionActive(id, isActive, userId) {
    const question = await QuestionModel.findById(id);
    if (!question)
        throw ApiError.notFound('Question not found');
    if (!isActive) {
        const publishedTests = await TestModel.countDocuments({ questionIds: question._id, publicationStatus: 'published' });
        if (publishedTests) {
            throw ApiError.conflict(`This question is used in ${publishedTests} published test(s). Remove it from those tests first.`, 'QUESTION_IN_USE');
        }
    }
    question.isActive = isActive;
    question.archivedAt = isActive ? null : new Date();
    question.updatedBy = userId;
    await question.save();
    return question;
}
/** Permanent deletion is only allowed when the question was never used anywhere. */
export async function deleteQuestion(id) {
    const question = await QuestionModel.findById(id);
    if (!question)
        throw ApiError.notFound('Question not found');
    const [inTests, inAttempts, inResults] = await Promise.all([
        TestModel.countDocuments({ questionIds: question._id }),
        TestAttemptModel.countDocuments({ 'persistedQuestionOrder.questionId': question._id }),
        ResultModel.countDocuments({ 'grades.questionId': question._id }),
    ]);
    if (inTests || inAttempts || inResults) {
        throw ApiError.conflict('This question is used by tests or student attempts. Archive it instead of deleting.', 'QUESTION_IN_USE');
    }
    await question.deleteOne();
}
//# sourceMappingURL=question.service.js.map