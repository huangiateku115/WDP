import mongoose, { Schema } from 'mongoose';
import { IWarehouseCell, WarehouseOperationalStatus } from '../../types/warehouse-map.type';

const cellDimensions = new Schema({
  widthM: { type: Number, required: true, min: Number.MIN_VALUE },
  depthM: { type: Number, required: true, min: Number.MIN_VALUE },
  // Do not infer usable clearance from the rack's nominal height.
  usableHeightM: { type: Number, min: Number.MIN_VALUE },
}, { _id: false });

const schema = new Schema<IWarehouseCell>({
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  zoneId: { type: Schema.Types.ObjectId, ref: 'WarehouseZone', required: true, index: true },
  rackId: { type: Schema.Types.ObjectId, ref: 'WarehouseRack', required: true, index: true },
  levelNumber: { type: Number, required: true, min: 1 },
  cellNumber: { type: Number, required: true, min: 1 },
  code: { type: String, required: true, trim: true, uppercase: true },
  dimensions: { type: cellDimensions, required: true },
  maxWeightKg: { type: Number, required: true, min: Number.MIN_VALUE },
  usedWeightKg: { type: Number, required: true, min: 0, default: 0 },
  usedVolumeM3: { type: Number, required: true, min: 0, default: 0 },
  allocationVersion: { type: Number, required: true, min: 0, default: 0 },
  managedInventoryRevision: { type: Number, required: true, min: 0, default: 0 },
  operationalStatus: { type: String, enum: Object.values(WarehouseOperationalStatus), default: WarehouseOperationalStatus.AVAILABLE },
  deletedAt: { type: Date },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

schema.index({ rackId: 1, levelNumber: 1, cellNumber: 1 }, { unique: true });
schema.index({ facilityId: 1, code: 1 }, { unique: true });
schema.index({ rackId: 1, levelNumber: 1, deletedAt: 1 });
schema.index({ deletedAt: 1 });

export default mongoose.model<IWarehouseCell>('WarehouseCell', schema);
