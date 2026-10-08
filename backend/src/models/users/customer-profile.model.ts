import mongoose, { Schema } from 'mongoose';
import { ICustomerProfile, VerificationStatus } from '../../types/customer-profile.type';

const customerProfileSchema = new Schema<ICustomerProfile>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
  identityCard: { type: String, immutable: true }, 
  address: { type: String },
  taxCode: { type: String },
  
  verificationStatus: { 
    type: String, 
    enum: Object.values(VerificationStatus), 
    default: VerificationStatus.UNVERIFIED 
  },
  verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: { type: Date },
  note: { type: String }
}, { timestamps: true });

export default mongoose.model<ICustomerProfile>('CustomerProfile', customerProfileSchema);
