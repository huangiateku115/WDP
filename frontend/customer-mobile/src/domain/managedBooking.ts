import {endDay, periodSchema, validDay} from './booking';

export type Operation = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
export interface CellInterval {
  start: string;
  end: string;
  status: 'RESERVED' | 'OCCUPIED' | 'HOLD';
  isMine: boolean;
}
export interface ManagedCell {
  id: string;
  code: string;
  zoneId: string;
  rackId: string;
  level: number;
  number: number;
  width: number | null;
  depth: number | null;
  height: number | null;
  usableVolumeM3: number | null;
  maxWeightKg: number | null;
  operationalStatus: 'AVAILABLE' | 'MAINTENANCE' | 'BLOCKED' | 'UNKNOWN';
  physicalUsage: {volumeM3: number; weightKg: number} | null;
  periodStatus: 'AVAILABLE' | 'OCCUPIED' | 'UNKNOWN';
  intervals: CellInterval[];
}
export interface ManagedRack {
  id: string;
  code: string;
  zoneId: string;
  status: Operation;
  levels: number[];
  position: {x: number; y: number; width: number; height: number};
  cells: ManagedCell[];
}
export interface ManagedZone {
  id: string;
  name: string;
  status: Operation;
  racks: ManagedRack[];
}
export interface ManagedFacility {
  id: string;
  name: string;
  managedInventory: boolean;
  status: Operation;
  monthlyRatePerM3: number | null;
  zones: ManagedZone[];
}
export interface ManagedDraft {
  facilityId: string;
  cellIds: string[];
  start: string;
  months: number;
  previewed: boolean;
  previewFingerprint?: string;
}
export type CellStatus = 'AVAILABLE' | 'RESERVED' | 'RESERVED_YOURS' | 'OCCUPIED' | 'MAINTENANCE' | 'UNKNOWN';
export const cellLabels: Record<CellStatus, string> = {
  AVAILABLE: 'Còn trống', RESERVED: 'Đã giữ chỗ', RESERVED_YOURS: 'Đã giữ · Của bạn',
  OCCUPIED: 'Đang sử dụng', MAINTENANCE: 'Bảo trì', UNKNOWN: 'Chưa đủ điều kiện',
};
export function cellEntries(facility: ManagedFacility | undefined) {
  return facility?.zones.flatMap(zone => zone.racks.flatMap(rack => rack.cells.map(cell => ({zone, rack, cell})))) ?? [];
}
const positive = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
export function validCellGeometry(cell: ManagedCell) {
  return positive(cell.width) && positive(cell.depth) && positive(cell.height) && positive(cell.usableVolumeM3)
    && Math.abs(cell.width * cell.depth * cell.height - cell.usableVolumeM3) < 0.000000001
    && Number.isSafeInteger(Math.round(cell.usableVolumeM3 * 1e6))
    && Math.round(cell.usableVolumeM3 * 1e6) > 0
    && Math.abs(cell.usableVolumeM3 * 1e6 - Math.round(cell.usableVolumeM3 * 1e6)) < 0.000001
    && (cell.maxWeightKg === null || positive(cell.maxWeightKg));
}
export function cellEligibility(f: ManagedFacility, z: ManagedZone, r: ManagedRack, c: ManagedCell, start: string, months: number): {status: CellStatus; eligible: boolean; reason: string} {
  const result = (status: CellStatus, reason: string, eligible = false) => ({status, reason, eligible});
  const end = endDay(start, months);
  if (!periodSchema.safeParse({start, months}).success || !end) return result('UNKNOWN', 'Kỳ thuê không hợp lệ.');
  if (c.zoneId !== z.id || c.rackId !== r.id || r.zoneId !== z.id || !r.levels.includes(c.level)) return result('UNKNOWN', 'Cấu trúc ô không khớp Zone/Rack.');
  if (c.intervals.some(i => !validDay(i.start) || !validDay(i.end) || i.start >= i.end)) return result('UNKNOWN', 'Khoảng giữ chỗ mẫu không hợp lệ.');
  const matches = c.intervals.filter(i => start < i.end && end > i.start);
  // Period evidence precedes raw operational availability. Ownership grants no exception.
  if (c.periodStatus === 'OCCUPIED' || matches.some(i => i.status === 'OCCUPIED')) return result('OCCUPIED', 'Ô đang được sử dụng trong kỳ thuê mẫu.');
  if (matches.length) return result(matches.every(i => i.isMine) ? 'RESERVED_YOURS' : 'RESERVED', 'Ô có khoảng giữ chỗ trùng kỳ thuê mẫu; quyền sở hữu không cho phép đặt lại.');
  if (c.operationalStatus === 'MAINTENANCE') return result('MAINTENANCE', 'Ô đang bảo trì.');
  if (!f.managedInventory || f.status !== 'ACTIVE' || z.status !== 'ACTIVE' || r.status !== 'ACTIVE') return result('UNKNOWN', 'Cơ sở, Zone hoặc Rack chưa hoạt động.');
  if (c.operationalStatus !== 'AVAILABLE' || c.periodStatus !== 'AVAILABLE') return result('UNKNOWN', 'Trạng thái ô chưa xác nhận khả dụng cho kỳ thuê.');
  if (!validCellGeometry(c)) return result('UNKNOWN', 'Thiếu hoặc không nhất quán kích thước/thể tích hữu dụng.');
  const usage = c.physicalUsage;
  if (!usage || ![usage.volumeM3, usage.weightKg].every(n => Number.isFinite(n) && n >= 0)) return result('UNKNOWN', 'Chưa xác nhận dữ liệu sử dụng vật lý; không coi là bằng không.');
  if (usage.volumeM3 !== 0 || usage.weightKg !== 0) return result('UNKNOWN', 'Dữ liệu sử dụng vật lý xung đột với trạng thái trống.');
  return result('AVAILABLE', 'Đủ điều kiện theo fixture của kỳ thuê đã chọn.', true);
}
export function illustrativeMonthlyPrice(capacity: number | null, rate: number | null | undefined) {
  if (capacity === null || !positive(capacity) || typeof rate !== 'number' || !Number.isSafeInteger(rate) || rate <= 0) return null;
  const micros = Math.round(capacity * 1e6);
  const numerator = micros * rate;
  // No floating-point price rounding and no invented fractional-VND policy.
  return Number.isSafeInteger(micros) && Number.isSafeInteger(numerator) && numerator % 1e6 === 0 ? numerator / 1e6 : null;
}
export function assessManagedDraft(f: ManagedFacility | undefined, draft: ManagedDraft | null) {
  const entries = cellEntries(f);
  const selected = draft?.cellIds.map(id => entries.find(e => e.cell.id === id)) ?? [];
  const invalid = selected.flatMap((entry, i) => {
    if (!entry || !f || !draft) return [{id: draft?.cellIds[i] ?? '', reason: 'Không tìm thấy ô trong cơ sở mẫu.'}];
    const check = cellEligibility(f, entry.zone, entry.rack, entry.cell, draft.start, draft.months);
    return check.eligible ? [] : [{id: entry.cell.id, reason: check.reason}];
  });
  const cells = selected.flatMap(e => e ? [e] : []);
  const unique = new Set(draft?.cellIds).size === draft?.cellIds.length;
  const periodValid = !!draft && periodSchema.safeParse(draft).success && !!endDay(draft.start, draft.months);
  const valid = !!f && f.id === draft?.facilityId && f.status === 'ACTIVE' && f.managedInventory && periodValid && unique && cells.length > 0 && invalid.length === 0;
  const volumeKnown = cells.length === selected.length && cells.every(e => validCellGeometry(e.cell));
  const capacity = volumeKnown ? cells.reduce((sum, e) => sum + Math.round(e.cell.usableVolumeM3! * 1e6), 0) / 1e6 : null;
  const rate = f?.monthlyRatePerM3;
  const monthly = illustrativeMonthlyPrice(capacity, rate);
  const total = monthly !== null && draft ? monthly * draft.months : null;
  const quote = valid && monthly !== null && total !== null && Number.isSafeInteger(monthly) && monthly > 0 && Number.isSafeInteger(total)
    ? {monthlyPrice: monthly, months: draft!.months, total, deposit: monthly, remaining: total - monthly} : null;
  // Local review binding, not a security signature or backend concurrency token.
  const fingerprint = valid ? JSON.stringify({facilityId: f.id, facilityStatus: f.status, start: draft!.start, months: draft!.months, rate,
    selected: cells.map(e => ({zoneStatus: e.zone.status, rackStatus: e.rack.status, cell: e.cell}))}) : null;
  return {valid, invalid, cells, capacity, quote, periodValid, fingerprint};
}
