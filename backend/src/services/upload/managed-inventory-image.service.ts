import mongoose, { ClientSession, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import InventoryImageUploadModel from '../../models/inventory-items/inventory-image-upload.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import { UserRole } from '../../types/user.type';
import { requireManagedInventoryReservationForRegistration } from '../reservations/managed-inventory-reservation.guard';
import { InventoryItemError } from '../inventory-items/inventory-item.validation';
import { CloudinaryService } from './cloudinary.service';
import { INVENTORY_IMAGE_MAX_BYTES, INVENTORY_IMAGE_MAX_COUNT, validateInventoryImage } from './inventory-image-validation.service';

const UNATTACHED_LIMIT = 20;
const UPLOAD_LEASE_MS = 2 * 60 * 60 * 1000;
const CLEANUP_LEASE_MS = 30 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const ACTIVE_QUOTA_STATUSES = ['UPLOADING', 'UNATTACHED', 'DELETE_PENDING'];
const ACTIVE_UPLOAD_LEASE = (now: Date) => ({ $or: [{ uploadLeaseUntil: { $exists: false } }, { uploadLeaseUntil: { $lte: now } }] });
const AVAILABLE_CLEANUP_LEASE = (now: Date) => ({ $or: [{ cleanupLeaseUntil: { $exists: false } }, { cleanupLeaseUntil: { $lte: now } }] });

type CustomerActor = { _id: Types.ObjectId; role: string };

function assertCustomer(actor: CustomerActor) {
  if (actor.role !== UserRole.CUSTOMER) throw new InventoryItemError(403, 'Only customers may upload inventory images');
}

function isDuplicateKey(error: unknown) { return (error as { code?: number })?.code === 11000; }

export class ManagedInventoryImageService {
  static async upload(file: Express.Multer.File | undefined, reservationInput: unknown, keyInput: unknown, actor: CustomerActor) {
    assertCustomer(actor);
    if (process.env.NODE_ENV === 'production') throw new InventoryItemError(503, 'Public item-image delivery is disabled in production until a private asset access policy is configured');
    if (!file?.buffer) throw new InventoryItemError(400, 'Image file is required');
    if (typeof reservationInput !== 'string' || !Types.ObjectId.isValid(reservationInput)) throw new InventoryItemError(400, 'Valid managedReservationId is required');
    if (typeof keyInput !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(keyInput)) throw new InventoryItemError(400, 'A valid Idempotency-Key header is required');
    if (file.size > INVENTORY_IMAGE_MAX_BYTES) throw new InventoryItemError(400, 'Image must be no larger than 8 MiB');
    const image = await validateInventoryImage(file.buffer, file.mimetype);
    const reservation = await requireManagedInventoryReservationForRegistration(reservationInput, actor._id);
    const keyFilter = { customerId: actor._id, managedReservationId: reservation._id, idempotencyKey: keyInput };
    let upload: any = await InventoryImageUploadModel.findOne(keyFilter).exec();
    let uploadLeaseToken: string;

    if (upload) {
      if (upload.sha256 !== image.sha256) throw new InventoryItemError(409, 'Idempotency-Key was already used with a different image');
      if (upload.status === 'UNATTACHED' && !upload.discardRequestedAt && upload.expiresAt > new Date()) return this.dto(upload);
      if (upload.status !== 'UPLOADING' || upload.expiresAt <= new Date() || upload.discardRequestedAt) throw new InventoryItemError(409, 'This image upload is no longer available');
      uploadLeaseToken = randomUUID();
      upload = await InventoryImageUploadModel.findOneAndUpdate({
        _id: upload._id, status: 'UPLOADING', sha256: image.sha256, discardRequestedAt: { $exists: false }, expiresAt: { $gt: new Date() }, ...ACTIVE_UPLOAD_LEASE(new Date()),
      }, { $set: { uploadLeaseToken, uploadLeaseUntil: new Date(Date.now() + UPLOAD_LEASE_MS) } }, { new: true }).exec();
      if (!upload) throw new InventoryItemError(409, 'This image upload is already in progress; retry the same request shortly');
    } else {
      uploadLeaseToken = randomUUID();
      upload = await this.reserveUploadSlot({ keyFilter, image, actor, reservation, uploadLeaseToken });
      if (upload.status === 'UNATTACHED') return this.dto(upload);
    }

    try {
      const asset = await CloudinaryService.uploadInventoryImage(file.buffer, upload.folder, upload.generatedPublicId);
      if (!asset.secureUrl.startsWith('https://') || asset.width !== image.width || asset.height !== image.height || asset.format.toLowerCase() !== image.format) {
        await InventoryImageUploadModel.updateOne({ _id: upload._id, status: 'UPLOADING', uploadLeaseToken }, {
          $set: { status: 'DELETE_PENDING', nextDeleteAt: upload.expiresAt, lastDeleteError: 'Cloudinary metadata did not match validated image' },
          $unset: { uploadLeaseToken: 1, uploadLeaseUntil: 1 },
        }).exec();
        throw new InventoryItemError(502, 'Cloudinary returned image metadata inconsistent with the validated upload');
      }
      const finalized = await InventoryImageUploadModel.findOneAndUpdate({ _id: upload._id, status: 'UPLOADING', uploadLeaseToken }, {
        $set: { status: 'UNATTACHED', secureUrl: asset.secureUrl, publicId: asset.publicId, width: image.width, height: image.height, format: image.format, nextDeleteAt: new Date() },
        $unset: { uploadLeaseToken: 1, uploadLeaseUntil: 1 },
      }, { new: true }).exec();
      if (!finalized) throw new InventoryItemError(409, 'Upload changed while finalizing; retry with the same Idempotency-Key');
      return this.dto(finalized);
    } catch (error) {
      if (error instanceof InventoryItemError) throw error;
      // The UPLOADING record was persisted before contacting Cloudinary. A retry reuses its server-assigned public ID.
      throw new InventoryItemError(502, 'Cloudinary image upload could not be finalized; retry with the same Idempotency-Key');
    } finally {
      await InventoryImageUploadModel.updateOne({ _id: upload._id, status: 'UPLOADING', uploadLeaseToken }, { $unset: { uploadLeaseToken: 1, uploadLeaseUntil: 1 } }).exec().catch(() => undefined);
    }
  }

  private static async reserveUploadSlot(input: {
    keyFilter: { customerId: Types.ObjectId; managedReservationId: Types.ObjectId; idempotencyKey: string };
    image: { sha256: string; width: number; height: number; format: 'jpg' | 'png' | 'webp' };
    actor: CustomerActor;
    reservation: any;
    uploadLeaseToken: string;
  }) {
    const { keyFilter, image, actor, reservation, uploadLeaseToken } = input;
    // Legacy unattached uploads lack quotaSlot; count them conservatively. New uploads are bounded by unique slot claims.
    const legacyFilter: any = {
      customerId: actor._id, managedReservationId: reservation._id, status: { $in: ACTIVE_QUOTA_STATUSES }, quotaSlot: { $exists: false },
    };
    const legacyCount = await InventoryImageUploadModel.countDocuments(legacyFilter).exec();
    const slotLimit = Math.max(0, UNATTACHED_LIMIT - legacyCount);
    if (!slotLimit) throw new InventoryItemError(429, 'Too many unused inventory image uploads; remove some or wait for expiry');

    const generatedPublicId = randomUUID();
    const folder = `wdp/managed-inventory/${actor._id.toString()}/${reservation._id.toString()}`;
    const now = new Date();
    for (let slot = 0; slot < slotLimit; slot += 1) {
      try {
        const [created] = await InventoryImageUploadModel.create([{
          ...keyFilter, customerId: actor._id, managedReservationId: reservation._id, facilityId: reservation.facilityId,
          // A non-HTTP placeholder keeps the existing unique URL index intact until Cloudinary returns its URL.
          secureUrl: `pending://managed-inventory/${generatedPublicId}`, publicId: `${folder}/${generatedPublicId}`,
          generatedPublicId, folder, sha256: image.sha256, width: image.width, height: image.height, format: image.format,
          status: 'UPLOADING', quotaSlot: slot, uploadLeaseToken, uploadLeaseUntil: new Date(now.getTime() + UPLOAD_LEASE_MS),
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), nextDeleteAt: now,
        }]);
        return created;
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const raced = await InventoryImageUploadModel.findOne(keyFilter).exec();
        if (raced) {
          if (raced.sha256 !== image.sha256) throw new InventoryItemError(409, 'Idempotency-Key was already used with a different image');
          if (raced.status === 'UNATTACHED' && !raced.discardRequestedAt && raced.expiresAt > new Date()) return raced;
          throw new InventoryItemError(409, 'This image upload is already in progress or no longer available; retry shortly');
        }
        // The unique customer/reservation/slot index is the concurrency guarantee; try the next free slot.
      }
    }
    throw new InventoryItemError(429, 'Too many unused inventory image uploads; remove some or wait for expiry');
  }

  static async remove(uploadIdInput: unknown, actor: CustomerActor) {
    assertCustomer(actor);
    if (typeof uploadIdInput !== 'string' || !Types.ObjectId.isValid(uploadIdInput)) throw new InventoryItemError(400, 'Invalid upload ID');
    const upload = await InventoryImageUploadModel.findOne({ _id: uploadIdInput, customerId: actor._id }).exec();
    if (!upload) throw new InventoryItemError(404, 'Image upload not found');
    if (upload.status === 'ATTACHED') throw new InventoryItemError(409, 'Attached item images are retained and cannot be deleted through upload cleanup');
    if (upload.status === 'DELETED') return { deleted: true };
    if (upload.status === 'UPLOADING' || upload.status === 'UNATTACHED') {
      const scheduled = await InventoryImageUploadModel.findOneAndUpdate({ _id: upload._id, customerId: actor._id, status: upload.status }, { $set: { discardRequestedAt: new Date() } }, { new: true }).exec();
      if (!scheduled) throw new InventoryItemError(409, 'Image upload changed; refresh and retry');
      return { deleted: false, scheduledFor: scheduled.expiresAt };
    }
    if (await InventoryItemModel.exists({ images: upload.secureUrl }).exec()) throw new InventoryItemError(409, 'This image is referenced by an Item and will be retained');
    return { deleted: false, scheduledFor: upload.nextDeleteAt };
  }

  static async attachNewImages(urls: string[], currentUrls: string[], itemId: Types.ObjectId, customerId: Types.ObjectId, reservationId: Types.ObjectId, session: ClientSession) {
    if (urls.length > INVENTORY_IMAGE_MAX_COUNT) throw new InventoryItemError(400, 'At most 10 Item images are allowed');
    const old = new Set(currentUrls);
    for (const url of [...new Set(urls)]) {
      if (old.has(url)) continue; // Legacy URLs already on this same Item remain valid.
      const upload = await InventoryImageUploadModel.findOne({ secureUrl: url, customerId, managedReservationId: reservationId }).session(session).exec();
      if (!upload) throw new InventoryItemError(403, 'New image URL is not an upload owned by this Customer and Reservation');
      if (upload.status === 'ATTACHED') {
        if (!upload.itemId?.equals(itemId)) throw new InventoryItemError(409, 'Image is already attached to another Item');
        continue;
      }
      if (upload.status !== 'UNATTACHED' || upload.discardRequestedAt || upload.expiresAt <= new Date()) throw new InventoryItemError(409, 'Image upload is expired or unavailable');
      const claimed = await InventoryImageUploadModel.updateOne({ _id: upload._id, customerId, managedReservationId: reservationId, status: 'UNATTACHED', discardRequestedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, {
        $set: { status: 'ATTACHED', itemId }, $unset: { quotaSlot: 1, nextDeleteAt: 1 },
      }, { session }).exec();
      if (claimed.modifiedCount !== 1) throw new InventoryItemError(409, 'Image upload was attached or claimed for cleanup concurrently; reload and retry');
    }
  }

  static async cleanupExpired(limit = 50) {
    const now = new Date();
    const candidates = await InventoryImageUploadModel.find({
      status: { $in: ['UPLOADING', 'UNATTACHED'] }, expiresAt: { $lte: now }, nextDeleteAt: { $lte: now }, ...ACTIVE_UPLOAD_LEASE(now),
    }).sort({ expiresAt: 1 }).limit(limit).select({ _id: 1 }).lean().exec();
    let deleted = 0;
    for (const candidate of candidates) {
      const claimed = await this.claimForCleanup(candidate._id);
      if (claimed && await this.deleteClaimed(claimed)) deleted += 1;
    }
    for (let attempt = 0; attempt < limit; attempt += 1) {
      const claimed = await this.claimDeleteRetry();
      if (!claimed) break;
      if (claimed.secureUrl && await InventoryItemModel.exists({ images: claimed.secureUrl }).exec()) {
        const retainFilter: any = { _id: claimed._id, status: 'DELETE_PENDING', cleanupLeaseToken: claimed.cleanupLeaseToken };
        await InventoryImageUploadModel.updateOne(retainFilter, {
          $set: { status: 'ATTACHED', lastDeleteError: 'Referenced by an InventoryItem; retained' },
          $unset: { cleanupLeaseToken: 1, cleanupLeaseUntil: 1, quotaSlot: 1, nextDeleteAt: 1 },
        }).exec().catch(() => undefined);
        continue;
      }
      if (await this.deleteClaimed(claimed)) deleted += 1;
    }
    return { deleted };
  }

  private static async claimForCleanup(id: Types.ObjectId) {
    const session = await mongoose.startSession();
    try {
      let claimed: any = null;
      await session.withTransaction(async () => {
        const now = new Date();
        const upload = await InventoryImageUploadModel.findOne({
          _id: id, status: { $in: ['UPLOADING', 'UNATTACHED'] }, expiresAt: { $lte: now }, nextDeleteAt: { $lte: now }, ...ACTIVE_UPLOAD_LEASE(now),
        }).session(session).exec();
        if (!upload) return;
        if (upload.secureUrl?.startsWith('http') && await InventoryItemModel.exists({ images: upload.secureUrl }).session(session).exec()) {
          await InventoryImageUploadModel.updateOne({ _id: upload._id, status: upload.status }, {
            $set: { status: 'ATTACHED', lastDeleteError: 'Referenced by an InventoryItem; retained' },
            $unset: { quotaSlot: 1, uploadLeaseToken: 1, uploadLeaseUntil: 1, nextDeleteAt: 1 },
          }, { session }).exec();
          return;
        }
        const cleanupLeaseToken = randomUUID();
        claimed = await InventoryImageUploadModel.findOneAndUpdate({
          _id: upload._id, status: upload.status, expiresAt: { $lte: now }, ...ACTIVE_UPLOAD_LEASE(now),
        }, {
          $set: { status: 'DELETE_PENDING', cleanupLeaseToken, cleanupLeaseUntil: new Date(Date.now() + CLEANUP_LEASE_MS) },
          $unset: { discardRequestedAt: 1, uploadLeaseToken: 1, uploadLeaseUntil: 1 },
        }, { new: true, session }).exec();
      });
      return claimed;
    } finally { await session.endSession(); }
  }

  private static async claimDeleteRetry() {
    const now = new Date(), cleanupLeaseToken = randomUUID();
    return InventoryImageUploadModel.findOneAndUpdate({
      status: 'DELETE_PENDING', nextDeleteAt: { $lte: now }, ...AVAILABLE_CLEANUP_LEASE(now),
    }, { $set: { cleanupLeaseToken, cleanupLeaseUntil: new Date(now.getTime() + CLEANUP_LEASE_MS) } }, { new: true }).sort({ nextDeleteAt: 1 }).exec();
  }

  private static async deleteClaimed(upload: any) {
    const filter: any = { _id: upload._id, status: 'DELETE_PENDING', cleanupLeaseToken: upload.cleanupLeaseToken };
    try {
      const result = await CloudinaryService.deleteAsset(upload.publicId);
      if (result?.result === 'error') throw new Error('Cloudinary reported deletion failure');
    } catch {
      const attempts = (upload.deleteAttempts || 0) + 1;
      const delay = Math.min(RETRY_MS * (2 ** Math.min(attempts - 1, 6)), 24 * 60 * 60 * 1000);
      await InventoryImageUploadModel.updateOne(filter, {
        $set: { deleteAttempts: attempts, nextDeleteAt: new Date(Date.now() + delay), lastDeleteError: 'Cloudinary deletion failed; scheduled for retry' },
        $unset: { cleanupLeaseToken: 1, cleanupLeaseUntil: 1 },
      }).exec().catch(() => undefined);
      return false;
    }
    // If Cloudinary succeeded but MongoDB is unavailable, retain the lease until it expires. A later worker safely repeats destroy().
    try {
      const saved = await InventoryImageUploadModel.updateOne(filter, {
        $set: { status: 'DELETED' },
        $unset: { nextDeleteAt: 1, cleanupLeaseToken: 1, cleanupLeaseUntil: 1, quotaSlot: 1, lastDeleteError: 1 },
      }).exec();
      return saved.modifiedCount === 1;
    } catch { return false; }
  }

  private static dto(upload: any) {
    return { uploadId: upload._id, secureUrl: upload.secureUrl, publicId: upload.publicId, width: upload.width, height: upload.height, format: upload.format, expiresAt: upload.expiresAt };
  }
}
