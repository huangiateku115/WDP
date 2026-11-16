import { Types } from 'mongoose';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ItemSpecificationModel from '../../models/inventory-items/item-specification.model';
import ManagedCellStockModel from '../../models/inventory-items/managed-cell-stock.model';
import ManagedItemInstanceModel from '../../models/inventory-items/managed-item-instance.model';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import WarehouseRackModel from '../../models/warehouse-map/warehouse-rack.model';
import CellAllocationModel from '../../models/warehouse-map/cell-allocation.model';
import ReservationModel from '../../models/reservations/reservation.model';
import { UserRole } from '../../types/user.type';
import { aggregateCellStock, calculateCapacity, placementsHaveCellAllocations, reconcileCell, replayManagedStockMovements, replayManagedStockMovementsBySku } from './managed-cell-stock.domain';

export class ManagedCellStockReadError extends Error {
  constructor(public status: number, message: string, public code: string) { super(message); }
}
const fail = (status: number, message: string, code: string): never => { throw new ManagedCellStockReadError(status, message, code); };
const oid = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) fail(400, `${label} is invalid`, 'INVALID_ID');
  return new Types.ObjectId(value as string);
};
const idText = (value: any) => String(value?._id ?? value ?? '');
function sameProjection(replayed: any[], projected: any[], key: (row: any) => string, fields: string[]) {
  if (replayed.length !== projected.length) return false;
  const current = new Map(projected.map(row => [key(row), row]));
  return replayed.every(row => { const projection = current.get(key(row)); return projection && fields.every(field => {
    const left = field.split('.').reduce((value, part) => value?.[part], row), right = field.split('.').reduce((value, part) => value?.[part], projection);
    return typeof left === 'number' && typeof right === 'number' ? left === right : idText(left) === idText(right);
  }); });
}
function sameInstanceProjection(replayed: any[], projected: any[]) {
  if (replayed.length !== projected.length) return false;
  const current = new Map(projected.map(row => [String(row.itemInstanceId), row]));
  return replayed.every(row => {
    const projection: any = current.get(String(row.itemInstanceId));
    if (!projection || projection.status !== row.status || idText(projection.skuId) !== idText(row.skuId) || idText(projection.itemSpecId) !== idText(row.itemSpecId) ||
      idText(projection.reservationId) !== idText(row.reservationId) || idText(projection.facilityId) !== idText(row.facilityId) || idText(projection.customerId) !== idText(row.customerId) ||
      projection.sourceReceiptId !== row.sourceReceiptId || projection.quantity !== 1 || projection.unitWeightKgSnapshot !== row.unitWeightKgSnapshot || projection.unitVolumeM3Snapshot !== row.unitVolumeM3Snapshot ||
      projection.allocations?.length !== row.allocations?.length) return false;
    const expected = [...row.allocations].sort((a: any, b: any) => idText(a.cellId).localeCompare(idText(b.cellId))), actual = [...projection.allocations].sort((a: any, b: any) => idText(a.cellId).localeCompare(idText(b.cellId)));
    return expected.every((line: any, index: number) => idText(line.cellId) === idText(actual[index]?.cellId) && line.weightKg === actual[index]?.weightKg && line.volumeM3 === actual[index]?.volumeM3);
  });
}
function assertSkuAccess(sku: any, actor: any) {
  if (!actor?._id) fail(401, 'Authentication required', 'AUTH_REQUIRED');
  if (sku.inventorySchemaVersion !== 3) fail(409, 'Stock reads are available only for V3 SKU records', 'UNSUPPORTED_INVENTORY_VERSION');
  if (actor.role === UserRole.CUSTOMER && String(sku.customerId) !== String(actor._id)) fail(404, 'SKU not found', 'SKU_NOT_FOUND');
  if ([UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(actor.role) && String(sku.facilityId) !== String(actor.assignedFacilityId ?? '')) fail(404, 'SKU not found', 'SKU_NOT_FOUND');
  if (![UserRole.CUSTOMER, UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF, UserRole.ADMIN, UserRole.BOM].includes(actor.role)) fail(403, 'Forbidden', 'FORBIDDEN');
}
function physicalSummary(rows: any[], instances: any[]) {
  const byCell = aggregateCellStock(rows, instances);
  const specs = new Map<string, any>();
  for (const stock of rows) {
    const key = idText(stock.itemSpecId), summary = specs.get(key) ?? { itemSpecId: stock.itemSpecId, quantityOnHand: 0, quantityHeld: 0, quantityAvailable: 0, totalWeightKg: 0, totalVolumeM3: 0, byCell: new Map(), byReceipt: [] };
    summary.quantityOnHand += stock.quantityOnHand; summary.quantityHeld += stock.quantityHeld; summary.quantityAvailable += stock.quantityAvailable;
    summary.totalWeightKg += stock.totalWeightKg; summary.totalVolumeM3 += stock.totalVolumeM3; summary.byReceipt.push({ receiptId: stock.receiptId, cellId: stock.cellId, quantityOnHand: stock.quantityOnHand, quantityHeld: stock.quantityHeld, unitWeightKgSnapshot: stock.unitWeightKgSnapshot, unitVolumeM3Snapshot: stock.unitVolumeM3Snapshot });
    const cellKey = idText(stock.cellId), cell = summary.byCell.get(cellKey) ?? { cellId: stock.cellId, quantityOnHand: 0, quantityHeld: 0, quantityAvailable: 0, weightKg: 0, volumeM3: 0 };
    cell.quantityOnHand += stock.quantityOnHand; cell.quantityHeld += stock.quantityHeld; cell.quantityAvailable += stock.quantityAvailable; cell.weightKg += stock.totalWeightKg; cell.volumeM3 += stock.totalVolumeM3; summary.byCell.set(cellKey, cell); specs.set(key, summary);
  }
  for (const instance of instances) {
    if (instance.status === 'REMOVED') continue;
    const key = idText(instance.itemSpecId), summary = specs.get(key) ?? { itemSpecId: instance.itemSpecId, quantityOnHand: 0, quantityHeld: 0, quantityAvailable: 0, totalWeightKg: 0, totalVolumeM3: 0, byCell: new Map(), byReceipt: [] };
    summary.quantityOnHand += 1; summary.quantityAvailable += 1; summary.totalWeightKg += instance.unitWeightKgSnapshot; summary.totalVolumeM3 += instance.unitVolumeM3Snapshot;
    summary.byReceipt.push({ receiptId: instance.sourceReceiptId, itemInstanceId: instance.itemInstanceId, quantityOnHand: 1, quantityHeld: 0 }); specs.set(key, summary);
  }
  return { byCell, specs };
}

export class ManagedCellStockReadService {
  static async skuStock(skuIdInput: unknown, actor: any) {
    const skuId = oid(skuIdInput, 'skuId'), sku: any = await InventoryItemModel.findOne({ _id: skuId, deletedAt: { $exists: false } }).lean().exec();
    if (!sku) fail(404, 'SKU not found', 'SKU_NOT_FOUND'); assertSkuAccess(sku, actor);
    const [specifications, stocks, instances, movements, legacySku] = await Promise.all([
      ItemSpecificationModel.find({ skuId, status: 'ACTIVE', deletedAt: { $exists: false } } as any).select('_id skuId customerId reservationId facilityId code name quantityUnitId').populate('quantityUnitId', 'code name').sort({ createdAt: 1, _id: 1 }).lean().exec(),
      ManagedCellStockModel.find({ skuId }).sort({ itemSpecId: 1, receiptId: 1, cellId: 1 }).lean().exec(),
      ManagedItemInstanceModel.find({ skuId }).sort({ itemInstanceId: 1 }).lean().exec(),
      ItemMovementModel.find({ itemId: skuId }).sort({ performedAt: 1, _id: 1 }).limit(10001).lean().exec(),
      InventoryItemModel.findOne({ _id: skuId }).select('quantity quantityUnit currentCellId').lean().exec(),
    ]);
    const reservationId = sku.reservationId ?? sku.managedReservationId;
    const scopedRows = (rows: any[]) => rows.every(row => String(row.skuId ?? row.itemId ?? '') === String(skuId) &&
      String(row.customerId ?? '') === String(sku.customerId) && String(row.facilityId ?? '') === String(sku.facilityId) &&
      String(row.reservationId ?? row.managedReservationId ?? '') === String(reservationId ?? ''));
    const scopeRowsMatch = !!sku.customerId && !!sku.facilityId && !!reservationId &&
      scopedRows([...specifications, ...stocks, ...instances, ...movements]);
    const placementCellIds = new Set<string>();
    for (const row of stocks) if (row.cellId) placementCellIds.add(idText(row.cellId));
    for (const row of instances) for (const allocation of row.allocations ?? []) if (allocation.cellId) placementCellIds.add(idText(allocation.cellId));
    for (const movement of movements) {
      for (const line of [...(movement.stockEffect?.source ?? []), ...(movement.stockEffect?.destination ?? []), ...(movement.v3Effect?.source ?? []), ...(movement.v3Effect?.destination ?? [])]) if (line.cellId) placementCellIds.add(idText(line.cellId));
      if (movement.sourceCellId) placementCellIds.add(idText(movement.sourceCellId));
      if (movement.destinationCellId) placementCellIds.add(idText(movement.destinationCellId));
    }
    const placementCellList = [...placementCellIds];
    const placementCells = placementCellList.length <= 10000 && placementCellList.length
      ? await WarehouseCellModel.find({ _id: { $in: placementCellList }, facilityId: sku.facilityId }).select('_id').limit(10001).lean().exec()
      : [];
    const cellScopeMatches = placementCellList.length <= 10000 && placementCells.length === placementCellList.length;
    const canonicalScopeMatches = scopeRowsMatch && cellScopeMatches;
    const legacyMovement = movements.some((row: any) => row.schemaVersion !== 4), historyBounded = movements.length <= 10000;
    const v4Events = movements.filter((row: any) => row.schemaVersion === 4);
    let replay: any = null, replayError: string | null = null;
    if (v4Events.length === movements.length && v4Events.length) { try { replay = replayManagedStockMovements(v4Events); } catch (error: any) { replayError = error?.code || 'STOCK_LEDGER_UNKNOWN'; } }
    const initialized = canonicalScopeMatches && movements.length === 0 && stocks.length === 0 && instances.every((row: any) => row.status === 'REMOVED') && legacySku?.quantity == null && legacySku?.currentCellId == null;
    const replayMatchesProjection = canonicalScopeMatches && historyBounded && !!replay && sameProjection(replay.lots, stocks, row => `${idText(row.itemSpecId)}|${row.receiptId}|${idText(row.cellId)}`, ['skuId','itemSpecId','reservationId','facilityId','customerId','cellId','receiptId','quantityOnHand','quantityHeld','quantityAvailable','totalWeightKg','totalVolumeM3','unitWeightKgSnapshot','unitVolumeM3Snapshot','quantityUnitSnapshot','ledgerRevision']) &&
      sameInstanceProjection(replay.instances, instances);
    const ledgerStatus = initialized ? 'NOT_REQUIRED' : replayMatchesProjection ? 'REPLAYED' : replayError ? 'MISMATCH' : 'UNKNOWN';
    const canonicalRows = replayMatchesProjection ? replay.lots : [], canonicalInstances = replayMatchesProjection ? replay.instances : [];
    const summary = physicalSummary(canonicalRows, canonicalInstances);
    return { skuId, reservationId: sku.reservationId ?? sku.managedReservationId, facilityId: sku.facilityId,
      ledgerStatus, reconciliationStatus: initialized ? 'NOT_REQUIRED' : ledgerStatus === 'MISMATCH' ? 'MISMATCH' : 'UNKNOWN', reasonCode: initialized ? 'NO_STOCK_HISTORY' : !canonicalScopeMatches ? 'STOCK_SCOPE_MISMATCH' : replayError || (legacyMovement ? 'LEGACY_MOVEMENT_NOT_REPLAYED' : historyBounded ? 'CANONICAL_LEDGER_OR_PROJECTION_UNVERIFIED' : 'MOVEMENT_HISTORY_LIMIT_EXCEEDED'),
      totalQuantity: initialized ? 0 : replayMatchesProjection ? summary.byCell.size === 0 ? 0 : [...summary.byCell.values()].reduce((sum: number, row: any) => sum + row.quantityOnHand, 0) : null,
      totalWeightKg: initialized ? 0 : replayMatchesProjection ? canonicalRows.reduce((sum: number, row: any) => sum + row.totalWeightKg, 0) + canonicalInstances.filter((row: any) => row.status === 'PLACED').reduce((sum: number, row: any) => sum + row.unitWeightKgSnapshot, 0) : null,
      totalVolumeM3: initialized ? 0 : replayMatchesProjection ? canonicalRows.reduce((sum: number, row: any) => sum + row.totalVolumeM3, 0) + canonicalInstances.filter((row: any) => row.status === 'PLACED').reduce((sum: number, row: any) => sum + row.unitVolumeM3Snapshot, 0) : null,
      itemSpecifications: specifications.map((spec: any) => { const value = summary.specs.get(idText(spec._id)); return { itemSpecId: spec._id, code: spec.code, name: spec.name, quantityUnit: spec.quantityUnitId?.name ?? null,
        quantityOnHand: initialized ? 0 : replayMatchesProjection ? value?.quantityOnHand ?? 0 : null, quantityHeld: initialized ? 0 : replayMatchesProjection ? value?.quantityHeld ?? 0 : null, quantityAvailable: initialized ? 0 : replayMatchesProjection ? value?.quantityAvailable ?? 0 : null,
        totalWeightKg: initialized ? 0 : replayMatchesProjection ? value?.totalWeightKg ?? 0 : null, totalVolumeM3: initialized ? 0 : replayMatchesProjection ? value?.totalVolumeM3 ?? 0 : null,
        byCell: initialized ? [] : replayMatchesProjection && value ? [...value.byCell.values()] : [], byReceipt: initialized ? [] : replayMatchesProjection ? value?.byReceipt ?? [] : [] }; }),
      byCell: initialized ? [] : replayMatchesProjection ? [...summary.byCell.entries()].map(([cellId, value]) => ({ cellId, ...value })) : [],
    };
  }

  static async itemSpecificationStock(skuIdInput: unknown, specIdInput: unknown, actor: any) {
    const skuId = oid(skuIdInput, 'skuId'), specId = oid(specIdInput, 'itemSpecId'), stock = await this.skuStock(skuId.toString(), actor);
    const result = stock.itemSpecifications.find((row: any) => idText(row.itemSpecId) === specId.toString());
    if (!result) return fail(404, 'Item Specification not found', 'ITEM_SPECIFICATION_NOT_FOUND');
    return { skuId, itemSpecId: specId, ledgerStatus: stock.ledgerStatus, reconciliationStatus: stock.reconciliationStatus, reasonCode: stock.reasonCode,
      quantityOnHand: result.quantityOnHand, quantityHeld: result.quantityHeld, quantityAvailable: result.quantityAvailable,
      totalWeightKg: result.totalWeightKg, totalVolumeM3: result.totalVolumeM3, byCell: result.byCell, byReceipt: result.byReceipt };
  }

  static async cellStock(cellIdInput: unknown, actor: any) {
    const cellId = oid(cellIdInput, 'cellId'), cell: any = await WarehouseCellModel.findOne({ _id: cellId, deletedAt: { $exists: false } }).lean().exec();
    if (!cell) fail(404, 'Cell not found', 'CELL_NOT_FOUND');
    if (![UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF, UserRole.ADMIN, UserRole.BOM].includes(actor?.role)) fail(403, 'Facility stock reader role required', 'FORBIDDEN');
    if ([UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(actor.role) && String(actor.assignedFacilityId ?? '') !== String(cell.facilityId)) fail(404, 'Cell not found', 'CELL_NOT_FOUND');
    const [stocks, instances, movements, allocations, legacyItems] = await Promise.all([
      ManagedCellStockModel.find({ facilityId: cell.facilityId, cellId }).sort({ itemSpecId: 1, receiptId: 1 }).limit(10001).lean().exec(),
      ManagedItemInstanceModel.find({ facilityId: cell.facilityId, 'allocations.cellId': cellId, status: 'PLACED' }).sort({ itemInstanceId: 1 }).limit(10001).lean().exec(),
      ItemMovementModel.find({ facilityId: cell.facilityId, $or: [{ sourceCellId: cellId }, { destinationCellId: cellId }, { 'v3Effect.source.cellId': cellId }, { 'v3Effect.destination.cellId': cellId }, { 'stockEffect.source.cellId': cellId }, { 'stockEffect.destination.cellId': cellId }] }).sort({ performedAt: 1, _id: 1 }).limit(10001).lean().exec(),
      CellAllocationModel.find({ facilityId: cell.facilityId, cellId } as any).select('reservationId status').limit(10001).lean().exec(),
      InventoryItemModel.find({ facilityId: cell.facilityId, currentCellId: cellId, status: 'IN_STORAGE', deletedAt: { $exists: false } } as any).select('_id currentCellId').limit(1001).lean().exec(),
    ]);
    const bounded = stocks.length <= 10000 && instances.length <= 10000 && movements.length <= 10000 && allocations.length <= 10000 && legacyItems.length <= 1000;
    const skuIds = new Set<string>([...stocks.map((row: any) => idText(row.skuId)), ...instances.map((row: any) => idText(row.skuId)), ...movements.map((row: any) => idText(row.itemId))].filter(Boolean));
    let canonical: any[] = [];
    if (bounded && !legacyItems.length && skuIds.size <= 100) { try { canonical = await Promise.all([...skuIds].map(skuId => this.skuStock(skuId, actor))); } catch { canonical = []; } }
    const canonicalVerified = bounded && !legacyItems.length && skuIds.size <= 100 && canonical.length === skuIds.size && canonical.every((row: any) => ['REPLAYED','NOT_REQUIRED'].includes(row.ledgerStatus) && row.reconciliationStatus !== 'MISMATCH');
    const placements = [...stocks, ...instances.flatMap((row: any) => row.allocations.map((allocation: any) => ({ reservationId: row.reservationId, cellId: allocation.cellId })))];
    const allocationsMatch = placementsHaveCellAllocations(placements, allocations);
    const byCell = canonical.flatMap((row: any) => row.byCell.filter((entry: any) => idText(entry.cellId) === String(cellId)));
    const summary = byCell.reduce((sum: any, row: any) => ({ quantity: sum.quantity + row.quantityOnHand, weightKg: sum.weightKg + row.weightKg, volumeM3: sum.volumeM3 + row.volumeM3 }), { quantity: 0, weightKg: 0, volumeM3: 0 });
    const hasHistory = movements.length > 0 || legacyItems.length > 0;
    const reconciliation = reconcileCell({ hasMovementHistory: hasHistory, stockQuantity: summary.quantity, projectedWeightKg: summary.weightKg, projectedVolumeM3: summary.volumeM3,
      counterWeightKg: cell.usedWeightKg, counterVolumeM3: cell.usedVolumeM3, sourceComplete: canonicalVerified && allocationsMatch });
    const initialized = reconciliation.status === 'NOT_REQUIRED';
    const maxVolumeM3 = Number(cell.dimensions?.widthM) * Number(cell.dimensions?.depthM) * Number(cell.dimensions?.usableHeightM);
    let capacity: any = null, capacityError = 'CELL_CAPACITY_INVALID'; try { capacity = calculateCapacity({ maxWeightKg: cell.maxWeightKg, maxVolumeM3, usedWeightKg: cell.usedWeightKg, usedVolumeM3: cell.usedVolumeM3 }); } catch (error: any) { capacityError = error?.code === 'CAPACITY_MISMATCH' ? 'CELL_CAPACITY_EXCEEDED' : 'CELL_CAPACITY_INVALID'; }
    return { cellId, facilityId: cell.facilityId, maxWeightKg: cell.maxWeightKg ?? null, maxVolumeM3: Number.isFinite(maxVolumeM3) && maxVolumeM3 > 0 ? maxVolumeM3 : null,
      usedWeightKg: cell.usedWeightKg ?? null, usedVolumeM3: cell.usedVolumeM3 ?? null, remainingWeightKg: capacity?.remainingWeightKg ?? null, remainingVolumeM3: capacity?.remainingVolumeM3 ?? null,
      stockQuantity: reconciliation.status === 'RECONCILED' || initialized ? summary.quantity : null, stockStatus: initialized || reconciliation.status === 'RECONCILED' && summary.quantity === 0 ? 'EMPTY' : reconciliation.status === 'RECONCILED' ? 'HAS_STOCK' : 'UNKNOWN', reconciliationStatus: capacity ? reconciliation.status : capacityError === 'CELL_CAPACITY_EXCEEDED' ? 'MISMATCH' : 'NOT_CONFIGURED',
      reasonCode: capacity ? reconciliation.reasonCode ?? (!canonicalVerified ? 'LEDGER_PROJECTION_NOT_RECONCILED' : !allocationsMatch ? 'RESERVATION_CELL_ALLOCATION_UNVERIFIED' : null) : capacityError,
      projection: reconciliation.status === 'RECONCILED' ? { bySku: canonical.map((row: any) => ({ skuId: row.skuId, itemSpecifications: row.itemSpecifications.map((spec: any) => ({ itemSpecId: spec.itemSpecId, ...((spec.byCell || []).find((entry: any) => idText(entry.cellId) === String(cellId)) || {}) })).filter((spec: any) => spec.cellId) })).filter((row: any) => row.itemSpecifications.length) } : null };
  }

  static async facilityDiagnostics(actor: any) {
    if (actor?.role !== UserRole.FACILITY_MANAGER || !actor?.assignedFacilityId) fail(403, 'Assigned Facility Manager role required', 'FACILITY_SCOPE_REQUIRED');
    const facilityId = actor.assignedFacilityId;
    const cells: any[] = await WarehouseCellModel.find({ facilityId, deletedAt: { $exists: false } }).sort({ rackId: 1, levelNumber: 1, cellNumber: 1 }).limit(1001).lean().exec();
    const ids = cells.map(row => row._id);
    const [racks, stocks, instances, movements, allocations, reservations, legacyItems] = await Promise.all([
      WarehouseRackModel.find({ facilityId, deletedAt: { $exists: false } }).select('_id rackCode maxWeightKgPerLevel').lean().exec(),
      ManagedCellStockModel.find({ facilityId, cellId: { $in: ids } }).sort({ receiptId: 1 }).limit(10001).lean().exec(),
      ManagedItemInstanceModel.find({ facilityId, 'allocations.cellId': { $in: ids } }).sort({ itemInstanceId: 1 }).limit(10001).lean().exec(),
      ItemMovementModel.find({ facilityId }).sort({ performedAt: 1, _id: 1 }).limit(10001).lean().exec(),
      CellAllocationModel.find({ facilityId, cellId: { $in: ids } } as any).select('cellId reservationId status startDate endDate holdExpiresAt').sort({ startDate: 1 }).limit(10001).lean().exec(),
      ReservationModel.find({ facilityId, serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3, status: { $nin: ['CANCELLED', 'REJECTED'] } } as any).select('_id reservationCode allocatedCapacity usedCapacityM3').limit(1001).lean().exec(),
      InventoryItemModel.find({ facilityId, currentCellId: { $in: ids }, status: 'IN_STORAGE', deletedAt: { $exists: false } } as any).select('_id currentCellId inventorySchemaVersion reservationId managedReservationId').limit(1001).lean().exec(),
    ]);
    if (cells.length > 1000 || reservations.length > 1000) fail(503, 'Facility capacity diagnostics exceed the supported read limit', 'DIAGNOSTICS_RESULT_LIMIT_EXCEEDED');
    if (cells.length > 1000 || reservations.length > 1000) fail(503, 'Facility capacity diagnostics exceed the supported read limit', 'DIAGNOSTICS_RESULT_LIMIT_EXCEEDED');
    const rackMap = new Map(racks.map((row: any) => [String(row._id), row]));
    const historyBounded = movements.length <= 10000, legacyMovement = movements.some((row: any) => row.schemaVersion !== 4);
    let replay: any = null;
    if (historyBounded && movements.length && !legacyMovement) { try { replay = replayManagedStockMovementsBySku(movements); } catch { replay = null; } }
    const expectedLots = replay?.lots ?? [], expectedInstances = replay?.instances ?? [];
    const projectionsBounded = stocks.length <= 10000 && instances.length <= 10000 && allocations.length <= 10000;
    const projectionsMatch = historyBounded && projectionsBounded && !legacyMovement && (movements.length === 0 ? stocks.length === 0 && instances.length === 0 : !!replay) &&
      (movements.length === 0 || sameProjection(expectedLots, stocks, row => `${idText(row.itemSpecId)}|${row.receiptId}|${idText(row.cellId)}`, ['skuId','itemSpecId','reservationId','facilityId','customerId','cellId','receiptId','quantityOnHand','quantityHeld','quantityAvailable','totalWeightKg','totalVolumeM3','unitWeightKgSnapshot','unitVolumeM3Snapshot','quantityUnitSnapshot','ledgerRevision']) && sameInstanceProjection(expectedInstances, instances));
    const byCell = aggregateCellStock(projectionsMatch ? expectedLots : stocks, projectionsMatch ? expectedInstances : instances);
    const expectedReservationVolume = new Map<string, number>();
    const reservationCells = new Map<string, Set<string>>();
    if (projectionsMatch && replay) {
      for (const row of expectedLots) {
        const reservationKey = idText(row.reservationId);
        expectedReservationVolume.set(reservationKey, (expectedReservationVolume.get(reservationKey) ?? 0) + row.totalVolumeM3);
        const cellSet = reservationCells.get(reservationKey) ?? new Set<string>(); cellSet.add(idText(row.cellId)); reservationCells.set(reservationKey, cellSet);
      }
      for (const row of expectedInstances) if (row.status === 'PLACED') {
        const reservationKey = idText(row.reservationId);
        expectedReservationVolume.set(reservationKey, (expectedReservationVolume.get(reservationKey) ?? 0) + row.unitVolumeM3Snapshot);
        const cellSet = reservationCells.get(reservationKey) ?? new Set<string>(); row.allocations.forEach((line: any) => cellSet.add(idText(line.cellId))); reservationCells.set(reservationKey, cellSet);
      }
    }
    for (const allocation of allocations) {
      const reservationKey = idText(allocation.reservationId);
      const cellSet = reservationCells.get(reservationKey) ?? new Set<string>(); cellSet.add(idText(allocation.cellId)); reservationCells.set(reservationKey, cellSet);
    }
    const levelWeight = new Map<string, number>();
    for (const cell of cells) { const key = `${cell.rackId}:${cell.levelNumber}`; levelWeight.set(key, (levelWeight.get(key) ?? 0) + (Number.isFinite(cell.usedWeightKg) ? Number(cell.usedWeightKg) : 0)); }
    const cellReconciliation = new Map<string, any>();
    const diagnosticCells = cells.map(cell => {
      const entries = movements.filter((row: any) => String(row.sourceCellId) === String(cell._id) || String(row.destinationCellId) === String(cell._id) || [...(row.v3Effect?.source ?? []), ...(row.v3Effect?.destination ?? []), ...(row.stockEffect?.source ?? []), ...(row.stockEffect?.destination ?? [])].some((line: any) => String(line.cellId) === String(cell._id)));
      const stock = byCell.get(String(cell._id)) ?? { quantity: 0, quantityOnHand: 0, quantityHeld: 0, quantityAvailable: 0, weightKg: 0, volumeM3: 0, itemSpecifications: new Map() };
      const stockLines = projectionsMatch ? expectedLots.filter((row: any) => String(row.cellId) === String(cell._id)) : [];
      const instanceLines = projectionsMatch ? expectedInstances.flatMap((row: any) => row.status === 'PLACED' ? row.allocations.filter((allocation: any) => String(allocation.cellId) === String(cell._id)).map((allocation: any) => ({ ...allocation, reservationId: row.reservationId })) : []) : [];
      const allocationsMatch = placementsHaveCellAllocations([...stockLines, ...instanceLines], allocations);
      const noLegacyStock = !legacyItems.some((row: any) => String(row.currentCellId) === String(cell._id));
      const sourceComplete = projectionsMatch && !legacyMovement && legacyItems.length <= 1000 && allocations.length <= 10000 && noLegacyStock && allocationsMatch;
      const reconciliation = reconcileCell({ hasMovementHistory: entries.length > 0 || !noLegacyStock, stockQuantity: stock.quantity, projectedWeightKg: stock.weightKg, projectedVolumeM3: stock.volumeM3,
        counterWeightKg: cell.usedWeightKg, counterVolumeM3: cell.usedVolumeM3, sourceComplete });
      cellReconciliation.set(String(cell._id), reconciliation);
      const maxVolumeM3 = Number(cell.dimensions?.widthM) * Number(cell.dimensions?.depthM) * Number(cell.dimensions?.usableHeightM);
      let capacity: any = null, capacityError = 'CELL_CAPACITY_INVALID'; try { capacity = calculateCapacity({ maxWeightKg: cell.maxWeightKg, maxVolumeM3, usedWeightKg: cell.usedWeightKg, usedVolumeM3: cell.usedVolumeM3 }); } catch (error: any) { capacityError = error?.code === 'CAPACITY_MISMATCH' ? 'CELL_CAPACITY_EXCEEDED' : 'CELL_CAPACITY_INVALID'; }
      const rack: any = rackMap.get(String(cell.rackId)), allocationRows = allocations.filter((row: any) => String(row.cellId) === String(cell._id));
      const lastMovement = entries.at(-1);
      return { cellId: cell._id, cellCode: cell.code, rackId: cell.rackId, rackCode: rack?.rackCode ?? null, levelNumber: cell.levelNumber,
        maxWeightKg: cell.maxWeightKg ?? null, maxVolumeM3: Number.isFinite(maxVolumeM3) && maxVolumeM3 > 0 ? maxVolumeM3 : null,
        usedWeightKg: cell.usedWeightKg ?? null, usedVolumeM3: cell.usedVolumeM3 ?? null,
        remainingWeightKg: capacity?.remainingWeightKg ?? null, remainingVolumeM3: capacity?.remainingVolumeM3 ?? null,
        stockQuantity: sourceComplete || reconciliation.status === 'NOT_REQUIRED' ? stock.quantity : null, stockStatus: reconciliation.status === 'NOT_REQUIRED' ? 'EMPTY' : reconciliation.status === 'RECONCILED' && stock.quantity > 0 ? 'HAS_STOCK' : reconciliation.status === 'RECONCILED' ? 'EMPTY' : 'UNKNOWN', reconciliationStatus: capacity ? reconciliation.status : capacityError === 'CELL_CAPACITY_EXCEEDED' ? 'MISMATCH' : 'NOT_CONFIGURED',
        reasonCode: capacity ? reconciliation.reasonCode ?? (legacyMovement ? 'LEGACY_MOVEMENT_NOT_REPLAYED' : projectionsMatch ? allocationsMatch ? null : 'RESERVATION_CELL_ALLOCATION_UNVERIFIED' : 'LEDGER_PROJECTION_NOT_RECONCILED') : capacityError, lastMovement: lastMovement ? { movementId: lastMovement._id, performedAt: lastMovement.performedAt } : null,
        activeAllocationCount: allocationRows.length, allocatedReservationIds: allocationRows.map((row: any) => row.reservationId),
        levelUsedWeightKg: levelWeight.get(`${cell.rackId}:${cell.levelNumber}`) ?? null, levelMaxWeightKg: rack?.maxWeightKgPerLevel ?? null,
        levelCapacityStatus: rack && Number.isFinite(Number(rack.maxWeightKgPerLevel)) && Number(rack.maxWeightKgPerLevel) > 0 && cells.filter((row: any) => String(row.rackId) === String(cell.rackId) && row.levelNumber === cell.levelNumber).every((row: any) => Number.isFinite(row.usedWeightKg) && row.usedWeightKg >= 0) ? (levelWeight.get(`${cell.rackId}:${cell.levelNumber}`) ?? 0) <= Number(rack.maxWeightKgPerLevel) ? 'WITHIN_LIMIT' : 'MISMATCH' : 'NOT_CONFIGURED',
      };
    });
    return { facilityId, generatedAt: new Date().toISOString(), cells: diagnosticCells, reservationSummary: reservations.map((row: any) => {
      const expected = projectionsMatch ? expectedReservationVolume.get(String(row._id)) ?? 0 : undefined;
      const validCounter = typeof row.usedCapacityM3 === 'number' && Number.isFinite(row.usedCapacityM3) && row.usedCapacityM3 >= 0;
      const reservationCellIds = reservationCells.get(String(row._id)) ?? new Set<string>();
      const cellsReconciled = [...reservationCellIds].every(cellId => cellReconciliation.get(cellId)?.status === 'RECONCILED' || cellReconciliation.get(cellId)?.status === 'NOT_REQUIRED');
      const legacyReservationStock = legacyItems.length > 1000 || legacyItems.some((item: any) => idText(item.reservationId ?? item.managedReservationId) === String(row._id));
      const allocated = typeof row.allocatedCapacity === 'number' && Number.isFinite(row.allocatedCapacity) && row.allocatedCapacity > 0;
      const withinReservationQuota = allocated && typeof expected === 'number' && expected <= row.allocatedCapacity + 0.000001;
      const reconciled = projectionsMatch && !legacyMovement && !legacyReservationStock && cellsReconciled && validCounter && allocated && withinReservationQuota && typeof expected === 'number' && Math.abs(expected - row.usedCapacityM3) <= 0.000001;
      return { reservationId: row._id, reservationCode: row.reservationCode, allocatedCapacityM3: row.allocatedCapacity ?? null, usedCapacityM3: row.usedCapacityM3 ?? null,
        expectedLedgerVolumeM3: projectionsMatch ? expected : null, reconciliationStatus: reconciled ? 'RECONCILED' : projectionsMatch && cellsReconciled && validCounter && allocated && typeof expected === 'number' ? 'MISMATCH' : 'UNKNOWN', reasonCode: reconciled ? null : !projectionsMatch ? 'RESERVATION_CELL_USAGE_REPLAY_REQUIRED' : legacyReservationStock ? 'LEGACY_RESERVATION_STOCK_UNRECONCILED' : !cellsReconciled ? 'CELL_COUNTER_RECONCILIATION_REQUIRED' : !validCounter ? 'RESERVATION_COUNTER_NOT_CONFIGURED' : !allocated ? 'RESERVATION_ALLOCATION_NOT_CONFIGURED' : !withinReservationQuota ? 'RESERVATION_STOCK_EXCEEDS_ALLOCATION' : 'RESERVATION_COUNTER_MISMATCH' };
    }) };
  }
}
