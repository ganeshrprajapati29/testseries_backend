import { describe, expect, it } from 'vitest';
import { TestModel } from '../models/Test.model.js';
import { scoreAnswers } from '../utils/scoring.js';
import { adminClient, makePublishedTest, studentClient } from './helpers.js';

describe('scoring utility', () => {
  it('handles fractional negative marks without floating point drift', () => {
    const s = scoreAnswers(
      [
        { questionId: '1', selectedOption: 'A', correctOption: 'A' },
        { questionId: '2', selectedOption: 'B', correctOption: 'A' },
        { questionId: '3', selectedOption: 'B', correctOption: 'A' },
        { questionId: '4', selectedOption: 'B', correctOption: 'A' },
      ],
      { marksPerCorrect: 2, negativeMarks: 0.66 },
    );
    expect(s.totalScore).toBe(0.02);
    expect(s.accuracy).toBe(25);
  });

  it('gives zero percentage and accuracy for an empty attempt', () => {
    const s = scoreAnswers([{ questionId: '1', selectedOption: null, correctOption: 'A' }], { marksPerCorrect: 1, negativeMarks: 1 });
    expect(s).toMatchObject({ totalScore: 0, attemptedCount: 0, accuracy: 0, percentage: 0 });
  });
});

describe('results & history', () => {
  it('hides results when visibility is HIDDEN and releases them later', async () => {
    const { test, questions } = await makePublishedTest({ resultVisibility: 'HIDDEN' });
    const { c } = await studentClient();
    const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;
    await c.put(`/api/exams/attempts/${attemptId}/answer`, { questionId: String(questions[0]!._id), selectedOption: 'A' });
    await c.post(`/api/exams/attempts/${attemptId}/submit`);

    const hidden = await c.get(`/api/results/${attemptId}`);
    expect(hidden.body.data.resultVisible).toBe(false);
    expect(hidden.body.data.totalScore).toBeUndefined();
    expect((await c.get(`/api/results/${attemptId}/solutions`)).status).toBe(403);

    await TestModel.updateOne({ _id: test._id }, { resultVisibility: 'IMMEDIATE' });
    const shown = await c.get(`/api/results/${attemptId}`);
    expect(shown.body.data.totalScore).toBe(2);
  });

  it('lists attempt history and dashboard statistics for the student', async () => {
    const { test } = await makePublishedTest({ maxAttempts: 0 });
    const { c } = await studentClient();
    for (let i = 0; i < 2; i++) {
      const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;
      await c.post(`/api/exams/attempts/${attemptId}/submit`);
    }
    const history = await c.get('/api/student/attempts');
    expect(history.body.data).toHaveLength(2);
    expect(history.body.meta.total).toBe(2);

    const dash = await c.get('/api/student/dashboard');
    expect(dash.body.data.stats.testsTaken).toBe(2);
  });

  it('lets admins filter and export results', async () => {
    const { test } = await makePublishedTest();
    const { c } = await studentClient();
    const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;
    await c.post(`/api/exams/attempts/${attemptId}/submit`);

    const admin = await adminClient();
    const list = await admin.get(`/api/admin/results?testId=${test._id}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].studentId.email).toBe('student@example.com');

    const csv = await admin.get('/api/admin/results/export');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('student@example.com');
  });
});
