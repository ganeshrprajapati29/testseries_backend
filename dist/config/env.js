import 'dotenv/config';
import { z } from 'zod';
const bool = z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));
const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    APP_URL: z.string().url().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/civil_sansad'),
    MONGODB_TEST_URI: z.string().default('mongodb://127.0.0.1:27017/civil_sansad_test'),
    REDIS_URL: z.string().optional().default(''),
    REDIS_PREFIX: z.string().default('cs:'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_TTL_HOURS: z.coerce.number().positive().default(168),
    ADMIN_SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
    COOKIE_DOMAIN: z.string().optional().transform((v) => (v ? v : undefined)),
    COOKIE_SECURE: bool.default(false),
    SMTP_HOST: z.string().optional().default(''),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASS: z.string().optional().default(''),
    MAIL_FROM: z.string().default('Civil Sansad <no-reply@civilsansad.com>'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    UPLOAD_DIR: z.string().default('uploads'),
    PUBLIC_UPLOAD_BASE_URL: z.string().default('/uploads'),
    /** Files that must only be downloaded through the API (question paper PDFs). Never serve this folder directly. */
    PRIVATE_UPLOAD_DIR: z.string().default('storage/private'),
    S3_BUCKET: z.string().optional().default(''),
    S3_REGION: z.string().optional().default(''),
    S3_ENDPOINT: z.string().optional().default(''),
    S3_ACCESS_KEY_ID: z.string().optional().default(''),
    S3_SECRET_ACCESS_KEY: z.string().optional().default(''),
    S3_PUBLIC_BASE_URL: z.string().optional().default(''),
    PAYMENTS_ENABLED: bool.default(false),
    RAZORPAY_KEY_ID: z.string().optional().default(''),
    RAZORPAY_KEY_SECRET: z.string().optional().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
    // English -> Hindi auto translation for questions, tests and series.
    //   google-free : public Google Translate endpoint, no key (default; fine for admin-only, low volume use)
    //   google      : Google Cloud Translation v2, needs TRANSLATE_API_KEY
    //   libre       : LibreTranslate server at TRANSLATE_API_URL (TRANSLATE_API_KEY optional)
    //   none        : disabled
    TRANSLATE_PROVIDER: z.enum(['google-free', 'google', 'libre', 'none']).default('google-free'),
    TRANSLATE_API_KEY: z.string().optional().default(''),
    TRANSLATE_API_URL: z.string().optional().default(''),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Logger depends on env, so print directly and fail fast.
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
}
const data = parsed.data;
if (data.NODE_ENV === 'production') {
    const problems = [];
    if (data.SESSION_SECRET.startsWith('change-me'))
        problems.push('SESSION_SECRET must be changed in production');
    if (!data.COOKIE_SECURE)
        problems.push('COOKIE_SECURE must be true in production (HTTPS)');
    if (data.STORAGE_DRIVER === 's3' && !data.S3_BUCKET)
        problems.push('S3_BUCKET is required when STORAGE_DRIVER=s3');
    if (data.PAYMENTS_ENABLED && (!data.RAZORPAY_KEY_ID || !data.RAZORPAY_KEY_SECRET || !data.RAZORPAY_WEBHOOK_SECRET)) {
        problems.push('Razorpay keys and webhook secret are required when PAYMENTS_ENABLED=true');
    }
    if (problems.length) {
        console.error(`Unsafe production configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
        process.exit(1);
    }
}
export const env = {
    ...data,
    isProd: data.NODE_ENV === 'production',
    isTest: data.NODE_ENV === 'test',
    corsOrigins: data.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    paymentsConfigured: data.PAYMENTS_ENABLED && !!data.RAZORPAY_KEY_ID && !!data.RAZORPAY_KEY_SECRET,
};
//# sourceMappingURL=env.js.map