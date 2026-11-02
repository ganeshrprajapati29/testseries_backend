/**
 * MOCK / DEMO DATA for client testing.
 *
 *   npm run seed:mock               (development)
 *   node dist/seed/seedMockData.js --confirm         (production build; --confirm required in production)
 *   ... --reset                      removes all previously generated mock data first
 *   ... --remove                     only removes mock data
 *
 * Creates ~1,000 questions (with SVG figures), 52 test series with covers, ~156 tests, 51 PYQ papers,
 * 50 students and ~300 evaluated attempts. Everything is linked to a dedicated "mock seeder" account
 * (and student emails end with @mock.ganpura.in) so it can be removed completely with --remove.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { disconnectRedis, getRedis } from '../config/redis.js';
import { CategoryModel } from '../models/Category.model.js';
import { EnrollmentModel } from '../models/Enrollment.model.js';
import { ImportJobModel } from '../models/ImportJob.model.js';
import { QuestionModel } from '../models/Question.model.js';
import { ResultModel } from '../models/Result.model.js';
import { SessionModel } from '../models/Session.model.js';
import { SiteSettingModel } from '../models/SiteSetting.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { UserModel } from '../models/User.model.js';
import { grantEnrollment } from '../services/access.service.js';
import { saveAnswers, startAttempt } from '../services/examination.service.js';
import { commitImportJob, createImportJob } from '../services/import.service.js';
import { finalizeAttempt } from '../services/scoring.service.js';
import { backfillFromTests } from '../services/questionCategory.service.js';
import { hashPassword } from '../utils/password.js';
import { questionContentHash } from '../utils/safeQuestion.js';
import { CURATED } from './mock/curated.js';
import { deletePrivateFile, storePdf } from '../services/storage.service.js';
import { CHEMISTRY_NUM, ENGLISH_VOCAB, MATHS, MATHS_IMAGE, MULTI_IMAGE, PHYSICS_NUM, REASONING } from './mock/generators.js';
import { questionPaperPdf, readSvgIfLocal, solutionsPdf } from './mock/pdf.js';
import { createRng } from './mock/rng.js';
import { categoryBadge, seriesCover } from './mock/svg.js';
import { seedCategories } from './seedCategories.js';
const SEEDER_EMAIL = 'mock-seeder@system.local';
const STUDENT_DOMAIN = 'mock.ganpura.in';
export const MOCK_STUDENT_PASSWORD = 'Student@123';
const KEYS = ['A', 'B', 'C', 'D'];
const DAY = 24 * 60 * 60 * 1000;
const args = new Set(process.argv.slice(2));
const log = (...m) => console.log(...m);
// ------------------------------------------------------------------ helpers
const uploadRoot = () => path.resolve(env.UPLOAD_DIR);
const publicUrl = (rel) => `${env.PUBLIC_UPLOAD_BASE_URL.replace(/\/$/, '')}/${rel}`;
async function saveSvg(folder, svg) {
    const name = `${crypto.createHash('sha1').update(svg).digest('hex').slice(0, 16)}.svg`;
    const rel = `mock/${folder}/${name}`;
    const target = path.join(uploadRoot(), rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, svg, 'utf8');
    return publicUrl(rel);
}
function slug(s) {
    return s
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 90);
}
// ------------------------------------------------------------------ removal
async function removeMock() {
    const seeder = await UserModel.findOne({ normalizedEmail: SEEDER_EMAIL });
    const students = await UserModel.find({ normalizedEmail: { $regex: `@${STUDENT_DOMAIN.replace(/\./g, '\\.')}$` } }, { _id: 1 }).lean();
    const studentIds = students.map((s) => s._id);
    const r = {};
    r.attempts = (await TestAttemptModel.deleteMany({ studentId: { $in: studentIds } })).deletedCount;
    r.results = (await ResultModel.deleteMany({ studentId: { $in: studentIds } })).deletedCount;
    r.enrollments = (await EnrollmentModel.deleteMany({ studentId: { $in: studentIds } })).deletedCount;
    await SessionModel.deleteMany({ userId: { $in: studentIds } });
    r.students = (await UserModel.deleteMany({ _id: { $in: studentIds } })).deletedCount;
    if (seeder) {
        const tests = await TestModel.find({ createdBy: seeder._id }, { _id: 1, questionPaperPdf: 1, solutionPdf: 1 }).lean();
        await Promise.all(tests.flatMap((t) => [t.questionPaperPdf?.key, t.solutionPdf?.key]).filter((k) => !!k).map((k) => deletePrivateFile(k)));
        // Real students may have attempted mock tests - remove those attempts too so nothing dangles.
        await TestAttemptModel.deleteMany({ testId: { $in: tests.map((t) => t._id) } });
        await ResultModel.deleteMany({ testId: { $in: tests.map((t) => t._id) } });
        const series = await TestSeriesModel.find({ createdBy: seeder._id }, { _id: 1 }).lean();
        await EnrollmentModel.deleteMany({ testSeriesId: { $in: series.map((s) => s._id) } });
        r.tests = (await TestModel.deleteMany({ createdBy: seeder._id })).deletedCount;
        r.series = (await TestSeriesModel.deleteMany({ createdBy: seeder._id })).deletedCount;
        r.questions = (await QuestionModel.deleteMany({ createdBy: seeder._id })).deletedCount;
        r.imports = (await ImportJobModel.deleteMany({ createdBy: seeder._id })).deletedCount;
        await seeder.deleteOne();
    }
    await CategoryModel.updateMany({ imageUrl: { $regex: '^/uploads/mock/|/mock/categories/' } }, { $set: { imageUrl: '' } });
    await fs.rm(path.join(uploadRoot(), 'mock'), { recursive: true, force: true });
    await SiteSettingModel.updateOne({ key: 'announcement' }, { $set: { value: '' } });
    log('Removed mock data:', r);
}
async function buildQuestionBank(rng, seederId) {
    const docs = [];
    const seen = new Set();
    const push = async (m) => {
        const options = m.options.map((text, i) => ({ key: KEYS[i], text, imageUrl: '' }));
        const contentHash = questionContentHash({ questionText: m.q, options });
        if (seen.has(contentHash))
            return;
        seen.add(contentHash);
        const imageUrl = m.image ? await saveSvg('questions', m.image) : '';
        const images = [];
        for (const svg of m.images ?? [])
            images.push(await saveSvg('questions', svg));
        const explanationImages = [];
        for (const svg of m.explanationImages ?? [])
            explanationImages.push(await saveSvg('solutions', svg));
        docs.push({
            questionText: m.q,
            options,
            correctOption: KEYS[m.correct],
            explanation: m.explanation,
            subject: m.subject,
            topic: m.topic,
            difficulty: m.difficulty,
            language: 'en',
            translations: m.hi
                ? [{ language: 'hi', questionText: m.hi.q, options: (m.hi.options ?? m.options).map((text, i) => ({ key: KEYS[i], text })), explanation: m.hi.explanation }]
                : [],
            imageUrl,
            images,
            explanationImages,
            tags: ['mock', m.topic.toLowerCase()],
            contentHash,
            isActive: true,
            createdBy: seederId,
            updatedBy: seederId,
        });
    };
    for (const [subject, list] of Object.entries(CURATED)) {
        for (const [q, opts, explanation, topic] of list) {
            const shuffled = rng.shuffle(opts);
            await push({ subject, topic, difficulty: rng.pick(['easy', 'medium', 'medium', 'hard']), q, options: shuffled, correct: shuffled.indexOf(opts[0]), explanation });
        }
    }
    const run = async (gens, each) => {
        for (const g of gens)
            for (let i = 0; i < each; i++)
                await push(g(rng));
    };
    await run(MATHS, 24);
    await run(MATHS_IMAGE, 10);
    await run(MULTI_IMAGE, 12);
    await run(REASONING, 20);
    await run(PHYSICS_NUM, 16);
    await run(CHEMISTRY_NUM, 30);
    await run(ENGLISH_VOCAB, 30);
    const inserted = await QuestionModel.insertMany(docs, { ordered: false });
    const bank = inserted.map((d) => ({
        id: d._id,
        subject: d.subject ?? '',
        hasImage: !!d.imageUrl,
        hasHindi: (d.translations?.length ?? 0) > 0,
    }));
    return bank;
}
function poolPicker(bank, rng) {
    const bySubject = new Map();
    for (const b of bank) {
        const list = bySubject.get(b.subject) ?? [];
        list.push(b);
        bySubject.set(b.subject, list);
    }
    /** Picks `count` distinct questions round-robin over the given subjects. */
    return (subjects, count, opts = {}) => {
        const pools = subjects.map((s) => {
            let list = rng.shuffle(bySubject.get(s) ?? []);
            if (opts.preferHindi)
                list = [...list.filter((q) => q.hasHindi), ...list.filter((q) => !q.hasHindi)];
            return list;
        });
        const out = [];
        const used = new Set();
        let guard = 0;
        while (out.length < count && guard++ < count * 20) {
            for (const pool of pools) {
                if (out.length >= count)
                    break;
                const next = pool.find((q) => !used.has(String(q.id)));
                if (next) {
                    used.add(String(next.id));
                    out.push(next.id);
                }
            }
            if (pools.every((p) => p.every((q) => used.has(String(q.id)))))
                break;
        }
        return out;
    };
}
// ------------------------------------------------------------------ catalogue plans
const GS = ['Polity', 'History', 'Geography', 'Economics', 'Physics', 'Chemistry', 'Biology', 'General Knowledge'];
const CSAT = ['Maths', 'Reasoning', 'English'];
const PLANS = [
    { path: 'defence/cds/gk', exam: 'CDS', titles: ['CDS General Knowledge Test Series 2027', 'CDS GK Sectional Practice Pack'], subjects: GS, marks: [1, 0.33], secPerQ: 60, price: [299, 599] },
    { path: 'defence/cds/english', exam: 'CDS', titles: ['CDS English Test Series 2027', 'CDS English Vocabulary & Grammar Drills'], subjects: ['English'], marks: [1, 0.33], secPerQ: 45, price: [249, 499] },
    { path: 'defence/cds/maths', exam: 'CDS', titles: ['CDS Elementary Mathematics Test Series', 'CDS Maths Speed Practice Pack'], subjects: ['Maths'], marks: [1, 0.33], secPerQ: 75, hindi: true, price: [299, 599] },
    { path: 'defence/nda/maths', exam: 'NDA', titles: ['NDA Mathematics Test Series 2027', 'NDA Maths Chapter-wise Practice'], subjects: ['Maths'], marks: [2.5, 0.83], secPerQ: 90, hindi: true, price: [349, 699] },
    { path: 'defence/nda/gat', exam: 'NDA', titles: ['NDA GAT Full Test Series', 'NDA GAT Science & GK Practice'], subjects: ['English', 'Physics', 'Chemistry', 'General Knowledge', 'History', 'Geography'], marks: [4, 1.33], secPerQ: 60, price: [349, 699] },
    { path: 'defence/capf/paper-i', exam: 'CAPF AC', titles: ['CAPF Paper-I General Ability Test Series', 'CAPF Paper-I Mini Mocks'], subjects: [...GS, 'Reasoning'], marks: [2, 0.66], secPerQ: 60, price: [299, 599] },
    { path: 'defence/capf/paper-ii', exam: 'CAPF AC', titles: ['CAPF Paper-II English Practice Series', 'CAPF Paper-II Language Skills Pack'], subjects: ['English'], marks: [1, 0], secPerQ: 45, price: [199, 399] },
    { path: 'defence/afcat', exam: 'AFCAT', titles: ['AFCAT Full Mock Test Series 2027', 'AFCAT Reasoning & Numerical Ability Pack'], subjects: ['English', 'General Knowledge', 'Maths', 'Reasoning'], marks: [3, 1], secPerQ: 45, hindi: true, price: [299, 599] },
    { path: 'jee/mains', exam: 'JEE Main', titles: ['JEE Main Full Syllabus Test Series 2027', 'JEE Main PCM Chapter Tests'], subjects: ['Physics', 'Chemistry', 'Maths'], marks: [4, 1], secPerQ: 120, hindi: true, price: [499, 999] },
    { path: 'jee/advance', exam: 'JEE Advanced', titles: ['JEE Advanced Mock Test Series', 'JEE Advanced Problem Solving Pack'], subjects: ['Physics', 'Maths', 'Chemistry'], marks: [3, 1], secPerQ: 150, price: [599, 1199] },
    { path: 'net', exam: 'UGC NET', titles: ['UGC NET Paper-1 Test Series', 'UGC NET Reasoning & ICT Practice'], subjects: ['Reasoning', 'Computer', 'Maths', 'General Knowledge'], marks: [2, 0], secPerQ: 72, hindi: true, price: [299, 599] },
    { path: 'upsc/prelims/paper-i', exam: 'UPSC Prelims', titles: ['UPSC Prelims GS Paper-I Test Series 2027', 'UPSC Prelims Polity & History Sectionals'], subjects: GS, marks: [2, 0.66], secPerQ: 72, price: [499, 999] },
    { path: 'upsc/prelims/paper-ii', exam: 'UPSC CSAT', titles: ['UPSC CSAT Paper-II Test Series', 'UPSC CSAT Quant & Reasoning Booster'], subjects: CSAT, marks: [2.5, 0.83], secPerQ: 90, hindi: true, price: [399, 799] },
    { path: 'upsc/mains', exam: 'UPSC Mains', titles: ['UPSC Mains GS Foundation Quiz Series', 'UPSC Mains Static GS Revision Pack'], subjects: GS, marks: [1, 0], secPerQ: 60, price: [399, 799] },
    { path: 'uppcs/prelims/gs-i', exam: 'UPPCS', titles: ['UPPCS Prelims GS-I Test Series 2027', 'UPPCS GS-I Topic-wise Practice'], subjects: GS, marks: [2, 0.66], secPerQ: 72, price: [299, 599] },
    { path: 'uppcs/prelims/gs-ii', exam: 'UPPCS CSAT', titles: ['UPPCS CSAT GS-II Test Series', 'UPPCS CSAT Quant Practice Pack'], subjects: CSAT, marks: [2.5, 0.83], secPerQ: 90, hindi: true, price: [249, 499] },
    { path: 'uppcs/mains', exam: 'UPPCS Mains', titles: ['UPPCS Mains GS Objective Revision Series', 'UPPCS Mains Fact Builder Pack'], subjects: GS, marks: [1, 0], secPerQ: 60, price: [299, 599] },
    { path: 'olympiad/ioqm', exam: 'IOQM', titles: ['IOQM Mathematics Practice Series', 'IOQM Number Theory & Algebra Pack'], subjects: ['Maths'], marks: [3, 0], secPerQ: 150, price: [299, 599] },
    { path: 'olympiad/nsep', exam: 'NSEP', titles: ['NSEP Physics Olympiad Test Series', 'NSEP Mechanics & Electricity Pack'], subjects: ['Physics'], marks: [3, 1], secPerQ: 120, price: [299, 599] },
    { path: 'olympiad/nsec', exam: 'NSEC', titles: ['NSEC Chemistry Olympiad Test Series', 'NSEC Physical Chemistry Pack'], subjects: ['Chemistry'], marks: [3, 1], secPerQ: 120, price: [299, 599] },
    { path: 'entrance-exam/jnvst', exam: 'JNVST', titles: ['JNVST Class 6 Mock Test Series', 'JNVST Mental Ability Practice'], subjects: ['Reasoning', 'Maths', 'English'], marks: [1.25, 0], secPerQ: 60, hindi: true, price: [149, 299] },
    { path: 'entrance-exam/rimc', exam: 'RIMC', titles: ['RIMC Entrance Mock Test Series', 'RIMC Maths & GK Practice Pack'], subjects: ['Maths', 'General Knowledge', 'English'], marks: [1, 0], secPerQ: 60, hindi: true, price: [199, 399] },
    { path: 'entrance-exam/rms', exam: 'RMS', titles: ['RMS CET Mock Test Series', 'RMS Reasoning & Intelligence Pack'], subjects: ['Maths', 'English', 'Reasoning', 'General Knowledge'], marks: [1, 0], secPerQ: 60, hindi: true, price: [199, 399] },
    { path: 'entrance-exam/sainik', exam: 'AISSEE', titles: ['Sainik School AISSEE Mock Test Series', 'Sainik School Maths & Intelligence Pack'], subjects: ['Maths', 'Reasoning', 'General Knowledge', 'English'], marks: [3, 0], secPerQ: 60, hindi: true, price: [199, 399] },
    { path: 'defence', exam: 'Defence', titles: ['Defence Combo Mega Mock Pack (CDS + NDA + AFCAT)'], subjects: ['Maths', 'English', 'General Knowledge', 'Reasoning', 'Physics'], marks: [1, 0.33], secPerQ: 60, price: [699, 1499] },
    { path: 'upsc/prelims', exam: 'UPSC Prelims', titles: ['UPSC Prelims Complete Mock Series (GS + CSAT)'], subjects: [...GS, ...CSAT], marks: [2, 0.66], secPerQ: 72, price: [999, 1999] },
    { path: 'uppcs/prelims', exam: 'UPPCS', titles: ['UPPCS Prelims Complete Mock Series (GS-I + GS-II)'], subjects: [...GS, ...CSAT], marks: [2, 0.66], secPerQ: 72, price: [599, 1199] },
    { path: 'jee', exam: 'JEE', titles: ['JEE Complete Practice Bundle (Main + Advanced)'], subjects: ['Physics', 'Chemistry', 'Maths'], marks: [4, 1], secPerQ: 120, hindi: true, price: [899, 1799] },
];
const TEST_SHAPES = [
    { type: 'MINI', label: 'Mini Mock', count: 10 },
    { type: 'SECTIONAL', label: 'Sectional Test', count: 15 },
    { type: 'FULL_LENGTH', label: 'Full Mock Test', count: 25 },
];
async function categoryByPath(moduleType, p) {
    let parentId = null;
    let found = null;
    for (const s of p.split('/')) {
        found = await CategoryModel.findOne({ moduleType, parentId, slug: s });
        if (!found)
            throw new Error(`Category ${moduleType}:${p} not found - run "npm run seed" first`);
        parentId = found._id;
    }
    return found;
}
async function uniqueSlugFor(model, base) {
    let s = slug(base);
    let i = 2;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    while (await model.exists({ slug: s }))
        s = `${slug(base)}-${i++}`;
    return s;
}
// ------------------------------------------------------------------ PDFs
async function attachPdfs(testId, subtitle, withSolutions) {
    const test = await TestModel.findById(testId);
    if (!test)
        return;
    const questions = await QuestionModel.find({ _id: { $in: test.questionIds } }).lean();
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    const svg = (url) => readSvgIfLocal(url, uploadRoot(), env.PUBLIC_UPLOAD_BASE_URL);
    const paper = {
        title: test.title,
        subtitle,
        meta: `Questions: ${test.questionIds.length}   |   Time: ${Math.round(test.durationSeconds / 60)} minutes   |   Marks: +${test.marksPerCorrect} / -${test.negativeMarks} per question`,
        questions: test.questionIds
            .map((id) => byId.get(String(id)))
            .filter((q) => !!q)
            .map((q) => ({
            text: q.questionText,
            options: q.options.map((o) => o.text ?? ''),
            correct: Math.max(0, q.options.findIndex((o) => o.key === q.correctOption)),
            explanation: q.explanation ?? '',
            images: [q.imageUrl ?? '', ...(q.images ?? [])].filter(Boolean).map(svg).filter((x) => !!x),
        })),
    };
    const base = slug(test.title);
    test.questionPaperPdf = { ...(await storePdf(await questionPaperPdf(paper), `${base}-question-paper.pdf`)), uploadedAt: new Date() };
    if (withSolutions)
        test.solutionPdf = { ...(await storePdf(await solutionsPdf(paper), `${base}-solutions.pdf`)), uploadedAt: new Date() };
    await test.save();
}
// ------------------------------------------------------------------ main
async function main() {
    await connectDatabase();
    if (env.isProd && !args.has('--confirm')) {
        throw new Error('Refusing to touch a production database without --confirm');
    }
    const existing = await UserModel.exists({ normalizedEmail: SEEDER_EMAIL });
    if (args.has('--remove')) {
        await removeMock();
        return;
    }
    if (existing && !args.has('--reset')) {
        log('Mock data already exists. Re-run with --reset to recreate it, or --remove to delete it.');
        return;
    }
    if (existing)
        await removeMock();
    const rng = createRng(20270101);
    await seedCategories();
    const roots = await CategoryModel.find({ parentId: null, imageUrl: { $in: ['', null] } }).sort({ moduleType: 1, sortOrder: 1 });
    for (const [i, root] of roots.entries()) {
        root.imageUrl = await saveSvg('categories', categoryBadge(root.name, i));
        await root.save();
    }
    const seeder = await UserModel.create({
        name: 'Mock Data Seeder',
        email: SEEDER_EMAIL,
        normalizedEmail: SEEDER_EMAIL,
        passwordHash: await hashPassword(crypto.randomBytes(24).toString('hex')),
        role: 'admin',
        accountStatus: 'deactivated', // cannot sign in
    });
    log('Building question bank...');
    const bank = await buildQuestionBank(rng, seeder._id);
    const pick = poolPicker(bank, rng);
    log(`  ${bank.length} questions (${bank.filter((b) => b.hasImage).length} with images, ${bank.filter((b) => b.hasHindi).length} with Hindi)`);
    // ---------------- test series + tests
    log('Creating test series and tests...');
    const now = Date.now();
    let seriesIndex = 0;
    const createdTests = [];
    const paidSeries = [];
    for (const plan of PLANS) {
        const category = await categoryByPath('TEST_SERIES', plan.path);
        const categoryPath = [...category.ancestors, category._id];
        for (const [ti, title] of plan.titles.entries()) {
            const isPaid = plan.titles.length === 1 ? true : ti === 1;
            const price = isPaid ? plan.price[0] : 0;
            const languages = plan.hindi ? ['en', 'hi'] : ['en'];
            const idx = seriesIndex++;
            const series = await TestSeriesModel.create({
                title,
                slug: await uniqueSlugFor(TestSeriesModel, title),
                description: `${title} is designed as per the latest ${plan.exam} exam pattern. Every test comes with instant results, all-India rank, subject-wise analysis and detailed solutions so you can find and fix your weak areas.\n\nSubjects covered: ${[...new Set(plan.subjects)].join(', ')}.`,
                highlights: [
                    `${TEST_SHAPES.length} tests: mini, sectional and full-length`,
                    `${plan.marks[0]} mark(s) per correct answer${plan.marks[1] ? `, −${plan.marks[1]} per wrong answer` : ', no negative marking'}`,
                    'Detailed explanation for every question',
                    plan.hindi ? 'Available in English and Hindi' : 'Exam-level difficulty',
                ],
                moduleType: 'TEST_SERIES',
                categoryId: category._id,
                categoryPath,
                examName: plan.exam,
                subject: [...new Set(plan.subjects)].slice(0, 3).join(', '),
                coverImage: await saveSvg('covers', seriesCover(plan.exam, title, idx)),
                languageOptions: languages,
                accessType: isPaid ? 'paid' : 'free',
                price,
                mrp: isPaid ? plan.price[1] : 0,
                validityDays: isPaid ? 365 : 180,
                isFeatured: idx % 6 === 0,
                sortOrder: ti,
                publicationStatus: 'published',
                publishedAt: new Date(now - (60 - idx) * DAY),
                createdBy: seeder._id,
                updatedBy: seeder._id,
            });
            if (isPaid)
                paidSeries.push(series._id);
            for (const [si, shape] of TEST_SHAPES.entries()) {
                const n = si + 1;
                const testTitle = `${plan.exam} ${shape.label} ${n}${plan.titles.length > 1 ? ` – ${ti === 0 ? 'Set A' : 'Set B'}` : ''}`;
                const questionIds = pick(plan.subjects, shape.count, { preferHindi: plan.hindi });
                // A few variations so every feature can be tested.
                const upcoming = idx % 13 === 5 && si === 2;
                const afterWindow = idx % 11 === 3 && si === 1;
                const hidden = idx % 17 === 7 && si === 0;
                const test = await new TestModel({
                    title: testTitle,
                    slug: await uniqueSlugFor(TestModel, `${title}-${shape.label}-${n}`),
                    description: `${shape.count} questions • ${plan.exam} pattern`,
                    instructions: si === 2 ? 'This is a full-length mock. Attempt it in one sitting, exactly like the real exam.' : '',
                    moduleType: 'TEST_SERIES',
                    seriesId: series._id,
                    categoryId: category._id,
                    categoryPath,
                    testType: shape.type,
                    questionIds,
                    languageOptions: languages,
                    durationSeconds: Math.max(300, Math.round((shape.count * plan.secPerQ) / 60) * 60),
                    marksPerCorrect: plan.marks[0],
                    negativeMarks: plan.marks[1],
                    maxAttempts: si === 0 ? 0 : si === 1 ? 3 : 2,
                    isFree: isPaid && si === 0,
                    availableFrom: upcoming ? new Date(now + 3 * DAY) : null,
                    availableUntil: afterWindow ? new Date(now + 7 * DAY) : null,
                    randomizeQuestions: si === 2,
                    randomizeOptions: false,
                    resultVisibility: hidden ? 'HIDDEN' : afterWindow ? 'AFTER_WINDOW' : 'IMMEDIATE',
                    sortOrder: si,
                    publicationStatus: 'published',
                    publishedAt: new Date(now - (55 - idx) * DAY),
                    createdBy: seeder._id,
                    updatedBy: seeder._id,
                }).save();
                createdTests.push({ id: test._id, seriesId: series._id, accessType: isPaid ? 'paid' : 'free', isFree: isPaid && si === 0, upcoming });
                if (shape.type === 'FULL_LENGTH' && idx < 12)
                    await attachPdfs(test._id, `${title} • ${plan.exam} pattern`, true);
            }
        }
    }
    log(`  ${seriesIndex} series, ${createdTests.length} tests`);
    // ---------------- PYQ papers
    log('Creating PYQ papers...');
    const PYQ_SUBJECT_POOL = {
        maths: ['Maths'], biology: ['Biology'], chemistry: ['Chemistry'], physics: ['Physics'], history: ['History'],
        geography: ['Geography'], polity: ['Polity'], economics: ['Economics'], english: ['English'], computer: ['Computer'],
    };
    let papers = 0;
    for (const examSlug of ['nda', 'cds']) {
        const exam = await categoryByPath('PYQS', examSlug);
        const subjects = await CategoryModel.find({ parentId: exam._id }).sort({ sortOrder: 1 });
        for (const subject of subjects) {
            for (const year of [2024, 2023, 2022]) {
                const examName = exam.name;
                const title = `${examName} ${subject.name} Paper ${year} (Mock)`;
                const count = subject.slug === 'maths' ? 20 : 15;
                const pyqTest = await new TestModel({
                    title,
                    slug: await uniqueSlugFor(TestModel, title),
                    description: `Practice paper modelled on the ${examName} ${year} ${subject.name} section.`,
                    moduleType: 'PYQS',
                    seriesId: null,
                    categoryId: subject._id,
                    categoryPath: [...subject.ancestors, subject._id],
                    testType: 'PYQ_PAPER',
                    paperYear: year,
                    paperName: `${examName} (I) ${year}`,
                    questionIds: pick(PYQ_SUBJECT_POOL[subject.slug] ?? ['General Knowledge'], count, { preferHindi: subject.slug === 'maths' }),
                    languageOptions: subject.slug === 'maths' ? ['en', 'hi'] : ['en'],
                    durationSeconds: count * (examSlug === 'nda' ? 90 : 60),
                    marksPerCorrect: examSlug === 'nda' ? 2.5 : 1,
                    negativeMarks: examSlug === 'nda' ? 0.83 : 0.33,
                    maxAttempts: 0,
                    isFree: true,
                    resultVisibility: 'IMMEDIATE',
                    sortOrder: 2024 - year,
                    publicationStatus: 'published',
                    publishedAt: new Date(now - 40 * DAY),
                    createdBy: seeder._id,
                    updatedBy: seeder._id,
                }).save();
                createdTests.push({ id: pyqTest._id, seriesId: null, accessType: 'free', isFree: true, upcoming: false });
                await attachPdfs(pyqTest._id, `${examName} (I) ${year} • ${subject.name} • Mock practice paper`, true);
                papers++;
            }
        }
    }
    log(`  ${papers} PYQ papers`);
    // ---------------- students
    log('Creating students...');
    const NAMES = [
        'Aarav Sharma', 'Ananya Singh', 'Rohit Verma', 'Priya Yadav', 'Aditya Mishra', 'Sneha Gupta', 'Vikram Chauhan', 'Pooja Patel', 'Karan Mehta', 'Neha Tiwari',
        'Arjun Rathore', 'Kavya Nair', 'Rahul Pandey', 'Isha Joshi', 'Saurabh Dubey', 'Riya Kapoor', 'Manish Kumar', 'Divya Saxena', 'Harsh Agarwal', 'Shreya Bhatt',
        'Amit Rawat', 'Nikita Chaudhary', 'Deepak Thakur', 'Simran Kaur', 'Varun Malhotra', 'Anjali Srivastava', 'Gaurav Tripathi', 'Megha Rao', 'Ankit Shukla', 'Tanvi Desai',
        'Yash Bisht', 'Komal Jain', 'Abhishek Pathak', 'Swati Kulkarni', 'Nitin Bhardwaj', 'Ritika Sethi', 'Suraj Prajapati', 'Payal Goswami', 'Akash Negi', 'Shalini Dixit',
        'Mohit Rana', 'Aditi Kashyap', 'Prakash Meena', 'Sakshi Arora', 'Tarun Bansal', 'Muskan Khan', 'Vivek Upadhyay', 'Bhavna Solanki', 'Kunal Sinha', 'Jyoti Rajput',
    ];
    const passwordHash = await hashPassword(MOCK_STUDENT_PASSWORD);
    const students = await UserModel.insertMany(NAMES.map((name, i) => {
        const email = `student${String(i + 1).padStart(2, '0')}@${STUDENT_DOMAIN}`;
        return {
            name,
            email,
            normalizedEmail: email,
            mobile: `9${String(rng.int(100000000, 999999999))}`,
            passwordHash,
            role: 'student',
            accountStatus: i >= 48 ? 'suspended' : 'active',
            preferredLanguage: i % 4 === 0 ? 'hi' : 'en',
            emailVerifiedAt: new Date(now - rng.int(20, 60) * DAY),
            lastLoginAt: new Date(now - rng.int(0, 10) * DAY),
        };
    }));
    // Spread registration dates over the last two months.
    for (const s of students) {
        await UserModel.collection.updateOne({ _id: s._id }, { $set: { createdAt: new Date(now - rng.int(30, 60) * DAY) } });
    }
    // ---------------- enrolments + attempts
    log('Simulating attempts (this takes a minute)...');
    const attemptable = createdTests.filter((t) => !t.upcoming);
    let attempts = 0;
    let inProgress = 0;
    for (const [si, student] of students.entries()) {
        if (student.accountStatus !== 'active')
            continue;
        const sid = String(student._id);
        const skill = 0.35 + rng.next() * 0.55;
        // Some students bought / were granted paid series.
        const granted = new Set();
        if (si % 3 === 0) {
            for (const p of rng.shuffle(paidSeries).slice(0, rng.int(1, 3))) {
                await grantEnrollment({ studentId: student._id, seriesId: p, validityDays: 365, source: 'admin', grantedBy: seeder._id });
                granted.add(String(p));
            }
        }
        const candidates = rng.shuffle(attemptable).filter((t) => t.accessType === 'free' || t.isFree || (t.seriesId && granted.has(String(t.seriesId))));
        const chosen = candidates.slice(0, rng.int(4, 8));
        for (const [ci, t] of chosen.entries()) {
            if (t.seriesId && t.accessType === 'free') {
                await grantEnrollment({ studentId: student._id, seriesId: t.seriesId, validityDays: 180, source: 'free' }).catch(() => undefined);
            }
            const { attemptId } = await startAttempt(String(t.id), sid, student.preferredLanguage === 'hi' ? 'hi' : 'en');
            const attempt = await TestAttemptModel.findById(attemptId).select('+answerKeySnapshot');
            if (!attempt)
                continue;
            const key = new Map((attempt.answerKeySnapshot ?? []).map((k) => [String(k.questionId), k.correctOption]));
            const duration = attempt.testConfigurationSnapshot.durationSeconds;
            const taken = Math.round(duration * (0.45 + rng.next() * 0.5));
            const keepRunning = si % 16 === 1 && ci === 0; // a few live attempts for the dashboard
            const answers = attempt.persistedQuestionOrder.map((o) => {
                const correct = key.get(String(o.questionId));
                const attempted = rng.chance(keepRunning ? 0.4 : 0.88);
                const right = rng.chance(skill);
                const wrong = o.optionOrder.filter((k) => k !== correct);
                return {
                    questionId: String(o.questionId),
                    selectedOption: attempted ? (right ? correct : rng.pick(wrong)) : null,
                    markedForReview: rng.chance(0.08),
                    visited: true,
                    timeSpentDelta: Math.min(3600, Math.round(taken / attempt.persistedQuestionOrder.length)),
                };
            });
            await saveAnswers(attemptId, sid, answers);
            if (keepRunning) {
                inProgress++;
                continue;
            }
            await finalizeAttempt(attemptId, 'manual');
            // Move the attempt into the past so dashboards and charts show realistic history.
            const startedAt = new Date(now - rng.int(0, 29) * DAY - rng.int(1, 12) * 60 * 60 * 1000);
            const submittedAt = new Date(startedAt.getTime() + taken * 1000);
            await TestAttemptModel.collection.updateOne({ _id: attempt._id }, { $set: { startedAt, deadlineAt: new Date(startedAt.getTime() + duration * 1000), submittedAt, finalizedAt: submittedAt, createdAt: startedAt, updatedAt: submittedAt } });
            await ResultModel.collection.updateOne({ attemptId: attempt._id }, { $set: { evaluatedAt: submittedAt, timeTakenSeconds: taken, createdAt: submittedAt, updatedAt: submittedAt } });
            attempts++;
        }
    }
    log(`  ${attempts} evaluated attempts, ${inProgress} in progress`);
    // ---------------- sample spreadsheet import (shows up in Import history)
    log('Creating a sample bulk import...');
    const importRng = createRng(777);
    const rows = ['questionText,optionA,optionB,optionC,optionD,correctOption,explanation,subject,topic,difficulty,tags'];
    const csvEsc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    for (let i = 0; i < 60 && rows.length <= 50; i++) {
        const m = importRng.pick([...MATHS, ...REASONING])(importRng);
        if (m.image)
            continue;
        rows.push([m.q, ...m.options, KEYS[m.correct], m.explanation, m.subject, m.topic, m.difficulty, 'mock;imported'].map(csvEsc).join(','));
    }
    const job = await createImportJob({
        buffer: Buffer.from(rows.join('\n'), 'utf8'),
        fileName: 'mock-quant-reasoning-practice.csv',
        targetTestId: null,
        defaults: { subject: '', topic: '', sourceExam: '', sourceYear: null, language: 'en' },
        userId: seeder._id,
    });
    const committed = await commitImportJob(String(job._id), true, seeder._id);
    log(`  imported ${committed.importedCount} questions from CSV (${job.duplicateRows} duplicates skipped)`);
    // ---------------- link questions to the categories of their tests
    await backfillFromTests();
    // ---------------- banner + cache
    await SiteSettingModel.updateOne({ key: 'announcement' }, { $set: { value: 'Demo environment: all test series, questions and students shown here are mock data for testing.', isPublic: true } }, { upsert: true });
    const redis = getRedis();
    if (redis) {
        await new Promise((resolve) => {
            if (redis.status === 'ready')
                return resolve();
            redis.once('ready', () => resolve());
            setTimeout(resolve, 5000);
        });
        await redis.incr('ns:catalog:version').catch(() => undefined);
        await redis.incr('ns:settings:version').catch(() => undefined);
    }
    const totals = {
        questions: await QuestionModel.countDocuments({ createdBy: seeder._id }),
        questionsWithImages: await QuestionModel.countDocuments({ createdBy: seeder._id, imageUrl: { $ne: '' } }),
        testSeries: await TestSeriesModel.countDocuments({ createdBy: seeder._id }),
        tests: await TestModel.countDocuments({ createdBy: seeder._id, moduleType: 'TEST_SERIES' }),
        pyqPapers: await TestModel.countDocuments({ createdBy: seeder._id, moduleType: 'PYQS' }),
        questionsWithMultipleImages: await QuestionModel.countDocuments({ createdBy: seeder._id, 'images.0': { $exists: true } }),
        questionsWithExplanationImages: await QuestionModel.countDocuments({ createdBy: seeder._id, 'explanationImages.0': { $exists: true } }),
        testsWithPdfs: await TestModel.countDocuments({ createdBy: seeder._id, questionPaperPdf: { $ne: null } }),
        students: students.length,
        attempts: await TestAttemptModel.countDocuments({ studentId: { $in: students.map((s) => s._id) } }),
        results: await ResultModel.countDocuments({ studentId: { $in: students.map((s) => s._id) } }),
        enrollments: await EnrollmentModel.countDocuments({ studentId: { $in: students.map((s) => s._id) } }),
    };
    log('\nMock data ready:', totals);
    log(`Student logins: student01@${STUDENT_DOMAIN} … student50@${STUDENT_DOMAIN} / password ${MOCK_STUDENT_PASSWORD} (student49 and student50 are suspended)`);
}
main()
    .catch((err) => {
    console.error(err);
    process.exitCode = 1;
})
    .finally(async () => {
    await disconnectRedis();
    await disconnectDatabase();
});
//# sourceMappingURL=seedMockData.js.map