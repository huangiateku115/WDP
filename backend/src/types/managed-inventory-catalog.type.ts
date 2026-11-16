import { Document, Types } from 'mongoose';

export interface ManagedInventoryCatalogFields {
  code: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  deletedAt?: Date;
}

export interface IManagedInventoryCategory extends Document, ManagedInventoryCatalogFields {}
export interface IManagedInventoryQuantityUnit extends Document, ManagedInventoryCatalogFields {}
