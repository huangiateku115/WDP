import mongoose, { ClientSession, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import WarehouseZoneModel from '../../models/warehouse-map/warehouse-zone.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import { CellAllocationStatus } from '../../types/warehouse-map.type';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { IWarehouseCell, IWarehouseRack, IWarehouseZone, RackDimensions, UtilizationStatus, WarehouseOperationalStatus, WarehouseUsageSnapshot } from '../../types/warehouse-map.type';
import { IUser, UserRole } from '../../types/user.type';
import {
  id, parseCellUpdate, parseList, parseRackCreate, parseRackUpdate, parseZoneCreate, parseZoneUpdate,
  WarehouseMapError,
} from './warehouse-map.validation';

type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'> | undefined;
const managers = [UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER];
const readers = [...managers, UserRole.FACILITY_STAFF];
const live = { deletedAt: { $exists: false } };

function assertActor(actor: Actor, allowed: UserRole[]) {
  if (!actor) throw new WarehouseMapError(401, 'Authentication required');
  if (!allowed.includes(actor.role)) throw new WarehouseMapError(403, 'Forbidden');
}

function assertFacilityScope(actor: Actor, facilityId: string, write = false) {
  assertActor(actor, write ? managers : readers);
  if ((actor!.role === UserRole.FACILITY_MANAGER || actor!.role === UserRole.FACILITY_STAFF) &&
      actor!.assignedFacilityId?.toString().toLowerCase() !== facilityId.toLowerCase()) {
    throw new WarehouseMapError(403, 'Facility is outside assigned scope');
  }
}

async function facilityForMap(facilityId: string, session?: ClientSession) {
  let query = FacilityModel.findOne({ _id: facilityId, ...live });
  if (session) query = query.session(session);
  const facility = await query.exec();
  if (!facility) throw new WarehouseMapError(404, 'Facility not found');
  if (facility.status !== FacilityStatus.ACTIVE) throw new WarehouseMapError(409, 'Facility must be ACTIVE');
  if (!facility.serviceTypes.includes(FacilityServiceType.MANAGED_INVENTORY)) {
    throw new WarehouseMapError(409, 'Facility does not support MANAGED_INVENTORY');
  }
  return facility;
}

async function assertCustomerMapAccess(actor: Actor) {
  assertActor(actor, [UserRole.CUSTOMER]);
  // MI-01 exposes only the sanitized structural map; browsing does not require
  // a Managed Inventory reservation or reveal customer-specific data.
}

async function assertReadFacility(actor: Actor, facilityId: string, allowCustomerMap = false) {
  if (actor?.role === UserRole.CUSTOMER && allowCustomerMap) await assertCustomerMapAccess(actor);
  else assertFacilityScope(actor, facilityId);
  await facilityForMap(facilityId);
}

async function zoneById(zoneId: string, session?: ClientSession) {
  let query = WarehouseZoneModel.findOne({ _id: zoneId, ...live });
  if (session) query = query.session(session);
  const zone = await query.exec();
  if (!zone) throw new WarehouseMapError(404, 'Warehouse zone not found');
  return zone;
}

async function rackById(rackId: string, session?: ClientSession) {
  let query = WarehouseRackModel.findOne({ _id: rackId, ...live });
  if (session) query = query.session(session);
  const rack = await query.exec();
  if (!rack) throw new WarehouseMapError(404, 'Rack not found');
  return rack;
}

async function cellById(cellId: string, session?: ClientSession) {
  let query = WarehouseCellModel.findOne({ _id: cellId, ...live });
  if (session) query = query.session(session);
  const cell = await query.exec();
  if (!cell) throw new WarehouseMapError(404, 'Rack cell not found');
  return cell;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error: unknown) {
    if (error instanceof WarehouseMapError) throw error;
    const e = error as { code?: number; name?: string; hasErrorLabel?: (label: string) => boolean };
    if (e?.code === 11000) throw new WarehouseMapError(409, 'Warehouse code or map position already exists');
    if (e?.name === 'ValidationError' || e?.name === 'CastError') throw new WarehouseMapError(400, 'Invalid warehouse map data');
    if (e?.hasErrorLabel?.('TransientTransactionError') || e?.name === 'VersionError') {
      throw new WarehouseMapError(409, 'Warehouse map changed; reload and retry');
    }
    throw new WarehouseMapError(500, 'Internal Server Error');
  }
}

async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally { await session.endSession(); }
}

function zoneDto(zone: IWarehouseZone) {
  return {
    _id: zone._id,
    facilityId: zone.facilityId,
    code: zone.code,
    name: zone.name,
    ...(zone.description ? { description: zone.description } : {}),
    ...(zone.color ? { color: zone.color } : {}),
    sortOrder: zone.sortOrder,
    isActive: zone.isActive,
    createdAt: zone.createdAt,
    updatedAt: zone.updatedAt,
  };
}

function rackDto(rack: IWarehouseRack) {
  return {
    _id: rack._id,
    facilityId: rack.facilityId,
    zoneId: rack.zoneId,
    aisleCode: rack.aisleCode,
    rackCode: rack.rackCode,
    dimensions: rack.dimensions,
    levelCount: rack.levelCount,
    cellsPerLevel: rack.cellsPerLevel,
    maxWeightKgPerLevel: rack.maxWeightKgPerLevel,
    maxWeightKg: rack.levelCount * rack.maxWeightKgPerLevel,
    mapX: rack.mapX,
    mapY: rack.mapY,
    orientation: rack.orientation,
    operationalStatus: rack.operationalStatus,
    createdAt: rack.createdAt,
    updatedAt: rack.updatedAt,
  };
}

