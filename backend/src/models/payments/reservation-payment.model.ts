import mongoose, { Schema } from 'mongoose';
import { IReservationPayment, PaymentProvider, PaymentPurpose, PaymentStatus } from '../../types/payment.type';
import { FacilityServiceType } from '../../types/facility.type';

const reservationPaymentSchema = new Schema<IReservationPayment>({
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, immutable: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true, immutable: true },
  serviceType: { type: String, enum: Object.values(FacilityServiceType), required: true, immutable: true },
  purpose: { type: String, enum: Object.values(PaymentPurpose), required: true, immutable: true },
  amount: { type: Number, required: true, min: Number.MIN_VALUE, immutable: true },
  currency: { type: String, required: true, match: /^[A-Z]{3}$/, immutable: true },
  idempotencyKey: { type: String, required: true, minlength: 1, maxlength: 160, immutable: true },
  provider: { type: String, enum: Object.values(PaymentProvider), required: true, immutable: true },
  providerReference: { type: String, maxlength: 200, immutable: true },
  status: { type: String, enum: Object.values(PaymentStatus), required: true, default: PaymentStatus.PENDING },
  succeededAt: { type: Date },
  failedAt: { type: Date },
  reconciliationReason: { type: String, maxlength: 500 },
}, { timestamps: true });

// One key represents one logical payment request across both reservation services.
reservationPaymentSchema.index({ idempotencyKey: 1 }, { unique: true });
// A reservation has at most one successfully captured deposit and one balance payment.
reservationPaymentSchema.index({ reservationId: 1, purpose: 1 }, {
  unique: true,
  partialFilterExpression: { status: PaymentStatus.SUCCEEDED },
});
reservationPaymentSchema.index({ provider: 1, providerReference: 1 }, {
  unique: true,
  partialFilterExpression: { providerReference: { $type: 'string' } },
});
reservationPaymentSchema.index({ customerId: 1, createdAt: -1 });

export default mongoose.model<IReservationPayment>('ReservationPayment', reservationPaymentSchema);
