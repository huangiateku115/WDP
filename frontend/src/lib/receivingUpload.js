export function receivingUpload(response, now = Date.now()) {
  const upload = response?.data?.data;
  if (response?.data?.success !== true || !/^[a-f\d]{24}$/i.test(upload?.uploadId || '') ||
      !Number.isSafeInteger(upload.width) || upload.width <= 0 || !Number.isSafeInteger(upload.height) || upload.height <= 0 ||
      !['jpeg', 'jpg', 'png', 'webp'].includes(upload.format) || typeof upload.publicId !== 'string' || !upload.publicId.trim() ||
      !Number.isFinite(Date.parse(upload.expiresAt)) || Date.parse(upload.expiresAt) <= now) {
    throw Error('The uploaded evidence response could not be verified. Retry with the same image.');
  }
  const url = new URL(upload.secureUrl);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('The evidence image URL could not be verified.');
  return upload;
}
