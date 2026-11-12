import {apiRecord, apiRows, objectId, recordId} from './facilityReview.js';
import {inventoryMovements} from './inventoryMovementHistory.js';
import {accessRows, sessionStatus} from './managedAccessFacility.js';

export function inventorySource(item) {
  if (item.inventorySchemaVersion === 3) return 'self';
  if (item.inventorySchemaVersion == null || [1, 2].includes(item.inventorySchemaVersion)) return 'batches';
  throw Error('Chưa hỗ trợ nguồn dữ liệu của mặt hàng này. Không dùng nguồn tồn khác để thay thế.');
}
const count = value => Number.isSafeInteger(value) && value >= 0;
const measure = value => Number.isFinite(value) && value >= 0;
export async function loadFacilityInventory({itemId, user, inventoryApi, v3Api, accessApi, signal}) {
  if (!objectId(itemId) || !objectId(user?.assignedFacilityId) || !['FACILITY_STAFF','FACILITY_MANAGER'].includes(user?.role)) throw Error('Cần đúng vai trò, cơ sở và mã mặt hàng.');
  const item = apiRecord(await inventoryApi.get(itemId, {signal}));
  if (recordId(item) !== itemId || recordId(item.facilityId) !== user.assignedFacilityId || !objectId(recordId(item.managedReservationId))) throw Error('Mặt hàng không thuộc cơ sở được phân công.');
  const source = inventorySource(item);
  if (source === 'batches') {
    const [stockResponse, historyResponse] = await Promise.all([inventoryApi.stockBalance(itemId, {signal}), inventoryApi.movements(itemId, {signal})]);
    const stock = apiRecord(stockResponse);
    if (recordId(stock.itemId) !== itemId || recordId(stock.facilityId) !== user.assignedFacilityId || !count(stock.onHandQuantity) || !count(stock.heldQuantity) || stock.heldQuantity > stock.onHandQuantity || !Array.isArray(stock.batches)) throw Error('Không xác minh được tồn và lô hàng của mặt hàng.');
    return {item, source, stock, movements: inventoryMovements(historyResponse, item), sessions: []};
  }
  const [stockResponse, historyResponse, sessionResponse] = await Promise.all([v3Api.stock(itemId), v3Api.movements(itemId), user.role === 'FACILITY_STAFF' ? accessApi.facilitySessions() : Promise.resolve(null)]);
  const stock = apiRecord(stockResponse), movements = apiRows(historyResponse);
  if (recordId(stock.skuId) !== itemId || recordId(stock.facilityId) !== user.assignedFacilityId || recordId(stock.reservationId) !== recordId(item.managedReservationId) || recordId(stock.customerId) !== recordId(item.customerId) || !['RECONCILED','RECONCILIATION_REQUIRED','UNKNOWN'].includes(stock.reconciliationStatus) || !count(stock.onHandQuantity) || !count(stock.heldQuantity) || !count(stock.availableQuantity) || stock.heldQuantity > stock.onHandQuantity || stock.availableQuantity !== stock.onHandQuantity - stock.heldQuantity || !measure(stock.totalWeightKg) || !measure(stock.totalVolumeM3) || !['byCell','byBatch','byPhysicalUnit'].every(key => Array.isArray(stock[key]))) throw Error('Không xác minh được tồn tự quản của mặt hàng.');
  if (stock.byCell.some(row => !objectId(recordId(row.cellId)) || !count(row.quantity) || !count(row.physicalUnitCount) || !measure(row.weightKg) || !measure(row.volumeM3)) || stock.byBatch.some(row => !row.batchId || !objectId(recordId(row.cellId)) || !count(row.quantity) || !count(row.heldQuantity)) || stock.byPhysicalUnit.some(row => !objectId(recordId(row.physicalUnitId)) || !Array.isArray(row.cellIds) || row.cellIds.some(id => !objectId(recordId(id))))) throw Error('Vị trí hoặc lô hàng tự quản chưa được xác minh.');
  const seen = new Set();
  for (const row of movements) {
    if (!objectId(recordId(row)) || seen.has(recordId(row)) || row.schemaVersion !== 3 || recordId(row.itemId) !== itemId || recordId(row.facilityId) !== user.assignedFacilityId || recordId(row.managedReservationId) !== recordId(item.managedReservationId) || !['ADD','REMOVE','MOVE'].includes(row.v3Effect?.action) || !count(row.quantity) || !Number.isFinite(Date.parse(row.performedAt))) throw Error('Lịch sử tự quản không khớp mặt hàng hoặc cơ sở.');
    seen.add(recordId(row));
  }
  return {item, source, stock, movements, sessions: sessionResponse ? accessRows(sessionResponse, 'session', user) : []};
}
export function visibleInventoryMovements(data, user, now = Date.now()) {
  if (data.source !== 'self' || user.role !== 'FACILITY_STAFF') return data.movements;
  const ids = new Set(data.sessions.filter(row => recordId(row.reservationId) === recordId(data.item.managedReservationId) && sessionStatus(row, now) === 'ACTIVE').map(recordId));
  return data.movements.filter(row => ids.has(recordId(row.v3Effect.accessSessionId)));
}
