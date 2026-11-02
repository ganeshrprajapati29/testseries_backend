import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuestionModel } from '../models/Question.model.js';
import { setTranslatorForTests } from '../services/translate.service.js';
import { adminClient, makeCategory, makeQuestions } from './helpers.js';

const fakeHindi = async (texts: string[]) => texts.map((t) => `हिं:${t}`);

const question = {
  questionText: 'Who wrote the Constitution?',
  options: [
    { key: 'A', text: 'Ambedkar' },
    { key: 'B', text: 'Nehru' },
  ],
  correctOption: 'A',
  explanation: 'Chairman of the drafting committee',
};

describe('English -> Hindi auto translation', () => {
  beforeEach(() => setTranslatorForTests(fakeHindi));
  afterEach(() => setTranslatorForTests(null));

  it('translates arbitrary texts for the editors', async () => {
    const admin = await adminClient();
    const res = await admin.post('/api/admin/translate', { texts: ['Hello', '', 'Hello'] });
    expect(res.status).toBe(200);
    expect(res.body.data.translations).toEqual(['हिं:Hello', '', 'हिं:Hello']);
  });

  it('fills the Hindi version of a question on save, without overwriting typed Hindi', async () => {
    const admin = await adminClient();
    const res = await admin.post('/api/admin/questions', { ...question, autoTranslate: true });
    expect(res.status).toBe(201);
    const hi = res.body.data.translations.find((t: { language: string }) => t.language === 'hi');
    expect(hi).toMatchObject({ questionText: 'हिं:Who wrote the Constitution?', explanation: 'हिं:Chairman of the drafting committee' });
    expect(hi.options).toEqual([
      expect.objectContaining({ key: 'A', text: 'हिं:Ambedkar' }),
      expect.objectContaining({ key: 'B', text: 'हिं:Nehru' }),
    ]);

    const typed = { language: 'hi', questionText: 'संविधान किसने लिखा?', options: [], explanation: '' };
    const res2 = await admin.post('/api/admin/questions', { ...question, translations: [typed], autoTranslate: true });
    expect(res2.body.data.translations[0].questionText).toBe('संविधान किसने लिखा?');
  });

  it('saves in English with a warning when the provider fails', async () => {
    setTranslatorForTests(async () => {
      throw new Error('quota exceeded');
    });
    const admin = await adminClient();
    const res = await admin.post('/api/admin/questions', { ...question, autoTranslate: true });
    expect(res.status).toBe(201);
    expect(res.body.data.translations).toEqual([]);
    expect(res.body.message).toMatch(/Hindi auto translation is unavailable/);
  });

  it('bulk translates selected questions and filters by Hindi availability', async () => {
    const admin = await adminClient();
    const qs = await makeQuestions(3);
    const ids = qs.map((q) => String(q._id));
    expect((await admin.get('/api/admin/questions?hindi=no')).body.meta.total).toBe(3);
    const res = await admin.post('/api/admin/questions/bulk-translate', { questionIds: ids.slice(0, 2) });
    expect(res.body.data).toMatchObject({ translated: 2, skipped: 0, failed: 0 });
    expect((await admin.get('/api/admin/questions?hindi=yes')).body.meta.total).toBe(2);
    // Already translated questions are skipped unless overwrite is requested.
    expect((await admin.post('/api/admin/questions/bulk-translate', { questionIds: ids })).body.data).toMatchObject({ translated: 1, skipped: 2 });
    const q = await QuestionModel.findById(ids[0]).lean();
    expect(q!.translations[0]!.questionText).toBe('हिं:Question number 1?');
  });

  it('fills Hindi title / description of tests and series', async () => {
    const admin = await adminClient();
    const cat = await makeCategory('SSC');
    const series = await admin.post('/api/admin/test-series', {
      title: 'SSC CGL Mock Series',
      description: 'Full length mocks',
      highlights: ['20 mocks', 'Detailed solutions'],
      categoryId: String(cat._id),
      autoTranslate: true,
    });
    expect(series.status).toBe(201);
    expect(series.body.data.hi).toMatchObject({ title: 'हिं:SSC CGL Mock Series', description: 'हिं:Full length mocks', highlights: ['हिं:20 mocks', 'हिं:Detailed solutions'] });

    const test = await admin.post('/api/admin/tests', {
      title: 'Mock 1',
      instructions: 'Read carefully',
      seriesId: series.body.data._id,
      durationMinutes: 60,
      hi: { title: 'मॉक 1', description: '', instructions: '' },
      autoTranslate: true,
    });
    expect(test.status).toBe(201);
    // Typed Hindi is kept, empty Hindi fields are filled.
    expect(test.body.data.hi).toMatchObject({ title: 'मॉक 1', instructions: 'हिं:Read carefully' });
  });
});
