import { Types } from 'mongoose';
import InventoryItemModel from '../../models/inventory-items/inventory-item.model';
import ItemSpecificationModel from '../../models/inventory-items/item-specification.model';
import ManagedCellStockModel from '../../models/inventory-items/managed-cell-stock.model';
import ManagedItemInstanceModel from '../../models/inventory-items/managed-item-instance.model';
import ItemMovementModel from '../../models/inventory-items/item-movement.model';
import ReservationModel from '../../models/reservations/reservation.model';
import WarehouseCellModel from '../../models/warehouse-map/warehouse-cell.model';
import { UserRole } from '../../types/user.type';
import { InventoryItemError } from './inventory-item.validation';
import { reconcileManagedV4SkuEvidence } from './managed-cell-stock-read.service';

export const MANAGED_V4_BATCH_LIMITS = Object.freeze({ skuCount: 100, specifications: 10_000, stockRows: 50_000, instances: 50_000,
  movementPerSku: 10_000, movementBatch: 50_000, reservations: 10_000, cells: 10_000 });

export class ManagedV4StockBatchReadError extends InventoryItemError {
  readonly code = 'MANAGED_V4_BATCH_EVIDENCE_LIMIT';
  constructor(message: string) { super(503, message); }
}
const id = (value: any) => String(value?._id ?? value ?? '');
const idSet = (...values: any[]) => [...new Set(values.map(id).filter(Boolean))];
const refs = (sku: any, stocks: any[], instances: any[], movements: any[]) => idSet(
  sku.reservationId ?? sku.managedReservationId,
  ...stocks.map(row => row.reservationId), ...instances.map(row => row.reservationId),
  ...movements.flatMap(movement => [movement.managedReservationId,
    ...(movement.stockEffect?.source ?? []).map((line: any) => line.reservationId), ...(movement.stockEffect?.destination ?? []).map((line: any) => line.reservationId)]));

async function bounded(query: any, limit: number, label: string) {
  const rows = await query.limit(limit + 1).lean().exec();
  if (rows.length > limit) throw new ManagedV4StockBatchReadError(`${label} exceeds the bounded Inventory list evidence limit`);
  return rows;
}

function unavailable(reason: string) {
  return { totalQuantity: null, quantityByUnit: [], totalWeightKg: null, totalVolumeM3: null, ledgerStatus: 'UNKNOWN',
    reconciliationStatus: 'UNKNOWN', dataCompleteness: 'INCOMPLETE', unavailableReason: reason };
}

