import { describe, expect, it } from 'vitest';
import { QuestionModel } from '../models/Question.model.js';
import { ResultModel } from '../models/Result.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { runExpireAttempts } from '../jobs/expireAttempts.job.js';
import { makePublishedTest, studentClient } from './helpers.js';

describe('examination engine', () => {
  it('starts an attempt without exposing answers and resumes it', async () => {
    const { test } = await makePublishedTest({ questions: 3 });
    const { c } = await studentClient();

    const start = await c.post(`/api/exams/tests/${test._id}/start`);
    expect(start.status).toBe(201);
    const again = await c.post(`/api/exams/tests/${test._id}/start`);
    expect(again.body.data).toEqual({ attemptId: start.body.data.attemptId, resumed: true });

    const exam = await c.get(`/api/exams/attempts/${start.body.data.attemptId}`);
    expect(exam.status).toBe(200);
    expect(exam.body.data.questions).toHaveLength(3);
    expect(exam.body.data.remainingSeconds).toBeGreaterThan(590);
    const payload = JSON.stringify(exam.body.data);
    expect(payload).not.toContain('correctOption');
    expect(payload).not.toContain('Explanation');
  });

  it('scores correct, incorrect and unanswered questions with negative marking', async () => {
    const { test, questions } = await makePublishedTest({ questions: 4, negativeMarks: 0.5 });
    const { c } = await studentClient();
    const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;

    // Q1 correct (A), Q2 correct, Q3 wrong, Q4 unanswered
    const answers = [
      { questionId: String(questions[0]!._id), selectedOption: 'A' },
      { questionId: String(questions[1]!._id), selectedOption: 'A' },
      { questionId: String(questions[2]!._id), selectedOption: 'B', markedForReview: true },
    ];
    expect((await c.put(`/api/exams/attempts/${attemptId}/answers`, { answers })).status).toBe(200);

    const submit = await c.post(`/api/exams/attempts/${attemptId}/submit`);
    expect(submit.status).toBe(200);

    const result = await c.get(`/api/results/${attemptId}`);
    expect(result.body.data).toMatchObject({
      totalQuestions: 4,
      attemptedCount: 3,
      correctCount: 2,
      incorrectCount: 1,
      unansweredCount: 1,
      totalScore: 3.5,
      maximumMarks: 8,
      percentage: 43.75,
      accuracy: 66.67,
      rank: 1,
    });

    const solutions = await c.get(`/api/results/${attemptId}/solutions`);
    expect(solutions.body.data.questions[2]).toMatchObject({ selectedOption: 'B', correctOption: 'A', isCorrect: false, marksAwarded: -0.5 });
    expect(solutions.body.data.questions[0].explanation).toMatch(/Explanation/);
  });

  it('keeps historical results stable after the question is edited', async () => {
    const { test, questions } = await makePublishedTest({ questions: 1 });
    const { c } = await studentClient();
    const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;
    await c.put(`/api/exams/attempts/${attemptId}/answer`, { questionId: String(questions[0]!._id), selectedOption: 'A' });

    // Admin changes the answer key while the attempt is running.
    await QuestionModel.updateOne({ _id: questions[0]!._id }, { correctOption: 'B' });
    await c.post(`/api/exams/attempts/${attemptId}/submit`);
    const result = await c.get(`/api/results/${attemptId}`);
    expect(result.body.data.correctCount).toBe(1);
  });

  it('submits only once even when requests race', async () => {
    const { test } = await makePublishedTest({ questions: 2 });
    const { c } = await studentClient();
    const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;
    const responses = await Promise.all([1, 2, 3, 4].map(() => c.post(`/api/exams/attempts/${attemptId}/submit`)));
    expect(responses.some((r) => r.status === 200)).toBe(true);
    expect(await ResultModel.countDocuments({ attemptId })).toBe(1);
  });

  it('rejects answers after the deadline and auto-submits', async () => {
    const { test, questions } = await makePublishedTest({ questions: 2 });
    const { c } = await studentClient();
    const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;
    await c.put(`/api/exams/attempts/${attemptId}/answer`, { questionId: String(questions[0]!._id), selectedOption: 'A' });

    await TestAttemptModel.updateOne({ _id: attemptId }, { deadlineAt: new Date(Date.now() - 60_000) });
    const late = await c.put(`/api/exams/attempts/${attemptId}/answer`, { questionId: String(questions[1]!._id), selectedOption: 'A' });
    expect(late.status).toBe(409);

    const attempt = await TestAttemptModel.findById(attemptId);
    expect(attempt!.status).toBe('AUTO_SUBMITTED');
    const result = await ResultModel.findOne({ attemptId });
    expect(result!.correctCount).toBe(1);
  });

  it('auto-submits abandoned attempts from the background job', async () => {
    const { test } = await makePublishedTest({ questions: 2 });
    const { c } = await studentClient();
    const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;
    await TestAttemptModel.updateOne({ _id: attemptId }, { deadlineAt: new Date(Date.now() - 60_000) });
    expect(await runExpireAttempts()).toBe(1);
    expect((await TestAttemptModel.findById(attemptId))!.status).toBe('AUTO_SUBMITTED');
  });

  it('enforces the attempt limit', async () => {
    const { test } = await makePublishedTest({ maxAttempts: 1 });
    const { c } = await studentClient();
    const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;
    await c.post(`/api/exams/attempts/${attemptId}/submit`);
    const second = await c.post(`/api/exams/tests/${test._id}/start`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ATTEMPT_LIMIT_REACHED');
  });

  it('rejects options and questions that do not belong to the attempt', async () => {
    const { test, questions } = await makePublishedTest({ questions: 1 });
    const { c } = await studentClient();
    const { attemptId } = (await c.post(`/api/exams/tests/${test._id}/start`)).body.data;
    const foreign = await c.put(`/api/exams/attempts/${attemptId}/answer`, { questionId: '0123456789abcdef01234567', selectedOption: 'A' });
    expect(foreign.status).toBe(400);
    const badOption = await c.put(`/api/exams/attempts/${attemptId}/answer`, { questionId: String(questions[0]!._id), selectedOption: 'F' });
    expect(badOption.status).toBe(400);
  });

  it("prevents students from reading another student's attempt", async () => {
    const { test } = await makePublishedTest();
    const { c: alice } = await studentClient('alice@example.com');
    const { c: bob } = await studentClient('bob@example.com');
    const { attemptId } = (await alice.post(`/api/exams/tests/${test._id}/start`)).body.data;
    expect((await bob.get(`/api/exams/attempts/${attemptId}`)).status).toBe(404);
    expect((await bob.post(`/api/exams/attempts/${attemptId}/submit`)).status).toBe(404);
    await alice.post(`/api/exams/attempts/${attemptId}/submit`);
    expect((await bob.get(`/api/results/${attemptId}`)).status).toBe(404);
  });

  it('requires purchase for paid series tests', async () => {
    const { test } = await makePublishedTest({ accessType: 'paid' });
    const { c } = await studentClient();
    const res = await c.post(`/api/exams/tests/${test._id}/start`);
    expect(res.status).toBe(402);
  });
});
