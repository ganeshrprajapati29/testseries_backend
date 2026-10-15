import helmet from 'helmet';
import { env } from './env.js';

export const SESSION_COOKIE = 'cs_session';
export const CSRF_COOKIE = 'cs_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export const helmetMiddleware = helmet({
  contentSecurityPolicy: env.isProd
    ? {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
          frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
          connectSrc: ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        },
      }
    : false,
  crossOriginResourcePolicy: { policy: 'same-site' },
});

export function sessionCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    domain: env.COOKIE_DOMAIN,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function csrfCookieOptions() {
  return {
    httpOnly: false, // must be readable by the SPA so it can echo the value in the header
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    domain: env.COOKIE_DOMAIN,
    path: '/',
  };
}

export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
};

export const LOGIN_LOCK = {
  maxFailedAttempts: 5,
  lockMinutes: 15,
};
