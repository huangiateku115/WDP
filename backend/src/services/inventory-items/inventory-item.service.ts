import mongoose, { ClientSession, Types } from 'mongoose';
import FacilityModel from '../../models/facilities/facility.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import ContractModel from '../../models/contracts/contract.model';
import ReservationModel from '../../models/reservations/reservation.model';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import ManagedFacilityCapacityModel from '../../models/reservations/managed-facility-capacity.model';
import ManagedReservationAuditModel from '../../models/reservations/managed-reservation-audit.model';
import PolicyModel from '../../models/pricing-policy/policy.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import WarehouseZoneModel from '../../models/warehouse-map/warehouse-zone.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import { IInventoryItem, InventoryItemStatus } from '../../types/inventory-item.type';
import { ItemMovementType } from '../../types/item-movement.type';
import { FacilityServiceType, FacilityStatus } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { PolicyType } from '../../types/pricing-policy.type';
import { ContractStatus, IContract } from '../../types/contract.type';
import { PaymentPurpose, PaymentStatus } from '../../types/payment.type';
import { ManagedReservationAction } from '../../types/managed-reservation-audit.type';
import { IUser, UserRole } from '../../types/user.type';
import { CellAllocationStatus, WarehouseOperationalStatus } from '../../types/warehouse-map.type';
import { requireActiveManagedInventoryReservation, requireManagedInventoryReservationForRegistration, ManagedReservationGuardError } from '../reservations/managed-inventory-reservation.guard';
import { InboundConfirmationInput, InventoryItemError, parseCreate, parseId, parseInboundConfirmation, parseInboundRejection, parseList, parseUpdate } from './inventory-item.validation';
import { validateCategoryPolicyConfig } from '../pricing-policy/rule.validation';
import { calculateRentalPaymentBreakdown } from '../payments/payment-accounting';

type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
const managementReaders = [UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF];
const live = { deletedAt: { $exists: false } };

async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof InventoryItemError || error instanceof ManagedReservationGuardError) throw error;
    const e = error as { code?: number; name?: string; hasErrorLabel?: (label: string) => boolean };
    if (e?.code === 11000) throw new InventoryItemError(409, 'Item code already exists in this Facility');
    if (e?.name === 'CastError' || e?.name === 'ValidationError') throw new InventoryItemError(400, 'Invalid inventory item data');
    if (e?.name === 'VersionError' || e?.hasErrorLabel?.('TransientTransactionError')) throw new InventoryItemError(409, 'Inventory changed concurrently; reload and retry');
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
    ...(item.inboundRequestedAt ? { inboundRequestedAt: item.inboundRequestedAt } : {}),
    ...(item.inboundConfirmedAt ? { inboundConfirmedAt: item.inboundConfirmedAt } : {}),
    ...(item.inboundRejection ? { inboundRejection: {
      reason: item.inboundRejection.reason,
      rejectedAt: item.inboundRejection.rejectedAt,
    } } : {}),
    ...(item.receivingCustodyStatus ? { receivingCustodyStatus: item.receivingCustodyStatus } : {}),
    ...(item.receivingInspection ? { receivingInspection: {
      decision: item.receivingInspection.decision,
      observedQuantity: item.receivingInspection.observedQuantity,
      observedUnitWeightKg: item.receivingInspection.observedUnitWeightKg,
      observedUnitDimensionsM: item.receivingInspection.observedUnitDimensionsM,
      compatibleWithCellIds: item.receivingInspection.compatibleWithCellIds,
      packingLayoutVerified: item.receivingInspection.packingLayoutVerified,
      note: item.receivingInspection.note,
      inspectedAt: item.receivingInspection.inspectedAt,
    } } : {}),
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

function rounded(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function measurementMatches(expected: number, measured: number, decimals: number) {
  return rounded(expected, decimals) === rounded(measured, decimals);
}

async function withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally { await session.endSession(); }
}

async function lockReservationForInbound(item: IInventoryItem, session: ClientSession, now: Date, allowDepositPaidRequest = false) {
  const reservation = await ReservationModel.findOneAndUpdate({
    _id: item.managedReservationId,
    customerId: item.customerId,
    facilityId: item.facilityId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY,
    ...(allowDepositPaidRequest ? { $or: [
      { status: ReservationStatus.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now } },
      { status: ReservationStatus.DEPOSIT_PAID, bookingFlowVersion: 2, endDate: { $gt: now } },
      { status: ReservationStatus.CHECKIN_READY, bookingFlowVersion: 2, endDate: { $gt: now } },
    ] } : { $or: [
      { status: ReservationStatus.ACTIVE, startDate: { $lte: now }, endDate: { $gt: now } },
      { status: ReservationStatus.CHECKIN_READY, bookingFlowVersion: 2, startDate: { $lte: now }, endDate: { $gt: now } },
    ] }),
  }, { $inc: { inventoryVersion: 1 } }, { new: true, session, runValidators: true }).exec();
  if (!reservation) throw new InventoryItemError(409, allowDepositPaidRequest ? 'An active or deposit-paid version 2 Managed reservation is required to request inbound' : 'An active, in-term Managed Inventory rental is required to confirm inbound');
  const overdue = await ReservationModel.exists({
    customerId: item.customerId,
    facilityId: item.facilityId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY,
    status: ReservationStatus.OVERDUE,
    _id: { $ne: reservation._id },
  }).session(session).exec();
  if (overdue) throw new InventoryItemError(409, 'An unresolved overdue Managed rental blocks new inbound');
  return reservation;
}

