import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { QuestionModel } from '../models/Question.model.js';
import { TestModel } from '../models/Test.model.js';
import { adminClient, makePublishedTest } from './helpers.js';

const CSV = [
  'questionText,optionA,optionB,optionC,optionD,correctOption,explanation,subject,questionText_hi,optionA_hi,optionB_hi',
  'Capital of India?,Mumbai,New Delhi,Kolkata,Chennai,B,New Delhi is the capital.,GK,भारत की राजधानी?,मुंबई,नई दिल्ली',
  'Largest planet?,Earth,Mars,Jupiter,Venus,3,,Science,,,',
  'Broken row,,only one,,,,,,,,',
].join('\n');

describe('bulk question import', () => {
  it('validates a CSV, reports row errors and imports valid rows into a test', async () => {
    const { test } = await makePublishedTest({ questions: 1 });
    const admin = await adminClient();

    const upload = await admin.agent
      .post('/api/admin/imports')
      .set('X-CSRF-Token', admin.csrf)
      .field('targetTestId', String(test._id))
      .attach('file', Buffer.from(CSV, 'utf8'), 'questions.csv');
    expect(upload.status).toBe(201);
    expect(upload.body.data).toMatchObject({ totalRows: 3, validRows: 2, invalidRows: 1 });
    expect(upload.body.data.rowErrors[0].row).toBe(4);
    // Nothing is saved before the admin commits.
    expect(await QuestionModel.countDocuments({ subject: 'GK' })).toBe(0);

    const commit = await admin.post(`/api/admin/imports/${upload.body.data._id}/commit`, { skipDuplicates: true });
    expect(commit.status).toBe(200);
    expect(commit.body.data.importedCount).toBe(2);

    const imported = await QuestionModel.findOne({ subject: 'GK' }).lean();
    expect(imported?.correctOption).toBe('B');
    expect(imported?.translations[0]?.questionText).toBe('भारत की राजधानी?');
    const planet = await QuestionModel.findOne({ questionText: 'Largest planet?' }).lean();
    expect(planet?.correctOption).toBe('C'); // "3" -> third option

    const updated = await TestModel.findById(test._id).lean();
    expect(updated?.questionIds).toHaveLength(3);

    // Re-uploading the same file flags duplicates.
    const again = await admin.agent.post('/api/admin/imports').set('X-CSRF-Token', admin.csrf).attach('file', Buffer.from(CSV, 'utf8'), 'questions.csv');
    expect(again.body.data.duplicateRows).toBe(2);
  });

  it('reads Excel (.xlsx) files', async () => {
    const admin = await adminClient();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Questions');
    ws.addRow(['Question Text', 'Option A', 'Option B', 'Correct Option', 'Subject']);
    ws.addRow(['2 + 2 = ?', '3', '4', 'B', 'Maths']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const upload = await admin.agent.post('/api/admin/imports').set('X-CSRF-Token', admin.csrf).attach('file', buffer, 'maths.xlsx');
    expect(upload.status).toBe(201);
    expect(upload.body.data).toMatchObject({ fileType: 'xlsx', validRows: 1, invalidRows: 0 });
  });

  it('rejects unsupported file types', async () => {
    const admin = await adminClient();
    const res = await admin.agent.post('/api/admin/imports').set('X-CSRF-Token', admin.csrf).attach('file', Buffer.from('x'), 'evil.exe');
    expect(res.status).toBe(400);
  });
});
