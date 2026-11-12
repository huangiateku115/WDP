import mongoose, { Schema } from 'mongoose';
import { IManagedV3Footprint } from '../../types/managed-inventory-v3.type';

const footprintCell = new Schema({ cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true },
  supportReactionKg: { type: Number, required: true, min: 0 }, occupiedVolumeM3: { type: Number, required: true, min: 0 },
  topologyRevision: { type: Number, required: true, min: 0 } }, { _id: false });
const schema = new Schema<IManagedV3Footprint>({
  physicalUnitId: { type: Schema.Types.ObjectId, ref: 'ManagedV3PhysicalUnit', required: true, index: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  cells: { type: [footprintCell], required: true, validate: { validator: (value: unknown[]) => value.length > 0 } },
  topologyCertificationId: { type: Schema.Types.ObjectId, required: true }, topologyRevision: { type: Number, required: true, min: 1 },
  verifiedAt: { type: Date, required: true }, state: { type: String, enum: ['ACTIVE', 'RELEASED'], required: true, default: 'ACTIVE' },
  revision: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.index({ physicalUnitId: 1, state: 1 }, { unique: true, partialFilterExpression: { state: 'ACTIVE' } });
schema.index({ 'cells.cellId': 1, state: 1 });
export default mongoose.model<IManagedV3Footprint>('ManagedV3Footprint', schema);