function signedByBothCurrentVersion(contract: IContract) {
  const version = contract.currentContentVersion;
  const active = contract.contentVersions?.find(entry => entry.version === version);
  if (!version || !active || contract.status !== ContractStatus.SIGNED) return false;
  const signatures = contract.signatures?.filter(signature => signature.version === version && signature.contentHash === active.contentHash) ?? [];
  return signatures.some(signature => signature.signerRole === UserRole.CUSTOMER) && signatures.some(signature => signature.signerRole !== UserRole.CUSTOMER);
}

async function assertV2FirstInboundPrerequisites(reservation: any, item: IInventoryItem, session: ClientSession, at: Date) {
  if (reservation.bookingFlowVersion !== 2 || reservation.status !== ReservationStatus.CHECKIN_READY) return;
  if (reservation.startDate > at || reservation.endDate <= at) throw new InventoryItemError(409, 'First Managed inbound is allowed only during the rental period');
  const deposit = await ReservationPaymentModel.findOne({ reservationId: reservation._id, purpose: PaymentPurpose.DEPOSIT, status: PaymentStatus.SUCCEEDED }).session(session).exec();
  if (!deposit || deposit.serviceType !== FacilityServiceType.MANAGED_INVENTORY || !deposit.customerId.equals(reservation.customerId) || deposit.currency !== 'VND' || deposit.amount !== reservation.depositAmount) {
    throw new InventoryItemError(409, 'Successful Managed deposit settlement is required');
  }
  const breakdown = calculateRentalPaymentBreakdown({ rentAmount: reservation.estimatedRent, depositAmount: deposit.amount, taxAmount: reservation.taxAmount ?? 0, discountAmount: reservation.discountAmount ?? 0 });
  if (breakdown.balanceDue > 0) {
    const balance = await ReservationPaymentModel.findOne({ reservationId: reservation._id, purpose: PaymentPurpose.BALANCE, status: PaymentStatus.SUCCEEDED }).session(session).exec();
    if (!balance || balance.serviceType !== FacilityServiceType.MANAGED_INVENTORY || !balance.customerId.equals(reservation.customerId) || balance.currency !== 'VND' || balance.amount !== breakdown.balanceDue) {
      throw new InventoryItemError(409, 'Full Managed balance settlement is required before first inbound');
    }
  } else if (!reservation.balanceSettledAt) throw new InventoryItemError(409, 'Zero balance must be explicitly settled before first inbound');

  const contract = await ContractModel.findOne({ reservationId: reservation._id, customerId: reservation.customerId }).session(session).exec();
  if (!contract || !signedByBothCurrentVersion(contract)) throw new InventoryItemError(409, 'Customer and Facility representative must sign the current contract version before first inbound');
  const active = contract.contentVersions?.find(entry => entry.version === contract.currentContentVersion);
  const handover = (active?.content as any)?.handover;
  const snapshot = Array.isArray(handover) ? handover.find((entry: any) => String(entry.itemId) === String(item._id)) : undefined;
  const inspection = item.receivingInspection;
  const snapshotCells = Array.isArray(snapshot?.compatibleCellIds) ? snapshot.compatibleCellIds.map(String).sort() : [];
  const inspectedCells = (inspection?.compatibleWithCellIds ?? []).map(String).sort();
  if (!snapshot || snapshot.decision !== 'ACCEPTED' || !inspection || inspection.decision !== 'ACCEPTED' ||
      snapshot.itemCode !== item.itemCode || snapshot.name !== item.name || snapshot.category !== item.category || snapshot.quantity !== inspection.observedQuantity ||
      !measurementMatches(snapshot.weightKg, inspection.observedUnitWeightKg, 3) ||
      !measurementMatches(snapshot.dimensionsM?.widthM, inspection.observedUnitDimensionsM?.widthM, 6) ||
      !measurementMatches(snapshot.dimensionsM?.depthM, inspection.observedUnitDimensionsM?.depthM, 6) ||
      !measurementMatches(snapshot.dimensionsM?.heightM, inspection.observedUnitDimensionsM?.heightM, 6) ||
      Boolean(snapshot.packingLayoutVerified) !== Boolean(inspection.packingLayoutVerified) ||
      snapshotCells.length !== inspectedCells.length || snapshotCells.some((cellId: string, index: number) => cellId !== inspectedCells[index])) {
    throw new InventoryItemError(409, 'Accepted receiving inspection must match the signed contract version');
  }
}

