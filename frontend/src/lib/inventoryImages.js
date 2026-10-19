export const INVENTORY_IMAGE_LIMIT = 10;
export function validateInventoryImageFile(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file?.type)) throw Error('Only JPEG, PNG and WebP images are accepted.');
  if (!file.size || file.size > 8 * 1024 * 1024) throw Error('Image must be non-empty and no larger than 8 MiB.');
}
export function validateInventoryImageDimensions(width, height) {
  if (![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=6000) || width*height>24000000) throw Error('Image must be at most 6000 pixels per side and 24 megapixels.');
}
export function uploadedInventoryImage(response) {
  const image=response?.data?.success===true?response.data.data:null;
  if (!image || !/^[a-f\d]{24}$/i.test(image.uploadId||'') || typeof image.publicId!=='string' || !image.publicId || typeof image.secureUrl!=='string' || !image.secureUrl.startsWith('https://') || !['jpg','png','webp'].includes(image.format) || !Number.isFinite(Date.parse(image.expiresAt)) || Date.parse(image.expiresAt)<=Date.now()) throw Error('Backend returned an invalid or expired image upload result.');
  const url=new URL(image.secureUrl);
  if(url.username||url.password||!url.hostname)throw Error('Invalid upload URL.');
  validateInventoryImageDimensions(image.width,image.height);
  return image;
}
export const inventoryImagesReady=images=>images.every(image=>image.status==='attached'||(image.status==='uploaded'&&Date.parse(image.expiresAt)>Date.now()));
