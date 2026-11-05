import mongoose, { Types } from 'mongoose';
import ReservationModel from '../../models/reservations/reservation.model';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import InventoryStockBalanceModel from '../../models/inventory-items/inventory-stock-balance.model';
import InventoryInboundRequestModel, { inventoryInboundRequestUnresolvedStates } from '../../models/inventory-items/inventory-inbound-request.model';
import ManagedOutboundRequestModel from '../../models/inventory-items/managed-outbound-request.model';
import RepeatedInboundInspectionModel from '../../models/inventory-items/repeated-inbound-inspection.model';
import ReceivingInspectionEvidenceModel from '../../models/inventory-items/receiving-inspection-evidence.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import WarehouseZoneModel from '../../models/warehouse-map/warehouse-zone.model';
import ContractModel from '../../models/contracts/contract.model';
import ReservationPaymentModel from '../../models/payments/reservation-payment.model';
import { FacilityServiceType } from '../../types/facility.type';
import { ReservationStatus } from '../../types/reservation.type';
import { IUser, UserRole } from '../../types/user.type';
import { CellAllocationStatus } from '../../types/warehouse-map.type';
import { ContractStatus } from '../../types/contract.type';
import { PaymentPurpose, PaymentStatus } from '../../types/payment.type';
import { InventoryItemStatus, ReceivingCustodyStatus } from '../../types/inventory-item.type';
import { InventoryInboundCustodyState } from '../../types/inventory-inbound-request.type';
import { ManagedOutboundRequestState } from '../../types/managed-outbound-request.type';
import { reconcileManagedItemStock, reconcileManagedCounters } from '../inventory-items/managed-stock-ledger.service';
import { reconcileManagedOutboundHolds } from '../inventory-items/managed-outbound-allocation.service';

type Actor = Pick<IUser, '_id' | 'role' | 'assignedFacilityId'>;
type Readiness = 'READY' | 'BLOCKED' | 'UNKNOWN';
type Blocker = { code: string; scope: string; message: string };
type StockFact = { item: any; ledger: any | null; balance: any | null; held: number | null; available: number | null };
const MAX_SCAN_ITEMS = 2000;
const LIVE = { deletedAt: { $exists: false } };
const identity = (value: any): string | null => value == null ? null : String(value._id ?? value);
const closeEnough = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

export class ManagedClosureReadinessError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'ManagedClosureReadinessError'; }
}
const fail = (status: number, message: string): never => { throw new ManagedClosureReadinessError(status, message); };
function parseId(value: unknown): Types.ObjectId {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, 'Invalid reservationId');
  return new Types.ObjectId(value as string);
}
function authorize(reservation: any, actor: Actor) {
  if (actor.role === UserRole.CUSTOMER) {
    if (!reservation.customerId.equals(actor._id)) fail(404, 'Managed reservation not found');
    return;
  }
  // Match GET /reservations/managed/:id: Facility Manager, Admin and BOM management access.
  if (![UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM].includes(actor.role)) fail(403, 'Forbidden');
  if (actor.role === UserRole.FACILITY_MANAGER &&
      (!actor.assignedFacilityId || !actor.assignedFacilityId.equals(reservation.facilityId))) fail(403, 'Facility is outside assigned scope');
}
function push(blockers: Blocker[], code: string, scope: string, message: string) {
  if (!blockers.some(row => row.code === code && row.scope === scope)) blockers.push({ code, scope, message });
}
function group<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) { const id = key(row); const bucket = result.get(id) ?? []; bucket.push(row); result.set(id, bucket); }
  return result;
}
async function rows<T>(query: any, session: mongoose.ClientSession, limit?: number): Promise<T[]> {
  let q = query.session(session).lean();
  if (limit !== undefined) q = q.limit(limit);
  return q.exec();
}
function balancesMatch(balance: any, ledger: any): boolean {
  if (balance.schemaVersion !== 1 || identity(balance.itemId) !== ledger.itemId ||
      identity(balance.currentCellId) !== ledger.currentCellId || balance.onHandQuantity !== ledger.onHandQuantity ||
      balance.actualTotalWeightKg !== ledger.actualTotalWeightKg || balance.actualTotalVolumeM3 !== ledger.actualTotalVolumeM3 ||
      !Array.isArray(balance.batches) || balance.batches.length !== ledger.batches.length) return false;
  const indexed = new Map(balance.batches.map((batch: any) => [batch.batchId, batch]));
  return ledger.batches.every((batch: any) => {
    const actual: any = indexed.get(batch.batchId);
    return actual && identity(actual.receiptMovementId) === identity(batch.receiptMovementId) &&
      identity(actual.receiptRequestId) === identity(batch.receiptRequestId) &&
      identity(actual.receivingInspectionEvidenceId) === identity(batch.receivingInspectionEvidenceId) &&
      actual.quantity === batch.quantity && actual.quantityUnit === batch.quantityUnit &&
      actual.actualTotalWeightKg === batch.actualTotalWeightKg && actual.actualTotalVolumeM3 === batch.actualTotalVolumeM3 &&
      Number.isSafeInteger(actual.heldQuantity) && actual.heldQuantity >= 0 && actual.heldQuantity <= actual.quantity;
  });
}

