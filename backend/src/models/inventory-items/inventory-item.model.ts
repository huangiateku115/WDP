import mongoose, { Schema } from 'mongoose';
import { IInventoryItem, InventoryItemStatus, ReceivingCustodyStatus, ReceivingInspectionDecision } from '../../types/inventory-item.type';
import { isValidImageList } from '../../utils/image-url';

const dimensionsSchema = new Schema({
  widthM: { type: Number, required: true, min: Number.MIN_VALUE },
  depthM: { type: Number, required: true, min: Number.MIN_VALUE },
  heightM: { type: Number, required: true, min: Number.MIN_VALUE },
}, { _id: false });

const schema = new Schema<IInventoryItem>({
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  managedReservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, index: true },
  itemCode: { type: String, required: true, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, trim: true, maxlength: 2000 },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  quantityUnit: { type: String, required: true, trim: true, maxlength: 32 },
  unitWeightKg: { type: Number, required: true, min: Number.MIN_VALUE },
  unitDimensionsM: { type: dimensionsSchema, required: true },
  unitVolumeM3: { type: Number, required: true, min: Number.MIN_VALUE },
  totalWeightKg: { type: Number, required: true, min: Number.MIN_VALUE },
  totalVolumeM3: { type: Number, required: true, min: Number.MIN_VALUE },
  preferredCellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell' },
  currentCellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', default: null },
  status: { type: String, enum: Object.values(InventoryItemStatus), default: InventoryItemStatus.REGISTERED, required: true },
  inboundRequestedAt: { type: Date },
  inboundRequestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  inboundConfirmedAt: { type: Date },
  inboundConfirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  inboundMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement' },
  inboundRejection: {
    reason: { type: String, trim: true, maxlength: 1000 },
    rejectedAt: { type: Date },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  inboundIdempotencyKey: { type: String, trim: true, maxlength: 128 },
  outboundRequestedAt: { type: Date },
  outboundRequestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  outboundConfirmedAt: { type: Date },
  outboundConfirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  outboundMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement' },
  outboundHandoverNote: { type: String, trim: true, maxlength: 1000 },
  outboundVerifiedQuantity: { type: Number, min: 1, validate: Number.isSafeInteger },
  outboundIdempotencyKey: { type: String, trim: true, maxlength: 128 },
  outboundRejection: {
    reason: { type: String, trim: true, maxlength: 1000 },
    rejectedAt: { type: Date },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  receivingCustodyStatus: { type: String, enum: Object.values(ReceivingCustodyStatus), default: ReceivingCustodyStatus.NONE },
  receivingInspection: {
    decision: { type: String, enum: Object.values(ReceivingInspectionDecision) },
    observedQuantity: { type: Number, min: 1 },
    observedUnitWeightKg: { type: Number, min: Number.MIN_VALUE },
    observedUnitDimensionsM: { type: dimensionsSchema },
    compatibleWithCellIds: [{ type: Schema.Types.ObjectId, ref: 'WarehouseCell' }],
    packingLayoutVerified: { type: Boolean, default: false },
    note: { type: String, trim: true, maxlength: 1000 },
    inspectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    inspectedAt: { type: Date },
  },
  images: {
    type: [{ type: String, trim: true }],
    default: [],
    validate: { validator: isValidImageList, message: 'images must contain at most 10 valid HTTP(S) URLs' },
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  deletedAt: { type: Date },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });

// Item identifiers remain reserved in their Facility, including after soft deletion.
schema.index({ facilityId: 1, itemCode: 1 }, { unique: true });
schema.index({ facilityId: 1, status: 1, createdAt: -1 });
schema.index({ customerId: 1, managedReservationId: 1, createdAt: -1 });
schema.index({ preferredCellId: 1 });
schema.index({ deletedAt: 1 });

export default mongoose.model<IInventoryItem>('InventoryItem', schema);
