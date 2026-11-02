import { z } from 'zod';
import { PASSWORD_POLICY } from '../config/security.js';
export const passwordSchema = z
    .string()
    .min(PASSWORD_POLICY.minLength, `Password must be at least ${PASSWORD_POLICY.minLength} characters`)
    .max(PASSWORD_POLICY.maxLength, `Password must be at most ${PASSWORD_POLICY.maxLength} characters`)
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/\d/, 'Password must contain a number');
export const emailSchema = z.string().trim().max(254).email('Enter a valid email address');
export const MOBILE_RE = /^(\+91[-\s]?)?[6-9]\d{9}$/;
/** "+91 98765 43210" -> "9876543210" so the same number is always stored the same way. */
export const toTenDigits = (v) => v.replace(/\D/g, '').slice(-10);
export const mobileSchema = z
    .string()
    .trim()
    .regex(MOBILE_RE, 'Enter a valid 10 digit Indian mobile number')
    .transform(toTenDigits)
    .optional()
    .or(z.literal('').transform(() => undefined));
/** Required mobile (registration / admin-created students). */
export const requiredMobileSchema = z
    .string({ error: 'Mobile number is required' })
    .trim()
    .min(1, 'Mobile number is required')
    .regex(MOBILE_RE, 'Enter a valid 10 digit Indian mobile number')
    .transform(toTenDigits);
export const nameSchema = z.string().trim().min(2, 'Name must be at least 2 characters').max(100);
export const registerSchema = z.object({
    name: nameSchema,
    email: emailSchema,
    mobile: requiredMobileSchema,
    password: passwordSchema,
});
export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required').max(PASSWORD_POLICY.maxLength),
});
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
    token: z.string().min(20).max(200),
    password: passwordSchema,
});
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required').max(PASSWORD_POLICY.maxLength),
    newPassword: passwordSchema,
});
//# sourceMappingURL=auth.validator.js.map