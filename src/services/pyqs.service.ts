import { Types } from 'mongoose';
import { TestModel } from '../models/Test.model.js';
import { ApiError } from '../utils/ApiError.js';
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

/** Category page for an exam ("nda") or a subject ("nda/maths"). */
export async function pyqCategory(path: string) {
  const resolved = await resolvePath('PYQS', path);
  const categoryId = new Types.ObjectId(resolved.category._id);
  const counts = await paperCountsByCategory();

  const papers = await TestModel.aggregate([
    { $match: { moduleType: 'PYQS', publicationStatus: 'published', categoryPath: categoryId } },
    { $sort: { paperYear: -1, sortOrder: 1, title: 1 } },
    { $project: paperProjection },
    { $lookup: { from: 'categories', localField: 'categoryId', foreignField: '_id', as: 'subject', pipeline: [{ $project: { name: 1, slug: 1 } }] } },
    { $addFields: { subject: { $first: '$subject' } } },
  ]);

  const years = [...new Set(papers.map((p) => p.paperYear).filter((y): y is number => typeof y === 'number'))].sort((a, b) => b - a);
  const byYear = years.map((year) => ({ year, papers: papers.filter((p) => p.paperYear === year) }));
  const undated = papers.filter((p) => typeof p.paperYear !== 'number');
  if (undated.length) byYear.push({ year: null as unknown as number, papers: undated });

  return {
    ...resolved,
    children: resolved.children.map((c) => ({ ...c, paperCount: counts.get(String(c._id)) ?? 0 })),
    paperCount: papers.length,
    years,
    papersByYear: byYear,
  };
}

export async function assertPyqPaper(slug: string) {
  const exists = await TestModel.exists({ slug, moduleType: 'PYQS', publicationStatus: 'published' });
  if (!exists) throw ApiError.notFound('Paper not found');
}
