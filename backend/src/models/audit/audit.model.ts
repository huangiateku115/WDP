import mongoose, { Schema, Document } from 'mongoose';
import { ActionType, IAuditLog } from '../../types/audit.type';

export interface IAuditLogDocument extends IAuditLog, Document {
  createdAt: Date;
  updatedAt: Date;
}

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    action: { type: String, enum: Object.values(ActionType), required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', default: null },
    reason: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

export const AuditLogModel = mongoose.model<IAuditLogDocument>('AuditLog', auditLogSchema);
