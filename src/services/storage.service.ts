import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

export interface StoredFile {
  url: string;
  key: string;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

let s3: S3Client | null = null;
function s3Client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: env.S3_REGION || 'auto',
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: !!env.S3_ENDPOINT,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }
  return s3;
}

/**
 * Stores an uploaded image. `local` is for development or single-server deployments with a
 * persistent disk; use `s3` (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO...) otherwise.
 * File names are random - user supplied names are never used on disk.
 */
export async function storeImage(buffer: Buffer, mimeType: string, folder: 'questions' | 'covers' | 'misc'): Promise<StoredFile> {
  const ext = EXT_BY_MIME[mimeType];
  if (!ext) throw new Error('Unsupported image type');
  const key = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;

  if (env.STORAGE_DRIVER === 's3') {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    const base = env.S3_PUBLIC_BASE_URL.replace(/\/$/, '');
    return { key, url: `${base}/${key}` };
  }

  const root = path.resolve(env.UPLOAD_DIR);
  const target = path.resolve(root, key);
  if (!target.startsWith(root)) throw new Error('Invalid storage path');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return { key, url: `${env.PUBLIC_UPLOAD_BASE_URL.replace(/\/$/, '')}/${key}` };
}