function cellDto(cell: IWarehouseCell) {
  return {
    _id: cell._id,
    facilityId: cell.facilityId,
    zoneId: cell.zoneId,
    rackId: cell.rackId,
    levelNumber: cell.levelNumber,
    cellNumber: cell.cellNumber,
    code: cell.code,
    dimensions: cell.dimensions,
    maxWeightKg: cell.maxWeightKg,
    operationalStatus: cell.operationalStatus,
    createdAt: cell.createdAt,
    updatedAt: cell.updatedAt,
  };
}

function utilizationStatus(used: number, capacity: number): UtilizationStatus {
  if (used <= 0) return 'EMPTY';
  const ratio = capacity > 0 ? used / capacity : 0;
  if (ratio >= 1) return 'FULL';
  if (ratio >= 0.9) return 'NEAR_FULL';
  return 'PARTIAL';
}

/** Cell counters are transactional materialized aggregates maintained by inbound. */
async function usageForRack(_rack: IWarehouseRack, cells: IWarehouseCell[]): Promise<WarehouseUsageSnapshot> {
  const usage = cells.reduce((sum, cell) => ({
    usedWeightKg: sum.usedWeightKg + Number(cell.usedWeightKg ?? 0),
    usedVolumeM3: sum.usedVolumeM3 + Number(cell.usedVolumeM3 ?? 0),
  }), { usedWeightKg: 0, usedVolumeM3: 0 });
  if (!Number.isFinite(usage.usedWeightKg) || !Number.isFinite(usage.usedVolumeM3) || usage.usedWeightKg < 0 || usage.usedVolumeM3 < 0) {
    throw new WarehouseMapError(500, 'Warehouse inventory usage counters are invalid');
  }
  return { ...usage, source: 'WAREHOUSE_CELL_COUNTERS' };
}

function validRemaining(capacity: number, used: number) { return Math.max(0, capacity - used); }
async function hasBlockingAllocation(query: Record<string, unknown>, session: ClientSession) {
  const now = new Date();
  return Boolean(await CellAllocationModel.exists({ ...query, $or: [
    { status: CellAllocationStatus.OCCUPIED },
    { status: CellAllocationStatus.RESERVED, endDate: { $gt: now } },
    { status: CellAllocationStatus.HOLD, holdExpiresAt: { $gt: now } },
  ] }).session(session).exec());
}

function parseBookingRange(value: unknown, actor: Actor) {
  const query = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const start = query.startDate, end = query.endDate;
  if (start === undefined && end === undefined) {
    const startDate = new Date(), endDate = new Date(Date.now() + 1);
    return { startDate, endDate };
  }
  if (typeof start !== 'string' || typeof end !== 'string') throw new WarehouseMapError(400, 'startDate and endDate must be provided together');
  const startDate = new Date(start), endDate = new Date(end);
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate.toISOString() !== start || endDate.toISOString() !== end || endDate <= startDate) {
    throw new WarehouseMapError(400, 'Invalid booking date range');
  }
  return { startDate, endDate };
}

async function cellBookingData(cells: IWarehouseCell[], actor: Actor, range?: { startDate: Date; endDate: Date }) {
  const rows = new Map<string, any[]>();
  if (!cells.length || !range) return { rows, myInventoryCells: new Set<string>() };
  const ids = cells.map(cell => cell._id);
  const now = new Date();
  const allocations = await CellAllocationModel.find({ cellId: { $in: ids },
    $or: [
      { status: CellAllocationStatus.OCCUPIED },
      { status: CellAllocationStatus.RESERVED, startDate: { $lt: range.endDate }, endDate: { $gt: range.startDate } },
      { status: CellAllocationStatus.HOLD, holdExpiresAt: { $gt: now }, startDate: { $lt: range.endDate }, endDate: { $gt: range.startDate } },
    ],
  }).select('cellId reservationId customerId status startDate endDate holdExpiresAt').lean().exec();
  for (const row of allocations) rows.set(String(row.cellId), [...(rows.get(String(row.cellId)) ?? []), row]);
  const myInventoryCells = new Set<string>();
  if (actor?.role === UserRole.CUSTOMER) {
    const customerId = actor._id as Types.ObjectId;
    const items = await InventoryItemModel.find({ customerId, currentCellId: { $in: ids }, status: 'IN_STORAGE', deletedAt: { $exists: false } } as any).select('currentCellId').lean().exec();
    for (const item of items) if (item.currentCellId) myInventoryCells.add(String(item.currentCellId));
  }
  return { rows, myInventoryCells };
}

