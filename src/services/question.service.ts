import { Types } from 'mongoose';
import { CategoryModel } from '../models/Category.model.js';
import { QuestionModel } from '../models/Question.model.js';
import { ResultModel } from '../models/Result.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, escapeRegex, pageParams } from '../utils/pagination.js';
import { questionContentHash } from '../utils/safeQuestion.js';
import { categoryLabels, resolveCategoryLinks } from './questionCategory.service.js';
import { withAutoHindi, type QuestionLike } from './questionTranslate.service.js';
import { syncPracticeSets } from './practiceSet.service.js';

export interface QuestionInput {
  questionText: string;
  options: { key: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; text: string; imageUrl: string }[];
  correctOption: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  explanation: string;
  subject: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  language: 'en' | 'hi';
  translations: { language: 'en' | 'hi'; questionText: string; options: { key: string; text: string }[]; explanation: string }[];
  imageUrl: string;
  sourceExam: string;
  sourceYear: number | null;
  tags: string[];
  categoryIds: string[];
  isActive: boolean;
  /** Fill the Hindi version by machine translation when it is missing. */
  autoTranslate?: boolean;
}

export async function listQuestions(q: {
  page: number;
  limit: number;
  search?: string;
  subject?: string;
  topic?: string;
  difficulty?: string;
  language?: string;
  sourceExam?: string;
  sourceYear?: number;
  isActive?: boolean;
  excludeTestId?: string;
  category?: string;
  testId?: string;
  hindi?: 'yes' | 'no';
}) {
  const { page, limit, skip } = pageParams(q.page, q.limit);
  const filter: Record<string, unknown> = {};
  if (q.search) filter.questionText = { $regex: escapeRegex(q.search), $options: 'i' };
  if (q.subject) filter.subject = q.subject;
  if (q.topic) filter.topic = { $regex: escapeRegex(q.topic), $options: 'i' };
  if (q.difficulty) filter.difficulty = q.difficulty;
  if (q.language) filter.language = q.language;
  if (q.sourceExam) filter.sourceExam = q.sourceExam;
  if (q.sourceYear) filter.sourceYear = q.sourceYear;
  filter.isActive = q.isActive ?? true;
  // Matches both an empty list and older documents that have no categoryIds field at all.
  if (q.category === 'none') filter['categoryIds.0'] = { $exists: false };
  else if (q.category) filter.categoryPaths = new Types.ObjectId(q.category);
  const hindiTranslated = { $or: [{ language: 'hi' }, { translations: { $elemMatch: { language: 'hi', questionText: { $nin: ['', null] } } } }] };
  if (q.hindi === 'yes') Object.assign(filter, hindiTranslated);
  else if (q.hindi === 'no') filter.$nor = [hindiTranslated];
  if (q.excludeTestId) {
    const test = await TestModel.findById(q.excludeTestId, { questionIds: 1 }).lean();
    if (test?.questionIds.length) filter._id = { $nin: test.questionIds };
  }
  if (q.testId) {
    // Questions of one test / paper ("View questions" links).
    const test = await TestModel.findById(q.testId, { questionIds: 1 }).lean();
    if (!test) throw ApiError.notFound('Test not found');
    filter._id = { ...((filter._id as object) ?? {}), $in: test.questionIds };
    delete filter.isActive;
  }

  const [items, total] = await Promise.all([
    QuestionModel.find(filter).select('-contentHash').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    QuestionModel.countDocuments(filter),
  ]);
  const usage = await TestModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { questionIds: { $in: items.map((i) => i._id) }, autoCategoryId: null } },
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
    years: (years as number[]).sort((a, b) => b - a),
  };
}

export async function getQuestion(id: string) {
  const question = await QuestionModel.findById(id).lean();
  if (!question) throw ApiError.notFound('Question not found');
  const tests = await TestModel.find({ questionIds: question._id }).select('title slug publicationStatus moduleType autoCategoryId seriesId categoryId questionIds').lean();
  const labels = await categoryLabels(question.categoryIds ?? []);
  const sitePaths = await categorySitePaths([...(question.categoryIds ?? []), ...tests.map((t) => t.categoryId)]);

  // Where students find this question on the website: the paper / test page (with its number in that
  // paper) and the category page that lists the paper.
  const websiteLinks = tests
    .filter((t) => t.publicationStatus === 'published')
    .map((t) => ({
      testId: String(t._id),
      title: t.title,
      isPracticeSet: !!t.autoCategoryId,
      url: t.moduleType === 'PYQS' && !t.seriesId ? `/pyqs/paper/${t.slug}` : `/tests/${t.slug}`,
      questionNumber: t.questionIds.findIndex((qid) => String(qid) === String(question._id)) + 1,
      totalQuestions: t.questionIds.length,
      categoryUrl: sitePaths.get(String(t.categoryId)) ?? null,
    }));
  return {
    ...question,
    tests: tests.map(({ questionIds: _q, ...t }) => t),
    websiteLinks,
    categories: (question.categoryIds ?? [])
      .map((id) => labels.get(String(id)) && { ...labels.get(String(id))!, siteUrl: sitePaths.get(String(id)) ?? null })
      .filter(Boolean),
  };
}

