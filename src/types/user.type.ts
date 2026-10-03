import { Document, Types } from 'mongoose';

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  FACILITY_STAFF = 'FACILITY_STAFF',
  FACILITY_MANAGER = 'FACILITY_MANAGER',
  BOM = 'BOM',
  ADMIN = 'ADMIN'
}

export interface IUser extends Document {
  keycloakSub: string;
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  assignedFacilityId?: Types.ObjectId | null;
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
