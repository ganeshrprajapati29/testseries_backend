import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getRedis, redisReady } from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * English -> Hindi machine translation used by the admin editors ("Auto-translate to Hindi").
 *
 * The provider is chosen with TRANSLATE_PROVIDER (see config/env.ts). Every translated string is cached
 * in Redis for 30 days, so re-saving or re-translating the same text never calls the provider again.
 */

export type Lang = 'en' | 'hi';
type Translator = (texts: string[], source: Lang, target: Lang) => Promise<string[]>;

const CACHE_TTL = 30 * 24 * 3600;
const MAX_TEXT = 5000;
const TIMEOUT_MS = 15_000;

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`translation provider responded ${res.status}`);
  return res.json() as Promise<unknown>;
}

async function postForm(url: string, text: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q: text }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`translation provider responded ${res.status}`);
  return res.json() as Promise<unknown>;
}

/** Chrome dictionary endpoint - works from datacenter IPs where the "gtx" endpoint is often rate limited. */
async function googleDictOne(text: string, source: Lang, target: Lang) {
  const data = await postForm(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${source}&tl=${target}`, text);
  // ["text"] for a known source language, [["text", "en"]] when auto-detecting, sometimes a bare string.
  const first = Array.isArray(data) ? data[0] : data;
  const out = Array.isArray(first) ? first[0] : first;
  if (typeof out !== 'string') throw new Error('unexpected translation response');
  return out;
}

/** Classic "gtx" endpoint - splits long text into sentences that are joined back together. */
async function googleGtxOne(text: string, source: Lang, target: Lang) {
  const data = (await postForm(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t`, text)) as [Array<[string, ...unknown[]]> | null, ...unknown[]];
  if (!Array.isArray(data?.[0])) throw new Error('unexpected translation response');
  return data[0].map((seg) => seg?.[0] ?? '').join('');
}

/** Public Google endpoints (no key). One text per request; falls back to the second endpoint on errors. */
async function googleFreeOne(text: string, source: Lang, target: Lang) {
  try {
    return await googleDictOne(text, source, target);
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'Dictionary endpoint failed - trying gtx');
    return googleGtxOne(text, source, target);
  }
}

/** Runs `fn` over items with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const providers: Record<Exclude<typeof env.TRANSLATE_PROVIDER, 'none'>, Translator> = {
  'google-free': (texts, s, t) => mapLimit(texts, 4, (x) => googleFreeOne(x, s, t)),
  google: async (texts, source, target) => {
    if (!env.TRANSLATE_API_KEY) throw new Error('TRANSLATE_API_KEY is not set');
    const data = (await postJson(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(env.TRANSLATE_API_KEY)}`, {
      q: texts,
      source,
      target,
      format: 'text',
    })) as { data?: { translations?: { translatedText: string }[] } };
    const list = data.data?.translations;
    if (!list || list.length !== texts.length) throw new Error('unexpected translation response');
    return list.map((t) => t.translatedText);
  },
  libre: async (texts, source, target) => {
    if (!env.TRANSLATE_API_URL) throw new Error('TRANSLATE_API_URL is not set');
    const url = `${env.TRANSLATE_API_URL.replace(/\/+$/, '')}/translate`;
    return mapLimit(texts, 4, async (q) => {
      const data = (await postJson(url, { q, source, target, format: 'text', ...(env.TRANSLATE_API_KEY ? { api_key: env.TRANSLATE_API_KEY } : {}) })) as { translatedText?: string };
      if (typeof data.translatedText !== 'string') throw new Error('unexpected translation response');
      return data.translatedText;
    });
  },
};

let override: Translator | null = null;
/** Tests replace the network provider with a deterministic fake. */
export function setTranslatorForTests(fn: Translator | null) {
  override = fn;
}

export function translationEnabled() {
  return !!override || env.TRANSLATE_PROVIDER !== 'none';
}

const cacheKey = (source: Lang, target: Lang, text: string) => `tr:${source}:${target}:${createHash('sha1').update(text).digest('hex')}`;

