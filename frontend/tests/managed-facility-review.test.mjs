import test from 'node:test';
import assert from 'node:assert/strict';
import { managedItemPage, managedReadiness, scopedManagedReservation, scopedTopology, positiveNumber } from '../src/lib/managedFacilityReview.js';
import { facilityPageVisible } from '../src/lib/facilityWorkspace.js';
import { assertConfirmedRequest } from '../src/api/confirmedContract.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';

const facility = 'a'.repeat(24), other = 'b'.repeat(24), reservation = 'c'.repeat(24), item = 'd'.repeat(24);
const response = data => ({ data: { success: true, data } });
const row = { _id: item, facilityId: facility, managedReservationId: reservation };
const page = rows => ({ data: { success: true, data: rows, pagination: { page: 1, total: rows.length, totalPages: rows.length ? 1 : 0 } } });

test('supervision accepts scoped inventory and empty pages', () => {
  assert.equal(managedItemPage(page([row]), facility, 1).rows[0].id, item);
  assert.deepEqual(managedItemPage(page([]), facility, 1).rows, []);
});
test('supervision rejects foreign facility, duplicate items and stale pagination', () => {
  assert.throws(() => managedItemPage(page([{ ...row, facilityId: other }]), facility, 1));
  assert.throws(() => managedItemPage(page([row, row]), facility, 1));
  assert.throws(() => managedItemPage(page([row]), facility, 2));
  assert.throws(() => managedItemPage(page([{ ...row, managedReservationId: null }]), facility, 1));
});
test('readiness requires scoped managed reservation and authoritative readonly report', () => {
  const record = { _id: reservation, facilityId: facility, serviceType: 'MANAGED_INVENTORY' };
  assert.equal(scopedManagedReservation(response(record), reservation, facility), record);
  assert.throws(() => scopedManagedReservation(response(record), reservation, other));
  const report = { reservationId: reservation, serviceType: 'MANAGED_INVENTORY', readonly: true, overallReadiness: 'UNKNOWN', blockers: [] };
  assert.equal(managedReadiness(response(report), reservation).overallReadiness, 'UNKNOWN');
  for (const invalid of [{ readonly: false }, { reservationId: other }, { overallReadiness: 'ACTIVE' }, { blockers: null }]) {
    assert.throws(() => managedReadiness(response({ ...report, ...invalid }), reservation));
  }
});
test('topology verification rejects foreign facility and wrong record before success', () => {
  assert.equal(scopedTopology(response(row), facility, item), row);
  assert.throws(() => scopedTopology(response(row), other, item));
  assert.throws(() => scopedTopology(response(row), facility, other));
});
test('geometry inputs reject blank, zero, negative, nonfinite and fractional counts', () => {
  for (const value of ['', ' ', 'NaN', 'Infinity', '-1', '0']) assert.throws(() => positiveNumber(value, 'Kích thước'));
  assert.throws(() => positiveNumber('1.5', 'Số tầng', true));
  assert.equal(positiveNumber('0.5', 'Chiều sâu'), 0.5);
  assert.equal(positiveNumber('4', 'Số tầng', true), 4);
});
test('both facility roles keep readonly inventory while legacy staff mutations are unavailable', () => {
  for (const role of ['staff', 'manager']) {
    for (const path of ['managed', 'inventory/stock', 'inventory/history', `inventory/items/${item}/history`]) assert.equal(facilityPageVisible(role, path), true);
  }
  for (const path of ['inventory/inbound', 'inventory/outbound', 'inventory/relocation']) assert.equal(facilityPageVisible('staff', path), false);
  assert.equal(facilityPageVisible('staff', 'warehouse-settings'), false);
  assert.equal(facilityPageVisible('manager', 'warehouse-settings'), true);
});
test('only confirmed readiness API is allowed; proposed visits/return APIs remain unavailable', () => {
  assert.doesNotThrow(() => assertConfirmedRequest({ method: 'get', url: `/reservations/managed/${reservation}/closure-readiness` }));
  for (const path of ['/managed/visits', `/managed/${reservation}/verify-space-return`]) {
    assert.throws(() => assertConfirmedRequest({ method: 'post', url: path }));
  }
});

