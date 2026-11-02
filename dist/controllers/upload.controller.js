import { audit } from '../services/audit.service.js';
import { storeImage, storeImageFromUrl, storePdf, storePdfFromUrl } from '../services/storage.service.js';
import { ApiError } from '../utils/ApiError.js';
import { created } from '../utils/ApiResponse.js';
const FOLDERS = ['questions', 'covers', 'categories', 'misc'];
const folderOf = (req) => {
    const f = String(req.query.folder ?? req.body?.folder ?? 'misc');
    return FOLDERS.includes(f) ? f : 'misc';
};
/** POST /admin/uploads/images (multipart "files", up to 10) */
export async function uploadImages(req, res) {
    const files = req.files ?? (req.file ? [req.file] : []);
    if (!files.length)
        throw ApiError.badRequest('Choose at least one image to upload');
    const folder = folderOf(req);
    const stored = [];
    for (const f of files)
        stored.push(await storeImage(f.buffer, folder));
    await audit(req, { action: 'file.upload', entityType: 'File', summary: `${stored.length} image(s) to ${folder}` });
    return created(res, { files: stored, url: stored[0].url }, `${stored.length} image(s) uploaded`);
}
/** POST /admin/uploads/images/from-url  { url, folder } - downloads the image to our storage. */
export async function importImage(req, res) {
    const stored = await storeImageFromUrl(req.body.url, folderOf(req));
    await audit(req, { action: 'file.import_url', entityType: 'File', summary: String(req.body.url).slice(0, 300) });
    return created(res, { files: [stored], url: stored.url }, 'Image imported');
}
/** POST /admin/uploads/pdf (multipart "file") */
export async function uploadPdf(req, res) {
    if (!req.file)
        throw ApiError.badRequest('Choose a PDF file to upload');
    const stored = await storePdf(req.file.buffer, req.file.originalname);
    await audit(req, { action: 'file.upload_pdf', entityType: 'File', summary: stored.fileName });
    return created(res, stored, 'PDF uploaded');
}
/** POST /admin/uploads/pdf/from-url { url } */
export async function importPdf(req, res) {
    const stored = await storePdfFromUrl(req.body.url);
    await audit(req, { action: 'file.import_pdf_url', entityType: 'File', summary: String(req.body.url).slice(0, 300) });
    return created(res, stored, 'PDF imported');
}
//# sourceMappingURL=upload.controller.js.map