export class ManagedV4StockBatchReadService {
  static async summarize(skus: any[], actor: any) {
    if (!Array.isArray(skus) || skus.length > MANAGED_V4_BATCH_LIMITS.skuCount) throw new ManagedV4StockBatchReadError('Inventory list SKU batch exceeds the configured limit');
    if (!actor?._id || ![UserRole.ADMIN, UserRole.BOM, UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(actor.role)) {
      throw Object.assign(new Error('Forbidden'), { status: 403, code: 'FORBIDDEN' });
    }
    const unique = new Map<string, any>();
    for (const sku of skus) {
      const skuId = id(sku._id);
      if (!/^[a-f\d]{24}$/i.test(skuId) || sku.inventorySchemaVersion !== 3) continue;
      if (unique.has(skuId)) throw new ManagedV4StockBatchReadError('Duplicate SKU in Inventory list page');
      if ([UserRole.FACILITY_MANAGER, UserRole.FACILITY_STAFF].includes(actor.role) && id(sku.facilityId) !== id(actor.assignedFacilityId)) {
        throw Object.assign(new Error('SKU is outside assigned Facility scope'), { status: 403, code: 'FACILITY_SCOPE_REQUIRED' });
      }
      unique.set(skuId, sku);
    }
    if (!unique.size) return new Map();
    const skuIds = [...unique.keys()].map(value => new Types.ObjectId(value));
    const [specifications, stocks, instances, movements] = await Promise.all([
      bounded(ItemSpecificationModel.find({ skuId: { $in: skuIds }, status: 'ACTIVE', deletedAt: { $exists: false } } as any)
        .select('_id skuId customerId reservationId facilityId code name quantityUnitId').populate('quantityUnitId', 'code name').sort({ skuId: 1, createdAt: 1, _id: 1 }),
        MANAGED_V4_BATCH_LIMITS.specifications, 'Specifications'),
      bounded(ManagedCellStockModel.find({ skuId: { $in: skuIds } }).sort({ skuId: 1, itemSpecId: 1, receiptId: 1, cellId: 1 }),
        MANAGED_V4_BATCH_LIMITS.stockRows, 'ManagedCellStock rows'),
      bounded(ManagedItemInstanceModel.find({ skuId: { $in: skuIds } }).sort({ skuId: 1, itemInstanceId: 1 }),
        MANAGED_V4_BATCH_LIMITS.instances, 'ManagedItemInstance rows'),
      bounded(ItemMovementModel.find({ itemId: { $in: skuIds } }).sort({ itemId: 1, performedAt: 1, _id: 1 }),
        MANAGED_V4_BATCH_LIMITS.movementBatch, 'Movement batch'),
    ]);
    const bySku = (rows: any[], key: string) => {
      const map = new Map<string, any[]>();
      for (const row of rows) { const skuId = id(row[key]); if (!unique.has(skuId)) throw new ManagedV4StockBatchReadError('Evidence query returned a SKU outside the authorized page'); const group = map.get(skuId) ?? []; group.push(row); map.set(skuId, group); }
      return map;
    };
    const specsBySku = bySku(specifications, 'skuId'), stocksBySku = bySku(stocks, 'skuId'), instancesBySku = bySku(instances, 'skuId'), movementsBySku = bySku(movements, 'itemId');
    const reservationRefs = new Set<string>();
    for (const [skuId, sku] of unique) for (const reservationId of refs(sku, stocksBySku.get(skuId) ?? [], instancesBySku.get(skuId) ?? [], movementsBySku.get(skuId) ?? [])) reservationRefs.add(reservationId);
    if (reservationRefs.size > MANAGED_V4_BATCH_LIMITS.reservations) throw new ManagedV4StockBatchReadError('Reservation evidence exceeds the bounded Inventory list limit');
    const reservationRows: any[] = reservationRefs.size ? await bounded((ReservationModel as any).find({ _id: { $in: [...reservationRefs].map(value => new Types.ObjectId(value)) },
      serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 3 }).select('_id customerId facilityId reservationCode status'), MANAGED_V4_BATCH_LIMITS.reservations, 'Reservation evidence') : [];
    const reservationsById = new Map(reservationRows.map(row => [id(row._id), row]));
    const cellRefs = new Set<string>();
    for (const row of stocks) if (row.cellId) cellRefs.add(id(row.cellId));
    for (const row of instances) for (const allocation of row.allocations ?? []) if (allocation.cellId) cellRefs.add(id(allocation.cellId));
    for (const movement of movements) for (const line of [...(movement.stockEffect?.source ?? []), ...(movement.stockEffect?.destination ?? []),
      ...(movement.v3Effect?.source ?? []), ...(movement.v3Effect?.destination ?? [])]) if (line.cellId) cellRefs.add(id(line.cellId));
    for (const movement of movements) { if (movement.sourceCellId) cellRefs.add(id(movement.sourceCellId)); if (movement.destinationCellId) cellRefs.add(id(movement.destinationCellId)); }
    if (cellRefs.size > MANAGED_V4_BATCH_LIMITS.cells) throw new ManagedV4StockBatchReadError('Cell evidence exceeds the bounded Inventory list limit');
    const cellRows: any[] = cellRefs.size ? await bounded(WarehouseCellModel.find({ _id: { $in: [...cellRefs].map(value => new Types.ObjectId(value)) } }).select('_id facilityId'),
      MANAGED_V4_BATCH_LIMITS.cells, 'Cell evidence') : [];
    const cellsById = new Map(cellRows.map(row => [id(row._id), row]));

    const results = new Map<string, any>();
    for (const [skuId, sku] of unique) {
      const skuSpecs = specsBySku.get(skuId) ?? [], skuStocks = stocksBySku.get(skuId) ?? [], skuInstances = instancesBySku.get(skuId) ?? [], skuMovements = movementsBySku.get(skuId) ?? [];
      if (skuMovements.length > MANAGED_V4_BATCH_LIMITS.movementPerSku) { results.set(skuId, unavailable('MOVEMENT_HISTORY_LIMIT_EXCEEDED')); continue; }
      const reservationIds = refs(sku, skuStocks, skuInstances, skuMovements);
      const reservationIdSet = new Set(reservationIds);
      const reservationScopeMatches = reservationIds.every(reservationId => {
        const row: any = reservationsById.get(reservationId);
        return row && id(row.customerId) === id(sku.customerId) && id(row.facilityId) === id(sku.facilityId);
      });
      const scopedRows = (rows: any[]) => rows.every(row => id(row.skuId ?? row.itemId) === skuId && id(row.customerId) === id(sku.customerId) &&
        id(row.facilityId) === id(sku.facilityId) && reservationIdSet.has(id(row.reservationId ?? row.managedReservationId ?? (sku.reservationId ?? sku.managedReservationId))));
      const placementCellIds = new Set<string>();
      for (const row of skuStocks) if (row.cellId) placementCellIds.add(id(row.cellId));
      for (const row of skuInstances) for (const allocation of row.allocations ?? []) if (allocation.cellId) placementCellIds.add(id(allocation.cellId));
      for (const movement of skuMovements) {
        for (const line of [...(movement.stockEffect?.source ?? []), ...(movement.stockEffect?.destination ?? []), ...(movement.v3Effect?.source ?? []), ...(movement.v3Effect?.destination ?? [])]) if (line.cellId) placementCellIds.add(id(line.cellId));
        if (movement.sourceCellId) placementCellIds.add(id(movement.sourceCellId)); if (movement.destinationCellId) placementCellIds.add(id(movement.destinationCellId));
      }
      const cellScopeMatches = placementCellIds.size <= MANAGED_V4_BATCH_LIMITS.cells && [...placementCellIds].every(cellId => id(cellsById.get(cellId)?.facilityId) === id(sku.facilityId));
      const canonicalScopeMatches = !!sku.customerId && !!sku.facilityId && !!(sku.reservationId ?? sku.managedReservationId) && reservationScopeMatches && cellScopeMatches &&
        scopedRows([...skuSpecs, ...skuStocks, ...skuInstances, ...skuMovements]);
      const initialized = canonicalScopeMatches && !skuMovements.length && !skuStocks.length && skuInstances.every(row => row.status === 'REMOVED') && sku.quantity == null && sku.currentCellId == null;
      const result = reconcileManagedV4SkuEvidence({ skuId: new Types.ObjectId(skuId), movements: skuMovements, stocks: skuStocks, instances: skuInstances,
        specifications: skuSpecs, canonicalScopeMatches, initialized });
      const verified = ['REPLAYED', 'NOT_REQUIRED'].includes(result.ledgerStatus) && result.reconciliationStatus !== 'MISMATCH';
      const quantityByUnit = verified ? result.quantityByUnit : [];
      results.set(skuId, { totalQuantity: verified && quantityByUnit.length <= 1 && (!quantityByUnit.length || quantityByUnit[0]?.quantityUnitId != null) ? quantityByUnit[0]?.quantity ?? 0 : null, quantityByUnit,
        totalWeightKg: verified ? result.totalWeightKg : null, totalVolumeM3: verified ? result.totalVolumeM3 : null,
        ledgerStatus: result.ledgerStatus, reconciliationStatus: result.reconciliationStatus, dataCompleteness: verified ? 'COMPLETE' : 'INCOMPLETE',
        ...(verified ? {} : { unavailableReason: result.reasonCode ?? 'STOCK_NOT_RECONCILED' }) });
    }
    return results;
  }
}
