import { Schema, model } from 'mongoose';
const passwordResetSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    requestedIp: { type: String, maxlength: 64 },
}, { timestamps: true });
passwordResetSchema.index({ tokenHash: 1 }, { unique: true });
passwordResetSchema.index({ userId: 1, createdAt: -1 });
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasswordResetModel = model('PasswordReset', passwordResetSchema);
//# sourceMappingURL=PasswordReset.model.js.map