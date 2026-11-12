import mongoose, { Schema } from 'mongoose';
import { IManagedAccessVisit, ManagedAccessPurpose, ManagedAccessVisitStatus } from '../../types/managed-access.type';

const audit = new Schema({ action: { type: String, required: true }, actorId: { type: Schema.Types.ObjectId, ref: 'User' }, actorRole: { type: String, required: true }, at: { type: Date, required: true }, details: { type: Schema.Types.Mixed } }, { _id: false });
const schema = new Schema<IManagedAccessVisit>({
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, index: true },
  purpose: { type: String, enum: Object.values(ManagedAccessPurpose), required: true },
  startsAt: { type: Date, required: true }, endsAt: { type: Date, required: true }, note: { type: String, maxlength: 500 },
  status: { type: String, enum: Object.values(ManagedAccessVisitStatus), required: true, default: ManagedAccessVisitStatus.SCHEDULED },
  assignedStaffId: { type: Schema.Types.ObjectId, ref: 'User' },
  idempotencyKey: { type: String, required: true, maxlength: 160 }, requestHash: { type: String, required: true, match: /^[a-f\d]{64}$/i },
  revision: { type: Number, required: true, min: 0, default: 0 }, checkedInAt: Date, checkedInByStaffId: { type: Schema.Types.ObjectId, ref: 'User' }, checkedOutAt: Date,
  presenceAttestation: { identityVerified: Boolean, customerPresent: Boolean, safetyReviewed: Boolean, notes: { type: String, maxlength: 1000 }, actorId: { type: Schema.Types.ObjectId, ref: 'User' }, recordedAt: Date, method: { type: String, enum: ['MANUAL_STAFF_ATTESTATION'] } },
  assignmentHistory: [{ _id: false, staffId: { type: Schema.Types.ObjectId, ref: 'User', default: null }, actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, at: { type: Date, required: true }, reason: { type: String, required: true, maxlength: 500 } }],
  audit: { type: [audit], default: [] },
}, { timestamps: true, optimisticConcurrency: true });
schema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });
schema.index({ facilityId: 1, status: 1, startsAt: 1 });
schema.index({ assignedStaffId: 1, status: 1, startsAt: 1 });
export default mongoose.model('ManagedAccessVisit', schema);