/** Snapshot-only diagnostic. No business model write methods are called from this service. */
export class ManagedClosureReadinessService {
  static async get(reservationIdInput: unknown, actor: Actor) {
    const reservationId = parseId(reservationIdInput);
    const session = await mongoose.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        const reservation: any = await ReservationModel.findOne({
          _id: reservationId, serviceType: FacilityServiceType.MANAGED_INVENTORY,
        }).session(session).lean().exec();
        if (!reservation) fail(404, 'Managed reservation not found');
        authorize(reservation, actor);
        response = await this.evaluate(reservation, session);
      }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
      return response;
    } finally { await session.endSession(); }
  }

  private static async evaluate(reservation: any, session: mongoose.ClientSession) {
    const blockers: Blocker[] = [];
    const reservationItems = await rows<any>(InventoryItemModel.find({ managedReservationId: reservation._id, ...LIVE }).sort({ _id: 1 }), session, MAX_SCAN_ITEMS + 1);
    if (reservationItems.length > MAX_SCAN_ITEMS) {
      push(blockers, 'SCAN_LIMIT_EXCEEDED', 'reservation', 'The complete Item set exceeds the safe scan limit; readiness is UNKNOWN.');
      return this.buildDto(reservation, blockers, {
        itemCount: null, currentQuantity: null, heldQuantity: null, availableQuantity: null, currentWeightKg: null, currentVolumeM3: null,
        items: [], requests: { inbound: null, outbound: null }, allocations: [], cells: [], contract: { status: 'UNKNOWN' }, payments: { status: 'UNKNOWN' },
      }, new Date());
    }
    const itemIds = reservationItems.map(row => row._id);
    const allocations = await rows<any>(CellAllocationModel.find({ reservationId: reservation._id }).sort({ cellId: 1 }), session);
    const inboundRequests = itemIds.length ? await rows<any>(InventoryInboundRequestModel.find({ reservationId: reservation._id, itemId: { $in: itemIds } }), session) : [];
    const outboundRequests = itemIds.length ? await rows<any>(ManagedOutboundRequestModel.find({ reservationId: reservation._id, itemId: { $in: itemIds } }), session) : [];
    const allocatedIds = new Set<string>((reservation.allocatedCellIds ?? []).map(identity).filter(Boolean) as string[]);
    const cellIdSet = new Set<string>([
      ...allocatedIds,
      ...allocations.map(row => identity(row.cellId)).filter(Boolean) as string[],
      ...reservationItems.map(row => identity(row.currentCellId)).filter(Boolean) as string[],
    ]);
    const cellIds = [...cellIdSet].map(value => new Types.ObjectId(value));
    const cells = cellIds.length ? await rows<any>(WarehouseCellModel.find({ _id: { $in: cellIds }, facilityId: reservation.facilityId }), session) : [];
    // Query by Cell across facility boundaries so a corrupt foreign-Facility placement
    // cannot disappear from the physical counter reconciliation.
    const facilityItems = cellIds.length ? await rows<any>(InventoryItemModel.find({ currentCellId: { $in: cellIds }, ...LIVE }).sort({ _id: 1 }), session, MAX_SCAN_ITEMS + 1) : [];
    const facilityScopeComplete = facilityItems.length <= MAX_SCAN_ITEMS;
    if (!facilityScopeComplete) push(blockers, 'PHYSICAL_COUNTER_UNKNOWN', 'facility', 'Shared Cell usage exceeds the safe scan limit; physical counters are UNKNOWN.');
    const allItemsMap = new Map<string, any>();
    [...reservationItems, ...facilityItems.slice(0, MAX_SCAN_ITEMS)].forEach(item => allItemsMap.set(identity(item._id)!, item));
    const allItems = [...allItemsMap.values()];
    const allIds = allItems.map(item => item._id);
    const movements = allIds.length ? await rows<any>(ItemMovementModel.find({ itemId: { $in: allIds } }).sort({ performedAt: 1, _id: 1 }), session) : [];
    const balances = allIds.length ? await rows<any>(InventoryStockBalanceModel.find({ itemId: { $in: allIds } }), session) : [];
    const allOutbound = allIds.length ? await rows<any>(ManagedOutboundRequestModel.find({ itemId: { $in: allIds } }), session) : [];
    const movementByItem = group(movements, row => identity(row.itemId)!);
    const balanceByItem = group(balances, row => identity(row.itemId)!);
    const outboundByItem = group(allOutbound, row => identity(row.itemId)!);
    const facts = new Map<string, StockFact>();
    const reservationItemIdSet = new Set(reservationItems.map(row => identity(row._id)));
    for (const item of allItems) {
      const key = identity(item._id)!;
      const diagnosticScope = reservationItemIdSet.has(key) ? `item:${key}` : `cell:${identity(item.currentCellId)}`;
      if (!reservationItemIdSet.has(key) && identity(item.facilityId) !== identity(reservation.facilityId)) {
        push(blockers, 'PHYSICAL_COUNTER_UNKNOWN', diagnosticScope, 'A Cell references an Item assigned to a different Facility; physical usage requires manual review.');
      }
      const itemMovements = movementByItem.get(key) ?? [];
      const balance = (balanceByItem.get(key) ?? [])[0] ?? null;
      const requests = outboundByItem.get(key) ?? [];
      try {
        const ledger = reconcileManagedItemStock(item, itemMovements);
        if (balance && !balancesMatch(balance, ledger)) {
          push(blockers, 'STOCK_BALANCE_MISMATCH', diagnosticScope, 'Persisted StockBalance differs from movement-derived quantity, placement or batch provenance.');
        }
        if (!balance && itemMovements.some(row => row.schemaVersion === 2)) {
          push(blockers, 'STOCK_LEDGER_UNKNOWN', diagnosticScope, 'Canonical movement history has no matching StockBalance projection.');
        }
        let held: number | null = 0;
        let available: number | null = ledger.onHandQuantity;
        if (balance) {
          const holdResult = reconcileManagedOutboundHolds({ item, movements: itemMovements, stockBalance: balance, requests });
          held = holdResult.heldQuantity;
          available = holdResult.availableQuantity;
        } else if (requests.some(row => row.state === ManagedOutboundRequestState.PENDING)) {
          held = null; available = null;
          push(blockers, 'HOLD_OUTSTANDING', diagnosticScope, 'A pending outbound hold cannot be reconciled without its StockBalance.');
        } else if (ledger.source === 'LEGACY_RECONCILED' && ledger.onHandQuantity > 0) {
          // Legacy v1 has no canonical hold projection. Report the limitation instead of inferring a hold count.
          held = null; available = null;
          push(blockers, 'STOCK_LEDGER_UNKNOWN', diagnosticScope, 'Legacy stock is ledger-reconciled, but held quantity cannot be proven from a persisted projection.');
        }
        facts.set(key, { item, ledger, balance, held, available });
      } catch (error) {
        // Reconciliation helper codes are implementation details; the public DTO uses
        // the stable closure-readiness vocabulary and does not leak raw ledger diagnostics.
        const isPlacementFailure = (error as any)?.code === 'PLACEMENT_LINEAGE_INVALID';
        push(blockers, isPlacementFailure ? 'PLACEMENT_INCONSISTENT' : 'STOCK_LEDGER_UNKNOWN', diagnosticScope,
          isPlacementFailure ? 'Movement history does not establish a consistent current placement.' : 'Movement lineage, balance or held quantity could not be reconciled.');
        facts.set(key, { item, ledger: null, balance, held: null, available: null });
      }
    }

    const unresolvedInbound = inboundRequests.filter(row => (inventoryInboundRequestUnresolvedStates as string[]).includes(row.state));
    const unresolvedOutbound = outboundRequests.filter(row => row.state === ManagedOutboundRequestState.PENDING);
    for (const row of unresolvedInbound) push(blockers, 'INBOUND_REQUEST_PENDING', `request:${identity(row._id)}`, 'Repeated inbound request is unresolved.');
    for (const row of unresolvedOutbound) push(blockers, 'OUTBOUND_REQUEST_PENDING', `request:${identity(row._id)}`, 'Canonical outbound request has an outstanding hold.');
    for (const row of inboundRequests) if (row.custodyState === InventoryInboundCustodyState.IN_CUSTODY) {
      push(blockers, 'CUSTODY_UNRESOLVED', `request:${identity(row._id)}`, 'Facility custody has not been returned or committed to storage.');
    }
    for (const item of reservationItems) {
      const pendingLegacyInspection = [InventoryItemStatus.PENDING_INBOUND, InventoryItemStatus.RECEIVED_PENDING_ACCEPTANCE].includes(item.status);
      const inCustody = item.receivingCustodyStatus === ReceivingCustodyStatus.IN_CUSTODY;
      if (pendingLegacyInspection || inCustody) push(blockers, 'CUSTODY_UNRESOLVED', `item:${identity(item._id)}`, 'Legacy receiving inspection or custody is unresolved.');
    }
    // Inspection/evidence records are read to detect dangling attempts; they are never changed or returned as another customer's data.
    const inspectionRows = itemIds.length ? await rows<any>(RepeatedInboundInspectionModel.find({ reservationId: reservation._id, itemId: { $in: itemIds } }), session) : [];
    const legacyEvidenceRows = itemIds.length ? await rows<any>(ReceivingInspectionEvidenceModel.find({ reservationId: reservation._id, itemId: { $in: itemIds } }), session) : [];
    const currentRequestIds = new Set(unresolvedInbound.map(row => identity(row._id)));
    if (inspectionRows.some(row => currentRequestIds.has(identity(row.requestId)))) push(blockers, 'CUSTODY_UNRESOLVED', 'reservation', 'An inspection attempt remains attached to an unresolved receipt request.');
    if (legacyEvidenceRows.some(row => reservationItems.some(item => identity(item._id) === identity(row.itemId) &&
      [InventoryItemStatus.PENDING_INBOUND, InventoryItemStatus.RECEIVED_PENDING_ACCEPTANCE].includes(item.status)))) {
      push(blockers, 'CUSTODY_UNRESOLVED', 'reservation', 'Legacy receiving evidence is associated with an unresolved Item inspection.');
    }

    const activeAllocations = allocations.filter(row => row.status !== CellAllocationStatus.RELEASED);
    const allocationCellIds = new Set(activeAllocations.map(row => identity(row.cellId)));
    if (allocationCellIds.size !== allocatedIds.size || [...allocatedIds].some(id => !allocationCellIds.has(id))) {
      push(blockers, 'ALLOCATION_INCONSISTENT', 'reservation', 'allocatedCellIds do not match unreleased CellAllocation records.');
    }
    const allocationDtos = allocations.map(row => {
      const ownerMatches = identity(row.reservationId) === identity(reservation._id) && identity(row.customerId) === identity(reservation.customerId) && identity(row.facilityId) === identity(reservation.facilityId);
      const datesMatch = new Date(row.startDate).getTime() === new Date(reservation.startDate).getTime() && new Date(row.endDate).getTime() === new Date(reservation.endDate).getTime();
      const allowedStatus = [CellAllocationStatus.RESERVED, CellAllocationStatus.OCCUPIED, CellAllocationStatus.RELEASED].includes(row.status);
      if (!ownerMatches || !datesMatch || !allowedStatus || (row.status !== CellAllocationStatus.RELEASED && !allocatedIds.has(identity(row.cellId)!))) {
        push(blockers, 'ALLOCATION_INCONSISTENT', `allocation:${identity(row._id)}`, 'CellAllocation owner, effective dates, status or Reservation membership is inconsistent.');
      }
      return { cellId: ownerMatches ? identity(row.cellId) : null, status: row.status, startDate: row.startDate, endDate: row.endDate,
        ownerMatches, datesMatch, expired: new Date(row.endDate).getTime() <= Date.now() };
    });
    for (const id of allocatedIds) if (!allocationCellIds.has(id)) push(blockers, 'ALLOCATION_INCONSISTENT', `cell:${id}`, 'Allocated Cell has no active Reservation allocation record.');

    const cellById = new Map(cells.map(row => [identity(row._id)!, row]));
    const cellChecks: any[] = [];
    const cellWeight = new Map<string, number>(), cellVolume = new Map<string, number>(), cellKnown = new Map<string, boolean>();
    for (const cellId of cellIdSet) {
      const cell = cellById.get(cellId);
      if (!cell) { push(blockers, 'ALLOCATION_INCONSISTENT', `cell:${cellId}`, 'Allocated/current Cell is missing or outside the Reservation Facility.'); cellKnown.set(cellId, false); continue; }
      let weight = 0, volume = 0, known = facilityScopeComplete;
      for (const item of facilityItems.filter(row => identity(row.currentCellId) === cellId)) {
        const fact = facts.get(identity(item._id)!);
        if (!fact?.ledger) { known = false; continue; }
        weight += fact.ledger.actualTotalWeightKg;
        volume += fact.ledger.actualTotalVolumeM3;
      }
      if (!known || typeof cell.usedWeightKg !== 'number' || typeof cell.usedVolumeM3 !== 'number' ||
          !closeEnough(cell.usedWeightKg, weight, 0.001) || !closeEnough(cell.usedVolumeM3, volume, 0.000001)) {
        known = false;
        push(blockers, 'PHYSICAL_COUNTER_UNKNOWN', `cell:${cellId}`, 'Cell counters cannot be reconciled against all Items currently placed in the Cell.');
      }
      const capacityVolume = Number(cell.dimensions?.widthM) * Number(cell.dimensions?.depthM) * Number(cell.dimensions?.usableHeightM);
      if (!Number.isFinite(capacityVolume) || capacityVolume <= 0 || typeof cell.maxWeightKg !== 'number' || weight > cell.maxWeightKg + 0.001 || volume > capacityVolume + 0.000001) {
        known = false;
        push(blockers, 'PHYSICAL_COUNTER_UNKNOWN', `cell:${cellId}`, 'Cell dimensions or physical limits are missing, invalid, or exceeded.');
      }
      cellKnown.set(cellId, known); cellWeight.set(cellId, weight); cellVolume.set(cellId, volume);
      cellChecks.push({ cellId, usageKnown: known, usedWeightKg: known ? weight : null, usedVolumeM3: known ? volume : null,
        storedUsedWeightKg: cell.usedWeightKg, storedUsedVolumeM3: cell.usedVolumeM3, operationalStatus: cell.operationalStatus });
    }
    const reservationFacts = reservationItems.map(item => facts.get(identity(item._id)!)).filter(Boolean) as StockFact[];
    const stockKnown = reservationFacts.every(row => row.ledger !== null);
    const currentQuantity = stockKnown ? reservationFacts.reduce((sum, row) => sum + row.ledger!.onHandQuantity, 0) : null;
    const currentWeight = stockKnown ? reservationFacts.reduce((sum, row) => sum + row.ledger!.actualTotalWeightKg, 0) : null;
    const currentVolume = stockKnown ? reservationFacts.reduce((sum, row) => sum + row.ledger!.actualTotalVolumeM3, 0) : null;
    const heldKnown = reservationFacts.every(row => row.held !== null);
    const heldQuantity = heldKnown ? reservationFacts.reduce((sum, row) => sum + row.held!, 0) : null;
    const availableQuantity = heldKnown && currentQuantity !== null ? currentQuantity - heldQuantity! : null;
    if (heldQuantity !== null && currentQuantity !== null && heldQuantity > currentQuantity) push(blockers, 'HOLD_OUTSTANDING', 'reservation', 'Persisted outbound holds exceed reconciled on-hand stock.');
    if (typeof reservation.usedCapacityM3 !== 'number' || !Number.isFinite(reservation.usedCapacityM3) || currentVolume === null ||
        !closeEnough(reservation.usedCapacityM3, currentVolume, 0.000001)) {
      push(blockers, 'PHYSICAL_COUNTER_UNKNOWN', 'reservation', 'Reservation usedCapacityM3 differs from movement-derived physical volume or cannot be verified.');
    }
    // The helper checks the same read-only invariant used by MI stock writers. It has no write side effects.
    if (currentVolume !== null && cellIds.length) {
      for (const id of cellIds) {
        const cell = cellById.get(identity(id)!);
        if (!cell || !cellKnown.get(identity(id)!)) continue;
        try { reconcileManagedCounters({ usedWeightKg: cellWeight.get(identity(id)!)!, usedVolumeM3: cellVolume.get(identity(id)!)! }, cell, reservation, currentVolume); }
        catch { push(blockers, 'PHYSICAL_COUNTER_UNKNOWN', `cell:${identity(id)}`, 'Stored physical counters do not match reconciled movement history.'); }
      }
    }
    const rackIds = [...new Set(cells.map(row => identity(row.rackId)).filter(Boolean) as string[])].map(id => new Types.ObjectId(id));
    const racks = rackIds.length ? await rows<any>(WarehouseRackModel.find({ _id: { $in: rackIds }, facilityId: reservation.facilityId }), session) : [];
    const zones = racks.length ? await rows<any>(WarehouseZoneModel.find({ _id: { $in: racks.map(row => row.zoneId) }, facilityId: reservation.facilityId }), session) : [];
    // Rack level capacity is shared by every Cell on that level. If the assessment
    // did not scan the whole Rack, its weight total cannot be represented as verified.
    const rackScopeCells = rackIds.length ? await rows<any>(WarehouseCellModel.find({ rackId: { $in: rackIds }, facilityId: reservation.facilityId }), session, MAX_SCAN_ITEMS + 1) : [];
    const rackScopeComplete = rackScopeCells.length <= MAX_SCAN_ITEMS;
    for (const cell of cells) {
      const rack = racks.find(row => identity(row._id) === identity(cell.rackId));
      if (!rack || identity(rack.zoneId) !== identity(cell.zoneId) || !zones.some(row => identity(row._id) === identity(rack.zoneId))) {
        push(blockers, 'ALLOCATION_INCONSISTENT', `cell:${identity(cell._id)}`, 'Cell Rack/Zone/Facility hierarchy cannot be verified.');
      }
    }
    for (const rack of racks) {
      const rackCells = rackScopeCells.filter(row => identity(row.rackId) === identity(rack._id));
      const assessedRackCells = cells.filter(row => identity(row.rackId) === identity(rack._id));
      if (!rackScopeComplete || rackCells.length !== assessedRackCells.length || rackCells.some(row => !cellIdSet.has(identity(row._id)!))) {
        push(blockers, 'PHYSICAL_COUNTER_UNKNOWN', `rack:${identity(rack._id)}`, 'Rack level weight capacity is UNKNOWN because not every Cell in the Rack was included in this bounded assessment.');
        continue;
      }
      if (!Number.isFinite(rack.maxWeightKgPerLevel)) { push(blockers, 'PHYSICAL_COUNTER_UNKNOWN', `rack:${identity(rack._id)}`, 'Rack level weight capacity is not configured.'); continue; }
      const levelTotals = new Map<number, number>();
      for (const cell of rackCells) {
        levelTotals.set(cell.levelNumber, (levelTotals.get(cell.levelNumber) ?? 0) + (cellWeight.get(identity(cell._id)!) ?? 0));
      }
      if ([...levelTotals.values()].some(value => value > rack.maxWeightKgPerLevel + 0.001)) push(blockers, 'PHYSICAL_COUNTER_UNKNOWN', `rack:${identity(rack._id)}`, 'Rack level weight capacity is exceeded.');
    }

    const contract = await ContractModel.findOne({ reservationId: reservation._id }).session(session).lean().exec();
    const payments = await rows<any>(ReservationPaymentModel.find({ reservationId: reservation._id }).sort({ createdAt: 1 }), session);
    const signed = Boolean(contract && contract.status === ContractStatus.SIGNED && contract.signedByCustomerAt && contract.signedByFMAt);
    const pendingPayment = payments.some(row => row.status === PaymentStatus.PENDING || row.status === PaymentStatus.RECONCILIATION_REQUIRED);
    const failedPayment = payments.some(row => row.status === PaymentStatus.FAILED);
    if (!signed) push(blockers, 'FINANCIAL_POLICY_UNRESOLVED', 'contract', 'Current fully signed contract status is not verified from persisted contract data.');
    if (pendingPayment || failedPayment) push(blockers, 'FINANCIAL_POLICY_UNRESOLVED', 'payments', 'Payment records include pending, failed or reconciliation-required entries.');
    push(blockers, 'FINANCIAL_POLICY_UNRESOLVED', 'reservation', 'Additional charges, waivers, refunds and final settlement rules are not represented by current verified data.');
    push(blockers, 'DISPOSITION_POLICY_UNRESOLVED', 'reservation', 'End-of-term goods disposition and final handover policies are not implemented.');

    if (![ReservationStatus.ACTIVE, ReservationStatus.OVERDUE].includes(reservation.status)) push(blockers, 'DISPOSITION_POLICY_UNRESOLVED', 'reservationStatus', 'Readiness assessment supports ACTIVE or OVERDUE Managed reservations only.');
    if (reservation.status === ReservationStatus.ACTIVE && new Date(reservation.endDate).getTime() > Date.now()) push(blockers, 'DISPOSITION_POLICY_UNRESOLVED', 'rentalTerm', 'Rental term has not ended; zero stock does not release an active rental allocation.');
    const definitePhysicalBlock = currentQuantity !== null && currentQuantity > 0 || heldQuantity !== null && heldQuantity > 0;
    if (currentQuantity !== null && currentQuantity > 0) push(blockers, 'STOCK_REMAINING', 'reservation', 'Movement history shows physical stock remains in this Reservation.');
    if (heldQuantity !== null && heldQuantity > 0) push(blockers, 'HOLD_OUTSTANDING', 'reservation', 'One or more units remain held by an outbound request.');
    const unknownCodes = new Set(['STOCK_LEDGER_UNKNOWN', 'STOCK_BALANCE_MISMATCH', 'ALLOCATION_INCONSISTENT', 'PHYSICAL_COUNTER_UNKNOWN', 'SCAN_LIMIT_EXCEEDED']);
    const physicalUnknown = blockers.some(row => unknownCodes.has(row.code));
    const operationalBlocked = unresolvedInbound.length > 0 || unresolvedOutbound.length > 0 || blockers.some(row => row.code === 'CUSTODY_UNRESOLVED');
    const physicalReadiness: Readiness = physicalUnknown || currentQuantity === null || heldQuantity === null ? 'UNKNOWN' : definitePhysicalBlock ? 'BLOCKED' : 'READY';
    const operationalReadiness: Readiness = physicalUnknown ? 'UNKNOWN' : operationalBlocked ? 'BLOCKED' : 'READY';
    const allocationReadiness: Readiness = physicalUnknown || blockers.some(row => row.code === 'ALLOCATION_INCONSISTENT') ? 'UNKNOWN' : 'READY';
    const financialReadiness: Readiness = 'UNKNOWN';
    const dispositionReadiness: Readiness = 'UNKNOWN';
    const overallReadiness: Readiness = definitePhysicalBlock || operationalBlocked ? 'BLOCKED' : 'UNKNOWN';
    return {
      reservationId: identity(reservation._id), serviceType: reservation.serviceType, reservationStatus: reservation.status,
      startDate: reservation.startDate, endDate: reservation.endDate, evaluatedAt: new Date(), snapshotConsistency: 'MONGODB_SNAPSHOT',
      physicalReadiness, operationalReadiness, allocationReadiness, financialReadiness, dispositionReadiness, overallReadiness,
      stockSummary: { itemCount: reservationItems.length, currentQuantity, heldQuantity, availableQuantity, currentWeightKg: currentWeight,
        currentVolumeM3: currentVolume, allocatedCapacityM3: reservation.allocatedCapacity ?? null, usedCapacityM3: reservation.usedCapacityM3 ?? null,
        items: reservationItems.map(item => {
          const fact = facts.get(identity(item._id)!);
          return { itemId: identity(item._id), itemCode: item.itemCode, status: item.status,
            currentQuantity: fact?.ledger?.onHandQuantity ?? null, heldQuantity: fact?.held ?? null, availableQuantity: fact?.available ?? null,
            currentCellId: fact?.ledger?.currentCellId ?? null, stockSource: fact?.ledger?.source ?? 'UNKNOWN' };
        }) },
      outstandingRequestSummary: { inbound: { unresolvedCount: unresolvedInbound.length }, outbound: { unresolvedCount: unresolvedOutbound.length },
        custodyOrInspectionUnresolved: blockers.filter(row => row.code === 'CUSTODY_UNRESOLVED').length },
      allocationSummary: { allocatedCellIds: [...allocatedIds], allocations: allocationDtos, cells: cellChecks },
      financialSummary: { contractStatus: contract?.status ?? 'MISSING', fullySigned: signed,
        payments: payments.map(row => ({ purpose: row.purpose, status: row.status, amount: row.amount, currency: row.currency })),
        additionalSettlementPolicy: 'UNKNOWN' },
      blockers, readonly: true,
      note: 'Diagnostic only. This endpoint does not close the Reservation or release any Cell allocation or Facility quota.',
    };
  }

  private static buildDto(reservation: any, blockers: Blocker[], stockSummary: any, evaluatedAt: Date) {
    return { reservationId: identity(reservation._id), serviceType: reservation.serviceType, reservationStatus: reservation.status,
      startDate: reservation.startDate, endDate: reservation.endDate, evaluatedAt, snapshotConsistency: 'MONGODB_SNAPSHOT',
      physicalReadiness: 'UNKNOWN' as Readiness, operationalReadiness: 'UNKNOWN' as Readiness, allocationReadiness: 'UNKNOWN' as Readiness,
      financialReadiness: 'UNKNOWN' as Readiness, dispositionReadiness: 'UNKNOWN' as Readiness, overallReadiness: 'UNKNOWN' as Readiness,
      stockSummary, outstandingRequestSummary: { inbound: { unresolvedCount: null }, outbound: { unresolvedCount: null }, custodyOrInspectionUnresolved: null },
      allocationSummary: { allocatedCellIds: [], allocations: [], cells: [] }, financialSummary: { contractStatus: 'UNKNOWN', additionalSettlementPolicy: 'UNKNOWN' },
      blockers, readonly: true, note: 'Diagnostic only. This endpoint does not close the Reservation or release any Cell allocation or Facility quota.' };
  }
}
