import { Types } from 'mongoose';
import { withTransaction } from '../config/database.js';
import { CategoryModel } from '../models/Category.model.js';
import { EnrollmentModel } from '../models/Enrollment.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { ApiError } from '../utils/ApiError.js';
import { buildMeta, escapeRegex, pageParams } from '../utils/pagination.js';
import { uniqueSlug } from '../utils/slugify.js';
import { activeEnrollment, grantEnrollment, hasSeriesAccess } from './access.service.js';
import { categoryPathFor } from './category.service.js';
const slugExists = (slug) => TestSeriesModel.exists({ slug }).then(Boolean);
function publishedWindowFilter(now = new Date()) {
    return {
        publicationStatus: 'published',
        $and: [
            { $or: [{ availableFrom: null }, { availableFrom: { $lte: now } }] },
            { $or: [{ availableUntil: null }, { availableUntil: { $gte: now } }] },
        ],
    };
}
async function publishedTestCounts(seriesIds) {
    const counts = await TestModel.aggregate([
        { $match: { seriesId: { $in: seriesIds }, publicationStatus: 'published' } },
        { $group: { _id: '$seriesId', count: { $sum: 1 }, free: { $sum: { $cond: ['$isFree', 1, 0] } } } },
    ]);
    return new Map(counts.map((c) => [String(c._id), { count: c.count, free: c.free }]));
}
// ---------------------------------------------------------------- admin
export async function adminListSeries(q) {
    const { page, limit, skip } = pageParams(q.page, q.limit);
    const filter = {};
    if (q.search)
        filter.title = { $regex: escapeRegex(q.search), $options: 'i' };
    if (q.categoryId)
        filter.categoryPath = new Types.ObjectId(q.categoryId);
    if (q.moduleType)
        filter.moduleType = q.moduleType;
    filter.publicationStatus = q.status ?? { $ne: 'archived' };
    const [items, total] = await Promise.all([
        TestSeriesModel.find(filter).populate('categoryId', 'name slug').sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
        TestSeriesModel.countDocuments(filter),
    ]);
    const testCounts = await TestModel.aggregate([
        { $match: { seriesId: { $in: items.map((i) => i._id) }, publicationStatus: { $ne: 'archived' } } },
        { $group: { _id: '$seriesId', count: { $sum: 1 } } },
    ]);
    const enrollCounts = await EnrollmentModel.aggregate([
        { $match: { testSeriesId: { $in: items.map((i) => i._id) }, revokedAt: null } },
        { $group: { _id: '$testSeriesId', count: { $sum: 1 } } },
    ]);
    const tc = new Map(testCounts.map((c) => [String(c._id), c.count]));
    const ec = new Map(enrollCounts.map((c) => [String(c._id), c.count]));
    return {
        items: items.map((i) => ({ ...i, testCount: tc.get(String(i._id)) ?? 0, enrollmentCount: ec.get(String(i._id)) ?? 0 })),
        meta: buildMeta(page, limit, total),
    };
}
export async function adminGetSeries(id) {
    const series = await TestSeriesModel.findById(id).populate('categoryId', 'name slug moduleType').lean();
    if (!series)
        throw ApiError.notFound('Test series not found');
    const tests = await TestModel.find({ seriesId: series._id, publicationStatus: { $ne: 'archived' } })
        .select('-questionIds')
        .sort({ sortOrder: 1, createdAt: 1 })
        .lean();
    const questionCounts = await TestModel.aggregate([
        { $match: { seriesId: series._id } },
        { $project: { n: { $size: '$questionIds' } } },
    ]);
    const qc = new Map(questionCounts.map((q) => [String(q._id), q.n]));
    return { ...series, tests: tests.map((t) => ({ ...t, questionCount: qc.get(String(t._id)) ?? 0 })) };
}
export async function createSeries(input, userId) {
    const { category, path } = await categoryPathFor(input.categoryId);
    if (category.moduleType !== input.moduleType) {
        throw ApiError.validation([{ path: 'body.categoryId', message: 'Category belongs to a different module' }]);
    }
    const slug = await uniqueSlug(input.title, slugExists);
    return TestSeriesModel.create({
        ...input,
        price: input.accessType === 'paid' ? input.price : 0,
        slug,
        categoryPath: path,
        publicationStatus: 'draft',
        createdBy: userId,
        updatedBy: userId,
    });
}
export async function updateSeries(id, input, userId) {
    const series = await TestSeriesModel.findById(id);
    if (!series)
        throw ApiError.notFound('Test series not found');
    if (input.categoryId && String(input.categoryId) !== String(series.categoryId)) {
        const { category, path } = await categoryPathFor(input.categoryId);
        if (category.moduleType !== (input.moduleType ?? series.moduleType)) {
            throw ApiError.validation([{ path: 'body.categoryId', message: 'Category belongs to a different module' }]);
        }
        series.categoryPath = path;
    }
    const accessType = input.accessType ?? series.accessType;
    const price = input.price ?? series.price ?? 0;
    if (accessType === 'paid' && price <= 0) {
        throw ApiError.validation([{ path: 'body.price', message: 'Paid series must have a price greater than 0' }]);
    }
    series.set({ ...input, price: accessType === 'paid' ? price : 0, updatedBy: userId });
    await series.save();
    return series;
}
export async function setSeriesPublication(id, status, userId) {
    const series = await TestSeriesModel.findById(id);
    if (!series)
        throw ApiError.notFound('Test series not found');
    if (status === 'published') {
        const category = await CategoryModel.findById(series.categoryId).lean();
        if (!category || category.status !== 'active') {
            throw ApiError.badRequest('The series category is inactive or archived. Activate it before publishing.');
        }
        if (series.accessType === 'paid' && (series.price ?? 0) <= 0)
            throw ApiError.badRequest('Set a price before publishing a paid series');
        series.publishedAt = series.publishedAt ?? new Date();
    }
    series.publicationStatus = status;
    series.updatedBy = userId;
    await series.save();
    return series;
}
/** Duplicates a series and its tests as drafts. Questions are referenced, never copied. */
export async function duplicateSeries(id, userId) {
    return withTransaction(async (session) => {
        const source = await TestSeriesModel.findById(id).session(session ?? null).lean();
        if (!source)
            throw ApiError.notFound('Test series not found');
        const { _id, createdAt: _c, updatedAt: _u, publishedAt: _p, ...rest } = source;
        void _id;
        const title = `${source.title} (Copy)`.slice(0, 200);
        const [copy] = await TestSeriesModel.create([{ ...rest, title, slug: await uniqueSlug(title, slugExists), publicationStatus: 'draft', isFeatured: false, createdBy: userId, updatedBy: userId }], { session });
        const tests = await TestModel.find({ seriesId: source._id, publicationStatus: { $ne: 'archived' } }).session(session ?? null).lean();
        for (const t of tests) {
            const { _id: tid, createdAt: _tc, updatedAt: _tu, publishedAt: _tp, ...trest } = t;
            void tid;
            await TestModel.create([
                {
                    ...trest,
                    seriesId: copy._id,
                    slug: await uniqueSlug(t.title, (s) => TestModel.exists({ slug: s }).then(Boolean)),
                    publicationStatus: 'draft',
                    createdBy: userId,
                    updatedBy: userId,
                },
            ], { session });
        }
        return copy;
    });
}
/** Deletes a series without attempts; otherwise archives it to preserve history. */
export async function removeSeries(id, userId) {
    const series = await TestSeriesModel.findById(id);
    if (!series)
        throw ApiError.notFound('Test series not found');
    const [attempts, enrollments] = await Promise.all([
        TestAttemptModel.countDocuments({ seriesId: series._id }),
        EnrollmentModel.countDocuments({ testSeriesId: series._id }),
    ]);
    if (attempts || enrollments) {
        series.publicationStatus = 'archived';
        series.updatedBy = userId;
        await series.save();
        await TestModel.updateMany({ seriesId: series._id }, { publicationStatus: 'archived' });
        return { archived: true };
    }
    await TestModel.deleteMany({ seriesId: series._id });
    await series.deleteOne();
    return { archived: false };
}
// ---------------------------------------------------------------- public
export async function publicListSeries(q, studentId) {
    const { page, limit, skip } = pageParams(q.page, q.limit);
    const filter = { ...publishedWindowFilter(), moduleType: q.moduleType };
    if (q.search)
        filter.title = { $regex: escapeRegex(q.search), $options: 'i' };
    if (q.category) {
        if (!/^[a-f\d]{24}$/i.test(q.category))
            throw ApiError.badRequest('Invalid category');
        filter.categoryPath = new Types.ObjectId(q.category);
    }
    if (q.accessType)
        filter.accessType = q.accessType;
    if (q.featured !== undefined)
        filter.isFeatured = q.featured;
    const sort = q.sort === 'newest'
        ? { publishedAt: -1 }
        : q.sort === 'price_asc'
            ? { price: 1, sortOrder: 1 }
            : q.sort === 'price_desc'
                ? { price: -1, sortOrder: 1 }
                : { isFeatured: -1, sortOrder: 1, publishedAt: -1 };
    const [items, total] = await Promise.all([
        TestSeriesModel.find(filter)
            .select('-createdBy -updatedBy -categoryPath')
            .populate('categoryId', 'name slug')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        TestSeriesModel.countDocuments(filter),
    ]);
    const counts = await publishedTestCounts(items.map((i) => i._id));
    let enrolledIds = new Set();
    if (studentId) {
        const enrollments = await EnrollmentModel.find({
            studentId,
            testSeriesId: { $in: items.map((i) => i._id) },
            revokedAt: null,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        }).lean();
        enrolledIds = new Set(enrollments.map((e) => String(e.testSeriesId)));
    }
    return {
        items: items.map((s) => ({
            ...s,
            testCount: counts.get(String(s._id))?.count ?? 0,
            freeTestCount: counts.get(String(s._id))?.free ?? 0,
            isEnrolled: enrolledIds.has(String(s._id)),
        })),
        meta: buildMeta(page, limit, total),
    };
}
export async function publicSeriesDetail(slug, studentId) {
    const series = await TestSeriesModel.findOne({ slug, ...publishedWindowFilter() })
        .select('-createdBy -updatedBy')
        .populate('categoryId', 'name slug')
        .lean();
    if (!series)
        throw ApiError.notFound('Test series not found');
    const tests = await TestModel.aggregate([
        { $match: { seriesId: series._id, publicationStatus: 'published' } },
        { $sort: { sortOrder: 1, createdAt: 1 } },
        {
            $project: {
                title: 1,
                slug: 1,
                description: 1,
                testType: 1,
                durationSeconds: 1,
                marksPerCorrect: 1,
                negativeMarks: 1,
                totalMarks: 1,
                maxAttempts: 1,
                isFree: 1,
                availableFrom: 1,
                availableUntil: 1,
                languageOptions: 1,
                paperYear: 1,
                questionCount: { $size: '$questionIds' },
            },
        },
    ]);
    const hasAccess = studentId ? await hasSeriesAccess(studentId, series) : series.accessType === 'free';
    const enrollment = studentId ? await activeEnrollment(studentId, series._id) : null;
    let attemptsByTest = new Map();
    if (studentId) {
        const attempts = await TestAttemptModel.find({ studentId, testId: { $in: tests.map((t) => t._id) } })
            .select('testId status createdAt')
            .sort({ createdAt: 1 })
            .lean();
        attemptsByTest = new Map();
        for (const a of attempts) {
            const key = String(a.testId);
            const cur = attemptsByTest.get(key) ?? { attempts: 0, inProgressAttemptId: null, lastAttemptId: null };
            cur.attempts += 1;
            if (a.status === 'IN_PROGRESS')
                cur.inProgressAttemptId = String(a._id);
            else
                cur.lastAttemptId = String(a._id);
            attemptsByTest.set(key, cur);
        }
    }
    // Build breadcrumb from the category path.
    const chain = await CategoryModel.find({ _id: { $in: series.categoryPath } }).select('name slug depth').sort({ depth: 1 }).lean();
    let acc = '';
    const breadcrumb = chain.map((c) => {
        acc = acc ? `${acc}/${c.slug}` : c.slug;
        return { _id: String(c._id), name: c.name, slug: c.slug, path: acc };
    });
    return {
        ...series,
        categoryPath: undefined,
        breadcrumb,
        hasAccess,
        isEnrolled: !!enrollment,
        enrollmentExpiresAt: enrollment?.expiresAt ?? null,
        tests: tests.map((t) => ({
            ...t,
            locked: !hasAccess && !t.isFree,
            myAttempts: attemptsByTest.get(String(t._id)) ?? { attempts: 0, inProgressAttemptId: null, lastAttemptId: null },
        })),
    };
}
/** Free series: adds the series to "My Tests". Paid series must go through payment. */
export async function enrollFree(seriesId, studentId) {
    const series = await TestSeriesModel.findOne({ _id: seriesId, publicationStatus: 'published' }).lean();
    if (!series)
        throw ApiError.notFound('Test series not found');
    if (series.accessType === 'paid')
        throw ApiError.paymentRequired('This is a paid test series. Please purchase it to enrol.');
    const existing = await activeEnrollment(studentId, series._id);
    if (existing)
        return existing;
    return grantEnrollment({ studentId, seriesId: series._id, validityDays: series.validityDays ?? 365, source: 'free' });
}
export async function featuredAndStats() {
    const now = new Date();
    const published = publishedWindowFilter(now);
    const [seriesCount, testCount, pyqPaperCount, featured] = await Promise.all([
        TestSeriesModel.countDocuments({ ...published, moduleType: 'TEST_SERIES' }),
        TestModel.countDocuments({ publicationStatus: 'published', moduleType: 'TEST_SERIES' }),
        TestModel.countDocuments({ publicationStatus: 'published', moduleType: 'PYQS' }),
        TestSeriesModel.find({ ...published, moduleType: 'TEST_SERIES' })
            .select('title slug description coverImage accessType price mrp examName languageOptions isFeatured categoryId validityDays')
            .populate('categoryId', 'name slug')
            .sort({ isFeatured: -1, sortOrder: 1, publishedAt: -1 })
            .limit(6)
            .lean(),
    ]);
    const questionAgg = await TestModel.aggregate([
        { $match: { publicationStatus: 'published' } },
        { $unwind: '$questionIds' },
        { $group: { _id: '$questionIds' } },
        { $count: 'n' },
    ]);
    const counts = await publishedTestCounts(featured.map((f) => f._id));
    return {
        stats: { seriesCount, testCount, pyqPaperCount, questionCount: questionAgg[0]?.n ?? 0 },
        featured: featured.map((f) => ({ ...f, testCount: counts.get(String(f._id))?.count ?? 0, freeTestCount: counts.get(String(f._id))?.free ?? 0 })),
    };
}
//# sourceMappingURL=testSeries.service.js.map