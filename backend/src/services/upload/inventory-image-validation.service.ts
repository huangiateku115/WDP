import { createHash } from 'crypto';
import sharp from 'sharp';
import { InventoryItemError } from '../inventory-items/inventory-item.validation';

export const INVENTORY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const INVENTORY_IMAGE_MAX_DIMENSION = 6000;
export const INVENTORY_IMAGE_MAX_COUNT = 10;
const MAX_PIXELS = 24_000_000;

export interface ValidatedInventoryImage { format: 'jpg' | 'png' | 'webp'; width: number; height: number; sha256: string; }

const MIME_FORMAT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

export async function validateInventoryImage(buffer: Buffer, declaredMime: string): Promise<ValidatedInventoryImage> {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > INVENTORY_IMAGE_MAX_BYTES) throw new InventoryItemError(400, 'Image must be non-empty and no larger than 8 MiB');
  if (!(declaredMime in MIME_FORMAT)) throw new InventoryItemError(400, 'Only JPEG, PNG, and WebP images are accepted');
  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_PIXELS, animated: true }).metadata();
  }
  catch { throw new InventoryItemError(400, 'Image content is invalid or incomplete'); }
  const expected = MIME_FORMAT[declaredMime as keyof typeof MIME_FORMAT];
  const actual = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
  const width = metadata.width || 0, height = metadata.height || 0;
  if (actual !== expected || !['jpg', 'png', 'webp'].includes(actual || '') || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > INVENTORY_IMAGE_MAX_DIMENSION || height > INVENTORY_IMAGE_MAX_DIMENSION || width * height > MAX_PIXELS || (metadata.pages || 1) !== 1) {
    throw new InventoryItemError(400, 'Image must be a single-frame JPEG, PNG, or WebP under the configured dimension limits and match its MIME type');
  }
  try { await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_PIXELS, animated: false }).stats(); }
  catch { throw new InventoryItemError(400, 'Image content is invalid or incomplete'); }
  return { format: actual as ValidatedInventoryImage['format'], width, height, sha256: createHash('sha256').update(buffer).digest('hex') };
}
