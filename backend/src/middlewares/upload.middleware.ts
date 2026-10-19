import multer from 'multer';
import { RequestHandler } from 'express';

// Lưu trữ tạm trong bộ nhớ RAM để stream trực tiếp lên Cloudinary
const storage = multer.memoryStorage();

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Chỉ chấp nhận file định dạng hình ảnh (JPEG, PNG, WEBP) hoặc tài liệu scan (PDF).'));
  }
};

export const uploadProofMiddleware = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // Giới hạn tối đa 10MB
  },
  fileFilter,
});

export const uploadInventoryImageMiddleware = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('Only JPEG, PNG, and WebP images are accepted'), { status: 400 }));
  },
});

export const uploadInventoryImageFile: RequestHandler = (req, res, next) => {
  uploadInventoryImageMiddleware.single('file')(req, res, error => {
    if (error) {
      const candidate = error as Error & { code?: string; status?: number };
      candidate.status = candidate.code === 'LIMIT_FILE_SIZE' ? 413 : candidate.status || 400;
      return next(candidate);
    }
    next();
  });
};
