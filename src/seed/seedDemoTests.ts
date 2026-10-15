/**
 * OPTIONAL development data so the student flow can be tried end-to-end.
 * Everything created here is clearly labelled "Demo" and is NOT meant for production.
 * Run with: npm run seed:demo   (refuses to run when NODE_ENV=production unless --force)
 */
import { pathToFileURL } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { CategoryModel } from '../models/Category.model.js';
import { QuestionModel } from '../models/Question.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { questionContentHash } from '../utils/safeQuestion.js';
import { seedCategories } from './seedCategories.js';

type Q = { q: string; o: [string, string, string, string]; a: 'A' | 'B' | 'C' | 'D'; e: string; s: string; t: string };

const POLITY_GK: Q[] = [
  { q: 'Which Article of the Constitution of India provides for the Right to Constitutional Remedies?', o: ['Article 14', 'Article 21', 'Article 32', 'Article 368'], a: 'C', e: 'Article 32 allows a person to move the Supreme Court for the enforcement of Fundamental Rights.', s: 'Polity', t: 'Fundamental Rights' },
  { q: 'The Constitution of India was adopted by the Constituent Assembly on:', o: ['26 January 1950', '26 November 1949', '15 August 1947', '9 December 1946'], a: 'B', e: 'It was adopted on 26 November 1949 and came into force on 26 January 1950.', s: 'Polity', t: 'Constitution' },
  { q: 'Who presides over a joint sitting of both Houses of Parliament?', o: ['President of India', 'Vice-President of India', 'Speaker of the Lok Sabha', 'Prime Minister'], a: 'C', e: 'Under Article 118(4), the Speaker of the Lok Sabha presides over a joint sitting.', s: 'Polity', t: 'Parliament' },
  { q: 'The Fundamental Duties were added to the Constitution by which amendment?', o: ['42nd Amendment', '44th Amendment', '73rd Amendment', '86th Amendment'], a: 'A', e: 'The 42nd Amendment Act, 1976 added Part IV-A (Article 51A) on Fundamental Duties.', s: 'Polity', t: 'Fundamental Duties' },
  { q: 'Which river is known as the "Sorrow of Bihar"?', o: ['Ganga', 'Kosi', 'Son', 'Gandak'], a: 'B', e: 'The Kosi frequently changes course and causes severe floods in Bihar.', s: 'Geography', t: 'Rivers of India' },
  { q: 'The Tropic of Cancer does NOT pass through which of these states?', o: ['Rajasthan', 'Jharkhand', 'Odisha', 'Tripura'], a: 'C', e: 'The Tropic of Cancer passes through 8 states including Rajasthan, Jharkhand and Tripura, but not Odisha.', s: 'Geography', t: 'Indian Geography' },
  { q: 'Who founded the Indian National Congress in 1885?', o: ['A. O. Hume', 'Dadabhai Naoroji', 'W. C. Bonnerjee', 'Surendranath Banerjee'], a: 'A', e: 'Allan Octavian Hume, a retired British civil servant, founded the INC; W. C. Bonnerjee was its first president.', s: 'History', t: 'Modern India' },
  { q: 'The Battle of Plassey was fought in the year:', o: ['1757', '1764', '1857', '1707'], a: 'A', e: 'The Battle of Plassey was fought on 23 June 1757 between the East India Company and Siraj-ud-Daulah.', s: 'History', t: 'Modern India' },
  { q: 'Which gas is most abundant in the Earth\'s atmosphere?', o: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Argon'], a: 'C', e: 'Nitrogen makes up about 78% of the atmosphere by volume.', s: 'General Science', t: 'Atmosphere' },
  { q: 'The repo rate in India is determined by:', o: ['Ministry of Finance', 'Reserve Bank of India (Monetary Policy Committee)', 'SEBI', 'NITI Aayog'], a: 'B', e: 'The Monetary Policy Committee of the RBI sets the policy repo rate.', s: 'Economics', t: 'Monetary Policy' },
];

const MATHS: Q[] = [
  { q: 'If log₁₀ 2 = 0.3010, then log₁₀ 8 equals:', o: ['0.9030', '0.6020', '2.4080', '0.3010'], a: 'A', e: 'log 8 = 3 log 2 = 3 × 0.3010 = 0.9030.', s: 'Maths', t: 'Logarithms' },
  { q: 'The derivative of sin x with respect to x is:', o: ['−cos x', 'cos x', 'tan x', 'sec x'], a: 'B', e: 'd/dx (sin x) = cos x.', s: 'Maths', t: 'Differentiation' },
  { q: 'The number of diagonals in a hexagon is:', o: ['6', '9', '12', '15'], a: 'B', e: 'n(n − 3)/2 = 6 × 3 / 2 = 9.', s: 'Maths', t: 'Geometry' },
  { q: 'If A = {1, 2, 3} then the number of subsets of A is:', o: ['3', '6', '8', '9'], a: 'C', e: 'A set with n elements has 2ⁿ subsets: 2³ = 8.', s: 'Maths', t: 'Sets' },
  { q: 'The value of sin² θ + cos² θ is:', o: ['0', '1', '2', 'It depends on θ'], a: 'B', e: 'This is the fundamental Pythagorean identity.', s: 'Maths', t: 'Trigonometry' },
];

async function upsertQuestions(list: Q[], sourceExam: string) {
  const ids = [];
  for (const item of list) {
    const options = item.o.map((text, i) => ({ key: (['A', 'B', 'C', 'D'] as const)[i]!, text, imageUrl: '' }));
    const contentHash = questionContentHash({ questionText: item.q, options });
    const doc = await QuestionModel.findOneAndUpdate(
      { contentHash },
      {
        $setOnInsert: {
          questionText: item.q,
          options,
          correctOption: item.a,
          explanation: item.e,
          subject: item.s,
          topic: item.t,
          difficulty: 'medium',
          language: 'en',
          sourceExam,
          contentHash,
          isActive: true,
        },
      },
      { upsert: true, new: true },
    );
    ids.push(doc._id);
  }
  return ids;
}

async function category(moduleType: 'TEST_SERIES' | 'PYQS', slugs: string[]) {
  let parentId = null;
  let found = null;
  for (const slug of slugs) {
    found = await CategoryModel.findOne({ moduleType, parentId, slug });
    if (!found) throw new Error(`Category ${slugs.join('/')} not found - run the category seed first`);
    parentId = found._id;
  }
  return found!;
}

export async function seedDemo() {
  await seedCategories();

  const upscP1 = await category('TEST_SERIES', ['upsc', 'prelims', 'paper-i']);
  const series = await TestSeriesModel.findOneAndUpdate(
    { slug: 'demo-upsc-prelims-gs-practice' },
    {
      $setOnInsert: {
        title: 'Demo: UPSC Prelims GS Practice Series',
        slug: 'demo-upsc-prelims-gs-practice',
        description: 'A small free demo series to try the Civil Sansad exam engine. Replace it with real content from the admin panel.',
        highlights: ['Exam-like interface', 'Instant result & solutions', 'Negative marking as per UPSC'],
        moduleType: 'TEST_SERIES',
        categoryId: upscP1._id,
        categoryPath: [...upscP1.ancestors, upscP1._id],
        examName: 'UPSC CSE Prelims',
        subject: 'General Studies',
        languageOptions: ['en'],
        accessType: 'free',
        price: 0,
        validityDays: 365,
        publicationStatus: 'published',
        publishedAt: new Date(),
        isFeatured: true,
      },
    },
    { upsert: true, new: true },
  );

  const gsIds = await upsertQuestions(POLITY_GK, 'Demo');
  const existingTest = await TestModel.findOne({ slug: 'demo-gs-mini-mock-1' });
  if (!existingTest) {
    await new TestModel({
      title: 'Demo GS Mini Mock 1',
      slug: 'demo-gs-mini-mock-1',
      description: '10 questions on Polity, Geography, History, Science and Economy.',
      moduleType: 'TEST_SERIES',
      seriesId: series._id,
      categoryId: upscP1._id,
      categoryPath: [...upscP1.ancestors, upscP1._id],
      testType: 'MINI',
      questionIds: gsIds,
      durationSeconds: 15 * 60,
      marksPerCorrect: 2,
      negativeMarks: 0.66,
      maxAttempts: 3,
      isFree: true,
      resultVisibility: 'IMMEDIATE',
      publicationStatus: 'published',
      publishedAt: new Date(),
    }).save();
  }

  const ndaMaths = await category('PYQS', ['nda', 'maths']);
  const mathIds = await upsertQuestions(MATHS, 'Demo');
  if (!(await TestModel.exists({ slug: 'demo-nda-maths-practice-paper' }))) {
    await new TestModel({
      title: 'Demo NDA Maths Practice Paper',
      slug: 'demo-nda-maths-practice-paper',
      description: 'Sample paper to preview the PYQ module. Upload real previous year papers from the admin panel.',
      moduleType: 'PYQS',
      seriesId: null,
      categoryId: ndaMaths._id,
      categoryPath: [...ndaMaths.ancestors, ndaMaths._id],
      testType: 'PYQ_PAPER',
      paperName: 'Demo Paper',
      questionIds: mathIds,
      durationSeconds: 10 * 60,
      marksPerCorrect: 2.5,
      negativeMarks: 0.83,
      maxAttempts: 0,
      isFree: true,
      resultVisibility: 'IMMEDIATE',
      publicationStatus: 'published',
      publishedAt: new Date(),
    }).save();
  }
  console.log('Demo content ready: "Demo: UPSC Prelims GS Practice Series" and "Demo NDA Maths Practice Paper"');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (env.isProd && !process.argv.includes('--force')) {
    console.error('Refusing to seed demo content in production. Pass --force if you really want it.');
    process.exit(1);
  }
  connectDatabase()
    .then(seedDemo)
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(disconnectDatabase);
}
