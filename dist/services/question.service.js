import { Types } from 'mongoose';
import { QuestionModel } from '../models/Question.model.js';
import { ResultModel } from '../models/Result.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, escapeRegex, pageParams } from '../utils/pagination.js';
import { questionContentHash } from '../utils/safeQuestion.js';
import { categoryLabels, resolveCategoryLinks } from './questionCategory.service.js';
import { withAutoHindi } from './questionTranslate.service.js';
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
    // Matches both an empty list and older documents that have no categoryIds field at all.
    if (q.category === 'none')
        filter['categoryIds.0'] = { $exists: false };
    else if (q.category)
        filter.categoryPaths = new Types.ObjectId(q.category);
    const hindiTranslated = { $or: [{ language: 'hi' }, { translations: { $elemMatch: { language: 'hi', questionText: { $nin: ['', null] } } } }] };
    if (q.hindi === 'yes')
        Object.assign(filter, hindiTranslated);
    else if (q.hindi === 'no')
        filter.$nor = [hindiTranslated];
    if (q.excludeTestId) {
        const test = await TestModel.findById(q.excludeTestId, { questionIds: 1 }).lean();
        if (test?.questionIds.length)
            filter._id = { $nin: test.questionIds };
    }
    if (q.testId) {
        // Questions of one test / paper ("View questions" links).
        const test = await TestModel.findById(q.testId, { questionIds: 1 }).lean();
        if (!test)
            throw ApiError.notFound('Test not found');
        filter._id = { ...(filter._id ?? {}), $in: test.questionIds };
        delete filter.isActive;
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
    const labels = await categoryLabels(items.flatMap((i) => i.categoryIds ?? []));
    return {
        items: items.map(({ categoryPaths: _p, ...i }) => ({
            ...i,
            usedInTests: um.get(String(i._id)) ?? 0,
            categories: (i.categoryIds ?? []).map((id) => labels.get(String(id))).filter(Boolean),
        })),
        meta: buildMeta(page, limit, total),
    };
}
export async function questionFacets() {
    const [subjects, sourceExams, years] = await Promise.all([
        QuestionModel.distinct('subject', { subject: { $ne: '' } }),
        QuestionModel.distinct('sourceExam', { sourceExam: { $ne: '' } }),
        QuestionModel.distinct('sourceYear', { sourceYear: { $ne: null } }),
    ]);
    const uncategorized = await QuestionModel.countDocuments({ isActive: true, 'categoryIds.0': { $exists: false } });
    const total = await QuestionModel.countDocuments({ isActive: true });
    return {
        total,
        uncategorized,
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
    const labels = await categoryLabels(question.categoryIds ?? []);
    return { ...question, tests, categories: (question.categoryIds ?? []).map((id) => labels.get(String(id))).filter(Boolean) };
}
export async function createQuestion({ autoTranslate, ...input }, userId) {
    const links = await resolveCategoryLinks(input.categoryIds ?? []);
    const { data, warning } = autoTranslate ? await withAutoHindi(input) : { data: input, warning: undefined };
    const question = await QuestionModel.create({ ...data, ...links, contentHash: questionContentHash(input), createdBy: userId, updatedBy: userId });
    return { question, warning };
}
export async function updateQuestion(id, { autoTranslate, ...input }, userId) {
    const question = await QuestionModel.findById(id);
    if (!question)
        throw ApiError.notFound('Question not found');
    const { categoryIds, ...rest } = input;
    question.set({ ...rest, updatedBy: userId });
    if (categoryIds !== undefined)
        question.set(await resolveCategoryLinks(categoryIds));
    if (input.options && input.correctOption === undefined && !input.options.some((o) => o.key === question.correctOption)) {
        throw ApiError.validation([{ path: 'body.correctOption', message: 'Select a correct option that exists' }]);
    }
    let warning;
    if (autoTranslate) {
        const plain = question.toObject();
        const filled = await withAutoHindi(plain);
        warning = filled.warning;
        if (filled.data !== plain)
            question.set('translations', filled.data.translations);
    }
    question.contentHash = questionContentHash({ questionText: question.questionText, options: question.options });
    await question.save();
    // Note: running attempts use the answer key captured when they started; finished results are immutable.
    return { question, warning };
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