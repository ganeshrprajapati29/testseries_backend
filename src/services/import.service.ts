import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
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
import { CategoryModel } from '../models/Category.model.js';
import { slugify } from '../utils/slugify.js';
import { categoryLabels, resolveCategoryLinks } from './questionCategory.service.js';

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
  'imageUrl',
  'images',
  'explanationImages',
  'category',
];

export function templateCsv(): string {
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
    '',
    '',
    '',
    'upsc/prelims/paper-i',
  ];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${String.fromCharCode(0xfeff)}${TEMPLATE_HEADERS.join(',')}\n${sample.map(esc).join(',')}\n`;
}

/** "Option A", "option_a", "OPTION-A" -> "optiona" */
function normalizeHeader(h: string) {
  return h.toLowerCase().replace(/[\s_\-.]/g, '');
}

type RawRow = Record<string, string>;

async function readRows(buffer: Buffer, fileType: 'csv' | 'xlsx'): Promise<RawRow[]> {
  if (fileType === 'csv') {
    let records: Record<string, string>[];
    try {
      records = parse(buffer, { columns: true, skip_empty_lines: true, bom: true, trim: true, relax_column_count: true });
    } catch (err) {
      throw ApiError.badRequest(`Could not read CSV file: ${(err as Error).message}`);
    }
    return records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [normalizeHeader(k), String(v ?? '')])));
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw ApiError.badRequest('Could not read the Excel file. Please upload a valid .xlsx file.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw ApiError.badRequest('The Excel file has no worksheets');
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = normalizeHeader(cell.text ?? '');
  });
  const rows: RawRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: RawRow = {};
    headers.forEach((h, col) => {
      if (h) obj[h] = (row.getCell(col).text ?? '').trim();
    });
    if (Object.values(obj).some((v) => v)) rows.push(obj);
  });
  return rows;
}

function pick(row: RawRow, ...keys: string[]) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== '') return cleanText(v);
  }
  return '';
}

function parseCorrect(value: string, optionCount: number): string {
  const v = value.trim().toUpperCase().replace(/^OPTION\s*/, '').replace(/[().]/g, '');
  if ((OPTION_KEYS as readonly string[]).includes(v)) return v;
  const n = Number(v);
  if (Number.isInteger(n) && n >= 1 && n <= optionCount) return OPTION_KEYS[n - 1]!;
  return v;
}

interface Defaults {
  categoryId?: string | null;
  subject: string;
  topic: string;
  sourceExam: string;
  sourceYear: number | null;
  language: 'en' | 'hi';
}

/**
 * Lookup of category paths -> id. Accepts slug paths ("defence/cds/maths"), name paths
 * ("Defence > CDS > Maths"), and an optional "pyqs:" / "test-series:" prefix.
 */
async function categoryLookup() {
  const cats = await CategoryModel.find({ status: { $ne: 'archived' } }, { slug: 1, name: 1, ancestors: 1, moduleType: 1 }).lean();
  const slugOf = new Map(cats.map((c) => [String(c._id), c.slug]));
  const nameOf = new Map(cats.map((c) => [String(c._id), slugify(c.name)]));
  const map = new Map<string, string>();
  const add = (path: string, c: (typeof cats)[number]) => {
    map.set(path, String(c._id));
    map.set(`${c.moduleType === 'PYQS' ? 'pyqs' : 'test-series'}:${path}`, String(c._id));
  };
  // Name based paths first, slug paths last so an exact slug path always wins.
  // Test Series paths are added after PYQ paths so they win when both trees have the same path.
  const ordered = [...cats.filter((x) => x.moduleType === 'PYQS'), ...cats.filter((x) => x.moduleType !== 'PYQS')];
  for (const c of ordered) add([...c.ancestors.map((a) => nameOf.get(String(a)) ?? ''), slugify(c.name)].join('/'), c);
  for (const c of ordered) add([...c.ancestors.map((a) => slugOf.get(String(a)) ?? ''), c.slug].join('/'), c);
  return (value: string) => {
    const raw = value.trim().toLowerCase();
    const prefix = raw.match(/^(pyqs?|test-?series|ts):/)?.[1];
    const body = raw.replace(/^(pyqs?|test-?series|ts):/, '');
    const path = body.split(/\s*[/>›]\s*/).filter(Boolean).map((p) => slugify(p)).join('/');
    if (prefix) return map.get(`${prefix.startsWith('pyq') ? 'pyqs' : 'test-series'}:${path}`) ?? null;
    return map.get(path) ?? null;
  };
}

function rowToQuestion(row: RawRow, defaults: Defaults, findCategory: (v: string) => string | null) {
  const categoryCell = pick(row, 'category', 'categories', 'categorypath');
  const categoryIds = categoryCell
    ? categoryCell.split(/[|;]/).map((c) => c.trim()).filter(Boolean).map((c) => findCategory(c) ?? `invalid:${c}`)
    : defaults.categoryId ? [String(defaults.categoryId)] : [];
  const options = OPTION_KEYS.map((key) => ({
    key,
    text: pick(row, `option${key.toLowerCase()}`, key.toLowerCase(), `opt${key.toLowerCase()}`),
    imageUrl: '',
  })).filter((o) => o.text);

  const hiOptions = OPTION_KEYS.map((key) => ({ key, text: pick(row, `option${key.toLowerCase()}hi`) })).filter((o) => o.text);
  const hiQuestion = pick(row, 'questiontexthi', 'questionhi');
  const translations = hiQuestion
    ? [{ language: 'hi' as const, questionText: hiQuestion, options: hiOptions, explanation: pick(row, 'explanationhi', 'solutionhi') }]
    : [];

  const yearRaw = pick(row, 'sourceyear', 'year');
  // Several image links can be given in one cell, separated by | , ; or new lines.
  const links = (v: string) => v.split(/[|,;\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
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
    imageUrl: pick(row, 'imageurl', 'image'),
    images: links(pick(row, 'images', 'questionimages')),
    explanationImages: links(pick(row, 'explanationimages', 'solutionimages')),
    sourceExam: pick(row, 'sourceexam', 'exam') || defaults.sourceExam,
    sourceYear: yearRaw ? Number(yearRaw) : defaults.sourceYear,
    tags: tagsRaw ? tagsRaw.split(/[;,]/).map((t) => t.trim()).filter(Boolean).slice(0, 20) : [],
    categoryIds,
    isActive: true,
  };
}

export async function createImportJob(params: {
  buffer: Buffer;
  fileName: string;
  targetTestId: string | null;
  defaults: Defaults;
  userId: Types.ObjectId;
}) {
  const lower = params.fileName.toLowerCase();
  const fileType: 'csv' | 'xlsx' = lower.endsWith('.xlsx') ? 'xlsx' : 'csv';

  if (params.targetTestId) {
    const target = await TestModel.findById(params.targetTestId, { autoCategoryId: 1 }).lean();
    if (!target) throw ApiError.validation([{ path: 'body.targetTestId', message: 'Target test not found' }]);
    if (target.autoCategoryId) {
      throw ApiError.validation([{ path: 'body.targetTestId', message: 'Automatic practice sets fill themselves - import into the category instead' }]);
    }
  }

  const rows = await readRows(params.buffer, fileType);
  const findCategory = await categoryLookup();
  if (!rows.length) throw ApiError.badRequest('The file does not contain any question rows');
  if (rows.length > MAX_IMPORT_ROWS) throw ApiError.badRequest(`A single import can contain at most ${MAX_IMPORT_ROWS} rows`);
  if (!('questiontext' in rows[0]!) && !('question' in rows[0]!)) {
    throw ApiError.badRequest('Missing "questionText" column. Download the template to see the expected format.');
  }

  const rowErrors: { row: number; field: string; message: string }[] = [];
  const valid: (ReturnType<typeof rowToQuestion> & { contentHash: string; row: number; duplicate: boolean })[] = [];
  const seen = new Set<string>();

  rows.forEach((raw, index) => {
    const rowNumber = index + 2; // header is row 1
    const candidate = rowToQuestion(raw, params.defaults, findCategory);
    const badCategory = candidate.categoryIds.find((c) => c.startsWith('invalid:'));
    if (badCategory) {
      rowErrors.push({ row: rowNumber, field: 'category', message: `Category "${badCategory.slice(8)}" was not found. Use a path like defence/cds/maths or pyqs:nda/maths` });
      return;
    }
    const parsed = createQuestionSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 5)) {
        rowErrors.push({ row: rowNumber, field: issue.path.join('.'), message: issue.message });
      }
      return;
    }
    const hash = questionContentHash(parsed.data);
    valid.push({ ...(parsed.data as ReturnType<typeof rowToQuestion>), contentHash: hash, row: rowNumber, duplicate: seen.has(hash) });
    seen.add(hash);
  });

  // Duplicates of questions already in the bank.
  const existing = await QuestionModel.find({ contentHash: { $in: [...seen] } }, { contentHash: 1 }).lean();
  const existingHashes = new Set(existing.map((e) => e.contentHash));
  for (const v of valid) if (existingHashes.has(v.contentHash)) v.duplicate = true;

  // Where the questions will appear (shown before committing).
  const labels = await categoryLabels(valid.flatMap((v) => v.categoryIds));
  const perCategory = new Map<string, number>();
  for (const v of valid) for (const id of v.categoryIds) perCategory.set(id, (perCategory.get(id) ?? 0) + 1);
  const destinations = [...perCategory.entries()]
    .map(([id, count]) => ({ categoryId: id, label: labels.get(id)?.label ?? 'Unknown', moduleType: labels.get(id)?.moduleType ?? '', count }))
    .sort((a, b) => b.count - a.count);
  const uncategorizedRows = valid.filter((v) => !v.categoryIds.length).length;

  const invalidRowNumbers = new Set(rowErrors.map((e) => e.row));
  const job = await ImportJobModel.create({
    destinations,
    uncategorizedRows,
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
    preview: valid.slice(0, 10).map((v) => ({
      row: v.row,
      questionText: v.questionText,
      options: v.options,
      correctOption: v.correctOption,
      subject: v.subject,
      duplicate: v.duplicate,
      categories: v.categoryIds.map((id) => labels.get(id)?.label ?? 'Unknown'),
    })),
  };
}

export async function commitImportJob(jobId: string, skipDuplicates: boolean, userId: Types.ObjectId) {
  return withTransaction(async (session) => {
    const job = await ImportJobModel.findOneAndUpdate(
      { _id: jobId, status: 'validated' },
      { $set: { status: 'committed', committedAt: new Date() } },
      { new: true, session },
    ).select('+payload');
    if (!job) {
      const exists = await ImportJobModel.exists({ _id: jobId });
      if (!exists) throw ApiError.notFound('Import job not found');
      throw ApiError.conflict('This import has already been committed or cancelled', 'IMPORT_CLOSED');
    }

    type Payload = ReturnType<typeof rowToQuestion> & { contentHash: string; duplicate: boolean; row: number };
    const rows = (job.payload as Payload[]).filter((p) => !(skipDuplicates && p.duplicate));
    const docs = [];
    for (const { duplicate: _d, row: _r, ...q } of rows) {
      const links = await resolveCategoryLinks((q as { categoryIds?: string[] }).categoryIds ?? []);
      docs.push({ ...q, ...links, createdBy: userId, updatedBy: userId });
    }
    const created = docs.length ? await QuestionModel.insertMany(docs, { session }) : [];
    const ids = created.map((c) => c._id as Types.ObjectId);

    // Rows skipped as duplicates still have to reach their destination: the question that already exists
    // is filed under the row's categories too (and goes into the target test).
    const skippedRows = (job.payload as Payload[]).filter((p) => skipDuplicates && p.duplicate);
    const existingDocs = skippedRows.length
      ? await QuestionModel.find({ contentHash: { $in: skippedRows.map((p) => p.contentHash) } }, { _id: 1, contentHash: 1, categoryIds: 1 })
          .sort({ createdAt: 1 })
          .session(session ?? null)
          .lean()
      : [];
    const existingByHash = new Map<string, (typeof existingDocs)[number]>();
    for (const e of existingDocs) if (!existingByHash.has(e.contentHash ?? '')) existingByHash.set(e.contentHash ?? '', e);
    const linkedIds: Types.ObjectId[] = [];
    for (const p of skippedRows) {
      const existing = existingByHash.get(p.contentHash);
      if (!existing) continue;
      linkedIds.push(existing._id);
      const add = ((p as { categoryIds?: string[] }).categoryIds ?? []).filter((c) => !(existing.categoryIds ?? []).map(String).includes(c));
      if (add.length) {
        const links = await resolveCategoryLinks([...(existing.categoryIds ?? []).map(String), ...add]);
        await QuestionModel.updateOne({ _id: existing._id }, { $set: links }, { session });
        existing.categoryIds = links.categoryIds;
      }
    }

    if (job.targetTestId) {
      const test = await TestModel.findById(job.targetTestId).session(session ?? null);
      if (test) {
        const inTest = new Set(test.questionIds.map(String));
        const toAdd = [...ids, ...linkedIds].filter((id) => !inTest.has(String(id)) && (inTest.add(String(id)), true));
        if (test.questionIds.length + toAdd.length > 500) throw ApiError.badRequest('The target test would exceed 500 questions');
        test.questionIds.push(...toAdd);
        await test.save({ session });
      }
    }

    job.importedCount = ids.length;
    job.createdQuestionIds = ids;
    job.payload = [];
    await job.save({ session });
    return {
      importedCount: ids.length,
      skipped: (job.validRows ?? 0) - ids.length,
      linkedExisting: [...new Set(linkedIds.map(String))].length,
      targetTestId: job.targetTestId,
      questionIds: [...ids, ...linkedIds],
    };
  });
}

export async function cancelImportJob(jobId: string) {
  const job = await ImportJobModel.findOneAndUpdate({ _id: jobId, status: 'validated' }, { $set: { status: 'cancelled', payload: [] } }, { new: true });
  if (!job) throw ApiError.conflict('Only validated imports can be cancelled', 'IMPORT_CLOSED');
  return job;
}

export async function listImportJobs(q: { page: number; limit: number }) {
  const { page, limit, skip } = pageParams(q.page, q.limit);
  const [items, total] = await Promise.all([
    ImportJobModel.find().select('-rowErrors').populate('createdBy', 'name email').populate('targetTestId', 'title').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ImportJobModel.countDocuments(),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
}

export async function getImportJob(jobId: string) {
  const job = await ImportJobModel.findById(jobId).select('+payload').populate('targetTestId', 'title').lean();
  if (!job) throw ApiError.notFound('Import job not found');
  const payload = (job.payload ?? []) as { row: number; questionText: string; options: unknown; correctOption: string; subject: string; duplicate: boolean }[];
  return {
    ...job,
    payload: undefined,
    preview: payload.slice(0, 10).map((v) => ({ row: v.row, questionText: v.questionText, options: v.options, correctOption: v.correctOption, subject: v.subject, duplicate: v.duplicate })),
  };
}
