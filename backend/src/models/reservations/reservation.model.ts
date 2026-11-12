import mongoose, { Schema } from 'mongoose';
import { IReservation, ReservationStatus } from '../../types/reservation.type';
import { FacilityServiceType } from '../../types/facility.type';

const statusHistorySchema = new Schema({
  status: { type: String, enum: Object.values(ReservationStatus), required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User' }, 
  reason: { type: String },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const termsAcceptanceSchema = new Schema({
  documentCode: { type: String, required: true, immutable: true },
  version: { type: String, required: true, immutable: true },
  versionId: { type: String, required: true, immutable: true },
  serviceType: { type: String, enum: Object.values(FacilityServiceType), required: true, immutable: true },
  contentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/, immutable: true },
  acceptedAt: { type: Date, required: true, immutable: true },
}, { _id: false, strict: 'throw' });

const reservationSchema = new Schema<IReservation>({
  reservationCode: { type: String, unique: true, required: true }, 
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
  
  serviceType: { type: String, enum: Object.values(FacilityServiceType), required: true },
  /** Absent on historical reservations; set only on a new booking after Customer acceptance. */
  termsAcceptance: { type: termsAcceptanceSchema, immutable: true },
  /** Optional Customer request identity for safe Self-Storage booking replay. */
  bookingIdempotencyKey: { type: String, immutable: true },
  bookingPayloadHash: { type: String, immutable: true },
  bookingFlowVersion: { type: Number, enum: [2, 3], immutable: true },
  /** Absent on historical records; distinguishes new one-shot full-rent bookings from legacy deposit/balance flows. */
  rentalPaymentFlow: { type: String, enum: ['FULL_UPFRONT_V1'], immutable: true },
  rentalPricingSnapshot: { type: Schema.Types.Mixed, immutable: true },
  storageUnitId: { type: Schema.Types.ObjectId, ref: 'StorageUnit' }, 
  allocatedCellIds: [{ type: Schema.Types.ObjectId, ref: 'WarehouseCell' }],
  allocatedCapacity: { type: Number },
  usedCapacityM3: { type: Number, min: 0, default: 0 },
  inventoryVersion: { type: Number, min: 0, default: 0 },
  /** Active Managed Inventory closure request; absent/null means no closure is pending. */
  activeClosureRequestId: { type: Schema.Types.ObjectId, ref: 'ManagedClosureRequest' },
  managedPricingSnapshot: { type: Schema.Types.Mixed },
  paymentSimulation: {
    simulated: { type: Boolean },
    provider: { type: String, enum: ['MOCK'] },
    paidAt: { type: Date },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  balanceSettledAt: { type: Date },
  balanceSettledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  depositPaymentId: { type: Schema.Types.ObjectId, ref: 'ReservationPayment' },
  balancePaymentId: { type: Schema.Types.ObjectId, ref: 'ReservationPayment' },
  fullPaymentId: { type: Schema.Types.ObjectId, ref: 'ReservationPayment' },
  balanceSettlementKey: { type: String, minlength: 1, maxlength: 160, immutable: true },
  handoverByStaffId: { type: Schema.Types.ObjectId, ref: 'User' },
  handoverAt: { type: Date },
  storageCondition: { type: String },  
  handoverAccessNotes: { type: String, maxlength: 1000 },
  
  /** Deadline for customer to arrive at facility, inspect unit and sign paper contract (default 3 days). */
  signingDeadline: { type: Date },
  paperContractProofUrl: { type: String },
  paperContractVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  paperContractVerifiedAt: { type: Date },
  accessPinCode: { type: String },
  cancellationReason: { type: String },
  refundPenaltyPercent: { type: Number, default: 0 },
  actualCheckoutDate: { type: Date },
  checkoutRequest: {
    requestedAt: { type: Date },
    note: { type: String, maxlength: 500 },
    status: { type: String, enum: ['PENDING', 'COMPLETED', 'CANCELLED'] },
  },
  checkoutInspectionId: { type: Schema.Types.ObjectId, ref: 'Inspection' },
  renewals: [{
    renewalDate: { type: Date, default: Date.now },
    durationMonths: { type: Number, required: true },
    amount: { type: Number, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'ReservationPayment' },
    oldEndDate: { type: Date, required: true },
    newEndDate: { type: Date, required: true }
  }],
  
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  
  status: { 
    type: String, 
    enum: Object.values(ReservationStatus), 
    default: ReservationStatus.RESERVED 
  },
  
  pricingPolicyId: { type: Schema.Types.ObjectId, ref: 'PricingRule', required: true }, 
  estimatedRent: { type: Number, required: true }, 
  depositAmount: { type: Number, required: true }, 
  taxAmount: { type: Number, default: 0 },         
  discountAmount: { type: Number, default: 0 },    
  
  expiresAt: { type: Date },
  
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  rejectReason: { type: String },
  
  statusHistory: { type: [statusHistorySchema], default: [] }
}, { timestamps: true });

reservationSchema.index({ facilityId: 1, status: 1 });
reservationSchema.index({ customerId: 1, status: 1 });
reservationSchema.index({ storageUnitId: 1, startDate: 1, endDate: 1 });
reservationSchema.index({ facilityId: 1, serviceType: 1, status: 1, startDate: 1, endDate: 1 });
reservationSchema.index(
  { customerId: 1, bookingIdempotencyKey: 1 },
  { unique: true, partialFilterExpression: { bookingIdempotencyKey: { $type: 'string' } } },
);

export default mongoose.model<IReservation>('Reservation', reservationSchema);
