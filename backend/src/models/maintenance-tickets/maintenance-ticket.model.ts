import mongoose, { Schema } from 'mongoose';
import { IMaintenanceTicket, MaintenanceCategory, MaintenancePriority, MaintenanceStatus } from '../../types/maintenance-ticket.type';

const schema = new Schema<IMaintenanceTicket>({
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  storageUnitId: { type: Schema.Types.ObjectId, ref: 'StorageUnit', immutable: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 5000 },
  category: { type: String, enum: Object.values(MaintenanceCategory), required: true },
  priority: { type: String, enum: Object.values(MaintenancePriority), default: MaintenancePriority.MEDIUM, required: true },
  status: { type: String, enum: Object.values(MaintenanceStatus), default: MaintenanceStatus.OPEN, required: true },
  reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedAt: { type: Date },
  resolutionNote: { type: String, trim: true, maxlength: 3000 },
  resolvedAt: { type: Date },
  closedAt: { type: Date },
  deletedAt: { type: Date },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, optimisticConcurrency: true });

schema.index({ facilityId: 1, status: 1, createdAt: -1 });
schema.index({ facilityId: 1, assignedTo: 1, status: 1 });
schema.index({ storageUnitId: 1, createdAt: -1 });
schema.index({ deletedAt: 1 });

export default mongoose.model<IMaintenanceTicket>('MaintenanceTicket', schema);
