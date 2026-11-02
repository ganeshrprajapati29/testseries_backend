import type { Request, Response } from 'express';
import * as categoryService from '../services/category.service.js';
import { audit } from '../services/audit.service.js';
import { cached } from '../services/cache.service.js';
import { ApiError } from '../utils/ApiError.js';
import { created, noContent, ok } from '../utils/ApiResponse.js';
import type { ModuleType } from '../types/enums.js';

// ---------- public
export async function publicTree(req: Request, res: Response) {
  const { moduleType } = req.query as unknown as { moduleType: ModuleType };
  return ok(res, await cached('catalog', `categories:tree:${moduleType}`, 300, () => categoryService.getPublicTree(moduleType)));
}

export async function resolve(req: Request, res: Response) {
  const moduleType = (req.query.moduleType as ModuleType) ?? 'TEST_SERIES';
  const path = String(req.params.path ?? req.query.path ?? '');
  if (!path) throw ApiError.badRequest('Category path is required');
  return ok(res, await cached('catalog', `categories:resolve:${moduleType}:${path.toLowerCase()}`, 300, () => categoryService.resolvePath(moduleType, path)));
}

// ---------- admin
export async function adminTree(req: Request, res: Response) {
  const { moduleType, includeArchived } = req.query as { moduleType?: ModuleType; includeArchived?: string };
  return ok(res, await categoryService.getAdminTree(moduleType, includeArchived === 'true'));
}

export async function create(req: Request, res: Response) {
  const category = await categoryService.createCategory(req.body);
  await audit(req, { action: 'category.create', entityType: 'Category', entityId: category.id, summary: `Created category "${category.name}"` });
  return created(res, category);
}

export async function update(req: Request, res: Response) {
  const category = await categoryService.updateCategory(String(req.params.id), req.body);
  await audit(req, { action: 'category.update', entityType: 'Category', entityId: category.id, summary: `Updated category "${category.name}"`, metadata: { changes: req.body } });
  return ok(res, category, 'Category updated');
}

export async function reorder(req: Request, res: Response) {
  await categoryService.reorderCategories(req.body.items);
  await audit(req, { action: 'category.reorder', entityType: 'Category', summary: `Reordered ${req.body.items.length} categories` });
  return ok(res, null, 'Order saved');
}

export async function activate(req: Request, res: Response) {
  const category = await categoryService.setCategoryActive(String(req.params.id), true);
  await audit(req, { action: 'category.activate', entityType: 'Category', entityId: category.id, summary: `Activated "${category.name}"` });
  return ok(res, category, 'Category activated');
}

export async function deactivate(req: Request, res: Response) {
  const category = await categoryService.setCategoryActive(String(req.params.id), false);
  await audit(req, { action: 'category.deactivate', entityType: 'Category', entityId: category.id, summary: `Deactivated "${category.name}"` });
  return ok(res, category, 'Category deactivated');
}

export async function archive(req: Request, res: Response) {
  const result = await categoryService.archiveCategory(String(req.params.id));
  await audit(req, { action: 'category.archive', entityType: 'Category', entityId: String(req.params.id), metadata: result });
  return ok(res, result, 'Category archived');
}

export async function restore(req: Request, res: Response) {
  const category = await categoryService.restoreCategory(String(req.params.id));
  await audit(req, { action: 'category.restore', entityType: 'Category', entityId: category.id, summary: `Restored "${category.name}"` });
  return ok(res, category, 'Category restored (inactive)');
}

export async function remove(req: Request, res: Response) {
  await categoryService.deleteCategory(String(req.params.id));
  await audit(req, { action: 'category.delete', entityType: 'Category', entityId: String(req.params.id) });
  return noContent(res);
}
