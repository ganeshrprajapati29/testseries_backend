import { describe, expect, it } from 'vitest';
import { CategoryModel } from '../models/Category.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { seedCategories } from '../seed/seedCategories.js';
import { adminClient, client } from './helpers.js';

describe('categories', () => {
  it('seeds the initial hierarchy idempotently', async () => {
    const first = await seedCategories();
    const second = await seedCategories();
    expect(first.created).toBe(54);
    expect(second.created).toBe(0);
    expect(await CategoryModel.countDocuments()).toBe(54);

    const cds = await CategoryModel.findOne({ moduleType: 'TEST_SERIES', slug: 'cds' });
    const cdsChildren = await CategoryModel.find({ parentId: cds!._id }).sort({ sortOrder: 1 });
    expect(cdsChildren.map((c) => c.name)).toEqual(['GK', 'English', 'Maths']);
  });

  it('serves a public tree and resolves slug paths', async () => {
    await seedCategories();
    const c = await client();
    const tree = await c.get('/api/categories?moduleType=TEST_SERIES');
    expect(tree.status).toBe(200);
    expect(tree.body.data.map((n: { name: string }) => n.name)).toContain('UPPCS');

    const resolved = await c.get('/api/categories/resolve?moduleType=TEST_SERIES&path=defence/nda');
    expect(resolved.body.data.category.name).toBe('NDA');
    expect(resolved.body.data.breadcrumb.map((b: { name: string }) => b.name)).toEqual(['Defence', 'NDA']);
    expect(resolved.body.data.children.map((b: { name: string }) => b.name)).toEqual(['Maths', 'GAT']);
  });

  it('lets an admin create, rename, move, deactivate and reorder categories', async () => {
    const admin = await adminClient();
    const parent = (await admin.post('/api/admin/categories', { name: 'SSC', moduleType: 'TEST_SERIES' })).body.data;
    const child = await admin.post('/api/admin/categories', { name: 'CGL', moduleType: 'TEST_SERIES', parentId: parent._id });
    expect(child.status).toBe(201);
    expect(child.body.data.depth).toBe(1);

    const dup = await admin.post('/api/admin/categories', { name: 'CGL', moduleType: 'TEST_SERIES', parentId: parent._id });
    expect(dup.status).toBe(409);

    const other = (await admin.post('/api/admin/categories', { name: 'Banking', moduleType: 'TEST_SERIES' })).body.data;
    const moved = await admin.patch(`/api/admin/categories/${child.body.data._id}`, { parentId: other._id, name: 'CGL Tier 1' });
    expect(moved.status).toBe(200);
    expect(moved.body.data.ancestors).toEqual([other._id]);

    // Cannot move a category under its own descendant.
    const cycle = await admin.patch(`/api/admin/categories/${other._id}`, { parentId: child.body.data._id });
    expect(cycle.status).toBe(400);

    expect((await admin.post(`/api/admin/categories/${parent._id}/deactivate`)).body.data.isActive).toBe(false);
    const publicTree = await admin.get('/api/categories?moduleType=TEST_SERIES');
    expect(publicTree.body.data.map((n: { name: string }) => n.name)).not.toContain('SSC');

    const reorder = await admin.put('/api/admin/categories/reorder', { items: [{ id: other._id, sortOrder: 5 }] });
    expect(reorder.status).toBe(200);
  });

  it('prevents archiving or deleting categories with active content', async () => {
    const admin = await adminClient();
    const cat = (await admin.post('/api/admin/categories', { name: 'UPSC', moduleType: 'TEST_SERIES' })).body.data;
    await TestSeriesModel.create({ title: 'Live series', slug: 'live', categoryId: cat._id, categoryPath: [cat._id], publicationStatus: 'published' });

    const archive = await admin.post(`/api/admin/categories/${cat._id}/archive`);
    expect(archive.status).toBe(409);
    expect(archive.body.error.code).toBe('CATEGORY_IN_USE');
    expect((await admin.del(`/api/admin/categories/${cat._id}`)).status).toBe(409);

    await TestSeriesModel.updateMany({}, { publicationStatus: 'unpublished' });
    expect((await admin.post(`/api/admin/categories/${cat._id}/archive`)).status).toBe(200);
  });
});
