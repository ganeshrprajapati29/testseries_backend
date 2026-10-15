import { CategoryModel } from '../models/Category.model.js';
import { EnrollmentModel } from '../models/Enrollment.model.js';
import { OrderModel } from '../models/Order.model.js';
import { QuestionModel } from '../models/Question.model.js';
import { ResultModel } from '../models/Result.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestAttemptModel } from '../models/TestAttempt.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { UserModel } from '../models/User.model.js';
import { DAY } from '../utils/dateTime.js';
import { round2 } from '../utils/scoring.js';
/** Admin dashboard - every number is computed from the database. */
export async function adminDashboard() {
    const since = new Date(Date.now() - 30 * DAY);
    const [students, newStudents, categories, series, publishedSeries, tests, publishedTests, pyqPapers, questions, attempts, activeAttempts, results30, revenue, enrollments, daily, topTests, recentResults,] = await Promise.all([
        UserModel.countDocuments({ role: 'student' }),
        UserModel.countDocuments({ role: 'student', createdAt: { $gte: since } }),
        CategoryModel.countDocuments({ status: { $ne: 'archived' } }),
        TestSeriesModel.countDocuments({ publicationStatus: { $ne: 'archived' } }),
        TestSeriesModel.countDocuments({ publicationStatus: 'published' }),
        TestModel.countDocuments({ moduleType: 'TEST_SERIES', publicationStatus: { $ne: 'archived' } }),
        TestModel.countDocuments({ publicationStatus: 'published' }),
        TestModel.countDocuments({ moduleType: 'PYQS', publicationStatus: { $ne: 'archived' } }),
        QuestionModel.countDocuments({ isActive: true }),
        TestAttemptModel.countDocuments(),
        TestAttemptModel.countDocuments({ status: 'IN_PROGRESS', deadlineAt: { $gt: new Date() } }),
        ResultModel.aggregate([
            { $match: { evaluatedAt: { $gte: since } } },
            { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$percentage' } } },
        ]),
        OrderModel.aggregate([{ $match: { orderStatus: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' }, n: { $sum: 1 } } }]),
        EnrollmentModel.countDocuments({ revokedAt: null }),
        TestAttemptModel.aggregate([
            { $match: { startedAt: { $gte: new Date(Date.now() - 14 * DAY) } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: 'Asia/Kolkata' } }, n: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]),
        ResultModel.aggregate([
            { $group: { _id: '$testId', title: { $last: '$testTitle' }, n: { $sum: 1 }, avg: { $avg: '$percentage' } } },
            { $sort: { n: -1 } },
            { $limit: 5 },
        ]),
        ResultModel.find().select('-grades').populate('studentId', 'name email').sort({ evaluatedAt: -1 }).limit(8).lean(),
    ]);
    // Fill missing days so the chart has a continuous 14-day axis.
    const byDay = new Map(daily.map((d) => [d._id, d.n]));
    const attemptsByDay = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(Date.now() - (13 - i) * DAY);
        const key = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        return { date: key, attempts: byDay.get(key) ?? 0 };
    });
    return {
        counts: {
            students,
            newStudents30d: newStudents,
            categories,
            series,
            publishedSeries,
            tests,
            publishedTests,
            pyqPapers,
            questions,
            attempts,
            activeAttempts,
            enrollments,
            results30d: results30[0]?.n ?? 0,
            averagePercentage30d: round2(results30[0]?.avg ?? 0),
            paidOrders: revenue[0]?.n ?? 0,
            revenueInPaise: revenue[0]?.total ?? 0,
        },
        attemptsByDay,
        topTests: topTests.map((t) => ({ testId: String(t._id), title: t.title, attempts: t.n, averagePercentage: round2(t.avg) })),
        recentResults,
    };
}
//# sourceMappingURL=analytics.service.js.map