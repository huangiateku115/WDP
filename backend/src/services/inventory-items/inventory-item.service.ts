import { Types } from 'mongoose';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import WarehouseZoneModel from '../../models/warehouse-map/warehouse-zone.model';
import { IInventoryItem, InventoryItemStatus } from '../../types/inventory-item.type';
import { IUser, UserRole } from '../../types/user.type';
import { WarehouseOperationalStatus } from '../../types/warehouse-map.type';
import { requireActiveManagedInventoryReservation, ManagedReservationGuardError } from '../reservations/managed-inventory-reservation.guard';
import { InventoryItemError, parseCreate, parseId, parseList, parseUpdate } from './inventory-item.validation';

type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
const managementReaders = [UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF];
const live = { deletedAt: { $exists: false } };

async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof InventoryItemError || error instanceof ManagedReservationGuardError) throw error;
    const e = error as { code?: number; name?: string };
    if (e?.code === 11000) throw new InventoryItemError(409, 'Item code already exists in this Facility');
    if (e?.name === 'CastError' || e?.name === 'ValidationError') throw new InventoryItemError(400, 'Invalid inventory item data');
    throw new InventoryItemError(500, 'Internal Server Error');
  }
}

function assertFacilityScope(actor: Actor, facilityId: string) {
  if (actor.role === UserRole.FACILITY_MANAGER || actor.role === UserRole.FACILITY_STAFF) {
    if (!actor.assignedFacilityId || actor.assignedFacilityId.toString() !== facilityId.toLowerCase()) {
      throw new InventoryItemError(403, 'Facility is outside assigned scope');
    }
  }
}

