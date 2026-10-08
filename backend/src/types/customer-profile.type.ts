import { Document, Types } from 'mongoose';

export enum VerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED'
}

export interface ICustomerProfile extends Document {
  userId: Types.ObjectId;
  identityCard?: string;
  address?: string;
  taxCode?: string;
  verificationStatus: VerificationStatus;
  verifiedBy?: Types.ObjectId;
  verifiedAt?: Date;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}
