import type { Request, Response } from 'express';
import { audit } from '../services/audit.service.js';
import { storeImage, storeImageFromUrl, storePdf, storePdfFromUrl, type ImageFolder } from '../services/storage.service.js';
import { ApiError } from '../utils/ApiError.js';
import { created } from '../utils/ApiResponse.js';

const FOLDERS: ImageFolder[] = ['questions', 'covers', 'categories', 'misc'];
const folderOf = (req: Request): ImageFolder => {
  const f = String(req.query.folder ?? req.body?.folder ?? 'misc') as ImageFolder;
  return FOLDERS.includes(f) ? f : 'misc';
};

/** POST /admin/uploads/images (multipart "files", up to 10) */
export async function uploadImages(req: Request, res: Response) {
  const files = (req.files as Express.Multer.File[] | undefined) ?? (req.file ? [req.file] : []);
  if (!files.length) throw ApiError.badRequest('Choose at least one image to upload');
  const folder = folderOf(req);
  const stored = [];
  for (const f of files) stored.push(await storeImage(f.buffer, folder));
  await audit(req, { action: 'file.upload', entityType: 'File', summary: `${stored.length} image(s) to ${folder}` });
  return created(res, { files: stored, url: stored[0]!.url }, `${stored.length} image(s) uploaded`);
}

/** POST /admin/uploads/images/from-url  { url, folder } - downloads the image to our storage. */
export async function importImage(req: Request, res: Response) {
  const stored = await storeImageFromUrl(req.body.url, folderOf(req));
  await audit(req, { action: 'file.import_url', entityType: 'File', summary: String(req.body.url).slice(0, 300) });
  return created(res, { files: [stored], url: stored.url }, 'Image imported');
}

/** POST /admin/uploads/pdf (multipart "file") */
export async function uploadPdf(req: Request, res: Response) {
  if (!req.file) throw ApiError.badRequest('Choose a PDF file to upload');
  const stored = await storePdf(req.file.buffer, req.file.originalname);
  await audit(req, { action: 'file.upload_pdf', entityType: 'File', summary: stored.fileName });
  return created(res, stored, 'PDF uploaded');
}

/** POST /admin/uploads/pdf/from-url { url } */
export async function importPdf(req: Request, res: Response) {
  const stored = await storePdfFromUrl(req.body.url);
  await audit(req, { action: 'file.import_pdf_url', entityType: 'File', summary: String(req.body.url).slice(0, 300) });
  return created(res, stored, 'PDF imported');
}
