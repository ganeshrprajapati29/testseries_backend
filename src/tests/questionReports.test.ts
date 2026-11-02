import { describe, expect, it } from 'vitest';
import { QuestionReportModel } from '../models/QuestionReport.model.js';
import { adminClient, makePublishedTest, studentClient } from './helpers.js';

describe('question reports', () => {
  it('lets a student report a question of their attempt and the admin resolve it', async () => {
    const { test, questions } = await makePublishedTest({ questions: 3 });
    const { c } = await studentClient();
    const start = await c.post(`/api/exams/tests/${test._id}/start`);
    const attemptId = start.body.data.attemptId;
    const qid = String(questions[1]!._id);

    // During the test.
    const rep = await c.post(`/api/exams/attempts/${attemptId}/reports`, { questionId: qid, reason: 'wrong_answer', comment: 'Answer should be C' });
    expect(rep.status).toBe(201);
    expect(rep.body.data).toMatchObject({ questionId: qid, status: 'open' });
    // Reporting again updates the same report.
    const again = await c.post(`/api/exams/attempts/${attemptId}/reports`, { questionId: qid, reason: 'typo', comment: '' });
    expect(again.status).toBe(200);
    expect(await QuestionReportModel.countDocuments()).toBe(1);

    // "other" needs a description; foreign questions are rejected.
    expect((await c.post(`/api/exams/attempts/${attemptId}/reports`, { questionId: qid, reason: 'other', comment: '' })).status).toBe(422);
    expect((await c.post(`/api/exams/attempts/${attemptId}/reports`, { questionId: String(test._id), reason: 'typo' })).status).toBe(400);

    // Another student cannot report through this attempt.
    const { c: other } = await studentClient('other@example.com');
    expect((await other.post(`/api/exams/attempts/${attemptId}/reports`, { questionId: qid, reason: 'typo' })).status).toBe(404);

    const admin = await adminClient();
    const list = await admin.get('/api/admin/question-reports');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ questionId: qid, count: 1, reasonCounts: { typo: 1 } });
    expect(list.body.data[0].question.correctOption).toBe('A');
    expect((await admin.get('/api/admin/question-reports/counts')).body.data).toMatchObject({ open: 1, openQuestions: 1 });

    const detail = await admin.get(`/api/admin/question-reports/question/${qid}`);
    expect(detail.body.data[0].studentId.email).toBe('student@example.com');

    const closed = await admin.post(`/api/admin/question-reports/question/${qid}/close`, { status: 'resolved', adminNote: 'Fixed the typo, thanks!' });
    expect(closed.body.data.updated).toBe(1);

    // The student sees the reply and cannot change a reviewed report.
    const mine = await c.get(`/api/exams/attempts/${attemptId}/reports`);
    expect(mine.body.data[0]).toMatchObject({ status: 'resolved', adminNote: 'Fixed the typo, thanks!' });
    expect((await c.post(`/api/exams/attempts/${attemptId}/reports`, { questionId: qid, reason: 'typo' })).status).toBe(409);
    expect((await admin.get('/api/admin/question-reports')).body.data).toHaveLength(0);
    expect((await admin.get('/api/admin/question-reports?status=resolved')).body.data).toHaveLength(1);
  });
});
