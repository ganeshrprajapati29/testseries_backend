import { describe, expect, it } from 'vitest';
import { CategoryModel } from '../models/Category.model.js';
import { seedCategories } from '../seed/seedCategories.js';
import { adminClient, client, makeQuestions, studentClient } from './helpers.js';

describe('PYQs', () => {
  it('lets an admin publish a paper that students can browse and attempt for free', async () => {
    await seedCategories();
    const admin = await adminClient();
    const nda = await CategoryModel.findOne({ moduleType: 'PYQS', slug: 'nda', parentId: null });
    const maths = await CategoryModel.findOne({ moduleType: 'PYQS', slug: 'maths', parentId: nda!._id });

    const paper = await admin.post('/api/admin/tests', {
      title: 'NDA (I) 2024 Mathematics',
      moduleType: 'PYQS',
      categoryId: String(maths!._id),
      testType: 'PYQ_PAPER',
      paperYear: 2024,
      durationMinutes: 150,
      marksPerCorrect: 2.5,
      negativeMarks: 0.83,
      maxAttempts: 0,
    });
    expect(paper.status).toBe(201);
    expect(paper.body.data.moduleType).toBe('PYQS');

    const qs = await makeQuestions(2);
    await admin.put(`/api/admin/tests/${paper.body.data._id}/questions`, { questionIds: qs.map((q) => String(q._id)) });
    await admin.post(`/api/admin/tests/${paper.body.data._id}/publication`, { publicationStatus: 'published' });

    const anon = await client();
    const home = await anon.get('/api/pyqs');
    const ndaNode = home.body.data.find((n: { slug: string }) => n.slug === 'nda');
    expect(ndaNode.paperCount).toBe(1);
    expect(ndaNode.children.map((s: { name: string }) => s.name)).toEqual(['Maths', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'Polity', 'Economics']);

    const subject = await anon.get('/api/pyqs/category/nda/maths');
    expect(subject.body.data.years).toEqual([2024]);
    expect(subject.body.data.papersByYear[0].papers[0].questionCount).toBe(2);

    const detail = await anon.get(`/api/pyqs/papers/${paper.body.data.slug}`);
    expect(detail.body.data.hasAccess).toBe(true);

    const { c } = await studentClient();
    expect((await c.post(`/api/exams/tests/${paper.body.data._id}/start`)).status).toBe(201);
  });

  it('returns 404 for unknown PYQ categories', async () => {
    await seedCategories();
    const anon = await client();
    expect((await anon.get('/api/pyqs/category/nda/astrology')).status).toBe(404);
  });
});
