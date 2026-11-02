import { Types } from 'mongoose';
import { withTransaction } from '../config/database.js';
import { CategoryModel } from '../models/Category.model.js';
import { TestModel } from '../models/Test.model.js';
import { TestSeriesModel } from '../models/TestSeries.model.js';
import { ApiError } from '../utils/ApiError.js';
import { QuestionModel } from '../models/Question.model.js';
import { questionCountsByCategory, recomputeQuestionPaths } from './questionCategory.service.js';
import { slugify } from '../utils/slugify.js';
export const MAX_CATEGORY_DEPTH = 4;
export function buildTree(categories) {
    const byId = new Map();
    const sorted = [...categories].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    for (const c of sorted) {
        byId.set(String(c._id), {
            _id: String(c._id),
            name: c.name,
            slug: c.slug,
            moduleType: c.moduleType,
            parentId: c.parentId ? String(c.parentId) : null,
            depth: c.depth,
            description: c.description ?? '',
            icon: c.icon ?? '',
            imageUrl: c.imageUrl ?? '',
            sortOrder: c.sortOrder ?? 0,
            isActive: c.isActive ?? true,
            status: c.status ?? 'active',
            path: '',
            children: [],
        });
    }
    const roots = [];
    for (const node of byId.values()) {
        const parent = node.parentId ? byId.get(node.parentId) : undefined;
        if (parent)
            parent.children.push(node);
        else if (!node.parentId)
            roots.push(node);
        // Nodes whose parent is filtered out (inactive/archived) are dropped from public trees.
    }
    const assignPath = (nodes, prefix) => {
        for (const n of nodes) {
            n.path = prefix ? `${prefix}/${n.slug}` : n.slug;
            assignPath(n.children, n.path);
        }
    };
    assignPath(roots, '');
    return roots;
}
export async function getAdminTree(moduleType, includeArchived = false) {
    const filter = {};
    if (moduleType)
        filter.moduleType = moduleType;
    if (!includeArchived)
        filter.status = { $ne: 'archived' };
    const categories = await CategoryModel.find(filter).lean();
    const [seriesCounts, testCounts] = await Promise.all([
        TestSeriesModel.aggregate([
            { $match: { publicationStatus: { $ne: 'archived' } } },
            { $group: { _id: '$categoryId', count: { $sum: 1 } } },
        ]),
        TestModel.aggregate([
            { $match: { publicationStatus: { $ne: 'archived' } } },
            { $group: { _id: '$categoryId', count: { $sum: 1 } } },
        ]),
    ]);
    const { counts: qMap } = await questionCountsByCategory();
    const sMap = new Map(seriesCounts.map((s) => [String(s._id), s.count]));
    const tMap = new Map(testCounts.map((s) => [String(s._id), s.count]));
    const tree = buildTree(categories);
    const decorate = (nodes) => {
        for (const n of nodes) {
            n.seriesCount = sMap.get(n._id) ?? 0;
            n.testCount = tMap.get(n._id) ?? 0;
            n.questionCount = qMap.get(n._id) ?? 0;
            decorate(n.children);
        }
    };
    decorate(tree);
    return tree;
}
/** Active categories only; a child is hidden if any ancestor is inactive. */
export async function getPublicTree(moduleType) {
    const categories = await CategoryModel.find({ moduleType, isActive: true, status: 'active' }).lean();
    return buildTree(categories);
}
/** Resolves a slug path such as "defence/cds" into the category chain (breadcrumb). */
export async function resolvePath(moduleType, path) {
    const slugs = path
        .split('/')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    if (!slugs.length || slugs.length > MAX_CATEGORY_DEPTH + 1)
        throw ApiError.notFound('Category not found');
    const chain = [];
    let parentId = null;
    for (const slug of slugs) {
        const found = await CategoryModel.findOne({ moduleType, parentId, slug, isActive: true, status: 'active' }).lean();
        if (!found)
            throw ApiError.notFound('Category not found');
        chain.push(found);
        parentId = found._id;
    }
    const current = chain[chain.length - 1];
    const children = await CategoryModel.find({ parentId: current._id, isActive: true, status: 'active' }).sort({ sortOrder: 1, name: 1 }).lean();
    let acc = '';
    const breadcrumb = chain.map((c) => {
        acc = acc ? `${acc}/${c.slug}` : c.slug;
        return { _id: String(c._id), name: c.name, slug: c.slug, path: acc };
    });
    return {
        category: { ...current, _id: String(current._id), path: acc },
        breadcrumb,
        children: children.map((c) => ({ ...c, _id: String(c._id), path: `${acc}/${c.slug}` })),
    };
}
async function assertSlugFree(moduleType, parentId, slug, excludeId) {
    const filter = { moduleType, parentId, slug };
    if (excludeId)
        filter._id = { $ne: excludeId };
    if (await CategoryModel.exists(filter)) {
        throw ApiError.conflict(`A category with the slug "${slug}" already exists at this level`, 'SLUG_TAKEN');
    }
}
async function loadParent(parentId, moduleType) {
    if (!parentId)
        return null;
    const parent = await CategoryModel.findById(parentId);
    if (!parent)
        throw ApiError.validation([{ path: 'body.parentId', message: 'Parent category not found' }]);
    if (parent.moduleType !== moduleType)
        throw ApiError.validation([{ path: 'body.parentId', message: 'Parent belongs to a different module' }]);
    if (parent.status === 'archived')
        throw ApiError.validation([{ path: 'body.parentId', message: 'Parent category is archived' }]);
    if (parent.depth >= MAX_CATEGORY_DEPTH) {
        throw ApiError.validation([{ path: 'body.parentId', message: `Categories can be nested at most ${MAX_CATEGORY_DEPTH + 1} levels deep` }]);
    }
    return parent;
}
export async function createCategory(input) {
    const parent = await loadParent(input.parentId, input.moduleType);
    const parentObjectId = parent ? parent._id : null;
    const slug = input.slug || slugify(input.name);
    await assertSlugFree(input.moduleType, parentObjectId, slug);
    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
        const last = await CategoryModel.findOne({ moduleType: input.moduleType, parentId: parentObjectId }).sort({ sortOrder: -1 }).lean();
        sortOrder = (last?.sortOrder ?? -1) + 1;
    }
    return CategoryModel.create({
        name: input.name,
        slug,
        moduleType: input.moduleType,
        parentId: parentObjectId,
        ancestors: parent ? [...parent.ancestors, parent._id] : [],
        depth: parent ? parent.depth + 1 : 0,
        description: input.description,
        icon: input.icon,
        sortOrder,
        isActive: input.isActive,
        status: input.isActive ? 'active' : 'inactive',
    });
}
export async function getCategory(id) {
    const category = await CategoryModel.findById(id);
    if (!category)
        throw ApiError.notFound('Category not found');
    return category;
}
/** Recomputes ancestors/depth for a moved subtree and the categoryPath of its content. */
async function rebuildSubtree(root, session) {
    const descendants = await CategoryModel.find({ ancestors: root._id }).session(session ?? null);
    const byId = new Map([[String(root._id), root]]);
    for (const d of descendants)
        byId.set(String(d._id), d);
    // Process shallowest first so parents are updated before children.
    const ordered = [...descendants].sort((a, b) => a.depth - b.depth);
    for (const d of ordered) {
        const parent = byId.get(String(d.parentId));
        d.ancestors = [...parent.ancestors, parent._id];
        d.depth = parent.depth + 1;
        if (d.depth > MAX_CATEGORY_DEPTH)
            throw ApiError.badRequest('Moving this category would exceed the maximum nesting depth');
        await d.save({ session });
    }
    for (const c of [root, ...descendants]) {
        const path = [...c.ancestors, c._id];
        await TestSeriesModel.updateMany({ categoryId: c._id }, { categoryPath: path }, { session });
        await TestModel.updateMany({ categoryId: c._id }, { categoryPath: path }, { session });
    }
}
export async function updateCategory(id, input) {
    return withTransaction(async (session) => {
        const category = await CategoryModel.findById(id).session(session ?? null);
        if (!category)
            throw ApiError.notFound('Category not found');
        if (category.status === 'archived')
            throw ApiError.badRequest('Restore the category before editing it');
        const parentChanged = input.parentId !== undefined && String(input.parentId ?? '') !== String(category.parentId ?? '');
        let newParent = null;
        if (parentChanged) {
            if (input.parentId === id)
                throw ApiError.badRequest('A category cannot be its own parent');
            newParent = await loadParent(input.parentId, category.moduleType);
            if (newParent && newParent.ancestors.some((a) => String(a) === id)) {
                throw ApiError.badRequest('A category cannot be moved inside its own sub-category');
            }
        }
        const targetParentId = parentChanged ? (newParent?._id ?? null) : (category.parentId ?? null);
        const nextSlug = input.slug ?? category.slug;
        if (nextSlug !== category.slug || parentChanged) {
            await assertSlugFree(category.moduleType, targetParentId, nextSlug, category._id);
        }
        if (input.name !== undefined)
            category.name = input.name;
        category.slug = nextSlug;
        if (input.description !== undefined)
            category.description = input.description;
        if (input.icon !== undefined)
            category.icon = input.icon;
        if (input.sortOrder !== undefined)
            category.sortOrder = input.sortOrder;
        if (input.isActive !== undefined) {
            category.isActive = input.isActive;
            category.status = input.isActive ? 'active' : 'inactive';
        }
        if (parentChanged) {
            category.parentId = newParent?._id ?? null;
            category.ancestors = newParent ? [...newParent.ancestors, newParent._id] : [];
            category.depth = newParent ? newParent.depth + 1 : 0;
        }
        await category.save({ session });
        if (parentChanged)
            await rebuildSubtree(category, session);
        if (parentChanged)
            await recomputeQuestionPaths({ categoryPaths: category._id });
        return category;
    });
}
export async function reorderCategories(items) {
    await CategoryModel.bulkWrite(items.map((i) => ({ updateOne: { filter: { _id: new Types.ObjectId(i.id) }, update: { $set: { sortOrder: i.sortOrder } } } })));
}
async function subtreeIds(id) {
    const descendants = await CategoryModel.find({ ancestors: id }, { _id: 1 }).lean();
    return [id, ...descendants.map((d) => d._id)];
}
export async function setCategoryActive(id, isActive) {
    const category = await getCategory(id);
    if (category.status === 'archived')
        throw ApiError.badRequest('Restore the category before activating it');
    category.isActive = isActive;
    category.status = isActive ? 'active' : 'inactive';
    await category.save();
    return category;
}
async function activeContentCount(ids) {
    const [series, tests] = await Promise.all([
        TestSeriesModel.countDocuments({ categoryId: { $in: ids }, publicationStatus: 'published' }),
        TestModel.countDocuments({ categoryId: { $in: ids }, publicationStatus: 'published' }),
    ]);
    return { series, tests };
}
/** Archives a category and its sub-categories, unless published content still depends on them. */
export async function archiveCategory(id) {
    const category = await getCategory(id);
    const ids = await subtreeIds(category._id);
    const active = await activeContentCount(ids);
    if (active.series || active.tests) {
        throw ApiError.conflict(`This category still has ${active.series} published test series and ${active.tests} published tests. Unpublish or move them first.`, 'CATEGORY_IN_USE');
    }
    await CategoryModel.updateMany({ _id: { $in: ids } }, { status: 'archived', isActive: false, archivedAt: new Date() });
    return { archived: ids.length };
}
export async function restoreCategory(id) {
    const category = await getCategory(id);
    if (category.status !== 'archived')
        return category;
    if (category.parentId) {
        const parent = await CategoryModel.findById(category.parentId).lean();
        if (parent?.status === 'archived')
            throw ApiError.badRequest('Restore the parent category first');
    }
    category.status = 'inactive';
    category.isActive = false;
    category.archivedAt = null;
    await category.save();
    return category;
}
/** Hard delete is only allowed for an empty leaf category. */
export async function deleteCategory(id) {
    const category = await getCategory(id);
    const [children, series, tests] = await Promise.all([
        CategoryModel.countDocuments({ parentId: category._id }),
        TestSeriesModel.countDocuments({ categoryId: category._id }),
        TestModel.countDocuments({ categoryId: category._id }),
    ]);
    if (children || series || tests) {
        throw ApiError.conflict('Only empty categories without sub-categories, series or tests can be deleted. Archive it instead.', 'CATEGORY_IN_USE');
    }
    // Unlink questions from this category (the questions themselves are kept).
    await QuestionModel.updateMany({ categoryIds: category._id }, { $pull: { categoryIds: category._id, categoryPaths: category._id } });
    await category.deleteOne();
}
export async function categoryPathFor(categoryId) {
    const category = await CategoryModel.findById(categoryId).lean();
    if (!category)
        throw ApiError.validation([{ path: 'body.categoryId', message: 'Category not found' }]);
    if (category.status === 'archived')
        throw ApiError.validation([{ path: 'body.categoryId', message: 'Category is archived' }]);
    return { category, path: [...category.ancestors, category._id] };
}
/** Ids of a category and all of its descendants (used for public listings). */
export async function categoryWithDescendants(categoryId) {
    return subtreeIds(new Types.ObjectId(categoryId));
}
//# sourceMappingURL=category.service.js.map