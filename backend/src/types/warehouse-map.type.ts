import { Document, Types } from 'mongoose';

export enum WarehouseOperationalStatus {
  AVAILABLE = 'AVAILABLE',
  BLOCKED = 'BLOCKED',
  MAINTENANCE = 'MAINTENANCE',
}

export enum CellAllocationStatus {
  HOLD = 'HOLD',
  RESERVED = 'RESERVED',
  OCCUPIED = 'OCCUPIED',
  RELEASED = 'RELEASED',
}

export interface ICellAllocation extends Document {
  managedAccessRevision?: number;
  facilityId: Types.ObjectId;
  cellId: Types.ObjectId;
  reservationId: Types.ObjectId;
  customerId: Types.ObjectId;
  startDate: Date;
  endDate: Date;
  status: CellAllocationStatus;
  holdExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export enum RackOrientation {
  DEG_0 = 0,
  DEG_90 = 90,
  DEG_180 = 180,
  DEG_270 = 270,
}

export interface RackDimensions {
  widthM: number;
  depthM: number;
  heightM: number;
}

export interface CellDimensions {
  widthM: number;
  depthM: number;
  /** Usable clearance only; intentionally optional until measured/configured. */
  usableHeightM?: number;
}

export interface WarehouseZoneFields {
  facilityId: Types.ObjectId;
  code: string;
  name: string;
  description?: string;
  color?: string;
  sortOrder: number;
  isActive: boolean;
  /** Internal write token used to serialize child rack creation against parent changes. */
  structureVersion: number;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
}

export interface IWarehouseZone extends Document, WarehouseZoneFields {
  createdAt: Date;
  updatedAt: Date;
}

export interface WarehouseRackFields {
  facilityId: Types.ObjectId;
  zoneId: Types.ObjectId;
  aisleCode: string;
  rackCode: string;
  dimensions: RackDimensions;
  levelCount: number;
  cellsPerLevel: number;
  maxWeightKgPerLevel: number;
  mapX: number;
  mapY: number;
  orientation: RackOrientation;
  operationalStatus: WarehouseOperationalStatus;
  /** Written transactionally to serialize concurrent capacity/layout changes. */
  layoutVersion: number;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
}

export interface IWarehouseRack extends Document, WarehouseRackFields {
  createdAt: Date;
  updatedAt: Date;
}

export interface WarehouseCellFields {
  facilityId: Types.ObjectId;
  zoneId: Types.ObjectId;
  rackId: Types.ObjectId;
  levelNumber: number;
  cellNumber: number;
  code: string;
  dimensions: CellDimensions;
  maxWeightKg: number;
  /** Transactional materialized occupancy counters, initially zero. */
  usedWeightKg: number;
  usedVolumeM3: number;
  /** Write token serializing booking allocations for this cell. */
  allocationVersion: number;
  operationalStatus: WarehouseOperationalStatus;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
}

export interface IWarehouseCell extends Document, WarehouseCellFields {
  createdAt: Date;
  updatedAt: Date;
}

export type UtilizationStatus = 'EMPTY' | 'PARTIAL' | 'NEAR_FULL' | 'FULL';

/** Physical occupancy read from transactional WarehouseCell aggregates. */
export interface WarehouseUsageSnapshot {
  usedWeightKg: number;
  usedVolumeM3: number;
  physicalUsageKnown: boolean;
  source: 'WAREHOUSE_CELL_COUNTERS';
}
