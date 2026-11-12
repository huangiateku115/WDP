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
  paymentSnapshot?: {
    paymentId: Types.ObjectId;
    purpose: string;
    amount: number;
    currency: string;
    status: string;
    providerSettlementStatus: string;
    applicationStatus: string;
    verifiedAt: Date;
    appliedAt: Date;
  };
  
  signedByCustomerAt?: Date;
  signedByFMAt?: Date;
  fmId?: Types.ObjectId;
  
  pdfUrl?: string;
  termsVersion?: string;
  currentContentVersion?: number;
  contentVersions?: Array<{
    version: number;
    contentHash: string;
    content: Record<string, unknown>;
    createdBy: Types.ObjectId;
    createdAt: Date;
  }>;
  signatures?: Array<{
    version: number;
    contentHash: string;
    signerId: Types.ObjectId;
    signerRole: string;
    signedAt: Date;
  }>;
  
  signedProofUrl?: string;
  signedProofPublicId?: string;
  signedProofUploadedAt?: Date;
  verifiedByStaff?: Types.ObjectId;
  verifiedAt?: Date;
  paperContractNumber?: string;
  
  createdAt: Date;
  updatedAt: Date;
}
