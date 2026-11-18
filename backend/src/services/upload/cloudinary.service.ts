import cloudinary from '../../config/cloudinary.config';
import { UploadApiResponse } from 'cloudinary';
import { randomUUID } from 'node:crypto';
import { logOperationalFailure } from '../operations/operational-error.logger';

export class CloudinaryService {
  /**
   * Upload buffer directly to Cloudinary using upload_stream
   */
  static async uploadBuffer(
    buffer: Buffer,
    folder: string = 'wdp/signed-contracts',
    correlationId = randomUUID(),
  ): Promise<{ secureUrl: string; publicId: string; format: string }> {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'auto' },
        (error, result?: UploadApiResponse) => {
          if (error || !result) {
            logOperationalFailure({ operation: 'upload.buffer', stage: 'cloudinary_request', provider: 'cloudinary', error: error ?? new Error('Missing Cloudinary response'), correlationId, durationMs: Date.now() - startedAt });
            return reject(error || new Error('Upload to Cloudinary failed'));
          }
          resolve({
            secureUrl: result.secure_url,
            publicId: result.public_id,
            format: result.format || 'unknown'
          });
        }
      );
      stream.end(buffer);
    });
  }

  static async uploadInventoryImage(buffer: Buffer, folder: string, publicId: string, correlationId = randomUUID()): Promise<{ secureUrl: string; publicId: string; format: string; width: number; height: number }> {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, public_id: publicId, overwrite: true, unique_filename: false, resource_type: 'image', type: 'upload' },
        (error, result?: UploadApiResponse) => {
          if (error || !result) {
            logOperationalFailure({ operation: 'upload.inventory_image', stage: 'cloudinary_request', provider: 'cloudinary', error: error ?? new Error('Missing Cloudinary response'), correlationId, durationMs: Date.now() - startedAt });
            return reject(error || new Error('Upload to Cloudinary failed'));
          }
          resolve({ secureUrl: result.secure_url, publicId: result.public_id, format: result.format || 'unknown', width: result.width, height: result.height });
        },
      );
      stream.end(buffer);
    });
  }

  /**
   * Delete asset from Cloudinary
   */
  static async deleteAsset(publicId: string, suppliedCorrelationId = randomUUID()): Promise<any> {
    const correlationId = suppliedCorrelationId, startedAt = Date.now();
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      if (result?.result === 'error') logOperationalFailure({ operation: 'upload.cleanup', stage: 'cloudinary_delete', provider: 'cloudinary', error: Object.assign(new Error(), { http_code: result?.http_code }), correlationId, durationMs: Date.now() - startedAt });
      return result;
    }
    catch (error) { logOperationalFailure({ operation: 'upload.cleanup', stage: 'cloudinary_delete', provider: 'cloudinary', error, correlationId, durationMs: Date.now() - startedAt }); throw error; }
  }
}
