import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

const MB = 1024 * 1024;

/** Files are kept in memory and handed to the storage service / parser - never executed. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * MB, files: 1 },
  fileFilter(_req, file, cb) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      return cb(ApiError.badRequest('Only PNG, JPEG, WEBP or GIF images are allowed'));
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
