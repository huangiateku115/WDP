import { Document, Types } from 'mongoose';

export enum MaintenanceCategory {
  GENERAL = 'GENERAL', CLEANING = 'CLEANING', SECURITY = 'SECURITY', ELECTRICAL = 'ELECTRICAL',
  STRUCTURAL = 'STRUCTURAL', ACCESS = 'ACCESS', EQUIPMENT = 'EQUIPMENT', OTHER = 'OTHER',
}
export enum MaintenancePriority { LOW = 'LOW', MEDIUM = 'MEDIUM', HIGH = 'HIGH', URGENT = 'URGENT' }
export enum MaintenanceStatus { OPEN = 'OPEN', ASSIGNED = 'ASSIGNED', IN_PROGRESS = 'IN_PROGRESS', RESOLVED = 'RESOLVED', CLOSED = 'CLOSED' }

export interface IMaintenanceTicket extends Document {
  facilityId: Types.ObjectId;
  storageUnitId?: Types.ObjectId;
  title: string;
  description: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  reportedBy: Types.ObjectId;
  assignedTo?: Types.ObjectId;
  assignedAt?: Date;
  resolutionNote?: string;
  resolvedAt?: Date;
  closedAt?: Date;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