function cellBookingDto(cell: IWarehouseCell, allocations: any[], hasMyInventory: boolean, actor: Actor) {
  const usedWeightKg = Number(cell.usedWeightKg ?? 0), usedVolumeM3 = Number(cell.usedVolumeM3 ?? 0);
  const active = allocations.find(allocation => allocation.status === CellAllocationStatus.OCCUPIED || allocation.status === CellAllocationStatus.RESERVED || allocation.status === CellAllocationStatus.HOLD);
  const isMine = Boolean(actor?.role === UserRole.CUSTOMER && allocations.some(allocation => String(allocation.customerId) === actor._id.toString()));
  const bookingStatus = usedWeightKg > 0 || usedVolumeM3 > 0 || active?.status === CellAllocationStatus.OCCUPIED
    ? 'OCCUPIED' : active ? 'RESERVED' : 'AVAILABLE';
  const displayStatus = cell.operationalStatus === WarehouseOperationalStatus.MAINTENANCE ? 'MAINTENANCE'
    : cell.operationalStatus === WarehouseOperationalStatus.BLOCKED ? 'BLOCKED' : bookingStatus;
  const maxVolumeM3 = cell.dimensions.usableHeightM === undefined ? null : cell.dimensions.widthM * cell.dimensions.depthM * cell.dimensions.usableHeightM;
  return { bookingStatus, displayStatus, isMine, hasMyInventory, usedWeightKg, maxWeightKg: cell.maxWeightKg,
    remainingWeightKg: validRemaining(cell.maxWeightKg, usedWeightKg), usedVolumeM3, maxVolumeM3,
    remainingVolumeM3: maxVolumeM3 === null ? null : validRemaining(maxVolumeM3, usedVolumeM3) };
}

async function assertRecordAccess(actor: Actor, facilityId: Types.ObjectId, write = false, session?: ClientSession) {
  assertFacilityScope(actor, facilityId.toString(), write);
  await facilityForMap(facilityId.toString(), session);
}

async function activeManagedFacilityIds() {
  const facilities = await FacilityModel.find({
    status: FacilityStatus.ACTIVE,
    serviceTypes: FacilityServiceType.MANAGED_INVENTORY,
    ...live,
  }).select('_id').lean().exec();
  return facilities.map(facility => facility._id);
}

function applyListFacilityScope(filter: Record<string, unknown>, requested: string | undefined, actor: Actor) {
  if (actor!.role === UserRole.FACILITY_MANAGER || actor!.role === UserRole.FACILITY_STAFF) {
    if (!actor!.assignedFacilityId) throw new WarehouseMapError(403, 'Facility assignment is required');
    filter.facilityId = actor!.assignedFacilityId;
    return actor!.assignedFacilityId.toString();
  }
  if (requested) {
    filter.facilityId = requested;
    return requested;
  }
  return undefined;
}

async function lockZone(zoneId: string, session: ClientSession, options: { facilityId?: string; active?: boolean; deleted?: boolean } = {}) {
  const query: Record<string, unknown> = { _id: zoneId };
  if (options.facilityId) query.facilityId = options.facilityId;
  if (options.active) query.isActive = true;
  if (options.deleted) query.deletedAt = { $exists: true };
  else query.deletedAt = { $exists: false };
  return WarehouseZoneModel.findOneAndUpdate(query, { $inc: { structureVersion: 1 } }, { new: true, session, runValidators: true }).exec();
}

async function lockRack(rackId: string, session: ClientSession, scope: { facilityId: Types.ObjectId; zoneId: Types.ObjectId }) {
  return WarehouseRackModel.findOneAndUpdate(
    { _id: rackId, facilityId: scope.facilityId, zoneId: scope.zoneId, ...live },
    { $inc: { layoutVersion: 1 } },
    { new: true, session, runValidators: true },
  ).exec();
}

export class WarehouseMapService {
  static async createZone(input: unknown, actor: Actor) {
    assertActor(actor, managers);
    const data = parseZoneCreate(input);
    assertFacilityScope(actor, data.facilityId as string, true);
    return execute(async () => {
      await facilityForMap(data.facilityId as string);
      const zone = await WarehouseZoneModel.create({ ...data, facilityId: new Types.ObjectId(data.facilityId as string) });
      return zoneDto(zone);
    });
  }

