import { describe, expect, it } from 'vitest';
import { TestModel } from '../models/Test.model.js';
import { adminClient, client, makeCategory, makeQuestions, studentClient } from './helpers.js';

describe('test series & tests (admin)', () => {
  it('creates, publishes and lists a series with tests', async () => {
    const admin = await adminClient();
    const cat = await makeCategory('UPPCS');

    const series = await admin.post('/api/admin/test-series', { title: 'UPPCS Prelims 2027', categoryId: String(cat._id), accessType: 'free' });
    expect(series.status).toBe(201);
    expect(series.body.data.publicationStatus).toBe('draft');

    const test = await admin.post('/api/admin/tests', { title: 'GS Mock 1', seriesId: series.body.data._id, durationMinutes: 120, marksPerCorrect: 2, negativeMarks: 0.66 });
    expect(test.status).toBe(201);
    expect(test.body.data.durationSeconds).toBe(7200);

    // Cannot publish a test with no questions.
    expect((await admin.post(`/api/admin/tests/${test.body.data._id}/publication`, { publicationStatus: 'published' })).status).toBe(400);

    const qs = await makeQuestions(3);
    const set = await admin.put(`/api/admin/tests/${test.body.data._id}/questions`, { questionIds: qs.map((q) => String(q._id)) });
    expect(set.body.data.totalMarks).toBe(6);

    expect((await admin.post(`/api/admin/tests/${test.body.data._id}/publication`, { publicationStatus: 'published' })).status).toBe(200);
    expect((await admin.post(`/api/admin/test-series/${series.body.data._id}/publication`, { publicationStatus: 'published' })).status).toBe(200);

    const anon = await client();
    const list = await anon.get(`/api/test-series?category=${cat._id}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].testCount).toBe(1);

    const detail = await anon.get(`/api/test-series/${series.body.data.slug}`);
    expect(detail.body.data.totalTests).toBe(1);
    expect(detail.body.data.typeCounts).toEqual({ FULL_LENGTH: 1 });
    const tests = await anon.get(`/api/test-series/${series.body.data.slug}/tests?page=1&limit=10`);
    expect(tests.body.data[0].questionCount).toBe(3);
    expect(tests.body.meta.total).toBe(1);
    expect(JSON.stringify(tests.body.data)).not.toContain('correctOption');
  });

  it('treats null/empty availability dates as "no schedule"', async () => {
    const admin = await adminClient();
    const cat = await makeCategory('CDS');
    const res = await admin.post('/api/admin/test-series', { title: 'No schedule', categoryId: String(cat._id), availableFrom: null, availableUntil: '' });
    expect(res.status).toBe(201);
    expect(res.body.data.availableFrom).toBeNull();
    expect(res.body.data.availableUntil).toBeNull();

    const bad = await admin.post('/api/admin/test-series', {
      title: 'Bad schedule',
      categoryId: String(cat._id),
      availableFrom: '2030-01-02T00:00:00.000Z',
      availableUntil: '2030-01-01T00:00:00.000Z',
    });
    expect(bad.status).toBe(422);
  });

  it('validates paid series pricing', async () => {
    const admin = await adminClient();
    const cat = await makeCategory('JEE');
    const res = await admin.post('/api/admin/test-series', { title: 'Paid without price', categoryId: String(cat._id), accessType: 'paid', price: 0 });
    expect(res.status).toBe(422);
  });

  it('hides drafts from students', async () => {
    const admin = await adminClient();
    const cat = await makeCategory('NET');
    const s = await admin.post('/api/admin/test-series', { title: 'Hidden draft', categoryId: String(cat._id) });
    const { c } = await studentClient();
    expect((await c.get(`/api/test-series/${s.body.data.slug}`)).status).toBe(404);
  });

  it('duplicates a series as a draft without copying questions', async () => {
    const admin = await adminClient();
    const cat = await makeCategory('NDA');
    const s = await admin.post('/api/admin/test-series', { title: 'Original', categoryId: String(cat._id) });
    const t = await admin.post('/api/admin/tests', { title: 'Paper 1', seriesId: s.body.data._id, durationMinutes: 60 });
    const qs = await makeQuestions(2);
    await admin.put(`/api/admin/tests/${t.body.data._id}/questions`, { questionIds: qs.map((q) => String(q._id)) });

    const copy = await admin.post(`/api/admin/test-series/${s.body.data._id}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body.data.publicationStatus).toBe('draft');
    const copiedTests = await TestModel.find({ seriesId: copy.body.data._id });
    expect(copiedTests).toHaveLength(1);
    expect(copiedTests[0]!.questionIds.map(String)).toEqual(qs.map((q) => String(q._id)));
  });
});
