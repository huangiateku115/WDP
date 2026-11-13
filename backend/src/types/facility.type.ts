import { Document } from 'mongoose';

export enum FacilityServiceType {
  SELF_STORAGE = 'SELF_STORAGE',
  MANAGED_INVENTORY = 'MANAGED_INVENTORY',
}
export enum FacilityStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}
export interface FacilityAddress {
  line1: string;
  ward?: string;
  district?: string;
  city: string;
  country: string;
}
export interface FacilityContact {
  phone?: string;
  email?: string;
}
export interface ManagedVisitSchedule {
  timeZone: 'Asia/Ho_Chi_Minh';
  slotDurationMinutes: number;
  weeklyHours: Array<{ weekday: number; opensAt: string; closesAt: string }>;
}
export interface FacilityFields {
  code: string;
  name: string;
  address: FacilityAddress;
  contact?: FacilityContact;
  serviceTypes: FacilityServiceType[];
  status: FacilityStatus;
  description?: string;
  operatingHours?: string;
  managedVisitSchedule?: ManagedVisitSchedule;
  images?: string[];
  deletedAt?: Date;
  deletedBy?: import('mongoose').Types.ObjectId;
}
export interface IFacility extends Document, FacilityFields {
  managedAccessRevision?: number;
  createdAt: Date;
  updatedAt: Date;
}
