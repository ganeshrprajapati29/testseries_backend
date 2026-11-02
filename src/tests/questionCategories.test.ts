import { describe, expect, it } from 'vitest';
import { QuestionModel } from '../models/Question.model.js';
import { seedCategories } from '../seed/seedCategories.js';
import { CategoryModel } from '../models/Category.model.js';
import { adminClient, makeQuestions, makePublishedTest } from './helpers.js';

async function cat(moduleType: 'TEST_SERIES' | 'PYQS', path: string) {
  let parentId = null;
  let found = null;
  for (const slug of path.split('/')) {
    found = await CategoryModel.findOne({ moduleType, parentId, slug });
    parentId = found!._id;
  }
  return found!;
}

const base = {
  options: [
    { key: 'A', text: '1' },
    { key: 'B', text: '2' },
  ],
  correctOption: 'A',
};

describe('question categories', () => {
  it('saves a question in a sub-category and finds it from every parent level', async () => {
    await seedCategories();
    const admin = await adminClient();
    const cdsMaths = await cat('TEST_SERIES', 'defence/cds/maths');
    const ndaPhysics = await cat('PYQS', 'nda/physics');

    const res = await admin.post('/api/admin/questions', { ...base, questionText: 'Q in CDS Maths', categoryIds: [String(cdsMaths._id), String(ndaPhysics._id)] });
    expect(res.status).toBe(201);
    await admin.post('/api/admin/questions', { ...base, questionText: 'Q without category' });

    const defence = await cat('TEST_SERIES', 'defence');
    for (const id of [defence._id, cdsMaths._id, ndaPhysics._id]) {
      const list = await admin.get(`/api/admin/questions?category=${id}`);
      expect(list.body.data.map((q: { questionText: string }) => q.questionText)).toEqual(['Q in CDS Maths']);
    }
    const listed = await admin.get(`/api/admin/questions?category=${cdsMaths._id}`);
    expect(listed.body.data[0].categories.map((c: { label: string }) => c.label)).toEqual(['Defence › CDS › Maths', 'NDA › Physics']);

    // Older documents may not have the categoryIds field at all - they must still count as uncategorised.
    await QuestionModel.collection.insertOne({ questionText: 'Legacy question', options: base.options, correctOption: 'A', isActive: true, createdAt: new Date(0) });
    const none = await admin.get('/api/admin/questions?category=none');
    expect(none.body.data.map((q: { questionText: string }) => q.questionText)).toEqual(['Q without category', 'Legacy question']);
    expect((await admin.get('/api/admin/questions/facets')).body.data.uncategorized).toBe(2);

    const tree = await admin.get('/api/admin/categories?moduleType=TEST_SERIES');
    const defenceNode = tree.body.data.find((n: { slug: string }) => n.slug === 'defence');
    expect(defenceNode.questionCount).toBe(1);
  });

  it('bulk assigns, replaces and removes categories', async () => {
    await seedCategories();
    const admin = await adminClient();
    const qs = await makeQuestions(3);
    const upsc = await cat('TEST_SERIES', 'upsc/prelims/paper-i');
    const jee = await cat('TEST_SERIES', 'jee/mains');
    const ids = qs.map((q) => String(q._id));

    expect((await admin.post('/api/admin/questions/bulk-categories', { questionIds: ids, categoryIds: [String(upsc._id)], mode: 'add' })).body.data.updated).toBe(3);
    expect((await admin.get(`/api/admin/questions?category=${upsc.ancestors[0]}`)).body.meta.total).toBe(3);

    await admin.post('/api/admin/questions/bulk-categories', { questionIds: ids.slice(0, 1), categoryIds: [String(jee._id)], mode: 'replace' });
    const first = await QuestionModel.findById(ids[0]).lean();
    expect(first!.categoryIds.map(String)).toEqual([String(jee._id)]);
    expect(first!.categoryPaths.map(String)).not.toContain(String(upsc._id));

    await admin.post('/api/admin/questions/bulk-categories', { questionIds: ids, categoryIds: [String(upsc._id)], mode: 'remove' });
    expect((await admin.get(`/api/admin/questions?category=${upsc._id}`)).body.meta.total).toBe(0);
  });

  it("tags questions with the test's category when they are added to a test", async () => {
    const { test, category } = await makePublishedTest({ questions: 0 });
    const admin = await adminClient();
    const qs = await makeQuestions(2);
    await admin.post(`/api/admin/tests/${test._id}/questions`, { questionIds: qs.map((q) => String(q._id)) });
    const list = await admin.get(`/api/admin/questions?category=${category._id}`);
    expect(list.body.meta.total).toBe(2);
  });

  it('imports questions into categories from the "category" column', async () => {
    await seedCategories();
    const admin = await adminClient();
    const csv = [
      'questionText,optionA,optionB,correctOption,category',
      'Imported into CDS English?,Yes,No,A,defence/cds/english',
      'Imported into NDA Biology?,Yes,No,A,pyqs:nda/biology',
      'Bad category?,Yes,No,A,does/not/exist',
    ].join('\n');
    const up = await admin.agent.post('/api/admin/imports').set('X-CSRF-Token', admin.csrf).attach('file', Buffer.from(csv), 'q.csv');
    expect(up.body.data).toMatchObject({ validRows: 2, invalidRows: 1 });
    await admin.post(`/api/admin/imports/${up.body.data._id}/commit`, { skipDuplicates: true });
    const english = await cat('TEST_SERIES', 'defence/cds/english');
    const biology = await cat('PYQS', 'nda/biology');
    expect((await admin.get(`/api/admin/questions?category=${english._id}`)).body.meta.total).toBe(1);
    expect((await admin.get(`/api/admin/questions?category=${biology._id}`)).body.meta.total).toBe(1);
  });
});
