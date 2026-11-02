import { Types } from 'mongoose';
import { CategoryModel } from '../models/Category.model.js';
import { QuestionModel } from '../models/Question.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, escapeRegex, pageParams } from '../utils/pagination.js';
import { toSolutionQuestion } from '../utils/safeQuestion.js';
import { uniqueSlug } from '../utils/slugify.js';
import { hasTestAccess } from './access.service.js';
import { deletePrivateFile, openPrivateFile } from './storage.service.js';
import { categoryLabels, tagQuestionsWithTestCategory } from './questionCategory.service.js';
import { categoryPathFor } from './category.service.js';
import { fillHindiContent } from './translate.service.js';
const testSlugExists = (slug) => TestModel.exists({ slug }).then(Boolean);
async function resolvePlacement(input) {
    if (input.seriesId) {
        const series = await TestSeriesModel.findById(input.seriesId).lean();
        if (!series)
            throw ApiError.validation([{ path: 'body.seriesId', message: 'Test series not found' }]);
        if (series.publicationStatus === 'archived')
            throw ApiError.validation([{ path: 'body.seriesId', message: 'Test series is archived' }]);
        // A test may be placed in a more specific category (e.g. a subject) inside the series category.
        const categoryId = input.categoryId ?? String(series.categoryId);
        const { category, path } = await categoryPathFor(categoryId);
        if (category.moduleType !== series.moduleType) {
            throw ApiError.validation([{ path: 'body.categoryId', message: 'Category belongs to a different module' }]);
        }
        return { seriesId: series._id, categoryId: category._id, categoryPath: path, moduleType: series.moduleType };
    }
    if (!input.categoryId)
        throw ApiError.validation([{ path: 'body.categoryId', message: 'Select a test series or a category' }]);
    const { category, path } = await categoryPathFor(input.categoryId);
    return { seriesId: null, categoryId: category._id, categoryPath: path, moduleType: category.moduleType };
}
function toDoc(input) {
    const { durationMinutes, seriesId: _s, categoryId: _c, moduleType: _m, autoTranslate: _a, ...rest } = input;
    return { ...rest, ...(durationMinutes !== undefined ? { durationSeconds: Math.round(durationMinutes * 60) } : {}) };
}
export async function adminListTests(q) {
    const { page, limit, skip } = pageParams(q.page, q.limit);
    const filter = {};
    if (q.search)
        filter.title = { $regex: escapeRegex(q.search), $options: 'i' };
    if (q.seriesId)
        filter.seriesId = new Types.ObjectId(q.seriesId);
    if (q.categoryId)
        filter.categoryPath = new Types.ObjectId(q.categoryId);
    if (q.moduleType)
        filter.moduleType = q.moduleType;
    filter.publicationStatus = q.status ?? { $ne: 'archived' };
    const [items, total] = await Promise.all([
        TestModel.aggregate([
            { $match: filter },
            { $sort: { updatedAt: -1 } },
            { $skip: skip },
            { $limit: limit },
            { $addFields: { questionCount: { $size: '$questionIds' } } },
            { $project: { questionIds: 0 } },
            { $lookup: { from: 'testseries', localField: 'seriesId', foreignField: '_id', as: 'series', pipeline: [{ $project: { title: 1, slug: 1 } }] } },
            { $lookup: { from: 'categories', localField: 'categoryId', foreignField: '_id', as: 'category', pipeline: [{ $project: { name: 1, slug: 1 } }] } },
            { $addFields: { series: { $first: '$series' }, category: { $first: '$category' } } },
        ]),
        TestModel.countDocuments(filter),
    ]);
    const attemptCounts = await TestAttemptModel.aggregate([
        { $match: { testId: { $in: items.map((i) => i._id) } } },
        { $group: { _id: '$testId', n: { $sum: 1 } } },
    ]);
    const ac = new Map(attemptCounts.map((a) => [String(a._id), a.n]));
    const labels = await categoryLabels(items.map((i) => i.categoryId).filter(Boolean));
    return {
        items: items.map((i) => ({ ...i, attemptCount: ac.get(String(i._id)) ?? 0, categoryLabel: labels.get(String(i.categoryId))?.label ?? '' })),
        meta: buildMeta(page, limit, total),
    };
}
export async function adminGetTest(id) {
    const test = await TestModel.findById(id)
        .populate('seriesId', 'title slug accessType')
        .populate('categoryId', 'name slug')
        .populate({ path: 'questionIds', select: '-contentHash' })
        .lean();
    if (!test)
        throw ApiError.notFound('Test not found');
    const attemptCount = await TestAttemptModel.countDocuments({ testId: test._id });
    const categoryId = test.categoryId?._id;
    const labels = categoryId ? await categoryLabels([categoryId]) : new Map();
    return { ...test, durationMinutes: Math.round(test.durationSeconds / 60), attemptCount, categoryLabel: labels.get(String(categoryId))?.label ?? '' };
}
export async function createTest(input, userId) {
    const placement = await resolvePlacement(input);
    const slug = await uniqueSlug(input.title, testSlugExists);
    const doc = new TestModel({
        ...toDoc(input),
        ...placement,
        slug,
        questionIds: [],
        publicationStatus: 'draft',
        createdBy: userId,
        updatedBy: userId,
    });
    if (input.autoTranslate)
        await autoHindi(doc);
    await doc.save();
    return doc;
}
/** Fills the empty Hindi fields of a test from its English text (see fillHindiContent). */
async function autoHindi(test) {
    const current = (test.toObject().hi ?? {});
    const { hi, warning } = await fillHindiContent({ title: test.title, description: test.description, instructions: test.instructions }, current);
    test.set('hi', hi);
    test.$locals.translationWarning = warning;
}
export async function updateTest(id, input, userId) {
    const test = await TestModel.findById(id);
    if (!test)
        throw ApiError.notFound('Test not found');
    const placementChanged = (input.seriesId !== undefined && String(input.seriesId ?? '') !== String(test.seriesId ?? '')) ||
        (input.categoryId !== undefined && String(input.categoryId) !== String(test.categoryId));
    if (placementChanged) {
        const placement = await resolvePlacement({
            seriesId: input.seriesId !== undefined ? input.seriesId : test.seriesId ? String(test.seriesId) : null,
            categoryId: input.categoryId ?? (input.seriesId !== undefined ? undefined : String(test.categoryId)),
        });
        test.set(placement);
    }
    const oldKeys = [test.questionPaperPdf?.key, test.solutionPdf?.key].filter(Boolean);
    test.set({ ...toDoc(input), updatedBy: userId });
    if (input.autoTranslate)
        await autoHindi(test);
    await test.save();
    const keep = new Set([test.questionPaperPdf?.key, test.solutionPdf?.key].filter(Boolean));
    await Promise.all(oldKeys.filter((k) => !keep.has(k)).map((k) => deletePrivateFile(k)));
    return test;
}
async function assertQuestionsUsable(ids) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length)
        throw ApiError.badRequest('The same question was added more than once');
    const count = await QuestionModel.countDocuments({ _id: { $in: unique }, isActive: true });
    if (count !== unique.length)
        throw ApiError.badRequest('Some questions do not exist or are archived');
}
export async function setTestQuestions(id, questionIds, userId) {
    const test = await TestModel.findById(id);
    if (!test)
        throw ApiError.notFound('Test not found');
    await assertQuestionsUsable(questionIds);
    test.questionIds = questionIds.map((q) => new Types.ObjectId(q));
    test.updatedBy = userId;
    await test.save();
    await tagQuestionsWithTestCategory(questionIds, test);
    return test;
}
export async function addTestQuestions(id, questionIds, userId) {
    const test = await TestModel.findById(id);
    if (!test)
        throw ApiError.notFound('Test not found');
    const existing = new Set(test.questionIds.map(String));
    const toAdd = [...new Set(questionIds)].filter((q) => !existing.has(q));
    if (toAdd.length) {
        await assertQuestionsUsable(toAdd);
        if (test.questionIds.length + toAdd.length > 500)
            throw ApiError.badRequest('A test can contain at most 500 questions');
        test.questionIds.push(...toAdd.map((q) => new Types.ObjectId(q)));
    }
    test.updatedBy = userId;
    await test.save();
    await tagQuestionsWithTestCategory(toAdd, test);
    return { added: toAdd.length, total: test.questionIds.length };
}
export async function removeTestQuestion(id, questionId, userId) {
    const test = await TestModel.findById(id);
    if (!test)
        throw ApiError.notFound('Test not found');
    test.questionIds = test.questionIds.filter((q) => String(q) !== questionId);
    test.updatedBy = userId;
    await test.save();
    return test;
}
export async function setTestPublication(id, status, userId) {
    const test = await TestModel.findById(id);
    if (!test)
        throw ApiError.notFound('Test not found');
    if (status === 'published') {
        if (!test.questionIds.length)
            throw ApiError.badRequest('Add at least one question before publishing');
        const activeQuestions = await QuestionModel.countDocuments({ _id: { $in: test.questionIds }, isActive: true });
        if (activeQuestions !== test.questionIds.length)
            throw ApiError.badRequest('This test contains archived questions. Remove them before publishing.');
        const category = await CategoryModel.findById(test.categoryId).lean();
        if (!category || category.status !== 'active')
            throw ApiError.badRequest('The test category is inactive or archived');
        if (test.seriesId) {
            const series = await TestSeriesModel.findById(test.seriesId).lean();
            if (!series || series.publicationStatus === 'archived')
                throw ApiError.badRequest('The parent test series is archived');
        }
        test.publishedAt = test.publishedAt ?? new Date();
    }
    test.publicationStatus = status;
    test.updatedBy = userId;
    await test.save();
    return test;
}
export async function duplicateTest(id, userId) {
    const source = await TestModel.findById(id).lean();
    if (!source)
        throw ApiError.notFound('Test not found');
    const { _id, createdAt: _c, updatedAt: _u, publishedAt: _p, ...rest } = source;
    void _id;
    const title = `${source.title} (Copy)`.slice(0, 200);
    const copy = new TestModel({ ...rest, title, slug: await uniqueSlug(title, testSlugExists), publicationStatus: 'draft', createdBy: userId, updatedBy: userId });
    await copy.save();
    return copy;
}
export async function removeTest(id, userId) {
    const test = await TestModel.findById(id);
    if (!test)
        throw ApiError.notFound('Test not found');
    const attempts = await TestAttemptModel.countDocuments({ testId: test._id });
    if (attempts) {
        test.publicationStatus = 'archived';
        test.updatedBy = userId;
        await test.save();
        return { archived: true };
    }
    await test.deleteOne();
    await Promise.all([test.questionPaperPdf?.key, test.solutionPdf?.key].filter(Boolean).map((k) => deletePrivateFile(k)));
    return { archived: false };
}
/** Admin preview - includes answers and explanations. */
export async function previewTest(id) {
    const test = await TestModel.findById(id).lean();
    if (!test)
        throw ApiError.notFound('Test not found');
    const questions = await QuestionModel.find({ _id: { $in: test.questionIds } }).lean();
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    return {
        ...test,
        durationMinutes: Math.round(test.durationSeconds / 60),
        questions: test.questionIds.map((qid) => byId.get(String(qid))).filter(Boolean),
    };
}
export function availabilityState(test, now = new Date()) {
    if (test.availableFrom && now < test.availableFrom)
        return 'UPCOMING';
    if (test.availableUntil && now > test.availableUntil)
        return 'CLOSED';
    return 'OPEN';
}
/** Public test overview shown before the instructions page. Never includes questions. */
export async function publicTestDetail(slug, studentId) {
    const test = await TestModel.findOne({ slug, publicationStatus: 'published' }).select('-createdBy -updatedBy').lean();
    if (!test)
        throw ApiError.notFound('Test not found');
    let series = null;
    if (test.seriesId) {
        series = await TestSeriesModel.findById(test.seriesId).select('title slug accessType price publicationStatus').lean();
        if (!series || series.publicationStatus !== 'published')
            throw ApiError.notFound('Test not found');
    }
    const hasAccess = await hasTestAccess(studentId, test);
    let attempts = [];
    if (studentId) {
        attempts = await TestAttemptModel.find({ studentId, testId: test._id })
            .select('status attemptNumber finalScore submittedAt')
            .sort({ attemptNumber: -1 })
            .lean();
    }
    const completed = attempts.filter((a) => a.status !== 'IN_PROGRESS').length;
    const inProgress = attempts.find((a) => a.status === 'IN_PROGRESS');
    const attemptsLeft = test.maxAttempts === 0 ? null : Math.max(0, test.maxAttempts - completed);
    const chain = await CategoryModel.find({ _id: { $in: test.categoryPath } }).select('name slug depth').sort({ depth: 1 }).lean();
    let acc = '';
    const breadcrumb = chain.map((c) => {
        acc = acc ? `${acc}/${c.slug}` : c.slug;
        return { _id: String(c._id), name: c.name, slug: c.slug, path: acc };
    });
    const { questionIds, categoryPath: _cp, questionPaperPdf, solutionPdf, ...safe } = test;
    const paper = await paperPermissions(test, studentId, hasAccess);
    return {
        ...safe,
        questionCount: questionIds.length,
        durationMinutes: Math.round(test.durationSeconds / 60),
        series,
        breadcrumb,
        availability: availabilityState(test),
        hasAccess,
        attemptsUsed: completed,
        attemptsLeft,
        inProgressAttemptId: inProgress ? String(inProgress._id) : null,
        myAttempts: attempts.map((a) => ({ ...a, _id: String(a._id) })),
        pdfs: {
            questionPaper: questionPaperPdf ? { fileName: questionPaperPdf.fileName, size: questionPaperPdf.size, canDownload: hasAccess && !!studentId } : null,
            solutions: solutionPdf ? { fileName: solutionPdf.fileName, size: solutionPdf.size, canDownload: paper.solutions } : null,
        },
        canViewPaper: paper.paper,
        paperLockedReason: paper.reason,
    };
}
/**
 * PYQ papers can be viewed / printed by anyone with access. For mock tests the paper and its
 * solutions become available only after the student has submitted an attempt and results are visible.
 */
