import { Document, Types } from 'mongoose';

export enum AccessAction {
  UNLOCK_SUCCESS = 'UNLOCK_SUCCESS',
  UNLOCK_FAILED = 'UNLOCK_FAILED',
  DENIED_OVERDUE = 'DENIED_OVERDUE'
}

export enum AccessMethod {
  PIN_CODE = 'PIN_CODE',
  MOBILE_APP = 'MOBILE_APP'
}

export interface IAccessLog extends Document {
  reservationId: Types.ObjectId;
  storageUnitId: Types.ObjectId;
  customerId: Types.ObjectId;
  
  action: AccessAction;
  accessMethod: AccessMethod;
  reason?: string;
  
  createdAt: Date;
  updatedAt: Date;
}
