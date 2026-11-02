import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { createApp } from '../app.js';
import { CategoryModel } from '../models/Category.model.js';
import { QuestionModel } from '../models/Question.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { createAdminAccount } from '../services/auth.service.js';
import { questionContentHash } from '../utils/safeQuestion.js';

export const app = createApp();

export interface Client {
  agent: TestAgent;
  csrf: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
  refreshCsrf: () => Promise<void>;
}

/** A cookie-persisting client that automatically sends the CSRF header. */
export async function client(): Promise<Client> {
  const agent = request.agent(app);
  const res = await agent.get('/api/auth/csrf');
  const c: Client = {
    agent,
    csrf: res.body.data.csrfToken,
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('X-CSRF-Token', c.csrf).send(body),
    put: (url, body = {}) => agent.put(url).set('X-CSRF-Token', c.csrf).send(body),
    patch: (url, body = {}) => agent.patch(url).set('X-CSRF-Token', c.csrf).send(body),
    del: (url) => agent.delete(url).set('X-CSRF-Token', c.csrf),
    refreshCsrf: async () => {
      const r = await agent.get('/api/auth/csrf');
      c.csrf = r.body.data.csrfToken;
    },
  };
  return c;
}

let mobileSeq = 0;
/** A fresh valid Indian mobile number for every registered test student. */
export const nextMobile = () => String(9000000000 + ++mobileSeq);

export async function studentClient(email = 'student@example.com', password = 'Passw0rd1') {
  const c = await client();
  const res = await c.post('/api/auth/register', { name: 'Student One', email, mobile: nextMobile(), password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  await c.refreshCsrf();
  return { c, user: res.body.data.user };
}

export async function adminClient(email = 'admin@example.com', password = 'Adm1nPassword') {
  await createAdminAccount({ name: 'Admin', email, password, role: 'superadmin' });
  const c = await client();
  const res = await c.post('/api/auth/admin/login', { email, password });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  await c.refreshCsrf();
  return c;
}

export async function makeCategory(name = 'UPSC', moduleType: 'TEST_SERIES' | 'PYQS' = 'TEST_SERIES', parent?: { _id: unknown; ancestors: unknown[]; depth: number }) {
  return CategoryModel.create({
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    moduleType,
    parentId: parent?._id ?? null,
    ancestors: parent ? [...parent.ancestors, parent._id] : [],
    depth: parent ? parent.depth + 1 : 0,
  });
}

export async function makeQuestions(n: number) {
  const docs = [];
  for (let i = 0; i < n; i++) {
    const options = (['A', 'B', 'C', 'D'] as const).map((key) => ({ key, text: `Option ${key} for Q${i + 1}`, imageUrl: '' }));
    docs.push({
      questionText: `Question number ${i + 1}?`,
      options,
      correctOption: 'A',
      explanation: `Explanation ${i + 1}`,
      subject: i % 2 ? 'Polity' : 'History',
      contentHash: questionContentHash({ questionText: `Question number ${i + 1}?`, options }),
    });
  }
  return QuestionModel.insertMany(docs);
}

/** Creates a published series with one published test containing `questions` questions (answer A). */
export async function makePublishedTest(opts: { questions?: number; accessType?: 'free' | 'paid'; maxAttempts?: number; negativeMarks?: number; durationSeconds?: number; resultVisibility?: string } = {}) {
  const category = await makeCategory('UPSC');
  const series = await TestSeriesModel.create({
    title: 'Series One',
    slug: 'series-one',
    categoryId: category._id,
    categoryPath: [category._id],
    accessType: opts.accessType ?? 'free',
    price: opts.accessType === 'paid' ? 499 : 0,
    publicationStatus: 'published',
  });
  const questions = await makeQuestions(opts.questions ?? 4);
  const test = await new TestModel({
    title: 'Mock Test One',
    slug: 'mock-test-one',
    seriesId: series._id,
    categoryId: category._id,
    categoryPath: [category._id],
    questionIds: questions.map((q) => q._id),
    durationSeconds: opts.durationSeconds ?? 600,
    marksPerCorrect: 2,
    negativeMarks: opts.negativeMarks ?? 0.5,
    maxAttempts: opts.maxAttempts ?? 1,
    resultVisibility: opts.resultVisibility ?? 'IMMEDIATE',
    publicationStatus: 'published',
  }).save();
  return { category, series, test, questions };
}
