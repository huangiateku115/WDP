import { randomUUID } from 'crypto';
import { ClientSession, Types } from 'mongoose';
import ReceivingInspectionUploadModel from '../../models/inventory-items/receiving-inspection-upload.model';
import ReceivingInspectionEvidenceModel from '../../models/inventory-items/receiving-inspection-evidence.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { InventoryItemStatus } from '../../types/inventory-item.type';
import { UserRole } from '../../types/user.type';
import { InventoryItemError } from '../inventory-items/inventory-item.validation';
import { validateInventoryImage, INVENTORY_IMAGE_MAX_BYTES } from './inventory-image-validation.service';
import { CloudinaryService } from './cloudinary.service';

const EvidenceUploads: any = ReceivingInspectionUploadModel;

const UPLOAD_LEASE_MS = 2 * 60 * 60 * 1000;
const CLEANUP_LEASE_MS = 30 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
type StaffActor = { _id: Types.ObjectId; role: string; assignedFacilityId?: Types.ObjectId | null };
const fail = (status: number, message: string): never => { throw new InventoryItemError(status, message); };
const idValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

export class ManagedReceivingEvidenceService {
  static async upload(itemIdInput: unknown, file: Express.Multer.File | undefined, keyInput: unknown, actor: StaffActor) {
    if (actor.role !== UserRole.FACILITY_STAFF) fail(403, 'Facility Staff role required');
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') fail(503, 'Public receiving evidence delivery is disabled outside development/test');
    if (!idValid(itemIdInput)) fail(400, 'A valid Item and image file are required');
    if (!file || !file.buffer) fail(400, 'A valid Item and image file are required');
    const uploadedFile = file as Express.Multer.File;
    if (typeof keyInput !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(keyInput)) fail(400, 'A valid Idempotency-Key header is required');
    if (!actor.assignedFacilityId) fail(403, 'Assigned Facility is required');
    const item: any = await (InventoryItemModel as any).findOne({ _id: itemIdInput, facilityId: actor.assignedFacilityId, deletedAt: { $exists: false } }).exec();
    if (!item) fail(404, 'Managed Inventory Item not found in assigned Facility');
    if (![InventoryItemStatus.PENDING_INBOUND, InventoryItemStatus.RECEIVED_PENDING_ACCEPTANCE].includes(item.status)) fail(409, 'Item is not eligible for receiving inspection');
    const reservation: any = await (ReservationModel as any).findOne({ _id: item.managedReservationId, facilityId: actor.assignedFacilityId,
      serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 2, status: 'DEPOSIT_PAID', balanceSettledAt: { $exists: false } }).select('_id').exec();
    if (!reservation) fail(409, 'Evidence uploads require an unsettled DEPOSIT_PAID Managed V2 Reservation');
    if (uploadedFile.size > INVENTORY_IMAGE_MAX_BYTES) fail(400, 'Image must be no larger than 8 MiB');
    const image = await validateInventoryImage(uploadedFile.buffer, uploadedFile.mimetype);
    const filter = { itemId: item._id, staffId: actor._id, idempotencyKey: keyInput };
    let upload: any = await (ReceivingInspectionUploadModel as any).findOne(filter).exec();
    let leaseToken = randomUUID();
    if (upload) {
      if (upload.sha256 !== image.sha256) fail(409, 'Idempotency-Key was already used with different image bytes');
      if (upload.status === 'UNATTACHED' && upload.expiresAt > new Date()) return this.dto(upload);
      if (upload.status !== 'UPLOADING' || upload.expiresAt <= new Date()) fail(409, 'Evidence upload is no longer available');
      upload = await (ReceivingInspectionUploadModel as any).findOneAndUpdate({ _id: upload._id, status: 'UPLOADING', expiresAt: { $gt: new Date() }, $or: [{ uploadLeaseUntil: { $exists: false } }, { uploadLeaseUntil: { $lte: new Date() } }] }, { $set: { uploadLeaseToken: leaseToken, uploadLeaseUntil: new Date(Date.now() + UPLOAD_LEASE_MS) } }, { new: true }).exec();
      if (!upload) fail(409, 'Evidence upload is already in progress; retry shortly');
    } else {
      const generatedPublicId = randomUUID();
      const folder = `wdp/managed-receiving/${actor.assignedFacilityId}/${item._id}`;
      for (let slot = 0; slot < 20; slot += 1) {
        try {
          [upload] = await (ReceivingInspectionUploadModel as any).create([{
            ...filter, facilityId: actor.assignedFacilityId, sha256: image.sha256,
            secureUrl: `pending://managed-receiving/${generatedPublicId}`, publicId: `${folder}/${generatedPublicId}`,
            generatedPublicId, folder, width: image.width, height: image.height, format: image.format,
            status: 'UPLOADING', quotaSlot: slot, uploadLeaseToken: leaseToken,
            uploadLeaseUntil: new Date(Date.now() + UPLOAD_LEASE_MS), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), nextDeleteAt: new Date(),
          }]);
          break;
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
          const raced = await (ReceivingInspectionUploadModel as any).findOne(filter).exec();
          if (raced) {
            if (raced.sha256 !== image.sha256) fail(409, 'Idempotency-Key was already used with different image bytes');
            if (raced.status === 'UNATTACHED' && raced.expiresAt > new Date()) return this.dto(raced);
            fail(409, 'Evidence upload is already in progress or no longer available');
          }
        }
      }
      if (!upload) fail(429, 'Too many unattached evidence uploads for this Item');
    }
    try {
      const asset = await CloudinaryService.uploadInventoryImage(uploadedFile.buffer, upload.folder, upload.generatedPublicId);
      if (!asset.secureUrl.startsWith('https://') || asset.width !== image.width || asset.height !== image.height || asset.format.toLowerCase() !== image.format) fail(502, 'Cloudinary metadata did not match the validated image');
      const finalized = await (ReceivingInspectionUploadModel as any).findOneAndUpdate({ _id: upload._id, status: 'UPLOADING', uploadLeaseToken: leaseToken }, {
        $set: { status: 'UNATTACHED', secureUrl: asset.secureUrl, publicId: asset.publicId, nextDeleteAt: new Date() }, $unset: { uploadLeaseToken: 1, uploadLeaseUntil: 1 },
      }, { new: true }).exec();
      if (!finalized) fail(409, 'Evidence upload changed while finalizing; retry with the same key');
      return this.dto(finalized);
    } catch (error) {
      if (error instanceof InventoryItemError) throw error;
      throw new InventoryItemError(502, 'Evidence upload could not be finalized; retry with the same Idempotency-Key');
    } finally {
      await (ReceivingInspectionUploadModel as any).updateOne({ _id: upload._id, status: 'UPLOADING', uploadLeaseToken: leaseToken }, { $unset: { uploadLeaseToken: 1, uploadLeaseUntil: 1 } }).exec().catch(() => undefined);
    }
  }

  static async attach(uploadIds: Types.ObjectId[], itemId: Types.ObjectId, facilityId: Types.ObjectId, staffId: Types.ObjectId, snapshotId: Types.ObjectId, session: ClientSession) {
    if (uploadIds.length > 10 || new Set(uploadIds.map(String)).size !== uploadIds.length) fail(400, 'Provide up to 10 unique evidence uploads');
    const images = [];
    for (const uploadId of uploadIds) {
      const upload: any = await EvidenceUploads.findOne({ _id: uploadId, itemId, facilityId, staffId, status: 'UNATTACHED', expiresAt: { $gt: new Date() } }).session(session).exec();
      if (!upload) fail(409, 'Evidence upload is unavailable, expired, or belongs to another Facility Staff/Item');
      const changed = await EvidenceUploads.updateOne({ _id: upload._id, itemId, facilityId, staffId, status: 'UNATTACHED', expiresAt: { $gt: new Date() } }, { $set: { status: 'ATTACHED', snapshotId }, $unset: { quotaSlot: 1, nextDeleteAt: 1 } }, { session }).exec();
      if (changed.modifiedCount !== 1) fail(409, 'Evidence upload was attached or claimed concurrently');
      images.push({ uploadId: upload._id, secureUrl: upload.secureUrl, publicId: upload.publicId, sha256: upload.sha256, width: upload.width, height: upload.height, format: upload.format });
    }
    return images;
  }

  static async listForItem(itemId: Types.ObjectId, facilityId: Types.ObjectId) {
    return ReceivingInspectionEvidenceModel.find({ itemId, facilityId }).sort({ attempt: 1 }).lean().exec();
  }

  static async cleanupExpired(limit = 50) {
    const now = new Date();
    let deleted = 0;
    for (let i = 0; i < limit; i += 1) {
      const token = randomUUID();
      const upload = await EvidenceUploads.findOneAndUpdate({ status: { $in: ['UPLOADING', 'UNATTACHED'] }, expiresAt: { $lte: now }, $or: [{ uploadLeaseUntil: { $exists: false } }, { uploadLeaseUntil: { $lte: now } }] }, { $set: { status: 'DELETE_PENDING', cleanupLeaseToken: token, cleanupLeaseUntil: new Date(Date.now() + CLEANUP_LEASE_MS) }, $unset: { uploadLeaseToken: 1, uploadLeaseUntil: 1 } }, { new: true }).sort({ expiresAt: 1 }).exec();
      if (!upload) break;
      if (await this.deleteClaimed(upload)) deleted += 1;
    }
    for (let i = 0; i < limit; i += 1) {
      const nowRetry = new Date(), token = randomUUID();
      const upload = await EvidenceUploads.findOneAndUpdate({ status: 'DELETE_PENDING', nextDeleteAt: { $lte: nowRetry }, $or: [{ cleanupLeaseUntil: { $exists: false } }, { cleanupLeaseUntil: { $lte: nowRetry } }] }, { $set: { cleanupLeaseToken: token, cleanupLeaseUntil: new Date(Date.now() + CLEANUP_LEASE_MS) } }, { new: true }).sort({ nextDeleteAt: 1 }).exec();
      if (!upload) break;
      if (await this.deleteClaimed(upload)) deleted += 1;
    }
    return { deleted };
  }

  private static async deleteClaimed(upload: any) {
    const filter = { _id: upload._id, status: 'DELETE_PENDING', cleanupLeaseToken: upload.cleanupLeaseToken };
    try {
      const result = await CloudinaryService.deleteAsset(upload.publicId);
      if (result?.result === 'error') throw new Error('Cloudinary rejected evidence deletion');
      const saved = await (ReceivingInspectionUploadModel as any).updateOne(filter, { $set: { status: 'DELETED' }, $unset: { quotaSlot: 1, nextDeleteAt: 1, cleanupLeaseToken: 1, cleanupLeaseUntil: 1 } }).exec();
      return saved.modifiedCount === 1;
    } catch {
      const attempts = (upload.deleteAttempts || 0) + 1;
      await (ReceivingInspectionUploadModel as any).updateOne(filter, { $set: { deleteAttempts: attempts, nextDeleteAt: new Date(Date.now() + Math.min(RETRY_MS * 2 ** Math.min(attempts - 1, 6), 86400000)) }, $unset: { cleanupLeaseToken: 1, cleanupLeaseUntil: 1 } }).exec().catch(() => undefined);
      return false;
    }
  }

  private static dto(upload: any) { return { uploadId: upload._id, secureUrl: upload.secureUrl, publicId: upload.publicId, width: upload.width, height: upload.height, format: upload.format, expiresAt: upload.expiresAt }; }
}
