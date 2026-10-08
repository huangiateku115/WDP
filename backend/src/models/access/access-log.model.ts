import mongoose, { Schema } from 'mongoose';
import { IAccessLog, AccessAction, AccessMethod } from '../../types/access-log.type';

const accessLogSchema = new Schema<IAccessLog>({
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  storageUnitId: { type: Schema.Types.ObjectId, ref: 'StorageUnit', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  
  action: { type: String, enum: Object.values(AccessAction), required: true },
  accessMethod: { type: String, enum: Object.values(AccessMethod), required: true },
  reason: { type: String }
}, { timestamps: true });

export default mongoose.model<IAccessLog>('AccessLog', accessLogSchema);
