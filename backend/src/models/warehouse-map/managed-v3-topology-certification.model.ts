import mongoose, { Schema } from 'mongoose';
import { Document, Types } from 'mongoose';

export interface IManagedV3TopologyCertification extends Document {
  facilityId: Types.ObjectId; rackId: Types.ObjectId; levelNumber: number; revision: number; supportSurfaceId: string;
  certificationState: 'CERTIFIED' | 'REVOKED'; certifiedAt: Date; expiresAt: Date; certifiedBy: Types.ObjectId;
  provenance: string; worldTransform: { origin: [number, number, number]; axes: number[][] };
  levelMaxWeightKg: number; cells: Array<{ cellId: Types.ObjectId; xStartM: number; xEndM: number; yStartM: number; yEndM: number;
    usableHeightM: number; maxWeightKg: number; maxVolumeM3: number; obstacles: Array<{ xStartM: number; xEndM: number; yStartM: number; yEndM: number }> }>;
}
const obstacle = new Schema({ xStartM: { type: Number, required: true }, xEndM: { type: Number, required: true },
  yStartM: { type: Number, required: true }, yEndM: { type: Number, required: true } }, { _id: false });
const topologyCell = new Schema({ cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true },
  xStartM: { type: Number, required: true }, xEndM: { type: Number, required: true }, yStartM: { type: Number, required: true }, yEndM: { type: Number, required: true },
  usableHeightM: { type: Number, required: true, min: Number.MIN_VALUE }, maxWeightKg: { type: Number, required: true, min: Number.MIN_VALUE },
  maxVolumeM3: { type: Number, required: true, min: Number.MIN_VALUE }, obstacles: { type: [obstacle], required: true } }, { _id: false });
const schema = new Schema<IManagedV3TopologyCertification>({
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  rackId: { type: Schema.Types.ObjectId, ref: 'WarehouseRack', required: true, index: true }, levelNumber: { type: Number, required: true, min: 1 },
  revision: { type: Number, required: true, min: 1 }, supportSurfaceId: { type: String, required: true, trim: true },
  certificationState: { type: String, enum: ['CERTIFIED', 'REVOKED'], required: true }, certifiedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true }, certifiedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  provenance: { type: String, required: true, trim: true, maxlength: 500 },
  worldTransform: { origin: { type: [Number], required: true }, axes: { type: [[Number]], required: true } },
  levelMaxWeightKg: { type: Number, required: true, min: Number.MIN_VALUE }, cells: { type: [topologyCell], required: true },
}, { timestamps: true, strict: 'throw', optimisticConcurrency: true });
schema.index({ facilityId: 1, rackId: 1, levelNumber: 1, revision: 1 }, { unique: true });
schema.index({ facilityId: 1, rackId: 1, levelNumber: 1, certificationState: 1, expiresAt: 1 });
export default mongoose.model<IManagedV3TopologyCertification>('ManagedV3TopologyCertification', schema);
