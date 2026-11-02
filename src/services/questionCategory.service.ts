import { Types } from 'mongoose';
import { CategoryModel } from '../models/Category.model.js';
import { QuestionModel } from '../models/Question.model.js';
import { TestModel } from '../models/Test.model.js';
import { ApiError } from '../utils/ApiError.js';
import { categoriesOfQuestions, syncPracticeSets } from './practiceSet.service.js';

const oid = (v: string | Types.ObjectId) => (typeof v === 'string' ? new Types.ObjectId(v) : v);

/**
 * Validates category ids and returns them with the full path set (each category + its ancestors).
 * Storing the paths lets "Defence" list questions saved under "Defence / CDS / Maths".
 */
export async function resolveCategoryLinks(ids: (string | Types.ObjectId)[]) {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return { categoryIds: [] as Types.ObjectId[], categoryPaths: [] as Types.ObjectId[] };
  const cats = await CategoryModel.find({ _id: { $in: unique } }, { ancestors: 1, status: 1 }).lean();
  if (cats.length !== unique.length) throw ApiError.validation([{ path: 'body.categoryIds', message: 'One or more selected categories no longer exist' }]);
  if (cats.some((c) => c.status === 'archived')) throw ApiError.validation([{ path: 'body.categoryIds', message: 'Archived categories cannot be selected' }]);
  const paths = new Map<string, Types.ObjectId>();
  for (const c of cats) for (const id of [...c.ancestors, c._id]) paths.set(String(id), id);
  return { categoryIds: unique.map((i) => oid(i)), categoryPaths: [...paths.values()] };
}

/** "Defence › CDS › Maths" style labels for a set of category ids. */
export async function categoryLabels(ids: (string | Types.ObjectId)[]) {
  const unique = [...new Set(ids.map(String))];
  const out = new Map<string, { _id: string; name: string; label: string; moduleType: string }>();
  if (!unique.length) return out;
  const cats = await CategoryModel.find({ _id: { $in: unique } }, { name: 1, ancestors: 1, moduleType: 1 }).lean();
  const ancestorIds = [...new Set(cats.flatMap((c) => c.ancestors.map(String)))];
  const ancestors = await CategoryModel.find({ _id: { $in: ancestorIds } }, { name: 1 }).lean();
  const nameOf = new Map(ancestors.map((a) => [String(a._id), a.name]));
  for (const c of cats) {
    const label = [...c.ancestors.map((a) => nameOf.get(String(a)) ?? '?'), c.name].join(' › ');
    out.set(String(c._id), { _id: String(c._id), name: c.name, label, moduleType: c.moduleType });
  }
  return out;
}

/** Recomputes categoryPaths of questions after categories were moved in the tree. */
export async function recomputeQuestionPaths(filter: Record<string, unknown>) {
  const questions = await QuestionModel.find(filter, { categoryIds: 1 }).lean();
  if (!questions.length) return 0;
  const allIds = [...new Set(questions.flatMap((q) => (q.categoryIds ?? []).map(String)))];
  const cats = await CategoryModel.find({ _id: { $in: allIds } }, { ancestors: 1 }).lean();
  const pathOf = new Map(cats.map((c) => [String(c._id), [...c.ancestors, c._id]]));
  const ops = questions.map((q) => {
    const ids = (q.categoryIds ?? []).filter((id) => pathOf.has(String(id)));
    const paths = new Map<string, Types.ObjectId>();
    for (const id of ids) for (const p of pathOf.get(String(id))!) paths.set(String(p), p);
    return { updateOne: { filter: { _id: q._id }, update: { $set: { categoryIds: ids, categoryPaths: [...paths.values()] } } } };
  });
  await QuestionModel.bulkWrite(ops);
  return ops.length;
}

/** Adds a test's category to the questions in that test (called when questions are added to tests). */
export async function tagQuestionsWithTestCategory(questionIds: (string | Types.ObjectId)[], test: { categoryId: Types.ObjectId; categoryPath?: Types.ObjectId[] | null }) {
  if (!questionIds.length || !test.categoryId) return;
  const path = test.categoryPath?.length ? test.categoryPath : [test.categoryId];
  await QuestionModel.updateMany(
    { _id: { $in: questionIds.map((q) => oid(q)) } },
    { $addToSet: { categoryIds: test.categoryId, categoryPaths: { $each: path } } },
  );
}

/** Bulk add / replace / remove categories on many questions at once. */
export async function bulkSetCategories(questionIds: string[], categoryIds: string[], mode: 'add' | 'replace' | 'remove') {
  const ids = questionIds.map((q) => oid(q));
  const before = await categoriesOfQuestions(ids);
  if (mode === 'remove') {
    await QuestionModel.updateMany({ _id: { $in: ids } }, { $pull: { categoryIds: { $in: categoryIds.map((c) => oid(c)) } } });
  } else {
    if (mode === 'add' && !categoryIds.length) throw ApiError.validation([{ path: 'body.categoryIds', message: 'Select at least one category' }]);
    const links = await resolveCategoryLinks(categoryIds);
    if (mode === 'replace') await QuestionModel.updateMany({ _id: { $in: ids } }, { $set: { categoryIds: links.categoryIds } });
    else await QuestionModel.updateMany({ _id: { $in: ids } }, { $addToSet: { categoryIds: { $each: links.categoryIds } } });
  }
  const updated = await recomputeQuestionPaths({ _id: { $in: ids } });
  await syncPracticeSets([...before, ...(await categoriesOfQuestions(ids))]);
  return { updated };
}

/** Number of active questions in every category (including its sub-categories). */
export async function questionCountsByCategory() {
  const rows = await QuestionModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { isActive: true } },
    { $unwind: '$categoryPaths' },
    { $group: { _id: '$categoryPaths', n: { $sum: 1 } } },
  ]);
  const uncategorized = await QuestionModel.countDocuments({ isActive: true, 'categoryIds.0': { $exists: false } });
  return { counts: new Map(rows.map((r) => [String(r._id), r.n])), uncategorized };
}

/**
 * One-off / repair job: links every question to the categories of the tests it is used in.
 * Safe to run any number of times.
 */
export async function backfillFromTests() {
  const tests = await TestModel.find({ questionIds: { $ne: [] } }, { questionIds: 1, categoryId: 1, categoryPath: 1 }).lean();
  for (const t of tests) await tagQuestionsWithTestCategory(t.questionIds, t);
  return tests.length;
}
