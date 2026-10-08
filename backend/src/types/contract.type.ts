import { Document, Types } from 'mongoose';

export enum ContractStatus {
  DRAFT = 'DRAFT',
  SIGNED = 'SIGNED',
  TERMINATED = 'TERMINATED',
  EXPIRED = 'EXPIRED'
}

export interface IContract extends Document {
  contractCode: string;
  reservationId: Types.ObjectId;
  customerId: Types.ObjectId;
  
  status: ContractStatus;
  
  customerSnapshot: any; // { identityCard, fullName, phone, address }
  pricingSnapshot: any;  // { estimatedRent, depositAmount, taxAmount... }
  
  signedByCustomerAt?: Date;
  signedByFMAt?: Date;
  fmId?: Types.ObjectId;
  
  pdfUrl?: string;
  termsVersion?: string;
  
  createdAt: Date;
  updatedAt: Date;
}