/**
 * Translates many strings at once. Empty strings stay empty and each result keeps the
 * position of its input. Throws a 502 ApiError if the provider fails.
 */
export async function translateTexts(texts: string[], source: Lang = 'en', target: Lang = 'hi'): Promise<string[]> {
  if (!translationEnabled()) throw new ApiError(503, 'Auto translation is turned off on this server', 'TRANSLATE_DISABLED');
  const out = texts.map((t) => (t ?? '').trim().slice(0, MAX_TEXT));
  const pending = new Map<string, number[]>(); // unique text -> positions
  out.forEach((t, i) => {
    if (t) pending.set(t, [...(pending.get(t) ?? []), i]);
  });
  if (!pending.size) return out;

  const redis = !override && redisReady() ? getRedis() : null;
  const unique = [...pending.keys()];
  const results = new Map<string, string>();
  if (redis) {
    try {
      const hits = await redis.mget(unique.map((t) => cacheKey(source, target, t)));
      hits.forEach((h, i) => h !== null && results.set(unique[i]!, h));
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Translation cache read failed');
    }
  }

  const missing = unique.filter((t) => !results.has(t));
  if (missing.length) {
    const translator = override ?? providers[env.TRANSLATE_PROVIDER as keyof typeof providers];
    let translated: string[];
    try {
      translated = await translator(missing, source, target);
    } catch (err) {
      logger.warn({ err: (err as Error).message, provider: env.TRANSLATE_PROVIDER }, 'Translation failed');
      throw new ApiError(502, 'Could not translate right now. Please try again or type the Hindi text manually.', 'TRANSLATE_FAILED');
    }
    missing.forEach((t, i) => results.set(t, (translated[i] ?? '').trim()));
    if (redis) {
      const pipe = redis.pipeline();
      missing.forEach((t, i) => translated[i] && pipe.set(cacheKey(source, target, t), translated[i]!.trim(), 'EX', CACHE_TTL));
      pipe.exec().catch((err) => logger.warn({ err: err.message }, 'Translation cache write failed'));
    }
  }

  for (const [text, positions] of pending) for (const i of positions) out[i] = results.get(text) ?? '';
  return out;
}

/** Translates the string fields of an object; returns only the keys that had text. */
export async function translateFields<K extends string>(fields: Partial<Record<K, string | undefined | null>>) {
  const keys = (Object.keys(fields) as K[]).filter((k) => (fields[k] ?? '').trim());
  const translated = await translateTexts(keys.map((k) => fields[k]!));
  return Object.fromEntries(keys.map((k, i) => [k, translated[i]])) as Partial<Record<K, string>>;
}

export interface HindiContent {
  title?: string;
  description?: string;
  instructions?: string;
  highlights?: string[];
}

/**
 * Fills the empty Hindi fields of a test / series from its English text. Hindi typed by the admin is never
 * overwritten. Translation problems do not block saving - a warning is returned instead.
 */
export async function fillHindiContent(english: HindiContent, current: HindiContent = {}): Promise<{ hi: HindiContent; warning?: string }> {
  const hi: HindiContent = { ...current };
  const keys = (['title', 'description', 'instructions'] as const).filter((k) => k in english && english[k]?.trim() && !current[k]?.trim());
  const needHighlights = 'highlights' in english && !!english.highlights?.length && !current.highlights?.length;
  if (!keys.length && !needHighlights) return { hi };
  try {
    const texts = [...keys.map((k) => english[k]!), ...(needHighlights ? english.highlights! : [])];
    const out = await translateTexts(texts);
    keys.forEach((k, i) => (hi[k] = out[i]));
    if (needHighlights) hi.highlights = out.slice(keys.length).filter(Boolean);
    return { hi };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Auto translation skipped');
    return { hi, warning: 'Saved, but Hindi auto translation is unavailable right now - add the Hindi text manually or try again.' };
  }
}
