import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { sanitizeSvg } from '../services/storage.service.js';
import { adminClient, makePublishedTest, studentClient } from './helpers.js';

const MINI_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

afterAll(async () => {
  await fs.rm(path.resolve(env.PRIVATE_UPLOAD_DIR, 'pdfs'), { recursive: true, force: true });
});

describe('uploads', () => {
  it('uploads several images at once and converts them to WebP', async () => {
    const admin = await adminClient();
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#1e6fd0' } }).png().toBuffer();
    const jpg = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#f26b1d' } }).jpeg().toBuffer();
    const res = await admin.agent
      .post('/api/admin/uploads/images?folder=questions')
      .set('X-CSRF-Token', admin.csrf)
      .attach('files', png, 'figure.png')
      .attach('files', jpg, 'photo.jpg');
    expect(res.status).toBe(201);
    expect(res.body.data.files).toHaveLength(2);
    for (const f of res.body.data.files) {
      expect(f.url).toMatch(/^\/uploads\/questions\/.+\.webp$/);
      await fs.rm(path.resolve(env.UPLOAD_DIR, f.key), { force: true });
    }
  });

  it('rejects files that are not really images', async () => {
    const admin = await adminClient();
    const res = await admin.agent.post('/api/admin/uploads/images').set('X-CSRF-Token', admin.csrf).attach('files', Buffer.from('not an image at all'), { filename: 'fake.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('strips scripts and event handlers from SVG files', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)"><circle r="5" onclick="x()"/></a></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/script|onload|onclick|javascript:/i);
    expect(clean).toContain('<circle');
  });

  it('refuses to download links that point to the internal network (SSRF)', async () => {
    const admin = await adminClient();
    for (const url of ['http://127.0.0.1/secret.png', 'http://localhost:5000/api/health', 'http://169.254.169.254/latest/meta-data', 'file:///etc/passwd']) {
      const res = await admin.post('/api/admin/uploads/images/from-url', { url });
      expect([400, 422]).toContain(res.status);
    }
  });

  it('only admins can upload', async () => {
    const { c } = await studentClient();
    const res = await c.agent.post('/api/admin/uploads/pdf').set('X-CSRF-Token', c.csrf).attach('file', MINI_PDF, 'paper.pdf');
    expect(res.status).toBe(403);
  });
});

describe('question paper PDFs', () => {
  it('attaches PDFs to a test and enforces download rules', async () => {
    const { test } = await makePublishedTest({ questions: 2, maxAttempts: 0 });
    const admin = await adminClient();

    const qp = await admin.agent.post('/api/admin/uploads/pdf').set('X-CSRF-Token', admin.csrf).attach('file', MINI_PDF, 'Question Paper.pdf');
    expect(qp.status).toBe(201);
    expect(qp.body.data.key).toMatch(/^pdfs\//);
    const sol = await admin.agent.post('/api/admin/uploads/pdf').set('X-CSRF-Token', admin.csrf).attach('file', MINI_PDF, 'Solutions.pdf');

    const patch = await admin.patch(`/api/admin/tests/${test._id}`, { questionPaperPdf: qp.body.data, solutionPdf: sol.body.data });
    expect(patch.status).toBe(200);

    const notPdf = await admin.agent.post('/api/admin/uploads/pdf').set('X-CSRF-Token', admin.csrf).attach('file', Buffer.from('hello'), 'fake.pdf');
    expect(notPdf.status).toBe(400);

    const { c } = await studentClient();
    const detail = await c.get(`/api/tests/${test.slug}`);
    expect(detail.body.data.pdfs.questionPaper).toMatchObject({ fileName: 'Question Paper.pdf', canDownload: true });
    expect(detail.body.data.pdfs.solutions.canDownload).toBe(false);
    expect(JSON.stringify(detail.body.data)).not.toContain('pdfs/'); // storage keys are never exposed

    const paperPdf = await c.get(`/api/tests/${test.slug}/pdf/question-paper`);
    expect(paperPdf.status).toBe(200);
    expect(paperPdf.headers['content-type']).toBe('application/pdf');

    // Solutions and the printable paper unlock only after submitting.
    expect((await c.get(`/api/tests/${test.slug}/pdf/solutions`)).status).toBe(403);
    expect((await c.get(`/api/tests/${test.slug}/paper`)).status).toBe(403);
    const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;
    await c.post(`/api/exams/attempts/${attemptId}/submit`);
    expect((await c.get(`/api/tests/${test.slug}/pdf/solutions`)).status).toBe(200);
    const printable = await c.get(`/api/tests/${test.slug}/paper`);
    expect(printable.status).toBe(200);
    expect(printable.body.data.questions).toHaveLength(2);
    expect(printable.body.data.questions[0].correctOption).toBe('A');

    // Anonymous visitors cannot download.
    const { client } = await import('./helpers.js');
    const anon = await client();
    expect((await anon.get(`/api/tests/${test.slug}/pdf/question-paper`)).status).toBe(401);

    // Removing the PDF hides it again.
    await admin.patch(`/api/admin/tests/${test._id}`, { questionPaperPdf: null });
    expect((await c.get(`/api/tests/${test.slug}/pdf/question-paper`)).status).toBe(404);
  });

  it('saves multiple question and explanation images', async () => {
    const admin = await adminClient();
    const res = await admin.post('/api/admin/questions', {
      questionText: 'Which figure shows a right angle?',
      options: [
        { key: 'A', text: 'Figure 1' },
        { key: 'B', text: 'Figure 2' },
      ],
      correctOption: 'A',
      imageUrl: '/uploads/questions/a.webp',
      images: ['/uploads/questions/b.webp', 'https://example.com/c.png'],
      explanationImages: ['/uploads/questions/d.webp'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.images).toHaveLength(2);
    const bad = await admin.post('/api/admin/questions', {
      questionText: 'Bad image link',
      options: [
        { key: 'A', text: '1' },
        { key: 'B', text: '2' },
      ],
      correctOption: 'A',
      images: ['javascript:alert(1)'],
    });
    expect(bad.status).toBe(422);
  });
});
