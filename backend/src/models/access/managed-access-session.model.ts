import mongoose, { Schema } from 'mongoose';
import { IManagedAccessSession, ManagedAccessPurpose, ManagedAccessSessionStatus } from '../../types/managed-access.type';

const audit = new Schema({ action: { type: String, required: true }, actorId: { type: Schema.Types.ObjectId, ref: 'User' }, actorRole: { type: String, required: true }, at: { type: Date, required: true }, details: { type: Schema.Types.Mixed } }, { _id: false });
const schema = new Schema<IManagedAccessSession>({
  visitId: { type: Schema.Types.ObjectId, ref: 'ManagedAccessVisit', required: true, index: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
  scopedReservationIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Reservation' }], required: true,
    default: function (this: any) { return this.reservationId ? [this.reservationId] : undefined; },
    validate: { validator: function (this: any, ids: unknown[]) {
      if (!Array.isArray(ids) || !ids.length || !this.reservationId) return false;
      const normalized = ids.map(value => String(value));
      return new Set(normalized).size === normalized.length && normalized.includes(String(this.reservationId));
    }, message: 'scopedReservationIds must contain unique Reservation IDs including reservationId.' } },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  assignedStaffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  allowedCellIds: [{ type: Schema.Types.ObjectId, ref: 'WarehouseCell', required: true }],
  allowedPurposes: [{ type: String, enum: Object.values(ManagedAccessPurpose), required: true }],
  startedAt: { type: Date, required: true }, expiresAt: { type: Date, required: true }, endedAt: Date, revokedAt: Date, revokedBy: { type: Schema.Types.ObjectId, ref: 'User' }, revokeReason: { type: String, maxlength: 500 },
  status: { type: String, enum: Object.values(ManagedAccessSessionStatus), required: true }, revision: { type: Number, required: true, min: 0, default: 0 }, checkInIdempotencyKey: { type: String, required: true, maxlength: 160 },
  checkInRequestHash: { type: String, match: /^[a-f\d]{64}$/i },
  audit: { type: [audit], default: [] },
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ reservationId: 1, status: 1 });
schema.index({ reservationId: 1 }, { unique: true, partialFilterExpression: { status: ManagedAccessSessionStatus.ACTIVE },
  name: 'managed_access_session_active_reservation_unique' });
schema.index({ scopedReservationIds: 1 }, { unique: true, partialFilterExpression: { status: ManagedAccessSessionStatus.ACTIVE },
  name: 'managed_access_session_active_scope_unique' });
schema.index({ visitId: 1, checkInIdempotencyKey: 1 }, { unique: true });
schema.index({ facilityId: 1, status: 1, expiresAt: 1 });
export default mongoose.model('ManagedAccessSession', schema);
