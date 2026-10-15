import { z } from 'zod';
import { CATEGORY_STATUSES, MODULE_TYPES } from '../types/enums.js';
import { objectId, optionalObjectId } from './common.js';

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]*$/, 'Slug may contain only lowercase letters, numbers and hyphens')
    .max(100)
    .optional(),
  moduleType: z.enum(MODULE_TYPES),
  parentId: optionalObjectId,
  description: z.string().trim().max(2000).default(''),
  icon: z.string().trim().max(60).default(''),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'Slug may contain only lowercase letters, numbers and hyphens')
    .max(100)
    .optional(),
  parentId: optionalObjectId,
  description: z.string().trim().max(2000).optional(),
  icon: z.string().trim().max(60).optional(),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
});

export const reorderCategoriesSchema = z.object({
  items: z.array(z.object({ id: objectId, sortOrder: z.number().int().min(0).max(100000) })).min(1).max(500),
});

export const listCategoriesQuery = z.object({
  moduleType: z.enum(MODULE_TYPES).optional(),
  status: z.enum(CATEGORY_STATUSES).optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

export const publicCategoryQuery = z.object({
  moduleType: z.enum(MODULE_TYPES).default('TEST_SERIES'),
});
