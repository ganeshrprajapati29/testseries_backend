import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ACCOUNT_STATUSES, ROLES } from '../types/enums.js';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, trim: true, maxlength: 254 },
    normalizedEmail: { type: String, required: true, lowercase: true, trim: true },
    mobile: { type: String, trim: true, maxlength: 15 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'student', required: true },
    accountStatus: { type: String, enum: ACCOUNT_STATUSES, default: 'active', required: true },
    emailVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    preferredLanguage: { type: String, enum: ['en', 'hi'], default: 'en' },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.passwordHash;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        delete ret.__v;
        return ret;
      },
    },
  },
);

userSchema.index({ normalizedEmail: 1 }, { unique: true });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ name: 'text', email: 'text' });

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;
export const UserModel = model('User', userSchema);
