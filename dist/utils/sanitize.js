/**
 * Question and description content is rendered by React as plain text (never as raw HTML),
 * so here we only normalise whitespace and strip control characters and tags that might
 * arrive from spreadsheet imports.
 */
export function cleanText(input) {
    if (input === null || input === undefined)
        return '';
    return String(input)
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/<\s*\/?\s*(script|style|iframe|object|embed)[^>]*>/gi, '')
        .replace(/\r\n/g, '\n')
        .trim();
}
export function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
/** Strips keys starting with `$` or containing `.` from user supplied objects (NoSQL injection guard). */
export function stripMongoOperators(value) {
    if (Array.isArray(value))
        return value.map((v) => stripMongoOperators(v));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (k.startsWith('$') || k.includes('.'))
                continue;
            out[k] = stripMongoOperators(v);
        }
        return out;
    }
    return value;
}
//# sourceMappingURL=sanitize.js.map