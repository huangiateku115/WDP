import { Types } from 'mongoose';
import { FacilityServiceType } from './facility.type';
import { StorageUnitSize } from './storage-unit.type';

export enum TermUnit { DAY = 'DAY', MONTH = 'MONTH', YEAR = 'YEAR' }
export enum PolicyType {
  DEPOSIT = 'DEPOSIT', CANCELLATION = 'CANCELLATION', REFUND = 'REFUND',
  OVERDUE = 'OVERDUE', DISCOUNT = 'DISCOUNT', WAIVER = 'WAIVER',
  CATEGORY = 'CATEGORY', SHELF_CONSTRAINT = 'SHELF_CONSTRAINT',
}
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface EffectiveRecord {
  facilityId: Types.ObjectId;
  effectiveFrom: Date;
  effectiveTo?: Date;
  isActive: boolean;
  version: number;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
export interface PricingRule extends EffectiveRecord {
  serviceType: FacilityServiceType;
  unitSize?: StorageUnitSize;
  term: { value: number; unit: TermUnit };
  price: number;
  currency: string;
}
export interface Policy extends EffectiveRecord {
  serviceType?: FacilityServiceType;
  type: PolicyType;
  config: Record<string, unknown>;
}
