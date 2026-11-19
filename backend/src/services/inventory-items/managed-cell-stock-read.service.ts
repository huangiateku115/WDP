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
export function sameCellDiagnosticLines(ledgerLines: any[], projectionLines: any[]) {
  const key = (row: any) => `${row.kind}|${idText(row.itemSpecId)}|${row.receiptId}|${row.itemInstanceId ?? ''}|${idText(row.reservationId)}`;
  if (ledgerLines.length !== projectionLines.length) return false;
  const actual = new Map(projectionLines.map(row => [key(row), row]));
  return ledgerLines.every(expected => {
    const found: any = actual.get(key(expected));
    return !!found && (expected.kind === 'PHYSICAL_UNIT' || expected.quantity === found.quantity) &&
      expected.weightKg === found.weightKg && expected.volumeM3 === found.volumeM3;
  });
}
export function reconcileManagedV4SkuEvidence(input: { skuId: unknown; movements: any[]; stocks: any[]; instances: any[]; specifications: any[]; canonicalScopeMatches: boolean; initialized: boolean }) {
  const historyBounded = input.movements.length <= 10000;
  const legacyMovement = input.movements.some(row => row.schemaVersion !== 4);
  const v4Events = input.movements.filter(row => row.schemaVersion === 4);
  let replay: any = null, replayError: string | null = null;
  if (historyBounded && v4Events.length === input.movements.length && v4Events.length) {
    try { replay = replayManagedStockMovements(v4Events); } catch (error: any) { replayError = error?.code || 'STOCK_LEDGER_UNKNOWN'; }
  }
  const replayMatchesProjection = input.canonicalScopeMatches && historyBounded && !!replay &&
    sameProjection(replay.lots, input.stocks, row => `${idText(row.reservationId)}|${idText(row.itemSpecId)}|${row.receiptId}|${idText(row.cellId)}`,
      ['skuId','itemSpecId','reservationId','facilityId','customerId','cellId','receiptId','quantityOnHand','quantityHeld','quantityAvailable','totalWeightKg','totalVolumeM3','unitWeightKgSnapshot','unitVolumeM3Snapshot','quantityUnitSnapshot','ledgerRevision']) &&
    sameInstanceProjection(replay.instances, input.instances);
  const ledgerStatus = input.initialized ? 'NOT_REQUIRED' : replayMatchesProjection ? 'REPLAYED' : replayError ? 'MISMATCH' : 'UNKNOWN';
  const reasonCode = input.initialized ? 'NO_STOCK_HISTORY' : !input.canonicalScopeMatches ? 'STOCK_SCOPE_MISMATCH' : replayError ||
    (legacyMovement ? 'LEGACY_MOVEMENT_NOT_REPLAYED' : historyBounded ? 'CANONICAL_LEDGER_OR_PROJECTION_UNVERIFIED' : 'MOVEMENT_HISTORY_LIMIT_EXCEEDED');
  const canonicalRows = replayMatchesProjection ? replay.lots : [], canonicalInstances = replayMatchesProjection ? replay.instances : [];
  const summary = physicalSummary(canonicalRows, canonicalInstances);
  const quantityByUnit = new Map<string, { quantityUnitId: string | null; quantityUnit: string | null; quantity: number }>();
  for (const spec of input.specifications) {
    const value = summary.specs.get(idText(spec._id));
    const quantityUnitId = idText(spec.quantityUnitId?._id ?? spec.quantityUnitId) || null;
    const key = quantityUnitId ?? `unknown:${idText(spec._id)}`;
    const row = quantityByUnit.get(key) ?? { quantityUnitId, quantityUnit: spec.quantityUnitId?.name ?? null, quantity: 0 };
    if (input.initialized || replayMatchesProjection) row.quantity += value?.quantityOnHand ?? 0;
    quantityByUnit.set(key, row);
  }
  const weight = input.initialized ? 0 : replayMatchesProjection ? canonicalRows.reduce((sum: number, row: any) => sum + row.totalWeightKg, 0) + canonicalInstances.filter((row: any) => row.status === 'PLACED').reduce((sum: number, row: any) => sum + row.unitWeightKgSnapshot, 0) : null;
  const volume = input.initialized ? 0 : replayMatchesProjection ? canonicalRows.reduce((sum: number, row: any) => sum + row.totalVolumeM3, 0) + canonicalInstances.filter((row: any) => row.status === 'PLACED').reduce((sum: number, row: any) => sum + row.unitVolumeM3Snapshot, 0) : null;
  return { replay, replayMatchesProjection, ledgerStatus, reconciliationStatus: input.initialized ? 'NOT_REQUIRED' : ledgerStatus === 'MISMATCH' ? 'MISMATCH' : 'UNKNOWN', reasonCode, historyBounded, legacyMovement,
    canonicalRows, canonicalInstances, summary, quantityByUnit: [...quantityByUnit.values()], totalWeightKg: weight, totalVolumeM3: volume };
}
function assertSkuAccess(sku: any, actor: any) {
  if (!actor?._id) fail(401, 'Authentication required', 'AUTH_REQUIRED');
  if (sku.inventorySchemaVersion !== 3) fail(409, 'Stock reads are available only for V3 SKU records', 'UNSUPPORTED_INVENTORY_VERSION');
  if (actor.role === UserRole.CUSTOMER && String(sku.customerId) !== String(actor._id)) fail(404, 'SKU not found', 'SKU_NOT_FOUND');
  if ([UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(actor.role) && String(sku.facilityId) !== String(actor.assignedFacilityId ?? '')) fail(404, 'SKU not found', 'SKU_NOT_FOUND');
  if (![UserRole.CUSTOMER, UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF, UserRole.ADMIN, UserRole.BOM].includes(actor.role)) fail(403, 'Forbidden', 'FORBIDDEN');
}
function customerSafeStockStatus(status: string) {
  if (status === 'NOT_REQUIRED') return 'NO_ACTIVITY';
  if (status === 'RECONCILED') return 'VERIFIED';
  return 'CHECKING';
}
function facilityCellStatus(reconciliation: { status: string; reasonCode: string | null }, hasLegacySource: boolean) {
  if (hasLegacySource) return { status: 'LEGACY_BLOCKED', reasonCode: 'LEGACY_STOCK_REQUIRES_RECONCILIATION' };
  if (reconciliation.status === 'NOT_REQUIRED') return { status: 'EMPTY_VERIFIED', reasonCode: reconciliation.reasonCode };
  return reconciliation;
}
export function customerSafeStockDto<T extends Record<string, any>>(stock: T) {
  const { reasonCode: _reasonCode, ledgerStatus: _ledgerStatus, ...safe } = stock;
  const reconciliationStatus = customerSafeStockStatus(String(stock.reconciliationStatus ?? 'UNKNOWN'));
  return { ...safe, reconciliationStatus, verificationMessage: reconciliationStatus === 'CHECKING' ? 'Cơ sở đang kiểm tra số liệu tồn kho.' : null };
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
  static async skuStock(skuIdInput: unknown, actor: any, includeFacilityDiagnostics = false) {
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
    const referencedReservationIds = new Set<string>([String(reservationId ?? ''), ...stocks.map((row: any) => idText(row.reservationId)),
      ...instances.map((row: any) => idText(row.reservationId)), ...movements.flatMap((movement: any) => [idText(movement.managedReservationId), ...(movement.stockEffect?.source ?? []).map((line: any) => idText(line.reservationId)), ...(movement.stockEffect?.destination ?? []).map((line: any) => idText(line.reservationId))])].filter(Boolean));
    const reservationRows: any[] = referencedReservationIds.size <= 1000 ? await (ReservationModel as any).find({ _id: { $in: [...referencedReservationIds] }, customerId: sku.customerId,
      facilityId: sku.facilityId, serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3 }).select('_id reservationCode status').lean().exec() : [];
    const validReservationIds = new Set(reservationRows.map((row: any) => idText(row._id)));
    const scopedRows = (rows: any[]) => rows.every(row => String(row.skuId ?? row.itemId ?? '') === String(skuId) &&
      String(row.customerId ?? '') === String(sku.customerId) && String(row.facilityId ?? '') === String(sku.facilityId) &&
      validReservationIds.has(String(row.reservationId ?? row.managedReservationId ?? reservationId ?? '')));
    const scopeRowsMatch = !!sku.customerId && !!sku.facilityId && !!reservationId && validReservationIds.size === referencedReservationIds.size &&
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
    const initialized = canonicalScopeMatches && movements.length === 0 && stocks.length === 0 && instances.every((row: any) => row.status === 'REMOVED') && legacySku?.quantity == null && legacySku?.currentCellId == null;
    const reconciled = reconcileManagedV4SkuEvidence({ skuId, movements, stocks, instances, specifications, canonicalScopeMatches, initialized });
    const { replay, replayMatchesProjection, ledgerStatus, reasonCode, historyBounded, legacyMovement, canonicalRows, canonicalInstances, summary } = reconciled;
    let ledgerReplayStatus: 'VERIFIED' | 'EMPTY_VERIFIED' | 'UNKNOWN' = initialized ? 'EMPTY_VERIFIED' : 'UNKNOWN';
    let ledgerByCell: any[] = [];
    if (!initialized && replay && canonicalScopeMatches && historyBounded && !legacyMovement) {
      try {
        const replayByCell = aggregateCellStock(replay.lots, replay.instances);
        ledgerByCell = [...replayByCell.entries()].map(([cellId, value]: [string, any]) => ({
          cellId, quantityOnHand: value.quantityOnHand, weightKg: value.weightKg, volumeM3: value.volumeM3,
        }));
        ledgerReplayStatus = 'VERIFIED';
      } catch {
        ledgerReplayStatus = 'UNKNOWN';
        ledgerByCell = [];
      }
    }
    let projectionEvidenceStatus: 'AVAILABLE' | 'UNKNOWN' | 'INVALID' = canonicalScopeMatches && historyBounded ? 'AVAILABLE' : 'UNKNOWN';
    let projectionByCell: any[] = [];
    if (projectionEvidenceStatus === 'AVAILABLE') {
      try {
        const projection = aggregateCellStock(stocks, instances);
        projectionByCell = [...projection.entries()].map(([cellId, value]: [string, any]) => ({
          cellId, quantityOnHand: value.quantityOnHand, weightKg: value.weightKg, volumeM3: value.volumeM3,
        }));
      } catch {
        projectionEvidenceStatus = 'INVALID';
      }
    }
    const evidenceCellIds = new Set<string>();
    const addEvidenceCell = (value: any) => { if (value) evidenceCellIds.add(idText(value)); };
    for (const row of stocks) {
      if (idText(row.skuId) === idText(skuId) && idText(row.customerId) === idText(sku.customerId) && idText(row.facilityId) === idText(sku.facilityId)) addEvidenceCell(row.cellId);
    }
    for (const row of instances) {
      if (idText(row.skuId) === idText(skuId) && idText(row.customerId) === idText(sku.customerId) && idText(row.facilityId) === idText(sku.facilityId)) {
        for (const allocation of row.allocations ?? []) addEvidenceCell(allocation.cellId);
      }
    }
    for (const movement of movements) {
      if (idText(movement.itemId) !== idText(skuId) || idText(movement.customerId) !== idText(sku.customerId) || idText(movement.facilityId) !== idText(sku.facilityId)) continue;
      for (const line of [...(movement.stockEffect?.source ?? []), ...(movement.stockEffect?.destination ?? []),
        ...(movement.v3Effect?.source ?? []), ...(movement.v3Effect?.destination ?? [])]) addEvidenceCell(line.cellId);
      addEvidenceCell(movement.sourceCellId);
      addEvidenceCell(movement.destinationCellId);
    }
    const byReservation = replayMatchesProjection ? [...new Set([...canonicalRows.map((row: any) => idText(row.reservationId)), ...canonicalInstances.filter((row: any) => row.status === 'PLACED').map((row: any) => idText(row.reservationId))])].map(resId => ({
      reservationId: resId, reservationCode: reservationRows.find((row: any) => idText(row._id) === resId)?.reservationCode ?? null,
      quantityOnHand: canonicalRows.filter((row: any) => idText(row.reservationId) === resId).reduce((sum: number, row: any) => sum + row.quantityOnHand, 0) + canonicalInstances.filter((row: any) => row.status === 'PLACED' && idText(row.reservationId) === resId).length,
      totalWeightKg: canonicalRows.filter((row: any) => idText(row.reservationId) === resId).reduce((sum: number, row: any) => sum + row.totalWeightKg, 0) + canonicalInstances.filter((row: any) => row.status === 'PLACED' && idText(row.reservationId) === resId).reduce((sum: number, row: any) => sum + row.unitWeightKgSnapshot, 0),
      totalVolumeM3: canonicalRows.filter((row: any) => idText(row.reservationId) === resId).reduce((sum: number, row: any) => sum + row.totalVolumeM3, 0) + canonicalInstances.filter((row: any) => row.status === 'PLACED' && idText(row.reservationId) === resId).reduce((sum: number, row: any) => sum + row.unitVolumeM3Snapshot, 0),
    })) : [];
    let diagnosticEvidence: any;
    if (includeFacilityDiagnostics) {
      const metadata = new Map(specifications.map((spec: any) => [idText(spec._id), spec]));
      const skuMeta = { skuId, skuCode: sku.itemCode ?? null, skuName: sku.name ?? null };
      const scopeProvesLedger = initialized || canonicalScopeMatches && historyBounded && !legacyMovement && !!replay;
      const ledgerCellMap = new Map<string, any>();
      const addLedger = (cellId: string, line: any) => {
        const row = ledgerCellMap.get(cellId) ?? { cellId, quantity: 0, weightKg: 0, volumeM3: 0, lines: [] };
        row.quantity += line.quantity ?? 0; row.weightKg = Math.round((row.weightKg + line.weightKg + Number.EPSILON) * 1000) / 1000;
        row.volumeM3 = Math.round((row.volumeM3 + line.volumeM3 + Number.EPSILON) * 1_000_000) / 1_000_000;
        row.lines.push(line); ledgerCellMap.set(cellId, row);
      };
      if (scopeProvesLedger && replay) {
        for (const row of replay.lots) addLedger(idText(row.cellId), { ...skuMeta, itemSpecId: row.itemSpecId, itemSpecCode: metadata.get(idText(row.itemSpecId))?.code ?? null,
          itemSpecName: metadata.get(idText(row.itemSpecId))?.name ?? null, receiptId: row.receiptId, reservationId: row.reservationId,
          kind: 'BATCH', quantity: row.quantityOnHand, weightKg: row.totalWeightKg, volumeM3: row.totalVolumeM3 });
        for (const instance of replay.instances.filter((row: any) => row.status === 'PLACED')) {
          const ordered = [...instance.allocations].sort((a: any, b: any) => idText(a.cellId).localeCompare(idText(b.cellId)));
          for (let index = 0; index < ordered.length; index += 1) {
            const allocation = ordered[index], spec = metadata.get(idText(instance.itemSpecId));
            addLedger(idText(allocation.cellId), { ...skuMeta, itemSpecId: instance.itemSpecId, itemSpecCode: spec?.code ?? null, itemSpecName: spec?.name ?? null,
              receiptId: instance.sourceReceiptId, itemInstanceId: instance.itemInstanceId, reservationId: instance.reservationId,
              kind: 'PHYSICAL_UNIT', quantity: index === 0 ? 1 : 0, weightKg: allocation.weightKg, volumeM3: allocation.volumeM3 });
          }
        }
      }
      let projectionByCell = new Map<string, any>(), projectionStatus = 'UNKNOWN';
      try {
        projectionByCell = aggregateCellStock(stocks, instances);
        projectionStatus = canonicalScopeMatches && historyBounded ? 'READ' : 'UNKNOWN';
      } catch { projectionStatus = 'INVALID'; }
      const projectionCellMap = new Map<string, any>();
      if (projectionStatus === 'READ') {
        for (const row of stocks) {
          const cellId = idText(row.cellId), spec = metadata.get(idText(row.itemSpecId)), target = projectionCellMap.get(cellId) ?? { cellId, quantity: 0, weightKg: 0, volumeM3: 0, lines: [] };
          target.lines.push({ ...skuMeta, itemSpecId: row.itemSpecId, itemSpecCode: spec?.code ?? null, itemSpecName: spec?.name ?? null, receiptId: row.receiptId,
            reservationId: row.reservationId, kind: 'BATCH', quantity: row.quantityOnHand, quantityHeld: row.quantityHeld, weightKg: row.totalWeightKg, volumeM3: row.totalVolumeM3 });
          projectionCellMap.set(cellId, target);
        }
        for (const instance of instances.filter((row: any) => row.status === 'PLACED')) for (const allocation of instance.allocations ?? []) {
          const cellId = idText(allocation.cellId), spec = metadata.get(idText(instance.itemSpecId)), target = projectionCellMap.get(cellId) ?? { cellId, quantity: 0, weightKg: 0, volumeM3: 0, lines: [] };
          target.lines.push({ ...skuMeta, itemSpecId: instance.itemSpecId, itemSpecCode: spec?.code ?? null, itemSpecName: spec?.name ?? null, receiptId: instance.sourceReceiptId,
            itemInstanceId: instance.itemInstanceId, reservationId: instance.reservationId, kind: 'PHYSICAL_UNIT', quantity: 1, weightKg: allocation.weightKg, volumeM3: allocation.volumeM3 });
          projectionCellMap.set(cellId, target);
        }
        for (const [cellId, row] of projectionCellMap) {
          const totals = projectionByCell.get(cellId); row.quantity = totals?.quantity ?? 0; row.weightKg = totals?.weightKg ?? 0; row.volumeM3 = totals?.volumeM3 ?? 0;
        }
      }
      const movementCellIds = (movement: any) => [...(movement.stockEffect?.source ?? []), ...(movement.stockEffect?.destination ?? []),
        ...(movement.v3Effect?.source ?? []), ...(movement.v3Effect?.destination ?? [])].map((line: any) => idText(line.cellId));
      diagnosticEvidence = { ledgerStatus: initialized ? 'EMPTY_VERIFIED' : scopeProvesLedger ? 'VERIFIED' : 'UNKNOWN',
        ledgerByCell: [...ledgerCellMap.values()], projectionStatus, projectionByCell: [...projectionCellMap.values()],
        movementIdsByCell: movements.reduce((result: Record<string, string[]>, movement: any) => {
          for (const cellId of new Set(movementCellIds(movement))) if (cellId) result[cellId] = [...(result[cellId] ?? []), idText(movement._id)];
          return result;
        }, {}) };
    }
    const result = { skuId, reservationId: sku.reservationId ?? sku.managedReservationId, facilityId: sku.facilityId, byReservation,
      ledgerStatus, reconciliationStatus: reconciled.reconciliationStatus, reasonCode,
      ledgerReplayStatus, ledgerByCell, projectionEvidenceStatus, projectionByCell, evidenceCellIds: [...evidenceCellIds],
      totalQuantity: initialized ? 0 : replayMatchesProjection ? summary.byCell.size === 0 ? 0 : [...summary.byCell.values()].reduce((sum: number, row: any) => sum + row.quantityOnHand, 0) : null,
      totalWeightKg: reconciled.totalWeightKg,
      totalVolumeM3: reconciled.totalVolumeM3,
      itemSpecifications: specifications.map((spec: any) => { const value = summary.specs.get(idText(spec._id)); return { itemSpecId: spec._id, code: spec.code, name: spec.name, quantityUnitId: idText(spec.quantityUnitId?._id ?? spec.quantityUnitId) || null, quantityUnit: spec.quantityUnitId?.name ?? null,
        quantityOnHand: initialized ? 0 : replayMatchesProjection ? value?.quantityOnHand ?? 0 : null, quantityHeld: initialized ? 0 : replayMatchesProjection ? value?.quantityHeld ?? 0 : null, quantityAvailable: initialized ? 0 : replayMatchesProjection ? value?.quantityAvailable ?? 0 : null,
        totalWeightKg: initialized ? 0 : replayMatchesProjection ? value?.totalWeightKg ?? 0 : null, totalVolumeM3: initialized ? 0 : replayMatchesProjection ? value?.totalVolumeM3 ?? 0 : null,
        byCell: initialized ? [] : replayMatchesProjection && value ? [...value.byCell.values()] : [], byReceipt: initialized ? [] : replayMatchesProjection ? value?.byReceipt ?? [] : [] }; }),
      byCell: initialized ? [] : replayMatchesProjection ? [...summary.byCell.entries()].map(([cellId, value]) => ({ cellId, ...value })) : [],
      ...(includeFacilityDiagnostics ? { facilityDiagnosticEvidence: diagnosticEvidence } : {}),
    };
    return result;
  }

  static async itemSpecificationStock(skuIdInput: unknown, specIdInput: unknown, actor: any) {
    const skuId = oid(skuIdInput, 'skuId'), specId = oid(specIdInput, 'itemSpecId'), stock = await this.skuStock(skuId.toString(), actor);
    const specification = stock.itemSpecifications.find((row: any) => idText(row.itemSpecId) === specId.toString());
    if (!specification) return fail(404, 'Item Specification not found', 'ITEM_SPECIFICATION_NOT_FOUND');
    const result = { skuId, itemSpecId: specId, ledgerStatus: stock.ledgerStatus, reconciliationStatus: stock.reconciliationStatus, reasonCode: stock.reasonCode,
      quantityOnHand: specification.quantityOnHand, quantityHeld: specification.quantityHeld, quantityAvailable: specification.quantityAvailable,
      totalWeightKg: specification.totalWeightKg, totalVolumeM3: specification.totalVolumeM3, byCell: specification.byCell, byReceipt: specification.byReceipt };
    return result;
  }

  static async cellStock(cellIdInput: unknown, actor: any) {
    const cellId = oid(cellIdInput, 'cellId'), cell: any = await WarehouseCellModel.findOne({ _id: cellId, deletedAt: { $exists: false } }).lean().exec();
    if (!cell) fail(404, 'Cell not found', 'CELL_NOT_FOUND');
    if (![UserRole.FACILITY_MANAGER, UserRole.ADMIN, UserRole.BOM].includes(actor?.role)) fail(403, 'Facility stock diagnostics role required', 'FORBIDDEN');
    if (actor.role === UserRole.FACILITY_MANAGER && String(actor.assignedFacilityId ?? '') !== String(cell.facilityId)) fail(404, 'Cell not found', 'CELL_NOT_FOUND');
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
    if (bounded && !legacyItems.length && skuIds.size <= 100) { try { canonical = await Promise.all([...skuIds].map(skuId => this.skuStock(skuId, actor, true))); } catch { canonical = []; } }
    const movementSkuScopeComplete = movements.every((row: any) => !!idText(row.itemId) && skuIds.has(idText(row.itemId)));
    const canonicalVerified = bounded && !legacyItems.length && movementSkuScopeComplete && skuIds.size <= 100 && canonical.length === skuIds.size && canonical.every((row: any) => ['REPLAYED','NOT_REQUIRED'].includes(row.ledgerStatus) && row.reconciliationStatus !== 'MISMATCH');
    const placements = [...stocks, ...instances.flatMap((row: any) => row.allocations.map((allocation: any) => ({ reservationId: row.reservationId, cellId: allocation.cellId })))];
    const allocationsMatch = placementsHaveCellAllocations(placements, allocations);
    const byCell = canonical.flatMap((row: any) => row.byCell.filter((entry: any) => idText(entry.cellId) === String(cellId)));
    const summary = byCell.reduce((sum: any, row: any) => ({ quantity: sum.quantity + row.quantityOnHand, weightKg: sum.weightKg + row.weightKg, volumeM3: sum.volumeM3 + row.volumeM3 }), { quantity: 0, weightKg: 0, volumeM3: 0 });
    const hasHistory = movements.length > 0 || legacyItems.length > 0;
    const reconciliation = reconcileCell({ hasMovementHistory: hasHistory, stockQuantity: summary.quantity, projectedWeightKg: summary.weightKg, projectedVolumeM3: summary.volumeM3,
      counterWeightKg: cell.usedWeightKg, counterVolumeM3: cell.usedVolumeM3, sourceComplete: canonicalVerified && allocationsMatch });
    const initialized = reconciliation.status === 'NOT_REQUIRED';
    const skuEvidenceComplete = bounded && !legacyItems.length && movementSkuScopeComplete && canonical.length === skuIds.size && canonical.every((row: any) => ['VERIFIED', 'EMPTY_VERIFIED'].includes(row.facilityDiagnosticEvidence?.ledgerStatus));
    const ledgerLines = canonical.flatMap((row: any) => row.facilityDiagnosticEvidence?.ledgerByCell?.find((entry: any) => idText(entry.cellId) === String(cellId))?.lines ?? []);
    const projectionLines = canonical.flatMap((row: any) => row.facilityDiagnosticEvidence?.projectionByCell?.find((entry: any) => idText(entry.cellId) === String(cellId))?.lines ?? []);
    const ledgerTotals = skuEvidenceComplete ? canonical.reduce((total: any, row: any) => {
      const entry = row.facilityDiagnosticEvidence?.ledgerByCell?.find((value: any) => idText(value.cellId) === String(cellId));
      return { quantity: total.quantity + (entry?.quantity ?? 0), weightKg: total.weightKg + (entry?.weightKg ?? 0), volumeM3: total.volumeM3 + (entry?.volumeM3 ?? 0) };
    }, { quantity: 0, weightKg: 0, volumeM3: 0 }) : null;
    const projectionEvidenceValid = bounded && movementSkuScopeComplete && canonical.length === skuIds.size && canonical.every((row: any) => row.facilityDiagnosticEvidence?.projectionStatus === 'READ');
    let projectionTotals: any = null, projectionDataValid = projectionEvidenceValid;
    if (projectionEvidenceValid) {
      try { projectionTotals = aggregateCellStock(stocks, instances).get(String(cellId)) ?? { quantity: 0, weightKg: 0, volumeM3: 0 }; }
      catch { projectionDataValid = false; /* malformed stored projection remains UNKNOWN; never normalize it to zero */ }
    }
    const counterValid = Number.isFinite(cell.usedWeightKg) && cell.usedWeightKg >= 0 && Number.isFinite(cell.usedVolumeM3) && cell.usedVolumeM3 >= 0;
    const difference = (counter: number | null, value: number | null, places: 3 | 6) => counter !== null && value !== null && counterValid
      ? Math.round((counter - value + Number.EPSILON) * 10 ** places) / 10 ** places : null;
    const projectionLinesMatch = skuEvidenceComplete && projectionDataValid && sameCellDiagnosticLines(ledgerLines, projectionLines);
    const fullProjectionMatch = skuEvidenceComplete && canonical.every((row: any) => ['REPLAYED', 'NOT_REQUIRED'].includes(row.ledgerStatus));
    const maxVolumeM3 = Number(cell.dimensions?.widthM) * Number(cell.dimensions?.depthM) * Number(cell.dimensions?.usableHeightM);
    let capacity: any = null, capacityError = 'CELL_CAPACITY_INVALID'; try { capacity = calculateCapacity({ maxWeightKg: cell.maxWeightKg, maxVolumeM3, usedWeightKg: cell.usedWeightKg, usedVolumeM3: cell.usedVolumeM3 }); } catch (error: any) { capacityError = error?.code === 'CAPACITY_MISMATCH' ? 'CELL_CAPACITY_EXCEEDED' : 'CELL_CAPACITY_INVALID'; }
    return { cellId, facilityId: cell.facilityId, maxWeightKg: cell.maxWeightKg ?? null, maxVolumeM3: Number.isFinite(maxVolumeM3) && maxVolumeM3 > 0 ? maxVolumeM3 : null,
      usedWeightKg: cell.usedWeightKg ?? null, usedVolumeM3: cell.usedVolumeM3 ?? null, remainingWeightKg: capacity?.remainingWeightKg ?? null, remainingVolumeM3: capacity?.remainingVolumeM3 ?? null,
      stockQuantity: reconciliation.status === 'RECONCILED' || initialized ? summary.quantity : null, stockStatus: initialized || reconciliation.status === 'RECONCILED' && summary.quantity === 0 ? 'EMPTY' : reconciliation.status === 'RECONCILED' ? 'HAS_STOCK' : 'UNKNOWN', reconciliationStatus: capacity ? reconciliation.status : capacityError === 'CELL_CAPACITY_EXCEEDED' ? 'MISMATCH' : 'NOT_CONFIGURED',
      reasonCode: capacity ? reconciliation.reasonCode ?? (!canonicalVerified ? 'LEDGER_PROJECTION_NOT_RECONCILED' : !allocationsMatch ? 'RESERVATION_CELL_ALLOCATION_UNVERIFIED' : null) : capacityError,
      projection: reconciliation.status === 'RECONCILED' ? { bySku: canonical.map((row: any) => ({ skuId: row.skuId, itemSpecifications: row.itemSpecifications.map((spec: any) => ({ itemSpecId: spec.itemSpecId, ...((spec.byCell || []).find((entry: any) => idText(entry.cellId) === String(cellId)) || {}) })).filter((spec: any) => spec.cellId) })).filter((row: any) => row.itemSpecifications.length) } : null,
      diagnostics: { evidenceStatus: skuEvidenceComplete ? 'COMPLETE' : 'UNKNOWN', ledger: { status: skuEvidenceComplete ? ledgerTotals?.quantity === 0 ? 'EMPTY_VERIFIED' : 'VERIFIED' : 'UNKNOWN', quantity: ledgerTotals?.quantity ?? null,
        expectedWeightKg: ledgerTotals?.weightKg ?? null, expectedVolumeM3: ledgerTotals?.volumeM3 ?? null, lines: skuEvidenceComplete ? ledgerLines : [],
        movementIds: skuEvidenceComplete ? [...new Set(canonical.flatMap((row: any) => row.facilityDiagnosticEvidence?.movementIdsByCell?.[String(cellId)] ?? []))] : [] },
        projection: { status: fullProjectionMatch ? 'MATCH' : !skuEvidenceComplete || !projectionDataValid || projectionLinesMatch ? 'UNKNOWN' : 'MISMATCH',
          weightKg: projectionTotals?.weightKg ?? null, volumeM3: projectionTotals?.volumeM3 ?? null, lines: projectionDataValid ? projectionLines : [] },
        counter: { weightKg: counterValid ? cell.usedWeightKg : null, volumeM3: counterValid ? cell.usedVolumeM3 : null },
        difference: { counterMinusLedgerWeightKg: difference(cell.usedWeightKg ?? null, ledgerTotals?.weightKg ?? null, 3), counterMinusLedgerVolumeM3: difference(cell.usedVolumeM3 ?? null, ledgerTotals?.volumeM3 ?? null, 6),
          counterMinusProjectionWeightKg: difference(cell.usedWeightKg ?? null, projectionTotals?.weightKg ?? null, 3), counterMinusProjectionVolumeM3: difference(cell.usedVolumeM3 ?? null, projectionTotals?.volumeM3 ?? null, 6) } } };
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
    const movementRowsByCell = new Map<string, any[]>();
    for (const movement of movements) {
      const cellIds = new Set<string>([movement.sourceCellId, movement.destinationCellId,
        ...(movement.v3Effect?.source ?? []).map((line: any) => line.cellId), ...(movement.v3Effect?.destination ?? []).map((line: any) => line.cellId),
        ...(movement.stockEffect?.source ?? []).map((line: any) => line.cellId), ...(movement.stockEffect?.destination ?? []).map((line: any) => line.cellId)]
        .filter(Boolean).map((value: any) => String(value)));
      for (const cellId of cellIds) movementRowsByCell.set(cellId, [...(movementRowsByCell.get(cellId) ?? []), movement]);
    }
    const cellReconciliation = new Map<string, any>();
    // Calculate every Cell status before level summaries read sibling Cells.
    // Otherwise the first Cell in a level is evaluated while later statuses
    // are still absent and is incorrectly reported UNKNOWN.
    for (const cell of cells) {
      const entries = movementRowsByCell.get(String(cell._id)) ?? [];
      const stock = byCell.get(String(cell._id)) ?? { quantity: 0, weightKg: 0, volumeM3: 0 };
      const stockLines = projectionsMatch ? expectedLots.filter((row: any) => String(row.cellId) === String(cell._id)) : [];
      const instanceLines = projectionsMatch ? expectedInstances.flatMap((row: any) => row.status === 'PLACED' ? row.allocations.filter((allocation: any) => String(allocation.cellId) === String(cell._id)).map((allocation: any) => ({ ...allocation, reservationId: row.reservationId })) : []) : [];
      const allocationsMatch = placementsHaveCellAllocations([...stockLines, ...instanceLines], allocations);
      const noLegacyStock = !legacyItems.some((row: any) => String(row.currentCellId) === String(cell._id));
      const sourceComplete = historyBounded && projectionsBounded && projectionsMatch && !legacyMovement && legacyItems.length <= 1000 && allocations.length <= 10000 && noLegacyStock && allocationsMatch;
      const facilityEvidenceIncomplete = !historyBounded || !projectionsBounded || legacyMovement || legacyItems.length > 1000;
      const reconciliation = reconcileCell({ hasMovementHistory: entries.length > 0 || !noLegacyStock || facilityEvidenceIncomplete, stockQuantity: stock.quantity,
        projectedWeightKg: stock.weightKg, projectedVolumeM3: stock.volumeM3, counterWeightKg: cell.usedWeightKg, counterVolumeM3: cell.usedVolumeM3, sourceComplete });
      const hasCellLegacySource = entries.some((row: any) => row.schemaVersion !== 4) || legacyItems.some((row: any) => String(row.currentCellId) === String(cell._id));
      cellReconciliation.set(String(cell._id), facilityCellStatus(reconciliation, hasCellLegacySource));
    }
    const diagnosticCells = cells.map(cell => {
      const entries = movementRowsByCell.get(String(cell._id)) ?? [];
      const stock = byCell.get(String(cell._id)) ?? { quantity: 0, quantityOnHand: 0, quantityHeld: 0, quantityAvailable: 0, weightKg: 0, volumeM3: 0, itemSpecifications: new Map() };
      const stockLines = projectionsMatch ? expectedLots.filter((row: any) => String(row.cellId) === String(cell._id)) : [];
      const instanceLines = projectionsMatch ? expectedInstances.flatMap((row: any) => row.status === 'PLACED' ? row.allocations.filter((allocation: any) => String(allocation.cellId) === String(cell._id)).map((allocation: any) => ({ ...allocation, reservationId: row.reservationId })) : []) : [];
      const allocationsMatch = placementsHaveCellAllocations([...stockLines, ...instanceLines], allocations);
      const noLegacyStock = !legacyItems.some((row: any) => String(row.currentCellId) === String(cell._id));
      const sourceComplete = historyBounded && projectionsBounded && projectionsMatch && !legacyMovement && legacyItems.length <= 1000 && allocations.length <= 10000 && noLegacyStock && allocationsMatch;
      const reconciliation = cellReconciliation.get(String(cell._id));
      const maxVolumeM3 = Number(cell.dimensions?.widthM) * Number(cell.dimensions?.depthM) * Number(cell.dimensions?.usableHeightM);
      let capacity: any = null, capacityError = 'CELL_CAPACITY_INVALID'; try { capacity = calculateCapacity({ maxWeightKg: cell.maxWeightKg, maxVolumeM3, usedWeightKg: cell.usedWeightKg, usedVolumeM3: cell.usedVolumeM3 }); } catch (error: any) { capacityError = error?.code === 'CAPACITY_MISMATCH' ? 'CELL_CAPACITY_EXCEEDED' : 'CELL_CAPACITY_INVALID'; }
      const rack: any = rackMap.get(String(cell.rackId)), allocationRows = allocations.filter((row: any) => String(row.cellId) === String(cell._id));
      const lastMovement = entries.at(-1);
      return { cellId: cell._id, cellCode: cell.code, rackId: cell.rackId, rackCode: rack?.rackCode ?? null, levelNumber: cell.levelNumber,
        maxWeightKg: cell.maxWeightKg ?? null, maxVolumeM3: Number.isFinite(maxVolumeM3) && maxVolumeM3 > 0 ? maxVolumeM3 : null,
        usedWeightKg: cell.usedWeightKg ?? null, usedVolumeM3: cell.usedVolumeM3 ?? null,
        remainingWeightKg: capacity?.remainingWeightKg ?? null, remainingVolumeM3: capacity?.remainingVolumeM3 ?? null,
        stockQuantity: sourceComplete || reconciliation.status === 'EMPTY_VERIFIED' ? stock.quantity : null, stockStatus: reconciliation.status === 'EMPTY_VERIFIED' ? 'EMPTY' : reconciliation.status === 'RECONCILED' && stock.quantity > 0 ? 'HAS_STOCK' : reconciliation.status === 'RECONCILED' ? 'EMPTY' : 'UNKNOWN', reconciliationStatus: capacity ? reconciliation.status : capacityError === 'CELL_CAPACITY_EXCEEDED' ? 'MISMATCH' : 'UNKNOWN',
        reasonCode: capacity ? reconciliation.reasonCode ?? (legacyMovement ? 'LEGACY_MOVEMENT_NOT_REPLAYED' : projectionsMatch ? allocationsMatch ? null : 'RESERVATION_CELL_ALLOCATION_UNVERIFIED' : 'LEDGER_PROJECTION_NOT_RECONCILED') : capacityError, lastMovement: lastMovement ? { movementId: lastMovement._id, performedAt: lastMovement.performedAt } : null,
        activeAllocationCount: allocationRows.length, allocatedReservationIds: allocationRows.map((row: any) => row.reservationId),
        levelUsedWeightKg: levelWeight.get(`${cell.rackId}:${cell.levelNumber}`) ?? null, levelMaxWeightKg: rack?.maxWeightKgPerLevel ?? null,
        levelCapacityStatus: (() => {
          const levelCells = cells.filter((row: any) => String(row.rackId) === String(cell.rackId) && row.levelNumber === cell.levelNumber);
          const max = Number(rack?.maxWeightKgPerLevel), used = levelWeight.get(`${cell.rackId}:${cell.levelNumber}`);
          if (!rack || !Number.isFinite(max) || max <= 0 || used === undefined || !Number.isFinite(used) || levelCells.some((row: any) => !Number.isFinite(row.usedWeightKg) || row.usedWeightKg < 0)) return 'NOT_CONFIGURED';
          if (used > max + 0.001) return 'MISMATCH';
          if (!levelCells.every((row: any) => ['RECONCILED', 'EMPTY_VERIFIED'].includes(cellReconciliation.get(String(row._id))?.status))) return 'UNKNOWN';
          return 'WITHIN_LIMIT';
        })(),
      };
    });
    return { facilityId, generatedAt: new Date().toISOString(), cells: diagnosticCells, reservationSummary: reservations.map((row: any) => {
      const expected = projectionsMatch ? expectedReservationVolume.get(String(row._id)) ?? 0 : undefined;
      const validCounter = typeof row.usedCapacityM3 === 'number' && Number.isFinite(row.usedCapacityM3) && row.usedCapacityM3 >= 0;
      const reservationCellIds = reservationCells.get(String(row._id)) ?? new Set<string>();
      const cellsReconciled = [...reservationCellIds].every(cellId => cellReconciliation.get(cellId)?.status === 'RECONCILED' || cellReconciliation.get(cellId)?.status === 'EMPTY_VERIFIED');
      const legacyReservationStock = legacyItems.length > 1000 || legacyItems.some((item: any) => idText(item.reservationId ?? item.managedReservationId) === String(row._id));
      const allocated = typeof row.allocatedCapacity === 'number' && Number.isFinite(row.allocatedCapacity) && row.allocatedCapacity > 0;
      const withinReservationQuota = allocated && typeof expected === 'number' && expected <= row.allocatedCapacity + 0.000001;
      const reconciled = projectionsMatch && !legacyMovement && !legacyReservationStock && cellsReconciled && validCounter && allocated && withinReservationQuota && typeof expected === 'number' && Math.abs(expected - row.usedCapacityM3) <= 0.000001;
      return { reservationId: row._id, reservationCode: row.reservationCode, allocatedCapacityM3: row.allocatedCapacity ?? null, usedCapacityM3: row.usedCapacityM3 ?? null,
        expectedLedgerVolumeM3: projectionsMatch ? expected : null, reconciliationStatus: reconciled ? 'RECONCILED' : projectionsMatch && cellsReconciled && validCounter && allocated && typeof expected === 'number' ? 'MISMATCH' : 'UNKNOWN', reasonCode: reconciled ? null : !projectionsMatch ? 'RESERVATION_CELL_USAGE_REPLAY_REQUIRED' : legacyReservationStock ? 'LEGACY_RESERVATION_STOCK_UNRECONCILED' : !cellsReconciled ? 'CELL_COUNTER_RECONCILIATION_REQUIRED' : !validCounter ? 'RESERVATION_COUNTER_NOT_CONFIGURED' : !allocated ? 'RESERVATION_ALLOCATION_NOT_CONFIGURED' : !withinReservationQuota ? 'RESERVATION_STOCK_EXCEEDS_ALLOCATION' : 'RESERVATION_COUNTER_MISMATCH' };
    }) };
  }
}
