import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as warehouseMap from '../src/lib/warehouseMap.js';
import * as managedCellBooking from '../src/lib/managedCellBooking.js';

const require = createRequire(import.meta.url);
const cellId = 'a'.repeat(24);
const rack = { _id: 'b'.repeat(24), facilityId: 'c'.repeat(24), rackCode: 'R-01', zoneCode: 'Z-01', aisleCode: 'A-01' };
const cell = (overrides = {}) => ({
  _id: cellId, code: 'R01-L1-C1', cellNumber: 1, operationalStatus: 'AVAILABLE',
  periodStatus: 'AVAILABLE', isBookable: true, physicalUsageKnown: true,
  maxWeightKg: 100, usedWeightKg: 30, remainingWeightKg: 70,
  maxVolumeM3: 0.5, usedVolumeM3: 0.108, remainingVolumeM3: 0.392,
  dimensions: { widthM: 1, depthM: 0.5, usableHeightM: 1 }, ...overrides,
});
const detail = (cells = [cell()], overrides = {}) => ({
  rack: { ...rack, ...overrides.rack },
  levels: [{ levelNumber: 1, cells }, ...(overrides.levels || [])],
});

function compile() {
  const source = readFileSync(new URL('../src/components/customer/warehouse/CellInformation.jsx', import.meta.url), 'utf8');
  const code = transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
  const mocks = {
    '@/lib/warehouseMap': warehouseMap,
    '@/lib/managedCellBooking': managedCellBooking,
    '@/components/ui/button': { Button: ({ children, ...props }) => React.createElement('button', props, children) },
    'react-dom': { createPortal: (children) => children },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name in mocks ? { __esModule: true, ...mocks[name] } : require(name), module, module.exports);
  return module.exports;
}

const { default: WarehouseCells, CellInformation } = compile();
const renderCells = data => renderToStaticMarkup(React.createElement(WarehouseCells, { data, query: '', statusFilter: '', booking: { selection: [], period: { range: null }, locked: false, checking: false, toggle() {} } }));
const renderInformation = (item, level = { levelNumber: 1 }, itemRack = rack) => renderToStaticMarkup(React.createElement(CellInformation, { cell: item, level, rack: itemRack }));

test('Cell Information renders configured weight and volume capacity from the Backend DTO', () => {
  const html = renderInformation(cell());
  for (const value of ['Tải trọng tối đa', '100 kg', 'Tải trọng đang sử dụng', '30 kg', 'Tải trọng còn lại', '70 kg',
    'Thể tích tối đa', '0.5 m³', 'Thể tích đang sử dụng', '0.108 m³', 'Thể tích còn lại', '0.392 m³']) assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /undefined|NaN|Infinity/);
});

test('new empty Cell displays verified zero usage and Backend remaining capacity without inventing movement history', () => {
  const html = renderInformation(cell({ usedWeightKg: 0, remainingWeightKg: 100, usedVolumeM3: 0, remainingVolumeM3: 0.5 }));
  assert.match(html, /Tải trọng đang sử dụng[\s\S]*?<\/dt>\s*<dd>0 kg<\/dd>/);
  assert.match(html, /Tải trọng còn lại[\s\S]*?<\/dt>\s*<dd>100 kg<\/dd>/);
  assert.match(html, /Thể tích đang sử dụng[\s\S]*?<\/dt>\s*<dd>0 m³<\/dd>/);
  assert.match(html, /Thể tích còn lại[\s\S]*?<\/dt>\s*<dd>0.5 m³<\/dd>/);
  assert.doesNotMatch(html, /Chưa đối soát|UNKNOWN|undefined|NaN|Infinity/);
});

