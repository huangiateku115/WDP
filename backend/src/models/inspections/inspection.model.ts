import mongoose, { Schema } from 'mongoose';
import { IInspection, InspectionType, InspectionStatus, UnitCondition } from '../../types/inspection.type';

const inspectionSchema = new Schema<IInspection>({
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
  storageUnitId: { type: Schema.Types.ObjectId, ref: 'StorageUnit', required: true },
  inspectedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  
  type: { type: String, enum: Object.values(InspectionType), required: true },
  status: { type: String, enum: Object.values(InspectionStatus), default: InspectionStatus.DRAFT },
  
  condition: { type: String, enum: Object.values(UnitCondition), required: true },
  notes: { type: String },
  images: [{ type: String }],
  
  damageFee: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.model<IInspection>('Inspection', inspectionSchema);