async function lockZoneForInbound(zoneId: Types.ObjectId, facilityId: Types.ObjectId, session: ClientSession) {
  const zone = await WarehouseZoneModel.findOneAndUpdate({
    _id: zoneId, facilityId, isActive: true, ...live,
  }, { $inc: { structureVersion: 1 } }, { new: true, session, runValidators: true }).exec();
  if (!zone) throw new InventoryItemError(409, 'Destination Zone must be active');
  return zone;
}

async function lockRackForInbound(rackId: Types.ObjectId, facilityId: Types.ObjectId, zoneId: Types.ObjectId, session: ClientSession) {
  const rack = await WarehouseRackModel.findOneAndUpdate({
    _id: rackId, facilityId, zoneId, operationalStatus: WarehouseOperationalStatus.AVAILABLE, ...live,
  }, { $inc: { layoutVersion: 1 } }, { new: true, session, runValidators: true }).exec();
  if (!rack) throw new InventoryItemError(409, 'Destination Rack must be active and AVAILABLE');
  return rack;
}

async function assertCategoryPolicyDecision(facilityId: Types.ObjectId, category: string, session: ClientSession, at: Date) {
  const policies = await PolicyModel.find({
    facilityId,
    serviceType: FacilityServiceType.MANAGED_INVENTORY,
    type: PolicyType.CATEGORY,
    isActive: true,
    effectiveFrom: { $lte: at },
    $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: { $gt: at } }],
  }).session(session).limit(2).lean().exec();
  const policy = policies[0];
  if (policies.length !== 1 || !policy) throw new InventoryItemError(409, policies.length ? 'Managed Inventory CATEGORY policy is ambiguous' : 'No effective Managed Inventory CATEGORY policy is configured');
  let config: ReturnType<typeof validateCategoryPolicyConfig>;
  try { config = validateCategoryPolicyConfig(policy.config); }
  catch { throw new InventoryItemError(409, 'Effective Managed Inventory CATEGORY policy configuration is invalid'); }
  const normalizedCategory = category.trim().toUpperCase();
  if (config.blockedCategories.includes(normalizedCategory)) throw new InventoryItemError(409, 'Item category is prohibited by the effective Facility policy');
  if (!config.allowedCategories.includes(normalizedCategory)) throw new InventoryItemError(409, 'Item category is not allowed by the effective Facility policy');
}

function inboundReplayMatches(current: IInventoryItem, prior: any, data: InboundConfirmationInput) {
  return current.currentCellId?.toString() === data.cellId &&
    prior.destinationCellId?.toString() === data.cellId &&
    prior.quantity === data.verifiedQuantity &&
    measurementMatches(Number(prior.actualUnitWeightKg), data.actualUnitWeightKg, 3) &&
    measurementMatches(Number(prior.actualUnitDimensionsM?.widthM), data.actualUnitDimensionsM.widthM, 6) &&
    measurementMatches(Number(prior.actualUnitDimensionsM?.depthM), data.actualUnitDimensionsM.depthM, 6) &&
    measurementMatches(Number(prior.actualUnitDimensionsM?.heightM), data.actualUnitDimensionsM.heightM, 6) &&
    prior.inspectionNote === data.inspectionNote &&
    (current.quantity <= 1 || data.physicalPackingConfirmed);
}

