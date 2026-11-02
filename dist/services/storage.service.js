import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
const MB = 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * MB;
export const MAX_PDF_BYTES = 25 * MB;
let s3 = null;
function s3Client() {
    if (!s3) {
        s3 = new S3Client({
            region: env.S3_REGION || 'auto',
            endpoint: env.S3_ENDPOINT || undefined,
            forcePathStyle: !!env.S3_ENDPOINT,
            credentials: env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
                ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
                : undefined,
        });
    }
    return s3;
}
// ------------------------------------------------------------------ images
/**
 * Removes anything executable from an SVG. Uploaded SVGs are additionally served with a
 * sandboxing Content-Security-Policy by nginx (defence in depth).
 */
export function sanitizeSvg(input) {
    let svg = input.replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!ENTITY[\s\S]*?>/gi, '');
    svg = svg.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<script[^>]*\/>/gi, '');
    svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
    svg = svg.replace(/<(iframe|embed|object)[\s\S]*?(<\/\1\s*>|\/>)/gi, '');
    svg = svg.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    svg = svg.replace(/(href|xlink:href)\s*=\s*("|')\s*(javascript|data:text\/html)[^"']*\2/gi, '');
    if (!/<svg[\s>]/i.test(svg))
        throw ApiError.badRequest('The file is not a valid SVG image');
    return svg;
}
function looksLikeSvg(buffer) {
    const head = buffer.subarray(0, 1024).toString('utf8').trimStart().toLowerCase();
    return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}
/**
 * Normalises an uploaded image: verifies the real format from the file contents (not the
 * extension), fixes EXIF rotation, caps the size at 2000px and converts JPEG/PNG/AVIF/TIFF to
 * WebP. GIF (animation) and SVG (vector) are kept in their original format.
 */
export async function processImage(buffer) {
    if (!buffer.length)
        throw ApiError.badRequest('The image file is empty');
    if (buffer.length > MAX_IMAGE_BYTES)
        throw ApiError.badRequest('Images must be smaller than 8 MB');
    if (looksLikeSvg(buffer)) {
        const clean = sanitizeSvg(buffer.toString('utf8'));
        return { data: Buffer.from(clean, 'utf8'), ext: 'svg', mime: 'image/svg+xml' };
    }
    let meta;
    try {
        meta = await sharp(buffer, { limitInputPixels: 50_000_000 }).metadata();
    }
    catch {
        throw ApiError.badRequest('Unsupported or corrupted image. Use JPG, PNG, WEBP, GIF, SVG, AVIF or TIFF.');
    }
    if (!meta.format || !['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff'].includes(meta.format)) {
        throw ApiError.badRequest('Unsupported image format. Use JPG, PNG, WEBP, GIF, SVG, AVIF or TIFF.');
    }
    if (meta.format === 'gif')
        return { data: buffer, ext: 'gif', mime: 'image/gif' };
    try {
        const data = await sharp(buffer, { limitInputPixels: 50_000_000 })
            .rotate()
            .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 })
            .toBuffer();
        return { data, ext: 'webp', mime: 'image/webp' };
    }
    catch {
        throw ApiError.badRequest('This image could not be processed. Try saving it as JPG or PNG.');
    }
}
async function putPublic(key, data, mime) {
    if (env.STORAGE_DRIVER === 's3') {
        await s3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: data, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' }));
        return `${env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
    }
    const root = path.resolve(env.UPLOAD_DIR);
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep))
        throw new Error('Invalid storage path');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
    return `${env.PUBLIC_UPLOAD_BASE_URL.replace(/\/$/, '')}/${key}`;
}
/** Validates, optimises and stores an image. File names are random - never user supplied. */
export async function storeImage(buffer, folder) {
    const { data, ext, mime } = await processImage(buffer);
    const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    return { key, url: await putPublic(key, data, mime) };
}
// ------------------------------------------------------------------ private files (PDFs)
function privatePath(key) {
    const root = path.resolve(env.PRIVATE_UPLOAD_DIR);
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep))
        throw ApiError.badRequest('Invalid file key');
    return target;
}
export function isPdf(buffer) {
    return buffer.subarray(0, 1024).toString('latin1').includes('%PDF-');
}
export function safeFileName(name, fallback) {
    const base = path.basename(name || '').replace(/[^\w.\- ()]+/g, '_').trim().slice(0, 120);
    return base || fallback;
}
/** PDFs are stored privately and only streamed through the API after an access check. */
export async function storePdf(buffer, originalName) {
    if (!buffer.length)
        throw ApiError.badRequest('The PDF file is empty');
    if (buffer.length > MAX_PDF_BYTES)
        throw ApiError.badRequest('PDF files must be smaller than 25 MB');
    if (!isPdf(buffer))
        throw ApiError.badRequest('The file is not a valid PDF');
    const key = `pdfs/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.pdf`;
    if (env.STORAGE_DRIVER === 's3') {
        await s3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: `private/${key}`, Body: buffer, ContentType: 'application/pdf' }));
    }
    else {
        const target = privatePath(key);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, buffer);
    }
    const name = safeFileName(originalName, 'document.pdf');
    return { key, fileName: name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`, size: buffer.length };
}
export async function openPrivateFile(key) {
    if (!/^pdfs\/[\w\-/]+\.pdf$/.test(key))
        throw ApiError.notFound('File not found');
    if (env.STORAGE_DRIVER === 's3') {
        try {
            const obj = await s3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: `private/${key}` }));
            return { stream: obj.Body, size: obj.ContentLength };
        }
        catch {
            throw ApiError.notFound('File not found');
        }
    }
    const target = privatePath(key);
    try {
        const stat = await fsp.stat(target);
        return { stream: fs.createReadStream(target), size: stat.size };
    }
    catch {
        throw ApiError.notFound('File not found');
    }
}
export async function deletePrivateFile(key) {
    if (!/^pdfs\/[\w\-/]+\.pdf$/.test(key))
        return;
    if (env.STORAGE_DRIVER === 's3') {
        await s3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: `private/${key}` })).catch(() => undefined);
    }
    else {
        await fsp.rm(privatePath(key), { force: true });
    }
}
// ------------------------------------------------------------------ download from a link (SSRF-safe)
function isPrivateAddress(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return (a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224);
    }
    const v6 = ip.toLowerCase();
    if (v6 === '::' || v6 === '::1')
        return true;
    if (v6.startsWith('::ffff:'))
        return isPrivateAddress(v6.slice(7));
    return v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}