test('missing capacity and UNKNOWN usage stay explicit and do not become zero or reconciled', () => {
  const html = renderInformation(cell({ maxWeightKg: null, remainingWeightKg: null, maxVolumeM3: undefined, remainingVolumeM3: null,
    usedWeightKg: null, usedVolumeM3: undefined, physicalUsageKnown: false, isBookable: false, reconciliationStatus: 'UNKNOWN' }));
  assert.equal((html.match(/Chưa cấu hình/g) || []).length, 4);
  assert.equal((html.match(/Chưa xác định/g) || []).length, 2);
  assert.match(html, /Thông tin dung lượng hiện chưa được xác minh/);
  assert.doesNotMatch(html, /Đã đối soát|0 kg|0 m³|undefined|NaN|Infinity|UNKNOWN/);
});

test('booking eligibility capacity reasons are explained to Customers without exposing technical codes', () => {
  const html = renderInformation(cell({ physicalUsageKnown: true, isBookable: false, bookingReasonCode: 'CELL_WEIGHT_CAPACITY_NOT_CONFIGURED' }));
  assert.match(html, /chưa được cơ sở cấu hình tải trọng tối đa/);
  assert.doesNotMatch(html, /CELL_WEIGHT_CAPACITY_NOT_CONFIGURED|UNKNOWN|MISMATCH|RECONCILED/);
  const history = renderInformation(cell({ physicalUsageKnown: true, isBookable: false, bookingReasonCode: 'STOCK_RECONCILIATION_REQUIRED' }));
  assert.match(history, /kiểm tra lại lịch sử sử dụng ô này/);
  assert.doesNotMatch(history, /STOCK_RECONCILIATION_REQUIRED|UNKNOWN|MISMATCH|RECONCILED/);
});

test('redacted public-map capacity does not look unconfigured or expose physical counters', () => {
  const redactedCell = cell({ capacityDisclosure: 'REDACTED', bookingStatus: 'UNKNOWN', displayStatus: 'UNKNOWN', periodStatus: 'UNKNOWN',
    isBookable: false, bookingReasonCode: 'CELL_UNAVAILABLE', maxWeightKg: undefined, usedWeightKg: undefined, remainingWeightKg: undefined,
    maxVolumeM3: undefined, usedVolumeM3: undefined, remainingVolumeM3: undefined });
  const html = renderInformation(redactedCell);
  assert.match(html, /chỉ dành cho nhân viên cơ sở/);
  assert.doesNotMatch(html, /100 kg|30 kg|70 kg|0\.5 m³|0\.108 m³|0\.392 m³|Chưa cấu hình|MISMATCH|RECONCILED|CELL_UNAVAILABLE/);
  assert.doesNotMatch(html, /undefined|NaN|Infinity/);
  const cellCard = renderCells(detail([redactedCell]));
  assert.match(cellCard, /Thông số tải trọng được ẩn trên bản đồ khách hàng/);
  assert.doesNotMatch(cellCard, /Chưa cấu hình tải trọng|undefined|NaN|Infinity/);
});

test('WarehouseCells renders multiple racks and nested Cell rows with different booking states', () => {
  const first = renderCells(detail([cell()]));
  const second = renderCells(detail([cell({ _id: 'd'.repeat(24), cellNumber: 2, code: 'R02-L1-C2', periodStatus: 'RESERVED', isBookable: false })], { rack: { rackCode: 'R-02' } }));
  const html = first + second;
  assert.match(html, /R-01/);
  assert.match(html, /R-02/);
  assert.match(html, /R01-L1-C1/);
  assert.match(html, /R02-L1-C2/);
  assert.match(html, /Còn chỗ/);
  assert.match(html, /Đã được đặt/);
  assert.doesNotMatch(html, /undefined|NaN|Infinity/);
});

test('loading, empty, error/missing and malformed Cell data render a safe state', () => {
  assert.match(renderCells(undefined), /Chưa tải được thông tin kệ và ô lưu trữ/);
  assert.match(renderCells(detail([])), /No cells are configured for this rack/);
  const malformed = renderCells(detail([{ _id: null, cellNumber: NaN }, cell()]));
  assert.match(malformed, /Một phần thông tin ô chưa đầy đủ/);
  assert.match(malformed, /R01-L1-C1/);
  assert.doesNotMatch(malformed, /NaN|undefined|Infinity/);
});
