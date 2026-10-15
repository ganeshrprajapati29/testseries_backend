import { Schema, model } from 'mongoose';
const siteSettingSchema = new Schema({
    key: { type: String, required: true, trim: true, maxlength: 80 },
    value: { type: Schema.Types.Mixed, default: null },
    /** Public settings are returned to anonymous visitors (contact details, branding). */
    isPublic: { type: Boolean, default: false },
    description: { type: String, default: '', maxlength: 300 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });
siteSettingSchema.index({ key: 1 }, { unique: true });
export const SiteSettingModel = model('SiteSetting', siteSettingSchema);
//# sourceMappingURL=SiteSetting.model.js.map