import { UserModel } from '../models/User.model.js';
import type { AccountStatus } from '../types/enums.js';
import { ApiError } from '../utils/ApiError.js';
import { hashPassword } from '../utils/password.js';
import { normalizeEmail } from '../utils/sanitize.js';
import { revokeAllSessions } from './auth.service.js';

type AdminRole = 'admin' | 'superadmin';
const ADMIN_FILTER = { role: { $in: ['admin', 'superadmin'] } };
const SAFE_FIELDS = 'name email mobile role accountStatus lastLoginAt createdAt passwordChangedAt';

/** All admin accounts (super admins first). */
export async function listAdmins() {
  return UserModel.find(ADMIN_FILTER).select(SAFE_FIELDS).sort({ role: -1, createdAt: 1 }).lean();
}

async function assertEmailFree(email: string, exceptId?: string) {
  const filter: Record<string, unknown> = { normalizedEmail: normalizeEmail(email) };
  if (exceptId) filter._id = { $ne: exceptId };
  if (await UserModel.exists(filter)) throw ApiError.validation([{ path: 'body.email', message: 'Another account already uses this email' }]);
}

/** Never leave the panel without an active super admin. */
async function assertOtherActiveSuperadmin(exceptId: string) {
  const others = await UserModel.countDocuments({ role: 'superadmin', accountStatus: 'active', _id: { $ne: exceptId } });
  if (!others) throw ApiError.conflict('At least one active super admin is required. Make another super admin first.', 'LAST_SUPERADMIN');
}

export async function createAdmin(input: { name: string; email: string; password: string; role: AdminRole }) {
  await assertEmailFree(input.email);
  const user = await UserModel.create({
    name: input.name,
    email: input.email.trim(),
    normalizedEmail: normalizeEmail(input.email),
    passwordHash: await hashPassword(input.password),
    role: input.role,
    accountStatus: 'active',
  });
  return UserModel.findById(user._id).select(SAFE_FIELDS).lean();
}

/**
 * Super admin edits another admin (or themself): name, login email, role, status.
 * Changing the email / role / status signs that admin out everywhere.
 */
export async function updateAdmin(id: string, actorId: string, input: { name?: string; email?: string; role?: AdminRole; accountStatus?: AccountStatus }) {
  const user = await UserModel.findOne({ _id: id, ...ADMIN_FILTER });
  if (!user) throw ApiError.notFound('Admin not found');
  const self = id === actorId;
  if (self && input.accountStatus && input.accountStatus !== 'active') throw ApiError.badRequest('You cannot deactivate your own account');
  if (self && input.role === 'admin' && user.role === 'superadmin') throw ApiError.badRequest('You cannot remove your own super admin role');

  const losingSuper = user.role === 'superadmin' && ((input.role && input.role !== 'superadmin') || (input.accountStatus && input.accountStatus !== 'active'));
  if (losingSuper) await assertOtherActiveSuperadmin(id);

  let signOut = false;
  if (input.email !== undefined && normalizeEmail(input.email) !== user.normalizedEmail) {
    await assertEmailFree(input.email, id);
    user.email = input.email.trim();
    user.normalizedEmail = normalizeEmail(input.email);
    user.emailVerifiedAt = null;
    signOut = true;
  }
  if (input.name !== undefined) user.name = input.name;
  if (input.role && input.role !== user.role) {
    user.role = input.role;
    signOut = true;
  }
  if (input.accountStatus && input.accountStatus !== user.accountStatus) {
    user.accountStatus = input.accountStatus;
    signOut = signOut || input.accountStatus !== 'active';
  }
  await user.save();
  if (signOut && !self) await revokeAllSessions(id);
  return UserModel.findById(id).select(SAFE_FIELDS).lean();
}

/** Super admin sets a new password for an admin who forgot it (unlocks the account, signs them out). */
export async function resetAdminPassword(id: string, actorId: string, password: string) {
  if (id === actorId) throw ApiError.badRequest('Use "Change password" in My Account for your own password');
  const user = await UserModel.findOne({ _id: id, ...ADMIN_FILTER });
  if (!user) throw ApiError.notFound('Admin not found');
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.set({ failedLoginAttempts: 0, lockUntil: null });
  await user.save();
  await revokeAllSessions(id);
  return { email: user.email };
}
