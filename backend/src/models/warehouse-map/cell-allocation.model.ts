import mongoose, { Schema } from 'mongoose';
import { CellAllocationStatus, ICellAllocation } from '../../types/warehouse-map.type';

const schema = new Schema<ICellAllocation>({
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  cellId: { type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true, index: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: Object.values(CellAllocationStatus), required: true },
  managedAccessRevision: { type: Number, min: 0, default: 0 },
  holdExpiresAt: { type: Date },
}, { timestamps: true });

schema.index({ reservationId: 1, cellId: 1 }, { unique: true });
schema.index({ cellId: 1, status: 1, startDate: 1, endDate: 1, holdExpiresAt: 1 });
schema.index({ customerId: 1, status: 1 });

export default mongoose.model<ICellAllocation>('CellAllocation', schema);
