import { Types } from 'mongoose';
import { logger } from '../config/logger.js';
import { CategoryModel } from '../models/Category.model.js';
import { QuestionModel } from '../models/Question.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { uniqueSlug } from '../utils/slugify.js';

/**
 * Auto practice sets
 * ------------------
 * Students only see questions inside published tests / papers. A question that an admin files under a
 * category in the Question Bank but never adds to a test would never reach the website. For every
 * category that has such "pending" questions we keep published practice sets (tests without a series,
 * PART_SIZE questions each) in sync automatically. As soon as a question is added to a published test it
 * leaves the practice set, so nothing is shown twice.
 */
export const PART_SIZE = 50;

type Id = string | Types.ObjectId;
const oid = (v: Id) => (typeof v === 'string' ? new Types.ObjectId(v) : v);

/** Questions that already reach students through a normal published test. */
async function deliveredQuestionIds() {
  const ids = await TestModel.distinct('questionIds', { publicationStatus: 'published', autoCategoryId: null });
  return new Set(ids.map(String));
}

function settingsFor(moduleType: string, count: number) {
  const isPyq = moduleType === 'PYQS';
  return {
    durationSeconds: Math.min(6 * 3600, Math.max(10, count) * 60), // 1 minute per question, at least 10
    marksPerCorrect: isPyq ? 2.5 : 2,
    negativeMarks: isPyq ? 0.83 : 0.66,
  };
}

/** "2024" in "CAPF Paper 1 > 2024 > History" becomes the paper year on PYQ pages. */
function yearFrom(names: string[]) {
  for (const n of [...names].reverse()) {
    const m = /\b(19[5-9]\d|20\d{2}|2100)\b/.exec(n);
    if (m) return Number(m[1]);
  }
  return null;
}

async function syncCategory(categoryId: Types.ObjectId, delivered: Set<string>) {
  const category = await CategoryModel.findById(categoryId, { name: 1, ancestors: 1, moduleType: 1, status: 1 }).lean();
  const existing = await TestModel.find({ autoCategoryId: categoryId }).sort({ autoPart: 1 });

  let pending: { _id: Types.ObjectId; translations?: { language: string; questionText?: string }[]; language?: string }[] = [];
  if (category && category.status !== 'archived') {
    const questions = await QuestionModel.find({ categoryIds: categoryId, isActive: true }, { _id: 1, translations: 1, language: 1, categoryIds: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    // A question filed under both "CAPF" and "CAPF > 2025 > History" only goes into the most specific
    // set - parent category pages already list the sets of their sub-categories, so it would show twice.
    const otherIds = [...new Set(questions.flatMap((q) => (q.categoryIds ?? []).map(String)))].filter((id) => id !== String(categoryId));
    const below = new Set(
      (await CategoryModel.find({ _id: { $in: otherIds }, ancestors: categoryId, status: { $ne: 'archived' } }, { _id: 1 }).lean()).map((c) => String(c._id)),
    );
    pending = questions.filter((q) => !delivered.has(String(q._id)) && !(q.categoryIds ?? []).some((id) => below.has(String(id))));
  }

  const parts: (typeof pending)[] = [];
  for (let i = 0; i < pending.length; i += PART_SIZE) parts.push(pending.slice(i, i + PART_SIZE));

  let names: string[] = [];
  if (parts.length && category) {
    const ancestors = await CategoryModel.find({ _id: { $in: category.ancestors } }, { name: 1, depth: 1 }).sort({ depth: 1 }).lean();
    names = [...ancestors.map((a) => a.name), category.name];
  }

  for (let i = 0; i < parts.length; i++) {
    const qs = parts[i]!;
    const part = i + 1;
    const hasHindi = qs.some((q) => q.language === 'hi' || (q.translations ?? []).some((t) => t.language === 'hi' && t.questionText));
    const languageOptions = hasHindi ? ['en', 'hi'] : ['en'];
    const settings = settingsFor(category!.moduleType, qs.length);
    let test = existing.find((t) => t.autoPart === part);
    if (!test) {
      const label = names.join(' › ');
      const title = `${label} – Practice Set${parts.length > 1 || part > 1 ? ` ${part}` : ''}`.slice(0, 200);
      const isPyq = category!.moduleType === 'PYQS';
      test = new TestModel({
        title,
        slug: await uniqueSlug(`${names.join(' ')} practice set ${part}`, (s) => TestModel.exists({ slug: s }).then(Boolean)),
        description: `Practice questions from ${label}. New questions added to this category appear here automatically.`,
        moduleType: category!.moduleType,
        seriesId: null,
        categoryId,
        categoryPath: [...category!.ancestors, categoryId],
        testType: isPyq ? 'PYQ_PAPER' : 'CHAPTER',
        paperYear: isPyq ? yearFrom(names) : null,
        paperName: isPyq ? names[0] : '',
        maxAttempts: 0,
        isFree: true,
        resultVisibility: 'IMMEDIATE',
        publicationStatus: 'published',
        publishedAt: new Date(),
        sortOrder: 1000 + part,
        autoCategoryId: categoryId,
        autoPart: part,
        ...settings,
      });
    } else if (test.publicationStatus === 'archived') {
      // Archived by an earlier sync because it became empty - bring it back.
      test.publicationStatus = 'published';
      test.publishedAt = new Date();
    }
    test.set({ questionIds: qs.map((q) => q._id), languageOptions, durationSeconds: settings.durationSeconds, categoryPath: [...category!.ancestors, categoryId] });
    await test.save();
  }

  // Parts that are no longer needed: delete when never attempted, otherwise archive (keeps results intact).
  for (const t of existing.filter((x) => (x.autoPart ?? 0) > parts.length)) {
    if (await TestAttemptModel.exists({ testId: t._id })) {
      if (t.publicationStatus !== 'archived') {
        t.publicationStatus = 'archived';
        await t.save();
      }
    } else {
      await t.deleteOne();
    }
  }
}

/** Re-syncs the practice sets of the given categories. Never throws - content saving must not fail because of it. */
export async function syncPracticeSets(categoryIds: Id[]) {
  const unique = [...new Set(categoryIds.filter(Boolean).map(String))];
  if (!unique.length) return;
  try {
    const delivered = await deliveredQuestionIds();
    for (const id of unique) await syncCategory(oid(id), delivered);
  } catch (err) {
    logger.error({ err, categoryIds: unique }, 'Practice set sync failed');
  }
}

/** Categories (direct, not ancestors) of the given questions. */
export async function categoriesOfQuestions(questionIds: Id[]) {
  if (!questionIds.length) return [];
  const ids = await QuestionModel.distinct('categoryIds', { _id: { $in: questionIds.map(oid) } });
  return ids.map(String);
}

/** Questions moved in or out of normal tests: their categories' practice sets change. */
export async function syncForQuestions(questionIds: Id[], extraCategoryIds: Id[] = []) {
  await syncPracticeSets([...(await categoriesOfQuestions(questionIds)), ...extraCategoryIds.map(String)]);
}

/** Full rebuild for every category that has questions (deploy / repair). */
export async function syncAllPracticeSets() {
  const withQuestions = await QuestionModel.distinct('categoryIds', { isActive: true });
  const withSets = await TestModel.distinct('autoCategoryId', { autoCategoryId: { $ne: null } });
  await syncPracticeSets([...withQuestions, ...withSets].map(String));
  return TestModel.countDocuments({ autoCategoryId: { $ne: null }, publicationStatus: 'published' });
}

export const isAutoPracticeSet = (t: { autoCategoryId?: unknown }) => !!t.autoCategoryId;
