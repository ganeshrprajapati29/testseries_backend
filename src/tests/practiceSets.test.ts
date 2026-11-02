import { describe, expect, it } from 'vitest';
import { CategoryModel } from '../models/Category.model.js';
import { TestModel } from '../models/Test.model.js';
import { seedCategories } from '../seed/seedCategories.js';
import { PART_SIZE } from '../services/practiceSet.service.js';
import { adminClient, client, studentClient } from './helpers.js';

async function cat(moduleType: 'TEST_SERIES' | 'PYQS', path: string) {
  let parentId = null;
  let found = null;
  for (const slug of path.split('/')) {
    found = await CategoryModel.findOne({ moduleType, parentId, slug });
    parentId = found!._id;
  }
  return found!;
}

const q = (text: string, categoryIds: string[]) => ({
  questionText: text,
  options: [
    { key: 'A', text: 'Yes' },
    { key: 'B', text: 'No' },
  ],
  correctOption: 'A',
  categoryIds,
});

describe('Question Bank questions reach the website (auto practice sets)', () => {
  it('publishes a practice set for a category as soon as a question is filed there', async () => {
    await seedCategories();
    const admin = await adminClient();
    const paper1 = await cat('TEST_SERIES', 'upsc/prelims/paper-i');
    const upsc = await cat('TEST_SERIES', 'upsc');

    const created = await admin.post('/api/admin/questions', q('Which schedule lists the State List?', [String(paper1._id)]));
    expect(created.status).toBe(201);

    // Visible on the website - on the sub-category page and on every parent category page.
    const guest = await client();
    for (const id of [paper1._id, upsc._id]) {
      const list = await guest.get(`/api/tests?category=${id}`);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ questionCount: 1, isPracticeSet: true, isFree: true });
    }
    const slug = (await guest.get(`/api/tests?category=${paper1._id}`)).body.data[0].slug;
    expect((await guest.get(`/api/tests/${slug}`)).body.data.title).toBe('UPSC › Prelims › Paper-I – Practice Set');

    // A student can take it like any test.
    const { c } = await studentClient();
    const set = await TestModel.findOne({ slug });
    expect((await c.post(`/api/exams/tests/${set!._id}/start`)).status).toBe(201);

    // More questions in the same category join the same set.
    await admin.post('/api/admin/questions', q('Second question?', [String(paper1._id)]));
    expect((await guest.get(`/api/tests?category=${paper1._id}`)).body.data[0].questionCount).toBe(2);
  });

  it('PYQ categories get papers on the PYQ pages, with the year taken from the category', async () => {
    await seedCategories();
    const admin = await adminClient();
    const capf = await CategoryModel.create({ name: 'CAPF Paper 1', slug: 'capf-paper-1', moduleType: 'PYQS', parentId: null, ancestors: [], depth: 0 });
    const y2025 = await CategoryModel.create({ name: '2025', slug: '2025', moduleType: 'PYQS', parentId: capf._id, ancestors: [capf._id], depth: 1 });
    const history = await CategoryModel.create({ name: 'History', slug: 'history', moduleType: 'PYQS', parentId: y2025._id, ancestors: [capf._id, y2025._id], depth: 2 });

    // Filed under the exam, the year and the subject at once (as admins often do) - still only one set.
    const created = await admin.post('/api/admin/questions', q('Who founded the Mauryan empire?', [String(capf._id), String(y2025._id), String(history._id)]));
    expect(await TestModel.countDocuments({ autoCategoryId: { $ne: null } })).toBe(1);
    const page = await (await client()).get('/api/pyqs/category/capf-paper-1');
    expect(page.status).toBe(200);
    expect(page.body.data.paperCount).toBe(1);
    expect(page.body.data.years).toEqual([{ year: 2025, count: 1 }]);
    expect(page.body.data.papers[0].title).toBe('CAPF Paper 1 › 2025 › History – Practice Set');
    // Every level of a 3-level PYQ tree has its own page.
    expect((await (await client()).get('/api/pyqs/category/capf-paper-1/2025/history')).body.data.papers).toHaveLength(1);

    // The admin question page knows exactly where students see the question.
    const detail = await admin.get(`/api/admin/questions/${created.body.data._id}`);
    expect(detail.body.data.websiteLinks).toEqual([
      expect.objectContaining({
        url: `/pyqs/paper/${page.body.data.papers[0].slug}`,
        questionNumber: 1,
        totalQuestions: 1,
        isPracticeSet: true,
        categoryUrl: '/pyqs/capf-paper-1/2025/history',
      }),
    ]);
    expect(detail.body.data.categories.map((c: { siteUrl: string }) => c.siteUrl)).toEqual(['/pyqs/capf-paper-1', '/pyqs/capf-paper-1/2025', '/pyqs/capf-paper-1/2025/history']);
  });

  it('moves questions out of the practice set once they are in a published test, and back when removed', async () => {
    await seedCategories();
    const admin = await adminClient();
    const gk = await cat('TEST_SERIES', 'defence/cds/gk');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await admin.post('/api/admin/questions', q(`GK question ${i}?`, [String(gk._id)]))).body.data._id);
    const guest = await client();
    const setCount = async () => (await guest.get(`/api/tests?category=${gk._id}`)).body.data.find((t: { isPracticeSet: boolean }) => t.isPracticeSet)?.questionCount ?? 0;
    expect(await setCount()).toBe(3);

    // A normal test in the same category that the admin publishes.
    const test = await admin.post('/api/admin/tests', { title: 'CDS GK Test 1', categoryId: String(gk._id), durationMinutes: 30 });
    await admin.post(`/api/admin/tests/${test.body.data._id}/questions`, { questionIds: ids.slice(0, 2) });
    expect(await setCount()).toBe(3); // still a draft - nothing delivered yet
    await admin.post(`/api/admin/tests/${test.body.data._id}/publication`, { publicationStatus: 'published' });
    expect(await setCount()).toBe(1);
    // The stand-alone test itself is listed on the category page too.
    const titles = (await guest.get(`/api/tests?category=${gk._id}`)).body.data.map((t: { title: string }) => t.title);
    expect(titles).toContain('CDS GK Test 1');

    await admin.post(`/api/admin/tests/${test.body.data._id}/publication`, { publicationStatus: 'unpublished' });
    expect(await setCount()).toBe(3);
  });

  it('splits big categories into parts, follows archive / move / delete, and locks manual edits', async () => {
    await seedCategories();
    const admin = await adminClient();
    const maths = await cat('TEST_SERIES', 'defence/nda/maths');
    const ids: string[] = [];
    for (let i = 0; i < PART_SIZE + 2; i++) ids.push((await admin.post('/api/admin/questions', q(`Maths ${i}?`, [String(maths._id)]))).body.data._id);
    let sets = await TestModel.find({ autoCategoryId: maths._id }).sort({ autoPart: 1 });
    expect(sets.map((s) => s.questionIds.length)).toEqual([PART_SIZE, 2]);
    expect(sets[1]!.title).toContain('Practice Set 2');

    // Manual question edits on an automatic set are refused with a clear message.
    const locked = await admin.post(`/api/admin/tests/${sets[0]!._id}/questions`, { questionIds: [ids[0]] });
    expect(locked.status).toBe(400);
    expect(locked.body.error.message).toMatch(/automatic practice set/);

    // Archiving questions (allowed even though they sit in a published practice set) shrinks the sets.
    expect((await admin.post(`/api/admin/questions/${ids[0]}/archive`)).status).toBe(200);
    expect((await admin.post(`/api/admin/questions/${ids[1]}/archive`)).status).toBe(200);
    expect((await admin.post(`/api/admin/questions/${ids[2]}/archive`)).status).toBe(200);
    sets = await TestModel.find({ autoCategoryId: maths._id }).sort({ autoPart: 1 });
    expect(sets.map((s) => s.questionIds.length)).toEqual([PART_SIZE - 1]);

    // A question in a practice set can still be deleted permanently.
    expect((await admin.del(`/api/admin/questions/${ids[3]}`)).status).toBe(204);

    // Moving questions to another category moves them to that category's set.
    const english = await cat('TEST_SERIES', 'defence/cds/english');
    await admin.post('/api/admin/questions/bulk-categories', { questionIds: ids.slice(4, 14), categoryIds: [String(english._id)], mode: 'replace' });
    expect((await TestModel.findOne({ autoCategoryId: english._id }))!.questionIds).toHaveLength(10);
    expect((await TestModel.findOne({ autoCategoryId: maths._id }))!.questionIds).toHaveLength(PART_SIZE - 12);

    // Archiving the category is not blocked by its practice set, and the set disappears from the site.
    expect((await admin.post(`/api/admin/categories/${english._id}/archive`)).status).toBe(200);
    expect((await (await client()).get(`/api/tests?category=${english._id}`)).body.data).toHaveLength(0);
  });
});