/** Public website address of each category page ("/pyqs/capf/2025/history", "/test-series/c/upsc/prelims"). */
async function categorySitePaths(ids: (Types.ObjectId | string | null | undefined)[]) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const cats = await CategoryModel.find({ _id: { $in: unique } }, { slug: 1, ancestors: 1, moduleType: 1, status: 1 }).lean();
  const ancestors = await CategoryModel.find({ _id: { $in: [...new Set(cats.flatMap((c) => c.ancestors.map(String)))] } }, { slug: 1 }).lean();
  const slugOf = new Map([...ancestors, ...cats].map((c) => [String(c._id), c.slug]));
  for (const c of cats) {
    if (c.status !== 'active') continue; // inactive / archived categories have no public page
    const path = [...c.ancestors.map((a) => slugOf.get(String(a)) ?? ''), c.slug].join('/');
    out.set(String(c._id), c.moduleType === 'PYQS' ? `/pyqs/${path}` : `/test-series/c/${path}`);
  }
  return out;
}

export async function createQuestion({ autoTranslate, ...input }: QuestionInput, userId: Types.ObjectId) {
  const links = await resolveCategoryLinks(input.categoryIds ?? []);
  const { data, warning } = autoTranslate ? await withAutoHindi(input) : { data: input, warning: undefined };
  const question = await QuestionModel.create({ ...data, ...links, contentHash: questionContentHash(input), createdBy: userId, updatedBy: userId });
  await syncPracticeSets(links.categoryIds);
  return { question, warning };
}

export async function updateQuestion(id: string, { autoTranslate, ...input }: Partial<QuestionInput>, userId: Types.ObjectId) {
  const question = await QuestionModel.findById(id);
  if (!question) throw ApiError.notFound('Question not found');
  const { categoryIds, ...rest } = input;
  const previousCategories = (question.categoryIds ?? []).map(String);
  question.set({ ...rest, updatedBy: userId });
  if (categoryIds !== undefined) question.set(await resolveCategoryLinks(categoryIds));
  if (input.options && input.correctOption === undefined && !input.options.some((o) => o.key === question.correctOption)) {
    throw ApiError.validation([{ path: 'body.correctOption', message: 'Select a correct option that exists' }]);
  }
  let warning: string | undefined;
  if (autoTranslate) {
    const plain = question.toObject() as unknown as QuestionLike;
    const filled = await withAutoHindi(plain);
    warning = filled.warning;
    if (filled.data !== plain) question.set('translations', filled.data.translations);
  }
  question.contentHash = questionContentHash({ questionText: question.questionText, options: question.options });
  await question.save();
  await syncPracticeSets([...previousCategories, ...(question.categoryIds ?? []).map(String)]);
  // Note: running attempts use the answer key captured when they started; finished results are immutable.
  return { question, warning };
}

export async function setQuestionActive(id: string, isActive: boolean, userId: Types.ObjectId) {
  const question = await QuestionModel.findById(id);
  if (!question) throw ApiError.notFound('Question not found');
  if (!isActive) {
    // Auto practice sets do not count - the question simply leaves them.
    const publishedTests = await TestModel.countDocuments({ questionIds: question._id, publicationStatus: 'published', autoCategoryId: null });
    if (publishedTests) {
      throw ApiError.conflict(`This question is used in ${publishedTests} published test(s). Remove it from those tests first.`, 'QUESTION_IN_USE');
    }
  }
  question.isActive = isActive;
  question.archivedAt = isActive ? null : new Date();
  question.updatedBy = userId;
  await question.save();
  await syncPracticeSets(question.categoryIds ?? []);
  return question;
}

/** Permanent deletion is only allowed when the question was never used anywhere. */
export async function deleteQuestion(id: string) {
  const question = await QuestionModel.findById(id);
  if (!question) throw ApiError.notFound('Question not found');
  const [inTests, inAttempts, inResults] = await Promise.all([
    TestModel.countDocuments({ questionIds: question._id, autoCategoryId: null }),
    TestAttemptModel.countDocuments({ 'persistedQuestionOrder.questionId': question._id }),
    ResultModel.countDocuments({ 'grades.questionId': question._id }),
  ]);
  if (inTests || inAttempts || inResults) {
    throw ApiError.conflict('This question is used by tests or student attempts. Archive it instead of deleting.', 'QUESTION_IN_USE');
  }
  await TestModel.updateMany({ autoCategoryId: { $ne: null }, questionIds: question._id }, { $pull: { questionIds: question._id } });
  await question.deleteOne();
  await syncPracticeSets(question.categoryIds ?? []);
}
