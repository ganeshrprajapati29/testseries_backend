import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

const MB = 1024 * 1024;

/**
 * Files are kept in memory and handed to the storage service, which verifies the real format
 * from the file contents. The mimetype check here only rejects obvious mistakes early.
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * MB, files: 10 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/octet-stream') {
      return cb(ApiError.badRequest('Only image files are allowed (JPG, PNG, WEBP, GIF, SVG, AVIF, TIFF)'));
    }
    cb(null, true);
  },
});

export const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * MB, files: 1 },
  fileFilter(_req, file, cb) {
    if (file.mimetype !== 'application/pdf' && !file.originalname.toLowerCase().endsWith('.pdf')) {
      return cb(ApiError.badRequest('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

export const spreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * MB, files: 1 },
  fileFilter(_req, file, cb) {
    const name = file.originalname.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      return cb(ApiError.badRequest('Only .csv or .xlsx files are allowed'));
    }
    cb(null, true);
  },
});
