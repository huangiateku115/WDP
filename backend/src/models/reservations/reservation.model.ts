import mongoose, { Schema } from 'mongoose';
import { IReservation, ReservationStatus } from '../../types/reservation.type';
import { FacilityServiceType } from '../../types/facility.type';

const statusHistorySchema = new Schema({
  status: { type: String, enum: Object.values(ReservationStatus), required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User' }, 
  reason: { type: String },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const reservationSchema = new Schema<IReservation>({
  reservationCode: { type: String, unique: true, required: true }, 
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  facilityId: { type: Schema.Types.ObjectId, ref: 'Facility', required: true },
  
  serviceType: { type: String, enum: Object.values(FacilityServiceType), required: true },
  storageUnitId: { type: Schema.Types.ObjectId, ref: 'StorageUnit' }, 
  allocatedCellIds: [{ type: Schema.Types.ObjectId, ref: 'WarehouseCell' }],
  allocatedCapacity: { type: Number },
  usedCapacityM3: { type: Number, min: 0, default: 0 },
  inventoryVersion: { type: Number, min: 0, default: 0 },
  managedPricingSnapshot: { type: Schema.Types.Mixed },
  paymentSimulation: {
    simulated: { type: Boolean },
    provider: { type: String, enum: ['MOCK'] },
    paidAt: { type: Date },
    actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  storageCondition: { type: String },  
  
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

export default mongoose.model<IReservation>('Reservation', reservationSchema);