async function paperPermissions(test, studentId, hasAccess) {
    if (!studentId)
        return { paper: false, solutions: false, reason: 'Sign in to view the question paper.' };
    if (!hasAccess)
        return { paper: false, solutions: false, reason: 'Unlock this test to view the question paper.' };
    if (test.moduleType === 'PYQS')
        return { paper: true, solutions: true, reason: '' };
    const resultsHidden = test.resultVisibility === 'HIDDEN' || (test.resultVisibility === 'AFTER_WINDOW' && !!test.availableUntil && test.availableUntil > new Date());
    const submitted = await TestAttemptModel.exists({ studentId, testId: test._id, status: { $ne: 'IN_PROGRESS' } });
    if (!submitted)
        return { paper: false, solutions: false, reason: 'The question paper and solutions unlock after you submit this test.' };
    if (resultsHidden)
        return { paper: false, solutions: false, reason: 'Solutions will be available when results are released.' };
    return { paper: true, solutions: true, reason: '' };
}
/** Resolves a downloadable PDF for a student (access-checked) or an admin. */
export async function getTestPdf(ref, kind, studentId, isAdmin = false) {
    const test = ref.id ? await TestModel.findById(ref.id).lean() : await TestModel.findOne({ slug: ref.slug, publicationStatus: 'published' }).lean();
    if (!test)
        throw ApiError.notFound('Test not found');
    const file = kind === 'question-paper' ? test.questionPaperPdf : test.solutionPdf;
    if (!file)
        throw ApiError.notFound('No PDF has been uploaded for this test');
    if (!isAdmin) {
        const hasAccess = await hasTestAccess(studentId, test);
        const perms = await paperPermissions(test, studentId, hasAccess);
        const allowed = kind === 'question-paper' ? hasAccess : perms.solutions;
        if (!allowed)
            throw ApiError.forbidden(perms.reason || 'You do not have access to this PDF');
    }
    const { stream, size } = await openPrivateFile(file.key);
    return { stream, size, fileName: file.fileName };
}
/** Full paper (questions in order + answer key) for the printable / Save-as-PDF view. */
export async function getPrintablePaper(slug, studentId) {
    const test = await TestModel.findOne({ slug, publicationStatus: 'published' }).lean();
    if (!test)
        throw ApiError.notFound('Test not found');
    const hasAccess = await hasTestAccess(studentId, test);
    const perms = await paperPermissions(test, studentId, hasAccess);
    if (!perms.paper)
        throw ApiError.forbidden(perms.reason);
    return buildPrintable(test);
}
export async function getPrintablePaperAdmin(id) {
    const test = await TestModel.findById(id).lean();
    if (!test)
        throw ApiError.notFound('Test not found');
    return buildPrintable(test);
}
async function buildPrintable(test) {
    const questions = await QuestionModel.find({ _id: { $in: test.questionIds } }).select('-contentHash -createdBy -updatedBy').lean();
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    return {
        title: test.title,
        paperName: test.paperName ?? '',
        paperYear: test.paperYear ?? null,
        testType: test.testType,
        durationMinutes: Math.round(test.durationSeconds / 60),
        marksPerCorrect: test.marksPerCorrect,
        negativeMarks: test.negativeMarks,
        totalMarks: test.totalMarks,
        languageOptions: test.languageOptions,
        instructions: test.instructions ?? '',
        questions: test.questionIds
            .map((qid) => byId.get(String(qid)))
            .filter((q) => !!q)
            .map((q, i) => ({ number: i + 1, ...toSolutionQuestion(q), correctOption: q.correctOption })),
    };
}
//# sourceMappingURL=test.service.js.map