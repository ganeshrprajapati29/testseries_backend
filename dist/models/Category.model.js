import { Schema, model } from 'mongoose';
import { CATEGORY_STATUSES, MODULE_TYPES } from '../types/enums.js';
const categorySchema = new Schema({
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 100 },
    moduleType: { type: String, enum: MODULE_TYPES, required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    /** Materialized ancestor ids (root first) for fast subtree queries. */
    ancestors: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
    depth: { type: Number, required: true, min: 0, max: 5, default: 0 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    icon: { type: String, trim: true, maxlength: 60, default: '' },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: CATEGORY_STATUSES, default: 'active' },
    archivedAt: { type: Date, default: null },
}, { timestamps: true });
// Slugs are unique among siblings of the same module, so "maths" can exist under NDA and CDS.
categorySchema.index({ moduleType: 1, parentId: 1, slug: 1 }, { unique: true });
categorySchema.index({ moduleType: 1, parentId: 1, sortOrder: 1 });
categorySchema.index({ ancestors: 1 });
export const CategoryModel = model('Category', categorySchema);
//# sourceMappingURL=Category.model.js.map