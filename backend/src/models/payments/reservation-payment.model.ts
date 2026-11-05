import mongoose, { Schema } from 'mongoose';
import { IReservationPayment, PaymentApplicationStatus, PaymentProvider, PaymentPurpose, PaymentStatus, ProviderSettlementStatus } from '../../types/payment.type';
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
  // For PAYOS this immutable, already-uniquely-indexed value is the local orderCode.
  checkoutState: { type: String, enum: ['NOT_CREATED', 'CREATING', 'READY', 'UNKNOWN', 'RECONCILIATION_REQUIRED'] },
  checkoutUrl: { type: String, maxlength: 2048 },
  // Raw provider-generated EMV QR payload. It is never synthesized by WDP.
  qrCode: { type: String, maxlength: 4096, match: /^000201[\x20-\x7E]+$/ },
  providerPaymentLinkId: { type: String, maxlength: 200 },
  providerCurrency: { type: String, maxlength: 3 },
  providerCaptures: [{
    _id: false,
    eventHash: { type: String, required: true, maxlength: 64 },
    reference: { type: String, required: true, maxlength: 200 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, maxlength: 3 },
    transactionDateTime: { type: String, required: true, maxlength: 64 },
    receivedAt: { type: Date, required: true },
  }],
  providerOutcomeEvents: [{
    _id: false,
    eventHash: { type: String, required: true, maxlength: 64 },
    code: { type: String, required: true, maxlength: 32 },
    description: { type: String, required: true, maxlength: 500 },
    reference: { type: String, required: true, maxlength: 200 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, maxlength: 3 },
    paymentLinkId: { type: String, required: true, maxlength: 200 },
    transactionDateTime: { type: String, required: true, maxlength: 64 },
    receivedAt: { type: Date, required: true },
  }],
  providerSettlementStatus: { type: String, enum: Object.values(ProviderSettlementStatus), default: ProviderSettlementStatus.NOT_VERIFIED },
  applicationStatus: { type: String, enum: Object.values(PaymentApplicationStatus) },
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
