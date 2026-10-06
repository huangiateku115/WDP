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
export interface FacilityFields {
  code: string;
  name: string;
  address: FacilityAddress;
  contact?: FacilityContact;
  serviceTypes: FacilityServiceType[];
  status: FacilityStatus;
  description?: string;
  operatingHours?: string;
}
export interface IFacility extends Document, FacilityFields {
  createdAt: Date;
  updatedAt: Date;
}
