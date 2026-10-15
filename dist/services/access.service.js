import { EnrollmentModel } from '../models/Enrollment.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { DAY } from '../utils/dateTime.js';
export async function activeEnrollment(studentId, seriesId) {
    return EnrollmentModel.findOne({
        studentId,
        testSeriesId: seriesId,
        revokedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).lean();
}
/** Free series are open to every logged-in student; paid series need an active enrolment. */
export async function hasSeriesAccess(studentId, series) {
    if (series.accessType !== 'paid')
        return true;
    if (!studentId)
        return false;
    return !!(await activeEnrollment(studentId, series._id));
}
export async function hasTestAccess(studentId, test) {
    if (test.isFree || !test.seriesId)
        return true;
    const series = await TestSeriesModel.findById(test.seriesId, { accessType: 1 }).lean();
    if (!series)
        return false;
    return hasSeriesAccess(studentId, series);
}
/** Creates or extends an enrolment (purchase or admin grant). */
export async function grantEnrollment(params) {
    const existing = await EnrollmentModel.findOne({ studentId: params.studentId, testSeriesId: params.seriesId }).session(params.session ?? null);
    const base = existing?.expiresAt && existing.expiresAt > new Date() && !existing.revokedAt ? existing.expiresAt : new Date();
    const expiresAt = new Date(base.getTime() + params.validityDays * DAY);
    return EnrollmentModel.findOneAndUpdate({ studentId: params.studentId, testSeriesId: params.seriesId }, {
        $set: {
            source: params.source,
            orderId: params.orderId ?? existing?.orderId ?? null,
            grantedBy: params.grantedBy ?? null,
            expiresAt,
            revokedAt: null,
        },
    }, { upsert: true, new: true, session: params.session });
}
//# sourceMappingURL=access.service.js.map