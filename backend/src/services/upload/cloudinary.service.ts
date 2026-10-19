import cloudinary from '../../config/cloudinary.config';
import { UploadApiResponse } from 'cloudinary';

export class CloudinaryService {
  /**
   * Upload buffer directly to Cloudinary using upload_stream
   */
  static async uploadBuffer(
    buffer: Buffer,
    folder: string = 'wdp/signed-contracts'
  ): Promise<{ secureUrl: string; publicId: string; format: string }> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'auto' },
        (error, result?: UploadApiResponse) => {
          if (error || !result) {
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

  /**
   * Delete asset from Cloudinary
   */
  static async deleteAsset(publicId: string): Promise<any> {
    return cloudinary.uploader.destroy(publicId);
  }
}
