import { describe, expect, it } from 'vitest';
import { CategoryModel } from '../models/Category.model.js';
import { QuestionModel } from '../models/Question.model.js';
import { TestModel } from '../models/Test.model.js';
import { seedCategories } from '../seed/seedCategories.js';
import { adminClient, client } from './helpers.js';

async function upload(admin: Awaited<ReturnType<typeof adminClient>>, csv: string, fields: Record<string, string> = {}) {
  let req = admin.agent.post('/api/admin/imports').set('X-CSRF-Token', admin.csrf);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', Buffer.from(csv), 'q.csv');
}

describe('bulk import puts every question in its category and on the website', () => {
  it('accepts category names (not only slugs) and shows where the rows go', async () => {
    await seedCategories();
    const admin = await adminClient();
    const capf = await CategoryModel.create({ name: 'CAPF Paper 1', slug: 'capf-p1', moduleType: 'PYQS', parentId: null, ancestors: [], depth: 0 });
    const y = await CategoryModel.create({ name: '2025', slug: 'y-2025', moduleType: 'PYQS', parentId: capf._id, ancestors: [capf._id], depth: 1 });
    const history = await CategoryModel.create({ name: 'History', slug: 'hist', moduleType: 'PYQS', parentId: y._id, ancestors: [capf._id, y._id], depth: 2 });

    const csv = [
      'questionText,optionA,optionB,correctOption,category',
      'Who built the Red Fort?,Shah Jahan,Akbar,A,CAPF Paper 1 > 2025 > History',
      'Battle of Plassey year?,1757,1764,A,pyqs:CAPF Paper 1 / 2025 / History',
      'No category here?,Yes,No,A,',
    ].join('\n');
    const up = await upload(admin, csv);
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ validRows: 3, invalidRows: 0, uncategorizedRows: 1 });
    expect(up.body.data.destinations).toEqual([expect.objectContaining({ label: 'CAPF Paper 1 › 2025 › History', count: 2 })]);
    expect(up.body.data.preview[0].categories).toEqual(['CAPF Paper 1 › 2025 › History']);

    await admin.post(`/api/admin/imports/${up.body.data._id}/commit`, { skipDuplicates: true });
    expect(await QuestionModel.countDocuments({ categoryIds: history._id })).toBe(2);
    // ...and they are on the website right away (PYQ page of the exam).
    const page = await (await client()).get('/api/pyqs/category/capf-p1');
    expect(page.body.data.papers[0].questionCount).toBe(2);
  });

  it('files skipped duplicates under the new category and adds them to the target test', async () => {
    await seedCategories();
    const admin = await adminClient();
    const gk = await CategoryModel.findOne({ moduleType: 'TEST_SERIES', slug: 'gk' });
    const header = 'questionText,optionA,optionB,correctOption,category';
    const first = await upload(admin, [header, 'Capital of India?,Delhi,Mumbai,A,'].join('\n'));
    await admin.post(`/api/admin/imports/${first.body.data._id}/commit`, { skipDuplicates: true });
    const original = await QuestionModel.findOne({ questionText: 'Capital of India?' });
    expect(original!.categoryIds).toHaveLength(0);

    const test = await admin.post('/api/admin/tests', { title: 'GK Paper', categoryId: String(gk!._id), durationMinutes: 20 });
    const again = await upload(admin, [header, 'Capital of India?,Delhi,Mumbai,A,defence/cds/gk'].join('\n'), { targetTestId: test.body.data._id });
    expect(again.body.data.duplicateRows).toBe(1);
    const commit = await admin.post(`/api/admin/imports/${again.body.data._id}/commit`, { skipDuplicates: true });
    expect(commit.body.data).toMatchObject({ importedCount: 0, linkedExisting: 1 });

    const updated = await QuestionModel.findById(original!._id);
    expect(updated!.categoryIds.map(String)).toEqual([String(gk!._id)]);
    expect((await TestModel.findById(test.body.data._id))!.questionIds.map(String)).toEqual([String(original!._id)]);
    expect(await QuestionModel.countDocuments({ questionText: 'Capital of India?' })).toBe(1);
  });

  it('refuses an automatic practice set as import target', async () => {
    await seedCategories();
    const admin = await adminClient();
    const gk = await CategoryModel.findOne({ moduleType: 'TEST_SERIES', slug: 'gk' });
    await admin.post('/api/admin/questions', { questionText: 'GK?', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }], correctOption: 'A', categoryIds: [String(gk!._id)] });
    const set = await TestModel.findOne({ autoCategoryId: gk!._id });
    const res = await upload(admin, 'questionText,optionA,optionB,correctOption\nX?,1,2,A', { targetTestId: String(set!._id) });
    expect(res.status).toBe(422);
  });
});