function movementDto(movement: any, includeCustomer = true) {
  return {
    _id: movement._id, itemId: movement.itemId, managedReservationId: movement.managedReservationId,
    facilityId: movement.facilityId,
    ...(includeCustomer ? { customerId: movement.customerId, performedBy: movement.performedBy } : {}),
    type: movement.type,
    destinationCellId: movement.destinationCellId, quantity: movement.quantity, quantityUnit: movement.quantityUnit,
    actualUnitWeightKg: movement.actualUnitWeightKg, actualTotalWeightKg: movement.actualTotalWeightKg,
    actualUnitDimensionsM: movement.actualUnitDimensionsM, actualTotalVolumeM3: movement.actualTotalVolumeM3,
    performedAt: movement.performedAt, inspectionNote: movement.inspectionNote,
    createdAt: movement.createdAt,
  };
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
      const reservation = await requireManagedInventoryReservationForRegistration(data.managedReservationId, actor._id);
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
      // Normal item edits remain ACTIVE-only. A rejected v2 receiving inspection
      // may be corrected after deposit, before a contract snapshot is created.
      let reservation;
      try { reservation = await requireActiveManagedInventoryReservation(item.managedReservationId, actor._id, item.facilityId); }
      catch (error) {
        if (!(error instanceof ManagedReservationGuardError) || item.receivingInspection?.decision !== 'REJECTED') throw error;
        reservation = await requireManagedInventoryReservationForRegistration(item.managedReservationId, actor._id, item.facilityId);
        if (reservation.status !== ReservationStatus.DEPOSIT_PAID || reservation.bookingFlowVersion !== 2 || await ContractModel.exists({ reservationId: reservation._id })) throw error;
      }
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
      if (item.receivingInspection?.decision === 'REJECTED') {
        item.set('receivingInspection', undefined);
        item.receivingCustodyStatus = 'NONE' as any;
      }
      await item.save();
      return dto(item);
    });
  }

  static async requestInbound(idInput: unknown, actor: Actor) {
    if (actor.role !== UserRole.CUSTOMER) throw new InventoryItemError(403, 'Customer role required');
    const itemId = parseId(idInput, 'item ID');
    return execute(async () => withTransaction(async session => {
      const item = await InventoryItemModel.findOne({ _id: itemId, customerId: actor._id, ...live }).session(session).exec();
      if (!item) throw new InventoryItemError(404, 'Inventory item not found');
      if (item.status !== InventoryItemStatus.REGISTERED || item.currentCellId !== null) throw new InventoryItemError(409, 'Only unplaced REGISTERED inventory can request inbound');
      const now = new Date();
      const pending = await InventoryItemModel.findOneAndUpdate({
        _id: item._id, customerId: actor._id, status: InventoryItemStatus.REGISTERED, currentCellId: null, ...live,
      }, {
        $set: { status: InventoryItemStatus.PENDING_INBOUND, inboundRequestedAt: now, inboundRequestedBy: actor._id },
        $unset: { inboundRejection: 1 }, $inc: { __v: 1 },
      }, { new: true, session, runValidators: true }).exec();
      if (!pending) throw new InventoryItemError(409, 'Inventory item changed; reload and retry inbound request');
      const reservation = await lockReservationForInbound(item, session, now, true);
      const facility = await FacilityModel.findOne({
        _id: item.facilityId, status: FacilityStatus.ACTIVE,
        serviceTypes: FacilityServiceType.MANAGED_INVENTORY, ...live,
      }).session(session).exec();
      if (!facility || !reservation.facilityId.equals(item.facilityId)) throw new InventoryItemError(409, 'Active Managed Inventory Facility is required');
      return dto(pending);
    }));
  }

  static async confirmInbound(idInput: unknown, input: unknown, actor: Actor) {
    if (actor.role !== UserRole.FACILITY_STAFF) throw new InventoryItemError(403, 'Assigned Facility Staff role required');
    const itemId = parseId(idInput, 'item ID');
    const data: InboundConfirmationInput = parseInboundConfirmation(input);
    return execute(async () => withTransaction(async session => {
      const current = await InventoryItemModel.findOne({ _id: itemId, ...live }).session(session).exec();
      if (!current) throw new InventoryItemError(404, 'Inventory item not found');
      assertFacilityScope(actor, current.facilityId.toString());

      if (current.status === InventoryItemStatus.IN_STORAGE) {
        const prior = await ItemMovementModel.findOne({ itemId: current._id, idempotencyKey: data.idempotencyKey, type: ItemMovementType.INBOUND }).session(session).exec();
        if (prior && inboundReplayMatches(current, prior, data)) return { item: dto(current, true), movement: movementDto(prior), idempotentReplay: true };
        throw new InventoryItemError(409, 'Inventory item has already been confirmed inbound');
      }
      if (current.status !== InventoryItemStatus.PENDING_INBOUND || current.currentCellId !== null) throw new InventoryItemError(409, 'Only unplaced PENDING_INBOUND inventory can be confirmed');

      // Item write token serializes against customer metadata edits before any
      // other lock is acquired. Structural locks then follow Zone -> Reservation
      // -> Rack -> Cell, matching structural update lock order.
      const item = await InventoryItemModel.findOneAndUpdate({
        _id: current._id, status: InventoryItemStatus.PENDING_INBOUND, currentCellId: null, ...live,
      }, { $inc: { __v: 1 } }, { new: true, session }).exec();
      if (!item) throw new InventoryItemError(409, 'Inventory item changed; reload and retry');

      const cell = await WarehouseCellModel.findOne({ _id: data.cellId, ...live }).session(session).exec();
      if (!cell) throw new InventoryItemError(404, 'Destination Cell not found');
      if (!cell.facilityId.equals(item.facilityId)) throw new InventoryItemError(409, 'Destination Cell must belong to the item Facility');
      const reservationPreflight = await ReservationModel.findOne({ _id: item.managedReservationId, customerId: item.customerId,
        facilityId: item.facilityId, serviceType: FacilityServiceType.MANAGED_INVENTORY }).select('bookingFlowVersion').session(session).exec();
      if (!reservationPreflight) throw new InventoryItemError(409, 'Managed reservation is missing or outside item scope');
      if (reservationPreflight.bookingFlowVersion === 2) {
        const capacityLock = await ManagedFacilityCapacityModel.findOneAndUpdate({ facilityId: item.facilityId },
          { $inc: { bookingVersion: 1 } }, { new: true, session }).exec();
        if (!capacityLock) throw new InventoryItemError(409, 'Managed capacity configuration is missing');
      }
      await lockZoneForInbound(cell.zoneId, item.facilityId, session);
      const performedAt = new Date();
      const reservation = await lockReservationForInbound(item, session, performedAt);
      const firstV2Inbound = reservation.bookingFlowVersion === 2 && reservation.status === ReservationStatus.CHECKIN_READY;
      if (reservation.bookingFlowVersion === 2) {
        await assertV2FirstInboundPrerequisites(reservation, item, session, performedAt);
        const inspection = item.receivingInspection;
        if (!inspection || inspection.decision !== 'ACCEPTED' ||
            inspection.observedQuantity !== item.quantity ||
            !measurementMatches(inspection.observedUnitWeightKg, item.unitWeightKg, 3) ||
            !measurementMatches(inspection.observedUnitDimensionsM?.widthM, item.unitDimensionsM.widthM, 6) ||
            !measurementMatches(inspection.observedUnitDimensionsM?.depthM, item.unitDimensionsM.depthM, 6) ||
            !measurementMatches(inspection.observedUnitDimensionsM?.heightM, item.unitDimensionsM.heightM, 6) ||
            (item.quantity > 1 && !inspection.packingLayoutVerified)) {
          throw new InventoryItemError(409, 'A current ACCEPTED receiving inspection matching registered item data is required');
        }
        if (!reservation.allocatedCellIds?.some((allocatedId: Types.ObjectId) => allocatedId.equals(cell._id))) {
          throw new InventoryItemError(409, 'Destination Cell is not selected in this reservation');
        }
        if (!inspection.compatibleWithCellIds?.some((compatibleId: Types.ObjectId) => compatibleId.equals(cell._id))) {
          throw new InventoryItemError(409, 'Destination Cell was not approved by the receiving inspection');
        }
      }
      const allocation = await CellAllocationModel.findOne({ cellId: cell._id, reservationId: reservation._id,
        customerId: item.customerId, status: { $in: [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED] } }).session(session).exec();
      if (!allocation) throw new InventoryItemError(409, 'Inbound destination must be allocated to this Managed reservation');
      const facility = await FacilityModel.findOne({
        _id: item.facilityId, status: FacilityStatus.ACTIVE,
        serviceTypes: FacilityServiceType.MANAGED_INVENTORY, ...live,
      }).session(session).exec();
      if (!facility || !reservation.facilityId.equals(item.facilityId)) throw new InventoryItemError(409, 'Active Managed Inventory Facility is required');
      const rack = await lockRackForInbound(cell.rackId, item.facilityId, cell.zoneId, session);

      if (cell.operationalStatus !== WarehouseOperationalStatus.AVAILABLE || rack.operationalStatus !== WarehouseOperationalStatus.AVAILABLE) {
        throw new InventoryItemError(409, 'Destination Rack and Cell must be AVAILABLE');
      }
      if (cell.dimensions.usableHeightM === undefined) throw new InventoryItemError(409, 'Destination Cell usableHeightM must be measured before inbound');
      if (data.verifiedQuantity !== item.quantity ||
          !measurementMatches(item.unitWeightKg, data.actualUnitWeightKg, 3) ||
          !measurementMatches(item.unitDimensionsM.widthM, data.actualUnitDimensionsM.widthM, 6) ||
          !measurementMatches(item.unitDimensionsM.depthM, data.actualUnitDimensionsM.depthM, 6) ||
          !measurementMatches(item.unitDimensionsM.heightM, data.actualUnitDimensionsM.heightM, 6)) {
        throw new InventoryItemError(409, 'Verified quantity/measurements differ from registration; reject inbound so the owner can correct the item first');
      }
      if (reservation.bookingFlowVersion === 2 && (
          !measurementMatches(Number(item.receivingInspection?.observedUnitWeightKg), data.actualUnitWeightKg, 3) ||
          !measurementMatches(Number(item.receivingInspection?.observedUnitDimensionsM?.widthM), data.actualUnitDimensionsM.widthM, 6) ||
          !measurementMatches(Number(item.receivingInspection?.observedUnitDimensionsM?.depthM), data.actualUnitDimensionsM.depthM, 6) ||
          !measurementMatches(Number(item.receivingInspection?.observedUnitDimensionsM?.heightM), data.actualUnitDimensionsM.heightM, 6) ||
          item.receivingInspection?.observedQuantity !== data.verifiedQuantity)) {
        throw new InventoryItemError(409, 'Final physical measurements differ from the accepted receiving inspection');
      }
      if (item.quantity > 1 && !data.physicalPackingConfirmed) throw new InventoryItemError(409, 'Staff must physically confirm the complete multi-unit packing layout');
      const unit = data.actualUnitDimensionsM;
      const horizontalFit = (unit.widthM <= cell.dimensions.widthM && unit.depthM <= cell.dimensions.depthM) ||
        (unit.depthM <= cell.dimensions.widthM && unit.widthM <= cell.dimensions.depthM);
      if (!horizontalFit || unit.heightM > cell.dimensions.usableHeightM) throw new InventoryItemError(409, 'Verified handling unit does not fit destination Cell geometry');

      const totalWeightKg = rounded(data.actualUnitWeightKg * item.quantity, 3);
      const unitVolumeM3 = rounded(unit.widthM * unit.depthM * unit.heightM, 6);
      const totalVolumeM3 = rounded(unitVolumeM3 * item.quantity, 6);
      const cellVolumeM3 = rounded(cell.dimensions.widthM * cell.dimensions.depthM * cell.dimensions.usableHeightM, 6);
      const usedCellWeightKg = cell.usedWeightKg;
      const usedCellVolumeM3 = cell.usedVolumeM3;
      if (!Number.isFinite(usedCellWeightKg) || usedCellWeightKg < 0 || !Number.isFinite(usedCellVolumeM3) || usedCellVolumeM3 < 0) {
        throw new InventoryItemError(409, 'Destination Cell physical usage counters are unknown; verify this Cell before inbound');
      }
      if (usedCellWeightKg + totalWeightKg > cell.maxWeightKg || usedCellVolumeM3 + totalVolumeM3 > cellVolumeM3) {
        throw new InventoryItemError(409, 'Destination Cell kg or m3 capacity would be exceeded');
      }
      const rackCells = await WarehouseCellModel.find({ rackId: rack._id, ...live }).session(session).lean().exec();
      if (rackCells.some((rackCell: any) => !Number.isFinite(rackCell.usedWeightKg) || rackCell.usedWeightKg < 0 || !Number.isFinite(rackCell.usedVolumeM3) || rackCell.usedVolumeM3 < 0)) {
        throw new InventoryItemError(409, 'Rack physical usage is unknown; verify legacy Cell counters before inbound');
      }
      const levelUsedWeightKg = rackCells.filter((rackCell: any) => rackCell.levelNumber === cell.levelNumber).reduce((sum: number, rackCell: any) => sum + rackCell.usedWeightKg, 0);
      if (levelUsedWeightKg + totalWeightKg > rack.maxWeightKgPerLevel) {
        throw new InventoryItemError(409, 'Destination Rack level weight limit would be exceeded');
      }
      const rackUsedWeightKg = rackCells.reduce((sum: number, rackCell: any) => sum + rackCell.usedWeightKg, 0);
      if (rackUsedWeightKg + totalWeightKg > rack.levelCount * rack.maxWeightKgPerLevel) {
        throw new InventoryItemError(409, 'Destination Rack structural weight limit would be exceeded');
      }
      const usedQuotaM3 = rounded(Number(reservation.usedCapacityM3 ?? 0), 6);
      if (!Number.isFinite(Number(reservation.allocatedCapacity)) || usedQuotaM3 + totalVolumeM3 > Number(reservation.allocatedCapacity)) {
        throw new InventoryItemError(409, 'Managed rental used volume plus this lot would exceed its contracted quota');
      }

      // Enforce the approved Managed CATEGORY policy before any occupancy write.
      await assertCategoryPolicyDecision(item.facilityId, item.category, session, new Date());

      const updatedCell = await WarehouseCellModel.findOneAndUpdate({
        _id: cell._id, facilityId: item.facilityId, rackId: rack._id, zoneId: cell.zoneId,
        operationalStatus: WarehouseOperationalStatus.AVAILABLE, usedWeightKg: usedCellWeightKg, usedVolumeM3: usedCellVolumeM3, ...live,
        $expr: { $and: [
          { $lte: [{ $add: ['$usedWeightKg', totalWeightKg] }, '$maxWeightKg'] },
          { $lte: [{ $add: ['$usedVolumeM3', totalVolumeM3] }, cellVolumeM3] },
        ] },
      }, { $inc: { usedWeightKg: totalWeightKg, usedVolumeM3: totalVolumeM3 } }, { new: true, session, runValidators: true }).exec();
      if (!updatedCell) throw new InventoryItemError(409, 'Destination Cell capacity changed; reload and retry');

      reservation.usedCapacityM3 = rounded(usedQuotaM3 + totalVolumeM3, 6);
      if (firstV2Inbound) {
        reservation.status = ReservationStatus.ACTIVE;
        reservation.statusHistory.push({ status: ReservationStatus.ACTIVE, actorId: actor._id, reason: 'First Staff-confirmed Managed inbound completed check-in after signatures and full balance settlement', createdAt: performedAt } as any);
      }
      await reservation.save({ session });
      const movement = new ItemMovementModel({
        itemId: item._id, managedReservationId: reservation._id, facilityId: item.facilityId, customerId: item.customerId,
        type: ItemMovementType.INBOUND, destinationCellId: updatedCell._id,
        quantity: item.quantity, quantityUnit: item.quantityUnit,
        actualUnitWeightKg: rounded(data.actualUnitWeightKg, 3), actualTotalWeightKg: totalWeightKg,
        actualUnitDimensionsM: {
          widthM: rounded(unit.widthM, 6), depthM: rounded(unit.depthM, 6), heightM: rounded(unit.heightM, 6),
        }, actualTotalVolumeM3: totalVolumeM3,
        performedBy: actor._id, performedAt, inspectionNote: data.inspectionNote, idempotencyKey: data.idempotencyKey,
      });
      await movement.save({ session });
      allocation.status = CellAllocationStatus.OCCUPIED;
      await allocation.save({ session });
      item.status = InventoryItemStatus.IN_STORAGE;
      item.currentCellId = updatedCell._id;
      item.inboundConfirmedAt = performedAt;
      item.inboundConfirmedBy = actor._id;
      item.inboundMovementId = movement._id;
      item.inboundIdempotencyKey = data.idempotencyKey;
      await item.save({ session });
      if (firstV2Inbound) await ManagedReservationAuditModel.create([{ facilityId: reservation.facilityId, reservationId: reservation._id,
        actorId: actor._id, action: ManagedReservationAction.ACTIVATED, fromStatus: ReservationStatus.CHECKIN_READY,
        toStatus: ReservationStatus.ACTIVE, details: { firstInboundMovementId: movement._id, itemId: item._id, cellId: updatedCell._id } }], { session });
      if (reservation.bookingFlowVersion === 2) await ManagedReservationAuditModel.create([{ facilityId: reservation.facilityId, reservationId: reservation._id,
        actorId: actor._id, action: ManagedReservationAction.INBOUND_CONFIRMED, details: { movementId: movement._id, itemId: item._id, cellId: updatedCell._id, firstInbound: firstV2Inbound } }], { session });
      return { item: dto(item, true), movement: movementDto(movement), idempotentReplay: false };
    }));
  }

  static async rejectInbound(idInput: unknown, input: unknown, actor: Actor) {
    if (actor.role !== UserRole.FACILITY_STAFF) throw new InventoryItemError(403, 'Assigned Facility Staff role required');
    const itemId = parseId(idInput, 'item ID');
    const { reason } = parseInboundRejection(input);
    return execute(async () => withTransaction(async session => {
      const item = await InventoryItemModel.findOne({ _id: itemId, ...live }).session(session).exec();
      if (!item) throw new InventoryItemError(404, 'Inventory item not found');
      assertFacilityScope(actor, item.facilityId.toString());
      if (item.status !== InventoryItemStatus.PENDING_INBOUND || item.currentCellId !== null) throw new InventoryItemError(409, 'Only PENDING_INBOUND inventory can be rejected');
      const locked = await InventoryItemModel.findOneAndUpdate({
        _id: item._id, status: InventoryItemStatus.PENDING_INBOUND, currentCellId: null, ...live,
      }, { $inc: { __v: 1 } }, { new: true, session }).exec();
      if (!locked) throw new InventoryItemError(409, 'Inventory item changed; reload and retry');
      locked.status = InventoryItemStatus.REGISTERED;
      locked.inboundRejection = { reason, rejectedAt: new Date(), rejectedBy: actor._id } as any;
      await locked.save({ session });
      return dto(locked, true);
    }));
  }

  static async movements(idInput: unknown, actor: Actor) {
    const itemId = parseId(idInput, 'item ID');
    return execute(async () => {
      const item = await loadItem(itemId);
      await assertItemReadAccess(item, actor);
      const rows = await ItemMovementModel.find({ itemId: item._id }).sort({ performedAt: -1, _id: -1 }).lean().exec();
      return rows.map(row => movementDto(row, actor.role !== UserRole.CUSTOMER));
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
      const usedWeightKg = Number(cell.usedWeightKg ?? 0);
      const usedVolumeM3 = Number(cell.usedVolumeM3 ?? 0);
      const usedQuotaM3 = Number(reservation.usedCapacityM3 ?? 0);
      const [levelUsage, rackUsage] = await Promise.all([
        WarehouseCellModel.aggregate([
          { $match: { rackId: cell.rackId, levelNumber: cell.levelNumber, ...live } },
          { $group: { _id: null, usedWeightKg: { $sum: { $ifNull: ['$usedWeightKg', 0] } } } },
        ]).exec(),
        WarehouseCellModel.aggregate([
          { $match: { rackId: rack._id, ...live } },
          { $group: { _id: null, usedWeightKg: { $sum: { $ifNull: ['$usedWeightKg', 0] } } } },
        ]).exec(),
      ]);
      const levelUsedWeightKg = Number(levelUsage[0]?.usedWeightKg ?? 0);
      const rackUsedWeightKg = Number(rackUsage[0]?.usedWeightKg ?? 0);
      if (![usedWeightKg, usedVolumeM3, usedQuotaM3].every(value => Number.isFinite(value) && value >= 0) ||
          ![levelUsedWeightKg, rackUsedWeightKg].every(value => Number.isFinite(value) && value >= 0) ||
          !Number.isFinite(Number(reservation.allocatedCapacity)) || Number(reservation.allocatedCapacity) <= 0) {
        throw new InventoryItemError(409, 'Stored capacity usage counters are invalid; placement preview is unavailable');
      }
      const remainingWeightKg = rounded(Math.max(0, cell.maxWeightKg - usedWeightKg), 3);
      const remainingVolumeM3 = cellVolumeM3 === null ? null : rounded(Math.max(0, cellVolumeM3 - usedVolumeM3), 6);
      const remainingQuotaM3 = rounded(Math.max(0, Number(reservation.allocatedCapacity) - usedQuotaM3), 6);
      const remainingLevelWeightKg = rounded(Math.max(0, rack.maxWeightKgPerLevel - levelUsedWeightKg), 3);
      const ratedRackCapacityKg = rack.levelCount * rack.maxWeightKgPerLevel;
      const remainingRackWeightKg = rounded(Math.max(0, ratedRackCapacityKg - rackUsedWeightKg), 3);
      const lotVolumeWithinRemainingCellVolume = remainingVolumeM3 === null ? null : item.totalVolumeM3 <= remainingVolumeM3;
      const checks = {
        unitGeometryFits: heightFit === null ? null : horizontalFit && heightFit,
        unitHorizontalDimensionsFit: horizontalFit,
        unitHeightFitsKnownClearance: heightFit,
        totalLotWeightWithinCellCapacity: item.totalWeightKg <= remainingWeightKg,
        totalLotWeightWithinLevelRatedCapacity: item.totalWeightKg <= remainingLevelWeightKg,
        totalLotWeightWithinRackRatedCapacity: item.totalWeightKg <= remainingRackWeightKg,
        totalLotVolumeWithinKnownCellVolume: lotVolumeWithinRemainingCellVolume,
        totalLotVolumeWithinAllocatedRentalQuota: item.totalVolumeM3 <= remainingQuotaM3,
        // Aggregate volume does not prove that multiple physical units can be packed in this cell.
        multiUnitPackingLayoutValidated: item.quantity > 1 ? null : true,
      };
      const knownFailures = Object.values(checks).some(value => value === false);
      const hasUnknowns = Object.values(checks).some(value => value === null);
      const estimatedFit = knownFailures ? false : hasUnknowns ? null : true;
      const uncertainty: string[] = [];
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
        actualUsageKnown: true,
        itemEstimate: {
          quantity: item.quantity,
          unitWeightKg: item.unitWeightKg,
          totalWeightKg: item.totalWeightKg,
          unitVolumeM3: item.unitVolumeM3,
          totalVolumeM3: item.totalVolumeM3,
        },
        cellCapacity: {
          maxWeightKg: cell.maxWeightKg,
          usedWeightKg,
          remainingWeightKg,
          ...(cellVolumeM3 === null ? {} : { maxVolumeM3: cellVolumeM3, usedVolumeM3, remainingVolumeM3 }),
        },
        structuralCapacity: {
          levelRatedCapacityKg: rack.maxWeightKgPerLevel,
          levelUsedWeightKg,
          levelRemainingWeightKg: remainingLevelWeightKg,
          rackRatedCapacityKg: ratedRackCapacityKg,
          rackUsedWeightKg,
          rackRemainingWeightKg: remainingRackWeightKg,
        },
        rentalQuota: {
          allocatedCapacityM3: Number(reservation.allocatedCapacity),
          usedCapacityM3: usedQuotaM3,
          remainingCapacityM3: remainingQuotaM3,
          itemVolumeWithinQuota: checks.totalLotVolumeWithinAllocatedRentalQuota,
        },
        checks,
        uncertainty,
        notes: ['Advisory geometry/capacity preview only; no capacity is reserved and availability is not guaranteed.'],
        quantityPackingLayoutChecked: item.quantity <= 1,
      };
    });
  }
}
