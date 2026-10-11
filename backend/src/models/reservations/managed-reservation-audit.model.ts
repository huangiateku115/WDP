import { model, Schema } from 'mongoose';
import { IManagedReservationAudit, ManagedReservationAction } from '../../types/managed-reservation-audit.type';

const schema = new Schema<IManagedReservationAudit>({
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', immutable: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  action: { type: String, enum: Object.values(ManagedReservationAction), required: true, immutable: true },
  fromStatus: { type: String, immutable: true },
  toStatus: { type: String, immutable: true },
  details: { type: Schema.Types.Mixed, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw', versionKey: false });
schema.index({ facilityId: 1, createdAt: -1 });
schema.index({ reservationId: 1, createdAt: 1 });
schema.pre('save', function () {
  if (!this.isNew) throw new Error('Managed reservation audit events are append-only');
});
export default model<IManagedReservationAudit>('ManagedReservationAudit', schema);