  static async listZones(input: unknown, actor: Actor) {
    assertActor(actor, readers);
    const { page, limit, filter } = parseList(input, 'zone');
    const requested = filter.facilityId as string | undefined;
    if (requested) assertFacilityScope(actor, requested);
    const exactFacilityId = applyListFacilityScope(filter, requested, actor);
    if (!exactFacilityId) filter.facilityId = { $in: await activeManagedFacilityIds() };
    return execute(async () => {
      if (exactFacilityId) await facilityForMap(exactFacilityId);
      const [rows, total] = await Promise.all([
        WarehouseZoneModel.find(filter).sort({ sortOrder: 1, code: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
        WarehouseZoneModel.countDocuments(filter).exec(),
      ]);
      return { data: rows.map(zoneDto), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }

  static async getZone(idInput: unknown, actor: Actor) {
    const zoneId = id(idInput, 'zone ID');
    return execute(async () => {
      const zone = await zoneById(zoneId);
      await assertRecordAccess(actor, zone.facilityId);
      return zoneDto(zone);
    });
  }

  static async updateZone(idInput: unknown, input: unknown, actor: Actor) {
    assertActor(actor, managers);
    const zoneId = id(idInput, 'zone ID');
    const data = parseZoneUpdate(input);
    return execute(async () => {
      const zone = await zoneById(zoneId);
      await assertRecordAccess(actor, zone.facilityId, true);
      return withTransaction(async session => {
        const locked = await lockZone(zoneId, session);
        if (!locked) throw new WarehouseMapError(404, 'Warehouse zone not found');
        if (data.isActive === false) {
          const dependent = await WarehouseRackModel.exists({ zoneId: locked._id, ...live }).session(session).exec();
          if (dependent) throw new WarehouseMapError(409, 'Deactivate active racks before deactivating their warehouse zone');
        }
        Object.assign(locked, data);
        await locked.save({ session });
        return zoneDto(locked);
      });
    });
  }

  static async deleteZone(idInput: unknown, actor: Actor) {
    assertActor(actor, managers);
    const zoneId = id(idInput, 'zone ID');
    return execute(async () => withTransaction(async session => {
      const zone = await lockZone(zoneId, session);
      if (!zone) throw new WarehouseMapError(404, 'Warehouse zone not found');
      await assertRecordAccess(actor, zone.facilityId, true, session);
      const dependent = await WarehouseRackModel.exists({ zoneId: zone._id, ...live }).session(session).exec();
      if (dependent) throw new WarehouseMapError(409, 'Delete active racks before deleting their warehouse zone');
      zone.deletedAt = new Date();
      zone.deletedBy = actor!._id;
      await zone.save({ session });
      return zoneDto(zone);
    }));
  }

  static async restoreZone(idInput: unknown, actor: Actor) {
    assertActor(actor, managers);
    const zoneId = id(idInput, 'zone ID');
    return execute(async () => withTransaction(async session => {
      const zone = await WarehouseZoneModel.findOne({ _id: zoneId, deletedAt: { $exists: true } }).session(session).exec();
      if (!zone) throw new WarehouseMapError(404, 'Deleted warehouse zone not found');
      await assertRecordAccess(actor, zone.facilityId, true, session);
      const restored = await WarehouseZoneModel.findOneAndUpdate(
        { _id: zoneId, deletedAt: { $exists: true } },
        { $unset: { deletedAt: 1, deletedBy: 1 }, $inc: { structureVersion: 1 } },
        { new: true, session, runValidators: true },
      ).exec();
      if (!restored) throw new WarehouseMapError(409, 'Warehouse zone changed; reload and retry');
      return zoneDto(restored);
    }));
  }

  static async createRack(input: unknown, actor: Actor) {
    assertActor(actor, managers);
    const data = parseRackCreate(input) as Record<string, any>;
    assertFacilityScope(actor, data.facilityId, true);
    return execute(async () => withTransaction(async session => {
      const facility = await facilityForMap(data.facilityId, session);
      // Updating the parent document makes rack creation conflict with a concurrent
      // zone delete/deactivation transaction instead of committing under a stale read.
      const zone = await lockZone(data.zoneId, session, { facilityId: data.facilityId, active: true });
      if (!zone) throw new WarehouseMapError(404, 'Active warehouse zone not found in this facility');
      if (!facility._id.equals(zone.facilityId)) throw new WarehouseMapError(409, 'Zone must belong to the selected facility');
      const rack = new WarehouseRackModel({
        facilityId: facility._id, zoneId: zone._id, aisleCode: data.aisleCode, rackCode: data.rackCode,
        dimensions: data.dimensions, levelCount: data.levelCount, cellsPerLevel: data.cellsPerLevel,
        maxWeightKgPerLevel: data.maxWeightKgPerLevel, mapX: data.mapX, mapY: data.mapY,
        orientation: data.orientation, operationalStatus: data.operationalStatus, layoutVersion: 0,
      });
      await rack.save({ session });
      const cellRows = [];
      for (let level = 1; level <= data.levelCount; level += 1) {
        for (let cellNumber = 1; cellNumber <= data.cellsPerLevel; cellNumber += 1) {
          const usableHeightM = data.usableHeightMByLevel?.[level - 1];
          cellRows.push({
            facilityId: facility._id, zoneId: zone._id, rackId: rack._id,
            levelNumber: level, cellNumber,
            code: `${data.rackCode}-L${level}-C${cellNumber}`,
            dimensions: {
              widthM: data.dimensions.widthM / data.cellsPerLevel,
              depthM: data.dimensions.depthM,
              ...(usableHeightM !== undefined ? { usableHeightM } : {}),
            },
            maxWeightKg: data.cellCapacitiesKg[level - 1][cellNumber - 1],
            operationalStatus: data.operationalStatus,
          });
        }
      }
      const cells = await WarehouseCellModel.insertMany(cellRows, { session, ordered: true });
      return { rack: rackDto(rack), cells: cells.map(cellDto) };
    }));
  }

  static async listRacks(input: unknown, actor: Actor) {
    assertActor(actor, readers);
    const { page, limit, filter } = parseList(input, 'rack');
    const requested = filter.facilityId as string | undefined;
    if (requested) assertFacilityScope(actor, requested);
    const exactFacilityId = applyListFacilityScope(filter, requested, actor);
    if (!exactFacilityId) filter.facilityId = { $in: await activeManagedFacilityIds() };
    return execute(async () => {
      if (exactFacilityId) await facilityForMap(exactFacilityId);
      const [rows, total] = await Promise.all([
        WarehouseRackModel.find(filter).sort({ zoneId: 1, aisleCode: 1, mapY: 1, mapX: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
        WarehouseRackModel.countDocuments(filter).exec(),
      ]);
      return { data: rows.map(rackDto), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }

  static async getRack(idInput: unknown, actor: Actor) {
    const rackId = id(idInput, 'rack ID');
    return execute(async () => {
      const rack = await rackById(rackId);
      await assertRecordAccess(actor, rack.facilityId);
      return rackDto(rack);
    });
  }

  static async updateRack(idInput: unknown, input: unknown, actor: Actor) {
    assertActor(actor, managers);
    const rackId = id(idInput, 'rack ID');
    const data = parseRackUpdate(input);
    return execute(async () => withTransaction(async session => {
      const initial = await rackById(rackId, session);
      await assertRecordAccess(actor, initial.facilityId, true, session);
      const zone = await lockZone(initial.zoneId.toString(), session, { facilityId: initial.facilityId.toString(), active: true });
      if (!zone) throw new WarehouseMapError(409, 'Rack zone must be active');
      const rack = await lockRack(rackId, session, { facilityId: initial.facilityId, zoneId: initial.zoneId });
      if (!rack) throw new WarehouseMapError(404, 'Rack not found');
      if (Object.keys(data).length && await hasBlockingAllocation({ facilityId: rack.facilityId, cellId: { $in: await WarehouseCellModel.find({ rackId: rack._id, ...live }).distinct('_id').session(session).exec() } }, session)) {
        throw new WarehouseMapError(409, 'Rack cannot be structurally changed while Cells are reserved or occupied');
      }
      const newDimensions = (data.dimensions ?? rack.dimensions) as RackDimensions;
      const newLevelCapacity = Number(data.maxWeightKgPerLevel ?? rack.maxWeightKgPerLevel);
      const storedUsage = await WarehouseCellModel.aggregate([
        { $match: { rackId: rack._id, ...live } },
        { $group: { _id: '$levelNumber', usedKg: { $sum: { $ifNull: ['$usedWeightKg', 0] } }, usedVolumeM3: { $sum: { $ifNull: ['$usedVolumeM3', 0] } } } },
      ]).session(session).exec();
      const occupied = storedUsage.some((row: any) => Number(row.usedKg) > 0 || Number(row.usedVolumeM3) > 0);
      if (data.dimensions && occupied && (
        newDimensions.widthM < rack.dimensions.widthM || newDimensions.depthM < rack.dimensions.depthM || newDimensions.heightM < rack.dimensions.heightM
      )) throw new WarehouseMapError(409, 'Rack dimensions cannot shrink while physical inventory is stored');
      Object.assign(rack, data);
      if (data.dimensions) {
        const heights = await WarehouseCellModel.aggregate([
          { $match: { rackId: rack._id, 'dimensions.usableHeightM': { $exists: true }, ...live } },
          { $group: { _id: '$levelNumber', maxHeightM: { $max: '$dimensions.usableHeightM' } } },
        ]).session(session).exec();
        const configuredHeight = heights.reduce((sum: number, row: { maxHeightM: number }) => sum + row.maxHeightM, 0);
        if (configuredHeight > newDimensions.heightM) throw new WarehouseMapError(409, 'Configured usable heights across levels exceed the new rack height');
      }
      const usage = await WarehouseCellModel.aggregate([
        { $match: { rackId: rack._id, ...live } },
        { $group: { _id: '$levelNumber', totalKg: { $sum: '$maxWeightKg' } } },
        { $match: { totalKg: { $gt: newLevelCapacity } } },
      ]).session(session).exec();
      if (usage.length) throw new WarehouseMapError(409, 'Cell capacity limits exceed the new level capacity');
      const usedLevel = await WarehouseCellModel.aggregate([
        { $match: { rackId: rack._id, ...live } },
        { $group: { _id: '$levelNumber', usedKg: { $sum: { $ifNull: ['$usedWeightKg', 0] } } } },
        { $match: { usedKg: { $gt: newLevelCapacity } } },
      ]).session(session).exec();
      if (usedLevel.length) throw new WarehouseMapError(409, 'Rated level capacity cannot be reduced below actual stored weight');
      await rack.save({ session });
      if (data.dimensions) {
        await WarehouseCellModel.updateMany(
          { rackId: rack._id, ...live },
          { $set: { 'dimensions.widthM': newDimensions.widthM / rack.cellsPerLevel, 'dimensions.depthM': newDimensions.depthM } },
          { session, runValidators: true },
        ).exec();
      }
      return rackDto(rack);
    }));
  }

  static async deleteRack(idInput: unknown, actor: Actor) {
    assertActor(actor, managers);
    const rackId = id(idInput, 'rack ID');
    return execute(async () => withTransaction(async session => {
      const initial = await rackById(rackId, session);
      await assertRecordAccess(actor, initial.facilityId, true, session);
      const zone = await lockZone(initial.zoneId.toString(), session, { facilityId: initial.facilityId.toString(), active: true });
      if (!zone) throw new WarehouseMapError(409, 'Rack parent zone must be active');
      const rack = await lockRack(rackId, session, { facilityId: initial.facilityId, zoneId: initial.zoneId });
      if (!rack) throw new WarehouseMapError(404, 'Rack not found');
      if (await hasBlockingAllocation({ cellId: { $in: await WarehouseCellModel.find({ rackId: rack._id, ...live }).distinct('_id').session(session).exec() } }, session)) {
        throw new WarehouseMapError(409, 'Rack cannot be deleted while Cells are reserved or occupied');
      }
      const occupied = await WarehouseCellModel.exists({ rackId: rack._id, $or: [{ usedWeightKg: { $gt: 0 } }, { usedVolumeM3: { $gt: 0 } }], ...live }).session(session).exec();
      if (occupied) throw new WarehouseMapError(409, 'Rack cannot be deleted while physical inventory is stored');
      const activeCells = await WarehouseCellModel.countDocuments({ rackId: rack._id, operationalStatus: WarehouseOperationalStatus.AVAILABLE, ...live }).session(session).exec();
      if (activeCells > 0) throw new WarehouseMapError(409, 'Block or place rack cells in maintenance before deleting the rack');
      const deletedAt = new Date();
      await WarehouseCellModel.updateMany({ rackId: rack._id, ...live }, { $set: { deletedAt, deletedBy: actor!._id } }, { session }).exec();
      rack.deletedAt = deletedAt;
      rack.deletedBy = actor!._id;
      await rack.save({ session });
      return rackDto(rack);
    }));
  }

  static async restoreRack(idInput: unknown, actor: Actor) {
    assertActor(actor, managers);
    const rackId = id(idInput, 'rack ID');
    return execute(async () => withTransaction(async session => {
      const rack = await WarehouseRackModel.findOne({ _id: rackId, deletedAt: { $exists: true } }).session(session).exec();
      if (!rack) throw new WarehouseMapError(404, 'Deleted rack not found');
      await assertRecordAccess(actor, rack.facilityId, true, session);
      // Match the parent write-lock used by createRack, deleteZone and updateZone
      // before touching the Rack or its Cells. A parent change forces a transaction
      // conflict/retry; a retry then observes the inactive/deleted Zone and stops.
      const zone = await lockZone(rack.zoneId.toString(), session, {
        facilityId: rack.facilityId.toString(),
        active: true,
      });
      if (!zone) throw new WarehouseMapError(409, 'Restore the active parent zone before restoring this rack');
      const restoredRack = await WarehouseRackModel.findOneAndUpdate(
        { _id: rackId, deletedAt: { $exists: true } },
        { $unset: { deletedAt: 1, deletedBy: 1 }, $inc: { layoutVersion: 1 } },
        { new: true, session, runValidators: true },
      ).exec();
      if (!restoredRack) throw new WarehouseMapError(409, 'Rack changed; reload and retry');
      await WarehouseCellModel.updateMany(
        { rackId: rack._id, deletedAt: { $exists: true } },
        { $unset: { deletedAt: 1, deletedBy: 1 } },
        { session },
      ).exec();
      return rackDto(restoredRack);
    }));
  }

  static async listCells(input: unknown, actor: Actor) {
    assertActor(actor, readers);
    const { page, limit, filter } = parseList(input, 'cell');
    const requested = filter.facilityId as string | undefined;
    if (requested) assertFacilityScope(actor, requested);
    const exactFacilityId = applyListFacilityScope(filter, requested, actor);
    if (!exactFacilityId) filter.facilityId = { $in: await activeManagedFacilityIds() };
    return execute(async () => {
      if (exactFacilityId) await facilityForMap(exactFacilityId);
      const [rows, total] = await Promise.all([
        WarehouseCellModel.find(filter).sort({ rackId: 1, levelNumber: -1, cellNumber: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
        WarehouseCellModel.countDocuments(filter).exec(),
      ]);
      return { data: rows.map(cellDto), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }

  static async getCell(idInput: unknown, actor: Actor) {
    const cellId = id(idInput, 'rack cell ID');
    return execute(async () => {
      const cell = await cellById(cellId);
      await assertRecordAccess(actor, cell.facilityId);
      return cellDto(cell);
    });
  }

  static async updateCell(idInput: unknown, input: unknown, actor: Actor) {
    assertActor(actor, managers);
    const cellId = id(idInput, 'rack cell ID');
    const data = parseCellUpdate(input);
    return execute(async () => withTransaction(async session => {
      const initial = await cellById(cellId, session);
      await assertRecordAccess(actor, initial.facilityId, true, session);
      const zone = await lockZone(initial.zoneId.toString(), session, { facilityId: initial.facilityId.toString(), active: true });
      if (!zone) throw new WarehouseMapError(409, 'Cell parent zone must be active');
      const rack = await lockRack(initial.rackId.toString(), session, { facilityId: initial.facilityId, zoneId: initial.zoneId });
      if (!rack) throw new WarehouseMapError(404, 'Rack not found');
      const cell = await WarehouseCellModel.findOneAndUpdate({ _id: cellId, ...live }, { $inc: { allocationVersion: 1 } }, { new: true, session }).exec();
      if (!cell) throw new WarehouseMapError(404, 'Rack cell not found');
      if (Object.keys(data).length && await hasBlockingAllocation({ cellId: cell._id }, session)) {
        throw new WarehouseMapError(409, 'Cell cannot be structurally changed while it is reserved or occupied');
      }
      const maxWeightKg = Number(data.maxWeightKg ?? cell.maxWeightKg);
      if (maxWeightKg < Number(cell.usedWeightKg ?? 0)) throw new WarehouseMapError(409, 'Cell maxWeightKg cannot be reduced below actual stored weight');
      const siblings = await WarehouseCellModel.aggregate([
        { $match: { rackId: rack._id, levelNumber: cell.levelNumber, _id: { $ne: cell._id }, ...live } },
        { $group: { _id: null, totalKg: { $sum: '$maxWeightKg' } } },
      ]).session(session).exec();
      if ((siblings[0]?.totalKg ?? 0) + maxWeightKg > rack.maxWeightKgPerLevel) {
        throw new WarehouseMapError(409, 'Cell capacity limits on this level would exceed the rack limit');
      }
      if (data.dimensions) {
        const patchDimensions = data.dimensions as Record<string, number>;
        const merged = {
          widthM: patchDimensions.widthM ?? cell.dimensions.widthM,
          depthM: patchDimensions.depthM ?? cell.dimensions.depthM,
          ...(patchDimensions.usableHeightM !== undefined || cell.dimensions.usableHeightM !== undefined
            ? { usableHeightM: patchDimensions.usableHeightM ?? cell.dimensions.usableHeightM! } : {}),
        };
        if (merged.widthM > rack.dimensions.widthM / rack.cellsPerLevel || merged.depthM > rack.dimensions.depthM ||
            (merged.usableHeightM !== undefined && merged.usableHeightM > rack.dimensions.heightM)) {
          throw new WarehouseMapError(409, 'Cell dimensions must fit within the rack dimensions');
        }
        if (Number(cell.usedVolumeM3 ?? 0) > 0 && (
          merged.widthM < cell.dimensions.widthM || merged.depthM < cell.dimensions.depthM ||
          (cell.dimensions.usableHeightM !== undefined && merged.usableHeightM! < cell.dimensions.usableHeightM)
        )) throw new WarehouseMapError(409, 'Cell dimensions cannot shrink while physical inventory is stored');
        if (patchDimensions.usableHeightM !== undefined) {
          const levels = await WarehouseCellModel.aggregate([
            { $match: { rackId: rack._id, _id: { $ne: cell._id }, 'dimensions.usableHeightM': { $exists: true }, ...live } },
            { $group: { _id: '$levelNumber', maxHeightM: { $max: '$dimensions.usableHeightM' } } },
          ]).session(session).exec();
          const levelMax = new Map<number, number>(levels.map((row: { _id: number; maxHeightM: number }) => [row._id, row.maxHeightM]));
          levelMax.set(cell.levelNumber, Math.max(levelMax.get(cell.levelNumber) ?? 0, merged.usableHeightM!));
          const totalUsableHeight = [...levelMax.values()].reduce((sum, height) => sum + height, 0);
          if (totalUsableHeight > rack.dimensions.heightM) {
            throw new WarehouseMapError(409, 'Configured usable heights across levels exceed the rack height');
          }
        }
        cell.dimensions = merged as any;
      }
      if (data.maxWeightKg !== undefined) cell.maxWeightKg = data.maxWeightKg as number;
      if (data.operationalStatus !== undefined) cell.operationalStatus = data.operationalStatus as WarehouseOperationalStatus;
      await cell.save({ session });
      return cellDto(cell);
    }));
  }

  static async warehouseMap(facilityIdInput: unknown, actor: Actor, query?: unknown) {
    const facilityId = id(facilityIdInput, 'facilityId');
    const range = parseBookingRange(query, actor);
    return execute(async () => {
      await assertReadFacility(actor, facilityId, true);
      const facilityObjectId = new Types.ObjectId(facilityId);
      const [zones, racks] = await Promise.all([
        WarehouseZoneModel.find({ facilityId: facilityObjectId, isActive: true, ...live }).sort({ sortOrder: 1, code: 1 }).lean().exec(),
        WarehouseRackModel.find({ facilityId: facilityObjectId, ...live }).sort({ aisleCode: 1, mapY: 1, mapX: 1 }).lean().exec(),
      ]);
      const zoneIds = zones.map(zone => zone._id);
      const rackIds = racks.filter(rack => zoneIds.some(zoneId => zoneId.equals(rack.zoneId))).map(rack => rack._id);
      const cells = rackIds.length ? await WarehouseCellModel.find({ rackId: { $in: rackIds }, ...live }).lean().exec() : [];
      const bookingData = await cellBookingData(cells as IWarehouseCell[], actor, range);
      const cellsByRack = new Map<string, IWarehouseCell[]>();
      for (const cell of cells) {
        const key = cell.rackId.toString();
        cellsByRack.set(key, [...(cellsByRack.get(key) ?? []), cell]);
      }
      const racksByZone = new Map<string, IWarehouseRack[]>();
      for (const rack of racks) {
        if (!zoneIds.some(zoneId => zoneId.equals(rack.zoneId))) continue;
        const key = rack.zoneId.toString();
        racksByZone.set(key, [...(racksByZone.get(key) ?? []), rack]);
      }
      const zonesDto = await Promise.all(zones.map(async zone => {
        const zoneRacks = racksByZone.get(zone._id.toString()) ?? [];
        const aisleCodes = [...new Set(zoneRacks.map(rack => rack.aisleCode))].sort();
        const aisles = await Promise.all(aisleCodes.map(async aisleCode => ({
          aisleCode,
          racks: await Promise.all(zoneRacks.filter(rack => rack.aisleCode === aisleCode).map(async rack => {
            const rackCells = cellsByRack.get(rack._id.toString()) ?? [];
            const ratedCapacityKg = rack.levelCount * rack.maxWeightKgPerLevel;
            const allocatableCapacityKg = rackCells.reduce((sum, cell) => sum + cell.maxWeightKg, 0);
            const usage = await usageForRack(rack as IWarehouseRack, rackCells);
            const statuses = rackCells.map(cell => cellBookingDto(cell, bookingData.rows.get(cell._id.toString()) ?? [], bookingData.myInventoryCells.has(cell._id.toString()), actor));
            return {
              _id: rack._id,
              rackCode: rack.rackCode,
              mapX: rack.mapX,
              mapY: rack.mapY,
              orientation: rack.orientation,
              dimensions: rack.dimensions,
              operationalStatus: rack.operationalStatus,
              utilization: {
                usedWeightKg: usage.usedWeightKg,
                usedVolumeM3: usage.usedVolumeM3,
                source: usage.source,
                // Keep maxWeightKg as the legacy rated capacity field.
                maxWeightKg: ratedCapacityKg,
                ratedCapacityKg,
                allocatableCapacityKg,
                remainingWeightKg: validRemaining(ratedCapacityKg, usage.usedWeightKg),
                ratio: ratedCapacityKg > 0 ? usage.usedWeightKg / ratedCapacityKg : 0,
                status: utilizationStatus(usage.usedWeightKg, ratedCapacityKg),
              },
              cellCount: rackCells.length,
              availableCellCount: statuses.filter(cell => cell.displayStatus === 'AVAILABLE').length,
              reservedCellCount: statuses.filter(cell => cell.displayStatus === 'RESERVED').length,
              occupiedCellCount: statuses.filter(cell => cell.displayStatus === 'OCCUPIED').length,
              blockedCellCount: statuses.filter(cell => cell.displayStatus === 'BLOCKED').length,
              maintenanceCellCount: statuses.filter(cell => cell.displayStatus === 'MAINTENANCE').length,
              myCellCount: statuses.filter(cell => cell.isMine || cell.hasMyInventory).length,
            };
          })),
        })));
        return { _id: zone._id, code: zone.code, name: zone.name, ...(zone.color ? { color: zone.color } : {}), aisles };
      }));
      return { facilityId, zones: zonesDto };
    });
  }

  static async rackDetailMap(idInput: unknown, actor: Actor, query?: unknown) {
    const rackId = id(idInput, 'rack ID');
    const range = parseBookingRange(query, actor);
    return execute(async () => {
      const rack = await rackById(rackId);
      await assertReadFacility(actor, rack.facilityId.toString(), true);
      const zone = await WarehouseZoneModel.findOne({ _id: rack.zoneId, isActive: true, ...live }).exec();
      if (!zone) throw new WarehouseMapError(404, 'Rack zone not found');
      const cells = await WarehouseCellModel.find({ rackId: rack._id, ...live }).sort({ levelNumber: -1, cellNumber: 1 }).lean().exec();
      const bookingData = await cellBookingData(cells as IWarehouseCell[], actor, range);
      const usage = await usageForRack(rack, cells as IWarehouseCell[]);
      const levels = [];
      for (let levelNumber = rack.levelCount; levelNumber >= 1; levelNumber -= 1) {
        const levelCells = cells.filter(cell => cell.levelNumber === levelNumber);
        const maxWeightKg = rack.maxWeightKgPerLevel;
        const allocatableCapacityKg = levelCells.reduce((sum, cell) => sum + cell.maxWeightKg, 0);
        const usedWeightKg = levelCells.reduce((sum, cell) => sum + Number(cell.usedWeightKg ?? 0), 0);
        const usedVolumeM3 = levelCells.reduce((sum, cell) => sum + Number(cell.usedVolumeM3 ?? 0), 0);
        levels.push({
          levelNumber,
          maxWeightKg,
          ratedCapacityKg: maxWeightKg,
          allocatableCapacityKg,
          usedWeightKg,
          usedVolumeM3,
          remainingWeightKg: validRemaining(maxWeightKg, usedWeightKg),
          utilizationStatus: utilizationStatus(usedWeightKg, maxWeightKg),
          cells: levelCells.map(cell => ({
            _id: cell._id,
            code: cell.code,
            cellNumber: cell.cellNumber,
            dimensions: cell.dimensions,
            operationalStatus: cell.operationalStatus,
            utilizationStatus: utilizationStatus(Number(cell.usedWeightKg ?? 0), cell.maxWeightKg),
            ...cellBookingDto(cell as IWarehouseCell, bookingData.rows.get(cell._id.toString()) ?? [], bookingData.myInventoryCells.has(cell._id.toString()), actor),
          })),
        });
      }
      const capacityKg = rack.levelCount * rack.maxWeightKgPerLevel;
      const allocatableCapacityKg = cells.reduce((sum, cell) => sum + cell.maxWeightKg, 0);
      return {
        rack: {
          _id: rack._id,
          facilityId: rack.facilityId,
          zoneId: rack.zoneId,
          zoneCode: zone.code,
          aisleCode: rack.aisleCode,
          rackCode: rack.rackCode,
          dimensions: rack.dimensions,
          levelCount: rack.levelCount,
          cellsPerLevel: rack.cellsPerLevel,
          mapX: rack.mapX,
          mapY: rack.mapY,
          orientation: rack.orientation,
          operationalStatus: rack.operationalStatus,
        },
        capacity: {
          maxWeightKg: capacityKg,
          ratedCapacityKg: capacityKg,
          allocatableCapacityKg,
          usedWeightKg: usage.usedWeightKg,
          usedVolumeM3: usage.usedVolumeM3,
          remainingWeightKg: validRemaining(capacityKg, usage.usedWeightKg),
          utilizationStatus: utilizationStatus(usage.usedWeightKg, capacityKg),
          source: usage.source,
        },
        levels,
      };
    });
  }
}
