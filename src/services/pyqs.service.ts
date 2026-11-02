import { Types } from 'mongoose';
import { TestModel } from '../models/Test.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, pageParams } from '../utils/pagination.js';
import { getPublicTree, resolvePath, type CategoryNode } from './category.service.js';

async function paperCountsByCategory() {
  const rows = await TestModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { moduleType: 'PYQS', publicationStatus: 'published' } },
    { $unwind: '$categoryPath' },
    { $group: { _id: '$categoryPath', n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

/** Exams (root PYQ categories) with their subjects and published paper counts. */
export async function pyqHome() {
  const [tree, counts] = await Promise.all([getPublicTree('PYQS'), paperCountsByCategory()]);
  const decorate = (n: CategoryNode): CategoryNode & { paperCount: number } => ({
    ...n,
    paperCount: counts.get(n._id) ?? 0,
    children: n.children.map(decorate),
  });
  return tree.map(decorate);
}

const paperProjection = {
  title: 1,
  'hi.title': 1,
  slug: 1,
  description: 1,
  paperYear: 1,
  paperName: 1,
  durationSeconds: 1,
  marksPerCorrect: 1,
  negativeMarks: 1,
  totalMarks: 1,
  languageOptions: 1,
  categoryId: 1,
  questionCount: { $size: '$questionIds' },
};

/** Category page for an exam ("nda") or a subject ("nda/maths"): years with counts + paginated papers. */
export async function pyqCategory(path: string, q: { year?: number; page?: number; limit?: number } = {}) {
  const resolved = await resolvePath('PYQS', path);
  const categoryId = new Types.ObjectId(resolved.category._id);
  const counts = await paperCountsByCategory();
  const { page, limit, skip } = pageParams(q.page ?? 1, q.limit ?? 12);

  const base = { moduleType: 'PYQS', publicationStatus: 'published', categoryPath: categoryId };
  const match: Record<string, unknown> = { ...base };
  if (q.year) match.paperYear = q.year;

  const [yearAgg, papers, total] = await Promise.all([
    TestModel.aggregate<{ _id: number | null; n: number }>([{ $match: base }, { $group: { _id: '$paperYear', n: { $sum: 1 } } }, { $sort: { _id: -1 } }]),
    TestModel.aggregate([
      { $match: match },
      { $sort: { paperYear: -1, sortOrder: 1, title: 1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { ...paperProjection, hasQuestionPaperPdf: { $gt: ['$questionPaperPdf', null] }, hasSolutionPdf: { $gt: ['$solutionPdf', null] } } },
      { $lookup: { from: 'categories', localField: 'categoryId', foreignField: '_id', as: 'subject', pipeline: [{ $project: { name: 1, slug: 1 } }] } },
      { $addFields: { subject: { $first: '$subject' } } },
    ]),
    TestModel.countDocuments(match),
  ]);

  return {
    ...resolved,
    children: resolved.children.map((c) => ({ ...c, paperCount: counts.get(String(c._id)) ?? 0 })),
    paperCount: yearAgg.reduce((a, y) => a + y.n, 0),
    years: yearAgg.filter((y) => typeof y._id === 'number').map((y) => ({ year: y._id as number, count: y.n })),
    papers,
    meta: buildMeta(page, limit, total),
  };
}

export async function assertPyqPaper(slug: string) {
  const exists = await TestModel.exists({ slug, moduleType: 'PYQS', publicationStatus: 'published' });
  if (!exists) throw ApiError.notFound('Paper not found');
}
