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

/**
 * Cookie domain for the host that served the request. COOKIE_DOMAIN may list parent domains
 * (`civilsansad.com,example.org`); a request to `testapi.civilsansad.com` then sets cookies for
 * `civilsansad.com`, so a frontend on `test.civilsansad.com` can read the CSRF cookie. Any other
 * host (e.g. test.ganpura.in) gets host-only cookies.
 */
export function cookieDomainFor(host?: string) {
  if (!host) return undefined;
  const h = host.toLowerCase();
  return env.cookieDomains.find((d) => h === d || h.endsWith(`.${d}`));
}

export function sessionCookieOptions(maxAgeMs: number, host?: string) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    domain: cookieDomainFor(host),
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function csrfCookieOptions(host?: string) {
  return {
    httpOnly: false, // must be readable by the SPA so it can echo the value in the header
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    domain: cookieDomainFor(host),
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
