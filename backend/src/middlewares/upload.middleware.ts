import multer from 'multer';

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
