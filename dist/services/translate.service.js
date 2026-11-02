import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getRedis, redisReady } from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';
const CACHE_TTL = 30 * 24 * 3600;
const MAX_TEXT = 5000;
const TIMEOUT_MS = 15_000;
async function postJson(url, body, headers = {}) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok)
        throw new Error(`translation provider responded ${res.status}`);
    return res.json();
}
/** Public Google Translate endpoint (no key). Translates one text per request. */
async function googleFreeOne(text, source, target) {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${source}&tl=${target}&dt=t`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ q: text }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok)
        throw new Error(`translation provider responded ${res.status}`);
    const data = (await res.json());
    if (!Array.isArray(data?.[0]))
        throw new Error('unexpected translation response');
    return data[0].map((seg) => seg?.[0] ?? '').join('');
}
/** Runs `fn` over items with at most `limit` in flight. */
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}
const providers = {
    'google-free': (texts, s, t) => mapLimit(texts, 4, (x) => googleFreeOne(x, s, t)),
    google: async (texts, source, target) => {
        if (!env.TRANSLATE_API_KEY)
            throw new Error('TRANSLATE_API_KEY is not set');
        const data = (await postJson(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(env.TRANSLATE_API_KEY)}`, {
            q: texts,
            source,
            target,
            format: 'text',
        }));
        const list = data.data?.translations;
        if (!list || list.length !== texts.length)
            throw new Error('unexpected translation response');
        return list.map((t) => t.translatedText);
    },
    libre: async (texts, source, target) => {
        if (!env.TRANSLATE_API_URL)
            throw new Error('TRANSLATE_API_URL is not set');
        const url = `${env.TRANSLATE_API_URL.replace(/\/+$/, '')}/translate`;
        return mapLimit(texts, 4, async (q) => {
            const data = (await postJson(url, { q, source, target, format: 'text', ...(env.TRANSLATE_API_KEY ? { api_key: env.TRANSLATE_API_KEY } : {}) }));
            if (typeof data.translatedText !== 'string')
                throw new Error('unexpected translation response');
            return data.translatedText;
        });
    },
};
let override = null;
/** Tests replace the network provider with a deterministic fake. */
export function setTranslatorForTests(fn) {
    override = fn;
}
export function translationEnabled() {
    return !!override || env.TRANSLATE_PROVIDER !== 'none';
}
const cacheKey = (source, target, text) => `tr:${source}:${target}:${createHash('sha1').update(text).digest('hex')}`;
/**
 * Translates many strings at once. Empty strings stay empty and each result keeps the
 * position of its input. Throws a 502 ApiError if the provider fails.
 */
export async function translateTexts(texts, source = 'en', target = 'hi') {
    if (!translationEnabled())
        throw new ApiError(503, 'Auto translation is turned off on this server', 'TRANSLATE_DISABLED');
    const out = texts.map((t) => (t ?? '').trim().slice(0, MAX_TEXT));
    const pending = new Map(); // unique text -> positions
    out.forEach((t, i) => {
        if (t)
            pending.set(t, [...(pending.get(t) ?? []), i]);
    });
    if (!pending.size)
        return out;
    const redis = !override && redisReady() ? getRedis() : null;
    const unique = [...pending.keys()];
    const results = new Map();
    if (redis) {
        try {
            const hits = await redis.mget(unique.map((t) => cacheKey(source, target, t)));
            hits.forEach((h, i) => h !== null && results.set(unique[i], h));
        }
        catch (err) {
            logger.warn({ err: err.message }, 'Translation cache read failed');
        }
    }
    const missing = unique.filter((t) => !results.has(t));
    if (missing.length) {
        const translator = override ?? providers[env.TRANSLATE_PROVIDER];
        let translated;
        try {
            translated = await translator(missing, source, target);
        }
        catch (err) {
            logger.warn({ err: err.message, provider: env.TRANSLATE_PROVIDER }, 'Translation failed');
            throw new ApiError(502, 'Could not translate right now. Please try again or type the Hindi text manually.', 'TRANSLATE_FAILED');
        }
        missing.forEach((t, i) => results.set(t, (translated[i] ?? '').trim()));
        if (redis) {
            const pipe = redis.pipeline();
            missing.forEach((t, i) => translated[i] && pipe.set(cacheKey(source, target, t), translated[i].trim(), 'EX', CACHE_TTL));
            pipe.exec().catch((err) => logger.warn({ err: err.message }, 'Translation cache write failed'));
        }
    }
    for (const [text, positions] of pending)
        for (const i of positions)
            out[i] = results.get(text) ?? '';
    return out;
}
/** Translates the string fields of an object; returns only the keys that had text. */
export async function translateFields(fields) {
    const keys = Object.keys(fields).filter((k) => (fields[k] ?? '').trim());
    const translated = await translateTexts(keys.map((k) => fields[k]));
    return Object.fromEntries(keys.map((k, i) => [k, translated[i]]));
}
/**
 * Fills the empty Hindi fields of a test / series from its English text. Hindi typed by the admin is never
 * overwritten. Translation problems do not block saving - a warning is returned instead.
 */
export async function fillHindiContent(english, current = {}) {
    const hi = { ...current };
    const keys = ['title', 'description', 'instructions'].filter((k) => k in english && english[k]?.trim() && !current[k]?.trim());
    const needHighlights = 'highlights' in english && !!english.highlights?.length && !current.highlights?.length;
    if (!keys.length && !needHighlights)
        return { hi };
    try {
        const texts = [...keys.map((k) => english[k]), ...(needHighlights ? english.highlights : [])];
        const out = await translateTexts(texts);
        keys.forEach((k, i) => (hi[k] = out[i]));
        if (needHighlights)
            hi.highlights = out.slice(keys.length).filter(Boolean);
        return { hi };
    }
    catch (err) {
        logger.warn({ err: err.message }, 'Auto translation skipped');
        return { hi, warning: 'Saved, but Hindi auto translation is unavailable right now - add the Hindi text manually or try again.' };
    }
}
//# sourceMappingURL=translate.service.js.map