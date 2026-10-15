import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { withTransaction } from '../config/database.js';
import { ImportJobModel } from '../models/ImportJob.model.js';
import { QuestionModel } from '../models/Question.model.js';
import { TestModel } from '../models/Test.model.js';
import { OPTION_KEYS } from '../types/enums.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, pageParams } from '../utils/pagination.js';
import { questionContentHash } from '../utils/safeQuestion.js';
import { cleanText } from '../utils/sanitize.js';
import { createQuestionSchema } from '../validators/question.validator.js';
export const MAX_IMPORT_ROWS = 2000;
export const TEMPLATE_HEADERS = [
    'questionText',
    'optionA',
    'optionB',
    'optionC',
    'optionD',
    'optionE',
    'correctOption',
    'explanation',
    'subject',
    'topic',
    'difficulty',
    'language',
    'sourceExam',
    'sourceYear',
    'tags',
    'questionText_hi',
    'optionA_hi',
    'optionB_hi',
    'optionC_hi',
    'optionD_hi',
    'optionE_hi',
    'explanation_hi',
];
export function templateCsv() {
    const sample = [
        'Which article of the Indian Constitution deals with the Right to Constitutional Remedies?',
        'Article 19',
        'Article 21',
        'Article 32',
        'Article 356',
        '',
        'C',
        'Article 32 empowers citizens to move the Supreme Court for enforcement of Fundamental Rights.',
        'Polity',
        'Fundamental Rights',
        'easy',
        'en',
        'UPSC Prelims',
        '2019',
        'constitution;rights',
        'भारतीय संविधान का कौन सा अनुच्छेद संवैधानिक उपचारों के अधिकार से संबंधित है?',
        'अनुच्छेद 19',
        'अनुच्छेद 21',
        'अनुच्छेद 32',
        'अनुच्छेद 356',
        '',
        'अनुच्छेद 32 नागरिकों को मौलिक अधिकारों के प्रवर्तन हेतु सर्वोच्च न्यायालय जाने का अधिकार देता है।',
    ];
    const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return `${String.fromCharCode(0xfeff)}${TEMPLATE_HEADERS.join(',')}\n${sample.map(esc).join(',')}\n`;
}
/** "Option A", "option_a", "OPTION-A" -> "optiona" */
function normalizeHeader(h) {
    return h.toLowerCase().replace(/[\s_\-.]/g, '');
}
async function readRows(buffer, fileType) {
    if (fileType === 'csv') {
        let records;
        try {
            records = parse(buffer, { columns: true, skip_empty_lines: true, bom: true, trim: true, relax_column_count: true });
        }
        catch (err) {
            throw ApiError.badRequest(`Could not read CSV file: ${err.message}`);
        }
        return records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [normalizeHeader(k), String(v ?? '')])));
    }
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(buffer);
    }
    catch {
        throw ApiError.badRequest('Could not read the Excel file. Please upload a valid .xlsx file.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet)
        throw ApiError.badRequest('The Excel file has no worksheets');
    const headerRow = sheet.getRow(1);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
        headers[col] = normalizeHeader(cell.text ?? '');
    });
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1)
            return;
        const obj = {};
        headers.forEach((h, col) => {
            if (h)
                obj[h] = (row.getCell(col).text ?? '').trim();
        });
        if (Object.values(obj).some((v) => v))
            rows.push(obj);
    });
    return rows;
}
function pick(row, ...keys) {
    for (const k of keys) {
        const v = row[k];
        if (v !== undefined && v !== '')
            return cleanText(v);
    }
    return '';
}
function parseCorrect(value, optionCount) {
    const v = value.trim().toUpperCase().replace(/^OPTION\s*/, '').replace(/[().]/g, '');
    if (OPTION_KEYS.includes(v))
        return v;
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= optionCount)
        return OPTION_KEYS[n - 1];
    return v;
}
function rowToQuestion(row, defaults) {
    const options = OPTION_KEYS.map((key) => ({
        key,
        text: pick(row, `option${key.toLowerCase()}`, key.toLowerCase(), `opt${key.toLowerCase()}`),
        imageUrl: '',
    })).filter((o) => o.text);
    const hiOptions = OPTION_KEYS.map((key) => ({ key, text: pick(row, `option${key.toLowerCase()}hi`) })).filter((o) => o.text);
    const hiQuestion = pick(row, 'questiontexthi', 'questionhi');
    const translations = hiQuestion
        ? [{ language: 'hi', questionText: hiQuestion, options: hiOptions, explanation: pick(row, 'explanationhi', 'solutionhi') }]
        : [];
    const yearRaw = pick(row, 'sourceyear', 'year');
    const tagsRaw = pick(row, 'tags');
    return {
        questionText: pick(row, 'questiontext', 'question'),
        options,
        correctOption: parseCorrect(pick(row, 'correctoption', 'answer', 'correct', 'correctanswer'), options.length),
        explanation: pick(row, 'explanation', 'solution'),
        subject: pick(row, 'subject') || defaults.subject,
        topic: pick(row, 'topic', 'chapter') || defaults.topic,
        difficulty: (pick(row, 'difficulty') || 'medium').toLowerCase(),
        language: (pick(row, 'language', 'lang') || defaults.language).toLowerCase(),
        translations,
        imageUrl: '',
        sourceExam: pick(row, 'sourceexam', 'exam') || defaults.sourceExam,
        sourceYear: yearRaw ? Number(yearRaw) : defaults.sourceYear,
        tags: tagsRaw ? tagsRaw.split(/[;,]/).map((t) => t.trim()).filter(Boolean).slice(0, 20) : [],
        isActive: true,
    };
}
export async function createImportJob(params) {
    const lower = params.fileName.toLowerCase();
    const fileType = lower.endsWith('.xlsx') ? 'xlsx' : 'csv';
    if (params.targetTestId && !(await TestModel.exists({ _id: params.targetTestId }))) {
        throw ApiError.validation([{ path: 'body.targetTestId', message: 'Target test not found' }]);
    }
    const rows = await readRows(params.buffer, fileType);
    if (!rows.length)
        throw ApiError.badRequest('The file does not contain any question rows');
    if (rows.length > MAX_IMPORT_ROWS)
        throw ApiError.badRequest(`A single import can contain at most ${MAX_IMPORT_ROWS} rows`);
    if (!('questiontext' in rows[0]) && !('question' in rows[0])) {
        throw ApiError.badRequest('Missing "questionText" column. Download the template to see the expected format.');
    }
    const rowErrors = [];
    const valid = [];
    const seen = new Set();
    rows.forEach((raw, index) => {
        const rowNumber = index + 2; // header is row 1
        const candidate = rowToQuestion(raw, params.defaults);
        const parsed = createQuestionSchema.safeParse(candidate);
        if (!parsed.success) {
            for (const issue of parsed.error.issues.slice(0, 5)) {
                rowErrors.push({ row: rowNumber, field: issue.path.join('.'), message: issue.message });
            }
            return;
        }
        const hash = questionContentHash(parsed.data);
        valid.push({ ...parsed.data, contentHash: hash, row: rowNumber, duplicate: seen.has(hash) });
        seen.add(hash);
    });
    // Duplicates of questions already in the bank.
    const existing = await QuestionModel.find({ contentHash: { $in: [...seen] } }, { contentHash: 1 }).lean();
    const existingHashes = new Set(existing.map((e) => e.contentHash));
    for (const v of valid)
        if (existingHashes.has(v.contentHash))
            v.duplicate = true;
    const invalidRowNumbers = new Set(rowErrors.map((e) => e.row));
    const job = await ImportJobModel.create({
        fileName: params.fileName.slice(0, 255),
        fileType,
        status: 'validated',
        targetTestId: params.targetTestId,
        defaults: params.defaults,
        totalRows: rows.length,
        validRows: valid.length,
        invalidRows: invalidRowNumbers.size,
        duplicateRows: valid.filter((v) => v.duplicate).length,
        rowErrors: rowErrors.slice(0, 500),
        payload: valid,
        createdBy: params.userId,
    });
    return {
        ...job.toObject(),
        payload: undefined,
        preview: valid.slice(0, 10).map((v) => ({ row: v.row, questionText: v.questionText, options: v.options, correctOption: v.correctOption, subject: v.subject, duplicate: v.duplicate })),
    };
}
export async function commitImportJob(jobId, skipDuplicates, userId) {
    return withTransaction(async (session) => {
        const job = await ImportJobModel.findOneAndUpdate({ _id: jobId, status: 'validated' }, { $set: { status: 'committed', committedAt: new Date() } }, { new: true, session }).select('+payload');
        if (!job) {
            const exists = await ImportJobModel.exists({ _id: jobId });
            if (!exists)
                throw ApiError.notFound('Import job not found');
            throw ApiError.conflict('This import has already been committed or cancelled', 'IMPORT_CLOSED');
        }
        const rows = job.payload.filter((p) => !(skipDuplicates && p.duplicate));
        const docs = rows.map(({ duplicate: _d, row: _r, ...q }) => ({ ...q, createdBy: userId, updatedBy: userId }));
        const created = docs.length ? await QuestionModel.insertMany(docs, { session }) : [];
        const ids = created.map((c) => c._id);
        if (job.targetTestId && ids.length) {
            const test = await TestModel.findById(job.targetTestId).session(session ?? null);
            if (test) {
                if (test.questionIds.length + ids.length > 500)
                    throw ApiError.badRequest('The target test would exceed 500 questions');
                test.questionIds.push(...ids);
                await test.save({ session });
            }
        }
        job.importedCount = ids.length;
        job.createdQuestionIds = ids;
        job.payload = [];
        await job.save({ session });
        return { importedCount: ids.length, skipped: (job.validRows ?? 0) - ids.length, targetTestId: job.targetTestId };
    });
}
export async function cancelImportJob(jobId) {
    const job = await ImportJobModel.findOneAndUpdate({ _id: jobId, status: 'validated' }, { $set: { status: 'cancelled', payload: [] } }, { new: true });
    if (!job)
        throw ApiError.conflict('Only validated imports can be cancelled', 'IMPORT_CLOSED');
    return job;
}
export async function listImportJobs(q) {
    const { page, limit, skip } = pageParams(q.page, q.limit);
    const [items, total] = await Promise.all([
        ImportJobModel.find().select('-rowErrors').populate('createdBy', 'name email').populate('targetTestId', 'title').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        ImportJobModel.countDocuments(),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
}
export async function getImportJob(jobId) {
    const job = await ImportJobModel.findById(jobId).select('+payload').populate('targetTestId', 'title').lean();
    if (!job)
        throw ApiError.notFound('Import job not found');
    const payload = (job.payload ?? []);
    return {
        ...job,
        payload: undefined,
        preview: payload.slice(0, 10).map((v) => ({ row: v.row, questionText: v.questionText, options: v.options, correctOption: v.correctOption, subject: v.subject, duplicate: v.duplicate })),
    };
}
//# sourceMappingURL=import.service.js.map