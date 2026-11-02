import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { LOGIN_LOCK } from '../config/security.js';
import { PasswordResetModel } from '../models/PasswordReset.model.js';
import { SessionModel } from '../models/Session.model.js';
import { UserModel } from '../models/User.model.js';
import { ADMIN_ROLES } from '../types/enums.js';
import { ApiError } from '../utils/ApiError.js';
import { HOUR, MINUTE } from '../utils/dateTime.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../utils/password.js';
import { normalizeEmail } from '../utils/sanitize.js';
import { hashToken, randomToken } from '../utils/tokens.js';
import { passwordResetEmail, sendMail } from './mail.service.js';
const RESET_TOKEN_MINUTES = 30;
const LAST_SEEN_THROTTLE_MS = 5 * MINUTE;
export function publicUser(user) {
    const u = (typeof user.toJSON === 'function' ? user.toJSON() : user);
    return {
        id: String(u._id),
        name: u.name,
        email: u.email,
        mobile: u.mobile ?? '',
        role: u.role,
        accountStatus: u.accountStatus,
        preferredLanguage: u.preferredLanguage ?? 'en',
        emailVerifiedAt: u.emailVerifiedAt ?? null,
        lastLoginAt: u.lastLoginAt ?? null,
        createdAt: u.createdAt,
    };
}
export function sessionTtlMs(scope) {
    return (scope === 'admin' ? env.ADMIN_SESSION_TTL_HOURS : env.SESSION_TTL_HOURS) * HOUR;
}
async function createSession(user, scope, meta) {
    const token = randomToken(32);
    const ttl = sessionTtlMs(scope);
    await SessionModel.create({
        userId: user._id,
        tokenHash: hashToken(token),
        scope,
        expiresAt: new Date(Date.now() + ttl),
        ip: meta.ip?.slice(0, 64),
        userAgent: meta.userAgent?.slice(0, 512),
    });
    return { token, ttl };
}
/** Throws when another account already uses this mobile number. */
export async function assertMobileFree(mobile, exceptUserId) {
    if (!mobile)
        return;
    const filter = { mobile };
    if (exceptUserId)
        filter._id = { $ne: exceptUserId };
    if (await UserModel.exists(filter))
        throw ApiError.conflict('An account with this mobile number already exists', 'MOBILE_TAKEN');
}
export async function registerStudent(input, meta) {
    const normalizedEmail = normalizeEmail(input.email);
    const exists = await UserModel.exists({ normalizedEmail });
    if (exists)
        throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
    await assertMobileFree(input.mobile);
    const user = await UserModel.create({
        name: input.name,
        email: input.email.trim(),
        normalizedEmail,
        mobile: input.mobile,
        passwordHash: await hashPassword(input.password),
        role: 'student', // public registration can never create admins
        lastLoginAt: new Date(),
    });
    const session = await createSession(user, 'student', meta);
    return { user, ...session };
}
export async function login(input, scope, meta) {
    const normalizedEmail = normalizeEmail(input.email);
    const user = await UserModel.findOne({ normalizedEmail }).select('+passwordHash +failedLoginAttempts +lockUntil');
    const genericError = ApiError.unauthorized('Invalid email or password');
    if (!user) {
        await burnPasswordCheck(input.password);
        throw genericError;
    }
    if (user.lockUntil && user.lockUntil > new Date()) {
        throw new ApiError(423, 'Too many failed attempts. Your account is temporarily locked, please try again later.', 'ACCOUNT_LOCKED');
    }
    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
        const attempts = (user.failedLoginAttempts ?? 0) + 1;
        const update = { failedLoginAttempts: attempts };
        if (attempts >= LOGIN_LOCK.maxFailedAttempts) {
            update.lockUntil = new Date(Date.now() + LOGIN_LOCK.lockMinutes * MINUTE);
            update.failedLoginAttempts = 0;
            logger.warn({ userId: user.id }, 'Account locked after repeated failed logins');
        }
        await UserModel.updateOne({ _id: user._id }, update);
        throw genericError;
    }
    const isAdmin = ADMIN_ROLES.includes(user.role);
    if (scope === 'admin' && !isAdmin)
        throw genericError;
    if (scope === 'student' && isAdmin) {
        throw ApiError.forbidden('Administrators must sign in through the admin portal');
    }
    if (user.accountStatus !== 'active') {
        throw ApiError.forbidden('Your account is not active. Please contact support.');
    }
    await UserModel.updateOne({ _id: user._id }, { failedLoginAttempts: 0, lockUntil: null, lastLoginAt: new Date() });
    const session = await createSession(user, scope, meta);
    return { user, ...session };
}
export async function resolveSession(token) {
    const session = await SessionModel.findOne({ tokenHash: hashToken(token), revokedAt: null, expiresAt: { $gt: new Date() } });
    if (!session)
        return null;
    const user = await UserModel.findById(session.userId).lean();
    if (!user || user.accountStatus !== 'active')
        return null;
    if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
        await SessionModel.updateOne({ _id: session._id }, { lastSeenAt: new Date() });
    }
    return {
        sessionId: String(session._id),
        scope: session.scope,
        user: { id: String(user._id), _id: user._id, name: user.name, email: user.email, role: user.role },
    };
}
export async function revokeSession(sessionId) {
    await SessionModel.updateOne({ _id: sessionId }, { revokedAt: new Date() });
}
export async function revokeAllSessions(userId, exceptSessionId) {
    const filter = { userId, revokedAt: null };
    if (exceptSessionId)
        filter._id = { $ne: exceptSessionId };
    await SessionModel.updateMany(filter, { revokedAt: new Date() });
}
/** Always resolves successfully so the response does not reveal whether an email is registered. */
export async function requestPasswordReset(email, ip) {
    const user = await UserModel.findOne({ normalizedEmail: normalizeEmail(email), accountStatus: 'active' });
    if (!user)
        return;
    // Invalidate any outstanding tokens first.
    await PasswordResetModel.updateMany({ userId: user._id, usedAt: null }, { usedAt: new Date() });
    const token = randomToken(32);
    await PasswordResetModel.create({
        userId: user._id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * MINUTE),
        requestedIp: ip,
    });
    const isAdmin = ADMIN_ROLES.includes(user.role);
    const link = `${env.APP_URL.replace(/\/$/, '')}/${isAdmin ? 'admin/' : ''}reset-password?token=${encodeURIComponent(token)}`;
    const mail = passwordResetEmail(user.name, link, RESET_TOKEN_MINUTES);
    await sendMail({ ...mail, to: user.email });
}
export async function resetPassword(token, newPassword) {
    const record = await PasswordResetModel.findOneAndUpdate({ tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: new Date() } }, { usedAt: new Date() });
    if (!record)
        throw ApiError.badRequest('This reset link is invalid or has expired. Please request a new one.');
    const user = await UserModel.findById(record.userId);
    if (!user || user.accountStatus !== 'active')
        throw ApiError.badRequest('This reset link is invalid or has expired.');
    user.passwordHash = await hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    await user.save();
    await UserModel.updateOne({ _id: user._id }, { failedLoginAttempts: 0, lockUntil: null });
    await revokeAllSessions(String(user._id));
}
export async function changePassword(userId, currentSessionId, currentPassword, newPassword) {
    const user = await UserModel.findById(userId).select('+passwordHash');
    if (!user)
        throw ApiError.notFound('User not found');
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
        throw ApiError.validation([{ path: 'body.currentPassword', message: 'Current password is incorrect' }]);
    }
    if (currentPassword === newPassword) {
        throw ApiError.validation([{ path: 'body.newPassword', message: 'New password must be different from the current password' }]);
    }
    user.passwordHash = await hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    await user.save();
    // Sign out every other device; the current session stays valid.
    await revokeAllSessions(userId, currentSessionId);
}
export async function updateProfile(userId, input) {
    await assertMobileFree(input.mobile, userId);
    const user = await UserModel.findByIdAndUpdate(userId, { $set: input }, { new: true, runValidators: true });
    if (!user)
        throw ApiError.notFound('User not found');
    return user;
}
export async function getUserById(userId) {
    const user = await UserModel.findById(userId);
    if (!user)
        throw ApiError.notFound('User not found');
    return user;
}
/** Used by the CLI only - never exposed over HTTP. */
export async function createAdminAccount(input) {
    const normalizedEmail = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    const existing = await UserModel.findOne({ normalizedEmail });
    if (existing) {
        existing.role = input.role;
        existing.name = input.name;
        existing.passwordHash = passwordHash;
        existing.accountStatus = 'active';
        existing.passwordChangedAt = new Date();
        await existing.save();
        await revokeAllSessions(String(existing._id));
        return { user: existing, created: false };
    }
    const user = await UserModel.create({
        name: input.name,
        email: input.email.trim(),
        normalizedEmail,
        passwordHash,
        role: input.role,
        emailVerifiedAt: new Date(),
    });
    return { user, created: true };
}
//# sourceMappingURL=auth.service.js.map