function renderPage(file, role, tab = 'inventory', state = {}) {
  const require = createRequire(import.meta.url);
  const simple = tag => props => React.createElement(tag, null, props.title, props.children);
  const ui = Object.fromEntries(['Screen', 'Panel', 'Field', 'Message', 'Details', 'Status', 'Dialog'].map(key => [key, simple('section')]));
  Object.assign(ui, {
    Button: props => React.createElement('button', { disabled: props.disabled }, props.children),
    Input: () => React.createElement('input'), Select: () => React.createElement('select'),
    OpenLink: props => React.createElement('a', { href: props.to }, props.children),
    Table: props => React.createElement('div', null, ...(props.rows || []).flatMap(row => props.columns.map(column => React.createElement('div', { key: `${row.id}:${column.key}` }, column.render ? column.render(row) : row[column.key])))),
  });
  const mocks = {
    '@/api/facilityManagedApi': { default: {} }, '@/api/managedReservationApi': { default: {} },
    '@/lib/authSession': { useAuthSession: () => ({ user: { role, assignedFacilityId: facility }, accessToken: 'test-session' }), getAccessToken: () => 'test-session' },
    '@/lib/useFacilityResource': { default: () => ({ data: null, loading: false, error: '', reload() {}, ...state }), announceReviewChange() {} },
    '@/lib/facilityReview': { objectId: value => /^[a-f\d]{24}$/.test(value || ''), recordId: value => typeof value === 'object' ? value?._id || value?.id : value },
    '@/lib/managedFacilityReview': { managedItemPage, managedReadiness, scopedManagedReservation, scopedTopology, positiveNumber },
    '@/components/manager/ManagerUI': ui,
    '@/components/staff/QueuePagination': { default: simple('nav') },
    'react-router-dom': { useSearchParams: () => [new URLSearchParams({ tab }), () => {}] },
  };
  const code = transformSync(readFileSync(new URL(`../src/pages/${file}.jsx`, import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name in mocks ? { __esModule: true, ...mocks[name] } : require(name), module, module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default));
}

test('both roles render role-correct stock/history links without stock write actions', () => {
  for (const [role, base] of [['FACILITY_STAFF', 'staff'], ['FACILITY_MANAGER', 'manager']]) {
    const html = renderPage('staff/ManagedFacilityPage', role, 'inventory', { data: { rows: [{ ...row, id: item, itemCode: 'TEST-ITEM', name: 'Thùng thử nghiệm', customerId: other, status: 'IN_STORAGE' }], pagination: { page: 1, total: 1, totalPages: 1 } } });
    assert.ok(html.includes(`/${base}/inventory/stock?itemId=${item}`));
    assert.ok(html.includes(`/${base}/inventory/items/${item}/history`));
    assert.ok(html.includes('Thùng thử nghiệm'));
    assert.doesNotMatch(html, /Xác nhận nhập|Xác nhận xuất|Ghi biến động/);
  }
});

test('unavailable visits and return actions are explained without invented confirmation buttons', () => {
  const visits = renderPage('staff/ManagedFacilityPage', 'FACILITY_STAFF', 'visits');
  assert.match(visits, /chưa khả dụng/);
  assert.doesNotMatch(visits, /<button[^>]*>Xác nhận/);
  const checkout = renderPage('staff/ManagedFacilityPage', 'FACILITY_STAFF', 'checkout');
  assert.match(checkout, /cần chờ chức năng xác nhận/);
  assert.doesNotMatch(checkout, /Kiểm tra điều kiện<\/button>/);
});

test('topology configuration rejects staff and renders manager loading and error states', () => {
  assert.match(renderPage('manager/WarehouseSettingsPage', 'FACILITY_STAFF'), /Không có quyền/);
  const html = renderPage('manager/WarehouseSettingsPage', 'FACILITY_MANAGER', 'inventory', { loading: true });
  assert.match(html, /Đang tải cấu trúc kho/);
  assert.doesNotMatch(html, />Tạo kệ<|>Tạo khu vực</);
});
