import { z } from 'zod';
import { ACCESS_TYPES, LANGUAGES, MODULE_TYPES, PUBLICATION_STATUSES } from '../types/enums.js';
import { booleanQuery, imageUrl, objectId, optionalDate, pageQuery, searchString } from './common.js';
const seriesBase = z.object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
    description: z.string().trim().max(10000).default(''),
    highlights: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
    moduleType: z.enum(MODULE_TYPES).default('TEST_SERIES'),
    categoryId: objectId,
    examName: z.string().trim().max(120).default(''),
    subject: z.string().trim().max(120).default(''),
    coverImage: imageUrl,
    languageOptions: z.array(z.enum(LANGUAGES)).min(1).max(2).default(['en']),
    accessType: z.enum(ACCESS_TYPES).default('free'),
    price: z.coerce.number().min(0).max(1000000).default(0),
    mrp: z.coerce.number().min(0).max(1000000).default(0),
    validityDays: z.coerce.number().int().min(1).max(3650).default(365),
    availableFrom: optionalDate,
    availableUntil: optionalDate,
    isFeatured: z.boolean().default(false),
    sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
    hi: z
        .object({
        title: z.string().trim().max(400).default(''),
        description: z.string().trim().max(15000).default(''),
        highlights: z.array(z.string().trim().min(1).max(400)).max(12).default([]),
    })
        .optional(),
    autoTranslate: z.boolean().optional(),
});
function refineSeries(schema) {
    return schema
        .refine((d) => d.accessType !== 'paid' || (d.price ?? 0) > 0, { message: 'Paid series must have a price greater than 0', path: ['price'] })
        .refine((d) => !d.availableFrom || !d.availableUntil || d.availableFrom < d.availableUntil, {
        message: 'Available until must be after available from',
        path: ['availableUntil'],
    });
}
export const createTestSeriesSchema = refineSeries(seriesBase);
export const updateTestSeriesSchema = refineSeries(seriesBase.partial());
export const publishSchema = z.object({
    publicationStatus: z.enum(PUBLICATION_STATUSES),
});
export const listSeriesAdminQuery = z.object({
    ...pageQuery,
    search: searchString,
    categoryId: objectId.optional(),
    moduleType: z.enum(MODULE_TYPES).optional(),
    status: z.enum(PUBLICATION_STATUSES).optional(),
});
export const listSeriesPublicQuery = z.object({
    ...pageQuery,
    search: searchString,
    category: z.string().trim().max(400).optional(), // category id
    accessType: z.enum(ACCESS_TYPES).optional(),
    featured: booleanQuery,
    moduleType: z.enum(MODULE_TYPES).default('TEST_SERIES'),
    sort: z.enum(['popular', 'newest', 'price_asc', 'price_desc']).default('popular'),
});
//# sourceMappingURL=testSeries.validator.js.map