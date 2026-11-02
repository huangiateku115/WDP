import type {ManagedCell, ManagedFacility, ManagedRack} from '../domain/managedBooking';

function rack(facility: string, zoneId: string, code: string, levels: number[], columns: number, x: number, y: number): ManagedRack {
  const id = `${facility}-${code}`;
  const cells: ManagedCell[] = levels.flatMap(level => Array.from({length: columns}, (_, index) => {
    const number = index + 1;
    const width = number % 2 ? 0.6 : 0.8;
    const depth = 0.5;
    const height = level % 2 ? 0.4 : 0.6;
    return {
      id: `${id}-L${level}-C${number}`, code: `${code}-L${level}-C${number}`, zoneId, rackId: id, level, number,
      width, depth, height, usableVolumeM3: Math.round(width * depth * height * 1e6) / 1e6,
      maxWeightKg: level > 3 ? null : 60,
      operationalStatus: 'AVAILABLE', physicalUsage: {volumeM3: 0, weightKg: 0}, periodStatus: 'AVAILABLE', intervals: [],
    };
  }));
  return {id, code, zoneId, status: 'ACTIVE', levels, position: {x, y, width: 160, height: 120}, cells};
}
function warehouse(id: string, name: string, monthlyRatePerM3: number): ManagedFacility {
  const a = `${id}-zone-a`, b = `${id}-zone-b`, c = `${id}-zone-c`;
  const a1 = rack(id, a, 'A01', [1, 2, 3, 4], 2, 30, 55);
  const a2 = rack(id, a, 'A02', [1, 2], 3, 260, 55);
  const b1 = rack(id, b, 'B01', [1, 2, 3, 4, 5], 2, 30, 55);
  const b2 = rack(id, b, 'B02', [1, 2, 3], 2, 260, 55);
  const c1 = rack(id, c, 'C01', [1], 2, 30, 55);
  // Mixed, explicit evidence. Choosing a Cell never mutates these counters/intervals.
  a1.cells[2]!.intervals = [{start: '2026-11-01', end: '2027-02-01', status: 'RESERVED', isMine: true}];
  a1.cells[3]!.intervals = [{start: '2026-11-01', end: '2027-02-01', status: 'HOLD', isMine: false}];
  a1.cells[4]!.periodStatus = 'OCCUPIED';
  a1.cells[4]!.physicalUsage = {volumeM3: 0.008, weightKg: 2};
  a1.cells[5]!.operationalStatus = 'MAINTENANCE';
  a1.cells[6]!.physicalUsage = null;
  a1.cells[7]!.width = null;
  a2.cells[2]!.periodStatus = 'UNKNOWN';
  a2.cells[3]!.operationalStatus = 'BLOCKED';
  a2.cells[4]!.physicalUsage = {volumeM3: 0.01, weightKg: 1};
  b1.cells[4]!.periodStatus = 'OCCUPIED';
  b1.cells[4]!.physicalUsage = {volumeM3: 0.02, weightKg: 3};
  b2.status = 'INACTIVE';
  return {
    id, name, managedInventory: true, status: 'ACTIVE', monthlyRatePerM3,
    zones: [
      {id: a, name: 'Khu A · Hàng đóng gói', status: 'ACTIVE', racks: [a1, a2]},
      {id: b, name: 'Khu B · Hàng tiêu dùng', status: 'ACTIVE', racks: [b1, b2]},
      {id: c, name: 'Khu C · Tạm ngừng', status: 'INACTIVE', racks: [c1]},
      {id: `${id}-empty`, name: 'Khu D · Chưa bố trí', status: 'ACTIVE', racks: []},
    ],
  };
}
// Fictional fixtures only. Per-m³/month pricing is an illustrative calculation,
// not a backend policy. No shared access codes or physical placement operations.
export const managedWarehouses: ManagedFacility[] = [
  warehouse('east-metro', 'VaultSpace Đông Sài Gòn', 400000),
  warehouse('saigon-south', 'VaultSpace Nam Sài Gòn', 500000),
];
export const findManagedWarehouse = (id: string | undefined) => managedWarehouses.find(f => f.id === id);