function dto(item: IInventoryItem, includeCustomer = false) {
  return {
    _id: item._id,
    facilityId: item.facilityId,
    ...(includeCustomer ? { customerId: item.customerId } : {}),
    managedReservationId: item.managedReservationId,
    itemCode: item.itemCode,
    name: item.name,
    category: item.category,
    ...(item.description ? { description: item.description } : {}),
    quantity: item.quantity,
    quantityUnit: item.quantityUnit,
    unitWeightKg: item.unitWeightKg,
    unitDimensionsM: item.unitDimensionsM,
    unitVolumeM3: item.unitVolumeM3,
    totalWeightKg: item.totalWeightKg,
    totalVolumeM3: item.totalVolumeM3,
    ...(item.preferredCellId ? { preferredCellId: item.preferredCellId } : {}),
    currentCellId: item.currentCellId,
    status: item.status,
    images: item.images ?? [],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function deriveTotals(value: {
  quantity: number;
  unitWeightKg: number;
  unitDimensionsM: { widthM: number; depthM: number; heightM: number };
}) {
  const unitVolumeM3 = value.unitDimensionsM.widthM * value.unitDimensionsM.depthM * value.unitDimensionsM.heightM;
  const totalWeightKg = value.quantity * value.unitWeightKg;
  const totalVolumeM3 = value.quantity * unitVolumeM3;
  if (![unitVolumeM3, totalWeightKg, totalVolumeM3].every(Number.isFinite) || unitVolumeM3 <= 0 || totalWeightKg <= 0 || totalVolumeM3 <= 0) {
    throw new InventoryItemError(400, 'Derived item weight and volume must remain finite and positive');
  }
  return { unitVolumeM3, totalWeightKg, totalVolumeM3 };
}

async function loadItem(id: string) {
  const item = await InventoryItemModel.findOne({ _id: id, ...live }).exec();
  if (!item) throw new InventoryItemError(404, 'Inventory item not found');
  return item;
}

async function assertItemReadAccess(item: IInventoryItem, actor: Actor) {
  const facilityId = item.facilityId.toString();
  if (actor.role === UserRole.CUSTOMER) {
    if (item.customerId.toString() !== actor._id.toString()) throw new InventoryItemError(404, 'Inventory item not found');
    return;
  }
  if (!managementReaders.includes(actor.role)) throw new InventoryItemError(403, 'Forbidden');
  assertFacilityScope(actor, facilityId);
}

async function validatePreferredCell(cellId: string, facilityId: Types.ObjectId) {
  const cell = await WarehouseCellModel.findOne({ _id: cellId, facilityId, ...live }).exec();
  if (!cell) throw new InventoryItemError(404, 'Preferred Cell not found in this Facility');
  if (cell.operationalStatus !== WarehouseOperationalStatus.AVAILABLE) throw new InventoryItemError(409, 'Preferred Cell must be AVAILABLE');
  const [zone, rack] = await Promise.all([
    WarehouseZoneModel.findOne({ _id: cell.zoneId, facilityId, isActive: true, ...live }).exec(),
    WarehouseRackModel.findOne({ _id: cell.rackId, facilityId, zoneId: cell.zoneId, operationalStatus: WarehouseOperationalStatus.AVAILABLE, ...live }).exec(),
  ]);
  if (!zone || !rack) throw new InventoryItemError(409, 'Preferred Cell must belong to an active Zone and available Rack');
  return cell;
}

export class InventoryItemService {
  static async create(input: unknown, actor: Actor) {
    if (actor.role !== UserRole.CUSTOMER) throw new InventoryItemError(403, 'Only customers can register inventory items');
    const data = parseCreate(input);
    return execute(async () => {
      const reservation = await requireActiveManagedInventoryReservation(data.managedReservationId, actor._id);
      const facilityId = reservation.facilityId;
      const preferredCell = data.preferredCellId ? await validatePreferredCell(data.preferredCellId, facilityId) : undefined;
      const totals = deriveTotals(data);
      const item = new InventoryItemModel({
        ...data,
        facilityId,
        customerId: actor._id,
        managedReservationId: reservation._id,
        ...(preferredCell ? { preferredCellId: preferredCell._id } : {}),
        ...totals,
        currentCellId: null,
        status: InventoryItemStatus.REGISTERED,
        createdBy: actor._id,
      });
      await item.save();
      return dto(item);
    });
  }

  static async listMine(query: unknown, actor: Actor) {
    if (actor.role !== UserRole.CUSTOMER) throw new InventoryItemError(403, 'Customer role required');
    const parsed = parseList(query);
    if (parsed.facilityId || parsed.customerId) throw new InventoryItemError(400, 'Customer list scope is derived from the authenticated user');
    return execute(async () => {
      // Registration history remains visible to its owner after a reservation closes.
      const filter = { customerId: actor._id, ...live };
      const [items, total] = await Promise.all([
        InventoryItemModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((parsed.page - 1) * parsed.limit).limit(parsed.limit).lean().exec(),
        InventoryItemModel.countDocuments(filter).exec(),
      ]);
      return { data: items.map(item => dto(item as IInventoryItem)), pagination: { page: parsed.page, limit: parsed.limit, total, totalPages: Math.ceil(total / parsed.limit) } };
    });
  }

  static async list(query: unknown, actor: Actor) {
    if (!managementReaders.includes(actor.role)) throw new InventoryItemError(403, 'Operational or management role required');
    const parsed = parseList(query);
    const filter: Record<string, unknown> = { ...live };
    if (actor.role === UserRole.FACILITY_MANAGER || actor.role === UserRole.FACILITY_STAFF) {
      const assigned = actor.assignedFacilityId?.toString();
      if (!assigned) throw new InventoryItemError(403, 'Facility assignment is required');
      if (parsed.facilityId && parsed.facilityId !== assigned) throw new InventoryItemError(403, 'Facility is outside assigned scope');
      filter.facilityId = actor.assignedFacilityId;
    } else if (parsed.facilityId) filter.facilityId = new Types.ObjectId(parsed.facilityId);
    if (parsed.customerId) filter.customerId = new Types.ObjectId(parsed.customerId);
    if (parsed.category) filter.category = parsed.category;
    if (parsed.status) filter.status = parsed.status;
    if (parsed.search) {
      const regex = new RegExp(escapeRegex(parsed.search), 'i');
      filter.$or = [{ itemCode: regex }, { name: regex }, { category: regex }];
    }
    return execute(async () => {
      const [items, total] = await Promise.all([
        InventoryItemModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((parsed.page - 1) * parsed.limit).limit(parsed.limit).lean().exec(),
        InventoryItemModel.countDocuments(filter).exec(),
      ]);
      return { data: items.map(item => dto(item as IInventoryItem, true)), pagination: { page: parsed.page, limit: parsed.limit, total, totalPages: Math.ceil(total / parsed.limit) } };
    });
  }

  static async get(idInput: unknown, actor: Actor) {
    const itemId = parseId(idInput, 'item ID');
    return execute(async () => {
      const item = await loadItem(itemId);
      await assertItemReadAccess(item, actor);
      return dto(item, actor.role !== UserRole.CUSTOMER);
    });
  }

  static async update(idInput: unknown, input: unknown, actor: Actor) {
    if (actor.role !== UserRole.CUSTOMER) throw new InventoryItemError(403, 'Only the owning customer may update registered item metadata');
    const itemId = parseId(idInput, 'item ID');
    const changes = parseUpdate(input);
    return execute(async () => {
      const item = await loadItem(itemId);
      await assertItemReadAccess(item, actor);
      // Closed rentals do not erase history, but they cannot authorize metadata changes.
      await requireActiveManagedInventoryReservation(item.managedReservationId, actor._id, item.facilityId);
      if (item.status !== InventoryItemStatus.REGISTERED || item.currentCellId !== null) throw new InventoryItemError(409, 'Only unplaced REGISTERED item metadata can be edited');
      if (changes.preferredCellId) await validatePreferredCell(changes.preferredCellId as string, item.facilityId);
      const normalized = { ...changes };
      const preferredCellId = normalized.preferredCellId;
      delete normalized.preferredCellId;
      Object.assign(item, normalized);
      if (preferredCellId === null) item.set('preferredCellId', undefined);
      else if (preferredCellId) item.preferredCellId = new Types.ObjectId(preferredCellId as string);
      Object.assign(item, deriveTotals(item));
      item.currentCellId = null;
      item.status = InventoryItemStatus.REGISTERED;
      await item.save();
      return dto(item);
    });
  }

  static async placementPreview(idInput: unknown, query: unknown, actor: Actor) {
    const itemId = parseId(idInput, 'item ID');
    const input = query && typeof query === 'object' && !Array.isArray(query) ? query as Record<string, unknown> : {};
    if (Object.keys(input).some(key => key !== 'cellId')) throw new InventoryItemError(400, 'query contains an unsupported field');
    return execute(async () => {
      const item = await loadItem(itemId);
      await assertItemReadAccess(item, actor);
      const reservation = await requireActiveManagedInventoryReservation(item.managedReservationId, item.customerId, item.facilityId);
      const candidateCellId = input.cellId === undefined ? item.preferredCellId?.toString() : parseId(input.cellId, 'cellId');
      if (!candidateCellId) throw new InventoryItemError(400, 'cellId or a preferred Cell is required');
      const cell = await WarehouseCellModel.findOne({ _id: candidateCellId, facilityId: item.facilityId, ...live }).exec();
      if (!cell) throw new InventoryItemError(404, 'Cell not found in the item Facility');
      if (cell.operationalStatus !== WarehouseOperationalStatus.AVAILABLE) throw new InventoryItemError(409, 'Placement preview requires an AVAILABLE Cell');
      const [zone, rack] = await Promise.all([
        WarehouseZoneModel.findOne({ _id: cell.zoneId, facilityId: item.facilityId, isActive: true, ...live }).exec(),
        WarehouseRackModel.findOne({ _id: cell.rackId, facilityId: item.facilityId, zoneId: cell.zoneId, operationalStatus: WarehouseOperationalStatus.AVAILABLE, ...live }).exec(),
      ]);
      if (!zone) throw new InventoryItemError(409, 'Placement preview requires an active Zone');
      if (!rack) throw new InventoryItemError(409, 'Placement preview requires an available Rack');

      const unit = item.unitDimensionsM;
      const cellDimensions = cell.dimensions;
      const horizontalFit = (unit.widthM <= cellDimensions.widthM && unit.depthM <= cellDimensions.depthM) ||
        (unit.depthM <= cellDimensions.widthM && unit.widthM <= cellDimensions.depthM);
      const heightFit = cellDimensions.usableHeightM === undefined ? null : unit.heightM <= cellDimensions.usableHeightM;
      const cellVolumeM3 = cellDimensions.usableHeightM === undefined
        ? null
        : cellDimensions.widthM * cellDimensions.depthM * cellDimensions.usableHeightM;
      const lotVolumeWithinCellVolume = cellVolumeM3 === null ? null : item.totalVolumeM3 <= cellVolumeM3;
      const checks = {
        unitGeometryFits: heightFit === null ? null : horizontalFit && heightFit,
        unitHorizontalDimensionsFit: horizontalFit,
        unitHeightFitsKnownClearance: heightFit,
        totalLotWeightWithinCellCapacity: item.totalWeightKg <= cell.maxWeightKg,
        totalLotWeightWithinLevelRatedCapacity: item.totalWeightKg <= rack.maxWeightKgPerLevel,
        totalLotWeightWithinRackRatedCapacity: item.totalWeightKg <= rack.levelCount * rack.maxWeightKgPerLevel,
        totalLotVolumeWithinKnownCellVolume: lotVolumeWithinCellVolume,
        totalLotVolumeWithinAllocatedRentalQuota: item.totalVolumeM3 <= Number(reservation.allocatedCapacity),
        // Aggregate volume does not prove that multiple physical units can be packed in this cell.
        multiUnitPackingLayoutValidated: item.quantity > 1 ? null : true,
      };
      const knownFailures = Object.values(checks).some(value => value === false);
      const hasUnknowns = Object.values(checks).some(value => value === null);
      const estimatedFit = knownFailures ? false : hasUnknowns ? null : true;
      const uncertainty = ['ACTUAL_CELL_USAGE_NOT_AVAILABLE_IN_MI_01'];
      if (heightFit === null) uncertainty.push('USABLE_CELL_HEIGHT_NOT_MEASURED');
      if (item.quantity > 1) uncertainty.push('MULTI_UNIT_PACKING_LAYOUT_NOT_CHECKED');
      return {
        itemId: item._id,
        cellId: cell._id,
        advisory: true,
        advisoryStatus: estimatedFit === false ? 'NOT_FIT' : estimatedFit === null ? 'NEEDS_MEASUREMENT' : 'ESTIMATED_FIT',
        estimatedFit,
        allocationConfirmed: false,
        reservationCreated: false,
        stockWritten: false,
        staffConfirmationRequired: true,
        actualUsageKnown: false,
        itemEstimate: {
          quantity: item.quantity,
          unitWeightKg: item.unitWeightKg,
          totalWeightKg: item.totalWeightKg,
          unitVolumeM3: item.unitVolumeM3,
          totalVolumeM3: item.totalVolumeM3,
        },
        cellCapacity: { maxWeightKg: cell.maxWeightKg, ...(cellVolumeM3 === null ? {} : { maxVolumeM3: cellVolumeM3 }) },
        rentalQuota: { allocatedCapacityM3: Number(reservation.allocatedCapacity), itemVolumeWithinQuota: checks.totalLotVolumeWithinAllocatedRentalQuota },
        checks,
        uncertainty,
        notes: ['Advisory geometry/capacity preview only; no capacity is reserved and availability is not guaranteed.'],
        quantityPackingLayoutChecked: item.quantity <= 1,
      };
    });
  }
}
