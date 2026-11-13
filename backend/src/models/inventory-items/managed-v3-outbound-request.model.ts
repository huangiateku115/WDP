import mongoose, { Schema } from 'mongoose';
import { IManagedV3OutboundRequest, ManagedV3OutboundState } from '../../types/managed-inventory-v3-outbound.type';

const pose = new Schema({ xStartM: { type: Number, required: true }, yStartM: { type: Number, required: true }, rotationDeg: { type: Number, enum: [0, 90], required: true } }, { _id: false, strict: 'throw', immutable: true });
const allocation = new Schema({ itemKind: { type: String, enum: ['A1_PHYSICAL_UNIT', 'A2_BATCH'], required: true }, batchId: { type: String, trim: true, maxlength: 128 },
  physicalUnitId: { type: Schema.Types.ObjectId, ref: 'ManagedV3PhysicalUnit' }, cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }, quantityUnit: { type: String, required: true, trim: true, maxlength: 32 },
  weightKg: { type: Number, required: true, min: Number.MIN_VALUE }, volumeM3: { type: Number, required: true, min: Number.MIN_VALUE },
  receiptMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement', immutable: true }, topologyCertificationId: { type: Schema.Types.ObjectId, required: true },
  topologyRevision: { type: Number, required: true, min: 1, validate: Number.isSafeInteger }, pose,
}, { _id: false, strict: 'throw', immutable: true });
const customerAttestation = new Schema({ confirmedAt: { type: Date, required: true }, customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, trim: true, maxlength: 500, required: true } }, { _id: false, strict: 'throw' });
const schema = new Schema<IManagedV3OutboundRequest>({
  skuId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, immutable: true, index: true }, reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true }, facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true, index: true },
  itemKind: { type: String, enum: ['A1_PHYSICAL_UNIT', 'A2_BATCH'], required: true, immutable: true }, requestedQuantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, immutable: true },
  quantityUnit: { type: String, required: true, trim: true, maxlength: 32, immutable: true }, allocations: { type: [allocation], required: true, immutable: true },
  state: { type: String, enum: Object.values(ManagedV3OutboundState), required: true, default: ManagedV3OutboundState.PENDING }, version: { type: Number, required: true, min: 0, validate: Number.isSafeInteger, default: 0 },
  idempotencyKey: { type: String, required: true, trim: true, minlength: 8, maxlength: 128, immutable: true }, requestHash: { type: String, required: true, match: /^[a-f\d]{64}$/i, immutable: true },
  createdAt: { type: Date, required: true, immutable: true, default: Date.now }, cancelledAt: Date, confirmedAt: Date, confirmedMovementId: { type: Schema.Types.ObjectId, ref: 'ItemMovement' },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' }, customerAttestation: { type: customerAttestation, default: undefined },
}, { timestamps: { createdAt: false }, strict: 'throw', optimisticConcurrency: true });
schema.index({ skuId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ skuId: 1 }, { unique: true, name: 'managed_v3_outbound_one_pending_per_sku', partialFilterExpression: { state: ManagedV3OutboundState.PENDING } });
schema.index({ customerId: 1, reservationId: 1, state: 1, createdAt: -1, _id: -1 }); schema.index({ facilityId: 1, state: 1, createdAt: 1, _id: 1 });
schema.pre('validate', function () {
  const rows = this.allocations ?? [], keys = rows.map(row => row.itemKind === 'A1_PHYSICAL_UNIT' ? `U:${row.physicalUnitId}:${row.cellId}` : `B:${row.batchId}:${row.cellId}`);
  const total = this.itemKind === 'A1_PHYSICAL_UNIT' ? new Set(rows.map(row => String(row.physicalUnitId))).size : rows.reduce((n, row) => n + row.quantity, 0);
  if (!rows.length || rows.some(row => row.itemKind !== this.itemKind) || new Set(keys).size !== keys.length || total !== this.requestedQuantity ||
      rows.some(row => this.itemKind === 'A2_BATCH' ? (!row.batchId || !row.receiptMovementId || row.physicalUnitId != null || row.pose != null) : (!row.physicalUnitId || row.batchId != null))) this.invalidate('allocations', 'Outbound allocations must uniquely and exactly represent the requested V3 stock');
  if (this.state === ManagedV3OutboundState.CANCELLED && !this.cancelledAt) this.invalidate('cancelledAt', 'Cancelled request requires a timestamp');
  if (this.state === ManagedV3OutboundState.CONFIRMED && (!this.confirmedAt || !this.confirmedMovementId || !this.confirmedBy || !this.customerAttestation)) this.invalidate('confirmedMovementId', 'Confirmed request must link the canonical movement and Customer attestation');
  if (this.state === ManagedV3OutboundState.PENDING && (this.cancelledAt || this.confirmedAt || this.confirmedMovementId || this.confirmedBy || this.customerAttestation)) this.invalidate('state', 'Pending request cannot contain terminal facts');
});
export default mongoose.model<IManagedV3OutboundRequest>('ManagedV3OutboundRequest', schema);
