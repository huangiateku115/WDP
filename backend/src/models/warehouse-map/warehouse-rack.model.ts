import mongoose, { Schema } from 'mongoose';
import { IWarehouseRack, RackOrientation, WarehouseOperationalStatus } from '../../types/warehouse-map.type';

const dimensions = new Schema({
  widthM: { type: Number, required: true, min: Number.MIN_VALUE },
  depthM: { type: Number, required: true, min: Number.MIN_VALUE },
  heightM: { type: Number, required: true, min: Number.MIN_VALUE },
}, { _id: false });

const schema = new Schema<IWarehouseRack>({
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  zoneId: { type: Schema.Types.ObjectId, ref: 'WarehouseZone', required: true, index: true },
  aisleCode: { type: String, required: true, trim: true, uppercase: true },
  rackCode: { type: String, required: true, trim: true, uppercase: true },
  dimensions: { type: dimensions, required: true },
  levelCount: { type: Number, required: true, min: 1, max: 20 },
  cellsPerLevel: { type: Number, required: true, min: 1, max: 20 },
  maxWeightKgPerLevel: { type: Number, required: true, min: Number.MIN_VALUE },
  mapX: { type: Number, required: true, min: 0 },
  mapY: { type: Number, required: true, min: 0 },
  orientation: { type: Number, enum: Object.values(RackOrientation).filter(v => typeof v === 'number'), default: RackOrientation.DEG_0 },
  operationalStatus: { type: String, enum: Object.values(WarehouseOperationalStatus), default: WarehouseOperationalStatus.AVAILABLE },
  layoutVersion: { type: Number, required: true, default: 0, min: 0 },
  managedInventoryRevision: { type: Number, required: true, default: 0, min: 0 },
  deletedAt: { type: Date },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

schema.index({ facilityId: 1, rackCode: 1 }, { unique: true });
// Coordinates remain reserved after a soft delete to keep a map position stable.
schema.index({ zoneId: 1, aisleCode: 1, mapX: 1, mapY: 1 }, { unique: true });
schema.index({ facilityId: 1, zoneId: 1, aisleCode: 1 });
schema.index({ deletedAt: 1 });

export default mongoose.model<IWarehouseRack>('WarehouseRack', schema);
