import { z } from 'zod';
export const MAX_PAGE_SIZE = 100;
export const paginationQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export function pageParams(page = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
    const safePage = Math.max(1, page);
    return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}
export function buildMeta(page, limit, total) {
    return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
/** Escapes user input before using it inside a RegExp (prevents ReDoS / regex injection). */
export function escapeRegex(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=pagination.js.map