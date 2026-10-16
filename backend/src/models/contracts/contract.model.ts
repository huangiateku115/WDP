import mongoose, { Schema } from 'mongoose';
import { IContract, ContractStatus } from '../../types/contract.type';

const contractSchema = new Schema<IContract>({
  contractCode: { type: String, unique: true, required: true },
  reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, unique: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  
  status: { 
    type: String, 
    enum: Object.values(ContractStatus), 
    default: ContractStatus.DRAFT 
  },
  
  customerSnapshot: { type: Schema.Types.Mixed, required: true },
  pricingSnapshot: { type: Schema.Types.Mixed, required: true },
  
  signedByCustomerAt: { type: Date },
  signedByFMAt: { type: Date },
  fmId: { type: Schema.Types.ObjectId, ref: 'User' },
  
  pdfUrl: { type: String },
  termsVersion: { type: String, default: '1.0' },
  currentContentVersion: { type: Number, min: 1 },
  contentVersions: [{
    version: { type: Number, required: true },
    contentHash: { type: String, required: true },
    content: { type: Schema.Types.Mixed, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, required: true },
  }],
  signatures: [{
    version: { type: Number, required: true },
    contentHash: { type: String, required: true },
    signerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    signerRole: { type: String, required: true },
    signedAt: { type: Date, required: true },
  }],
}, { timestamps: true });

export default mongoose.model<IContract>('Contract', contractSchema);