/** DNS lookup that refuses internal addresses, used for every connection (also after redirects). */
const safeLookup = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err)
            return callback(err, '', 0);
        const list = addresses;
        const bad = list.find((a) => isPrivateAddress(a.address));
        if (!list.length || bad)
            return callback(new Error('Links to internal network addresses are not allowed'), '', 0);
        const first = list[0];
        if (options.all)
            return callback(null, list);
        callback(null, first.address, first.family);
    });
};
export async function downloadFromUrl(rawUrl, maxBytes, redirects = 3) {
    let url;
    try {
        url = new URL(rawUrl.trim());
    }
    catch {
        throw ApiError.badRequest('Enter a valid link starting with http:// or https://');
    }
    if (!['http:', 'https:'].includes(url.protocol))
        throw ApiError.badRequest('Only http:// and https:// links are supported');
    if (url.username || url.password)
        throw ApiError.badRequest('Links with credentials are not allowed');
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
        throw ApiError.badRequest('Links to internal network addresses are not allowed');
    }
    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = client.get(url, { lookup: safeLookup, timeout: 15000, headers: { 'User-Agent': 'CivilSansadBot/1.0 (+https://civilsansad.com)', Accept: '*/*' } }, (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume();
                if (redirects <= 0)
                    return reject(ApiError.badRequest('The link redirects too many times'));
                const next = new URL(res.headers.location, url).toString();
                return downloadFromUrl(next, maxBytes, redirects - 1).then(resolve, reject);
            }
            if (status !== 200) {
                res.resume();
                return reject(ApiError.badRequest(`The link could not be downloaded (HTTP ${status})`));
            }
            const declared = Number(res.headers['content-length'] ?? 0);
            if (declared > maxBytes) {
                res.destroy();
                return reject(ApiError.badRequest(`The file at this link is larger than ${Math.round(maxBytes / MB)} MB`));
            }
            const chunks = [];
            let total = 0;
            res.on('data', (c) => {
                total += c.length;
                if (total > maxBytes) {
                    res.destroy();
                    reject(ApiError.badRequest(`The file at this link is larger than ${Math.round(maxBytes / MB)} MB`));
                }
                else
                    chunks.push(c);
            });
            res.on('end', () => {
                const fromPath = decodeURIComponent(url.pathname.split('/').pop() || '');
                resolve({ buffer: Buffer.concat(chunks), contentType: String(res.headers['content-type'] ?? ''), fileName: fromPath });
            });
            res.on('error', () => reject(ApiError.badRequest('The download was interrupted')));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (err) => reject(err instanceof ApiError ? err : ApiError.badRequest(err.message.includes('internal') ? err.message : 'The link could not be reached')));
    });
}
export async function storeImageFromUrl(url, folder) {
    const remote = await downloadFromUrl(url, MAX_IMAGE_BYTES);
    return storeImage(remote.buffer, folder);
}
export async function storePdfFromUrl(url) {
    const remote = await downloadFromUrl(url, MAX_PDF_BYTES);
    return storePdf(remote.buffer, remote.fileName || 'document.pdf');
}
//# sourceMappingURL=storage.service.js.map