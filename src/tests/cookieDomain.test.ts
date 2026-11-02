import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { cookieDomainFor, csrfCookieOptions } from '../config/security.js';
import { client } from './helpers.js';

describe('cookie domain per host', () => {
  const original = [...env.cookieDomains];
  afterEach(() => {
    env.cookieDomains.splice(0, env.cookieDomains.length, ...original);
  });

  it('shares cookies with the parent domain only for configured hosts', () => {
    env.cookieDomains.splice(0, env.cookieDomains.length, 'civilsansad.com');
    expect(cookieDomainFor('testapi.civilsansad.com')).toBe('civilsansad.com');
    expect(cookieDomainFor('civilsansad.com')).toBe('civilsansad.com');
    expect(cookieDomainFor('test.ganpura.in')).toBeUndefined();
    expect(cookieDomainFor('evilcivilsansad.com')).toBeUndefined();
    expect(csrfCookieOptions('testapi.civilsansad.com').domain).toBe('civilsansad.com');
  });

  it('sets the Domain attribute on real responses for that host', async () => {
    env.cookieDomains.splice(0, env.cookieDomains.length, 'civilsansad.com');
    const c = await client();
    const res = await c.agent.get('/api/auth/csrf').set('Host', 'testapi.civilsansad.com');
    expect(String(res.headers['set-cookie'] ?? '')).toMatch(/cs_csrf=[^;]+;.*Domain=civilsansad\.com/i);
    const other = await c.agent.get('/api/auth/csrf').set('Host', 'test.ganpura.in');
    expect(String(other.headers['set-cookie'] ?? '')).not.toMatch(/Domain=/i);
  });
});
