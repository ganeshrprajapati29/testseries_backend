export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** Grace period for network latency when an answer or submission arrives right at the deadline. */
export const SUBMISSION_GRACE_MS = 10 * SECOND;
export function addMs(date, ms) {
    return new Date(date.getTime() + ms);
}
export function secondsBetween(from, to) {
    return Math.max(0, Math.round((to.getTime() - from.getTime()) / SECOND));
}
export function isWithinWindow(now, from, until) {
    if (from && now < from)
        return false;
    if (until && now > until)
        return false;
    return true;
}
//# sourceMappingURL=dateTime.js.map