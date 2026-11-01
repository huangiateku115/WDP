import type {Fixtures, InventoryItem, Stock} from './models';
import {verifiedFixtureStock} from './models';

export type Illustration = 'box' | 'stack' | 'label';
export interface Measurements {widthM: number | null; depthM: number | null; heightM: number | null; weightKg: number | null;}
export interface StockBatch {
  reference: string | null;
  quantity: number | null;
  unit: string | null;
  receipt: string | null;
  cell: string | null;
  measurements: Measurements | null;
}
export interface InventoryDetail {
  itemId: string;
  ownerId: string;
  description: string;
  rentalId: string | null;
  images: Illustration[];
  preferredCell: string | null;
  declaredMeasurements: Measurements | null;
  stockState: 'KNOWN' | 'MISSING' | 'INCONSISTENT';
  stockUnit: string | null;
  batches: StockBatch[];
  editable: boolean;
  editReason: string;
}
export interface InventoryRental {
  id: string;
  ownerId: string;
  code: string;
  name: string;
  stage: 'DEPOSIT_PAID' | 'ACTIVE' | 'AWAITING_DEPOSIT' | 'CLOSED';
  canRegister: boolean;
  reason: string;
  preferredCells: string[];
}
export interface InventoryMovement {
  id: string;
  itemId: string;
  ownerId: string;
  type: string | null;
  occurredAt: string | null;
  quantity: number | null;
  unit: string | null;
  sourceCell: string | null;
  destinationCell: string | null;
  schemaVersion?: number | null;
  arithmeticPolicy?: string | null;
  batchLines?: StockBatch[] | null;
  evidence?: string | null;
  staffProcessed?: boolean;
  note?: string | null;
}
export function ownItem(data: Fixtures, id: string | undefined, details: InventoryDetail[]) {
  if (!data.customer || typeof id !== 'string') return null;
  const item = data.items.find(i => i.id === id);
  const detail = details.find(d => d.itemId === id && d.ownerId === data.customer!.id);
  return item && detail ? {item, detail} : null;
}
export function canonicalStock(item: InventoryItem, detail: InventoryDetail): {state: 'KNOWN' | 'MISSING' | 'INCONSISTENT'; balance: Stock | null} {
  if (detail.stockState !== 'KNOWN') return {state: detail.stockState, balance: null};
  const balance = verifiedFixtureStock(item.stock);
  if (!balance || detail.stockUnit !== item.unit) return {state: 'INCONSISTENT', balance: null};
  return {state: 'KNOWN', balance};
}
export function canEditItem(item: InventoryItem, detail: InventoryDetail) {
  return item.status === 'REGISTERED' && detail.editable;
}
export function validMeasurement(n: number | null | undefined) {return typeof n === 'number' && Number.isFinite(n) && n > 0;}
export function measurementText(m: Measurements | null) {
  if (!m) return 'Chưa có số đo';
  const dimensions = [m.widthM, m.depthM, m.heightM].every(validMeasurement)
    ? `${m.widthM} × ${m.depthM} × ${m.heightM} m` : 'Kích thước chưa đầy đủ hoặc không hợp lệ';
  return dimensions + (validMeasurement(m.weightKg) ? ` · ${m.weightKg} kg / đơn vị` : ' · Chưa có khối lượng hợp lệ');
}
export function quantityText(n: number | null, unit: string | null) {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && !!unit ? n.toLocaleString('vi-VN') + ' ' + unit : 'Chưa có số lượng/đơn vị hợp lệ';
}
export const movementLabel = (type: string | null) => type === 'INBOUND' ? 'Nhập kho' : type === 'OUTBOUND' ? 'Xuất kho' : type === 'RELOCATION' ? 'Điều chuyển ô' : 'Loại di chuyển chưa xác định';
export function movementTime(value: string | null) {
  if (!value || Number.isNaN(new Date(value).valueOf())) return 'Chưa có thời điểm hợp lệ';
  return new Intl.DateTimeFormat('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(value));
}
export function sortedMovements(rows: InventoryMovement[], itemId: string, ownerId: string) {
  const stamp = (s: string | null) => s && !Number.isNaN(new Date(s).valueOf()) ? new Date(s).valueOf() : -Infinity;
  return rows.filter(r => r.itemId === itemId && r.ownerId === ownerId).map((row, index) => ({row, index}))
    .sort((a, b) => stamp(b.row.occurredAt) - stamp(a.row.occurredAt) || a.index - b.index).map(e => e.row);
}
