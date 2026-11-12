import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as review from '../src/lib/facilityReview.js';
import * as paper from '../src/lib/facilityPaperContract.js';
import * as managed from '../src/lib/managedPaperContract.js';
import { scopedManagedReservation } from '../src/lib/managedFacilityReview.js';
const require = createRequire(import.meta.url), { transformSync } = require('esbuild');
const reservationId = 'a'.repeat(24), facilityId = 'b'.repeat(24), customerId = 'c'.repeat(24), managerId = 'd'.repeat(24), contractId = 'e'.repeat(24), cellId = 'f'.repeat(24);
const response = data => ({ data: { success: true, data } });
function fixture() {
  const now = Date.now();
  const reservation = { _id: reservationId, facilityId, customerId, bookingFlowVersion: 3, serviceType: 'MANAGED_INVENTORY', rentalPaymentFlow: 'FULL_UPFRONT_V1', status: 'PAID', allocatedCellIds: [cellId], startDate: new Date(now - 3600000).toISOString(), endDate: new Date(now + 86400000).toISOString(), signingDeadline: new Date(now + 3600000).toISOString() };
  const document = { version: 2, contentHash: 'a'.repeat(64), createdAt: new Date(now - 3600000).toISOString(), content: { schemaVersion: 3, reservation: { id: reservationId, facilityId, serviceType: 'MANAGED_INVENTORY', cellIds: [cellId] } } };
  const contract = { _id: contractId, customerId, reservationId, status: 'DRAFT', currentContentVersion: 2, contentVersions: [document], signatures: [] };
  return { reservation, contract };
}
function signed(data) {
  data.reservation.status = 'CHECKIN_READY';
  Object.assign(data.contract, { status: 'SIGNED', verifiedAt: new Date().toISOString(), signedProofUrl: 'https://example.invalid/proof', signedProofPublicId: 'signed/proof', signatures: ['CUSTOMER', 'FACILITY_MANAGER'].map(signerRole => ({ signerRole, version: 2, contentHash: 'a'.repeat(64) })) });
  return data;
}
test('managed contract verifies owner, facility, service and document scope', () => {
  const data = fixture(); assert.equal(managed.managedContract(response(data.contract), data.reservation), data.contract);
  for (const change of [{ customerId: managerId }, { reservationId: facilityId }, { currentContentVersion: 99 }]) assert.throws(() => managed.managedContract(response({ ...data.contract, ...change }), data.reservation));
  data.contract.contentVersions[0].content.reservation.facilityId = customerId;
  assert.throws(() => managed.managedContract(response(data.contract), data.reservation));
});
test('managed handover requires current two-party proof, allocation, dates and explicit identity', () => {
  const data = signed(fixture()), input = { condition: 'GOOD', notes: '  Đã đối chiếu ô  ', identityVerified: true };
  assert.deepEqual(managed.managedHandoverPayload(data, input), { storageCondition: 'GOOD', accessNotes: 'Đã đối chiếu ô' });
  assert.throws(() => managed.managedHandoverPayload(data, { ...input, identityVerified: false }));
  assert.throws(() => managed.managedHandoverPayload(data, { ...input, condition: 'UNSAFE' }));
  assert.throws(() => managed.managedHandoverPayload(data, { ...input, notes: ' ' }));
  data.contract.signatures[0].contentHash = 'b'.repeat(64); assert.equal(managed.managedHandoverReady(data), false);
  data.contract.signatures[0].contentHash = 'a'.repeat(64); data.reservation.allocatedCellIds = []; assert.equal(managed.managedHandoverReady(data), false);
});

function harness(data, { role = 'FACILITY_MANAGER', failPaper = false } = {}) {
  const slots = []; let cursor = 0; const calls = []; const hooks = {
    useCallback: fn => fn,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
  };
  const session = { accessToken: 'test-session', user: { id: managerId, role, assignedFacilityId: facilityId } };
  const mocks = {
    react: { ...require('react'), ...hooks },
    '@/lib/authSession': { getAccessToken: () => session.accessToken, useAuthSession: () => session },
    '@/lib/facilityReview': review,
    '@/lib/managedFacilityReview': { scopedManagedReservation },
    '@/lib/facilityPaperContract': paper, '@/lib/managedPaperContract': managed,
    '@/lib/useFacilityResource': { default: () => ({ data, loading: false, error: '', reload() {} }), announceReviewChange() {} },
    '@/api/managedReservationApi': { default: { detail: async () => response(data.reservation) } },
    '@/api/facilityHandoverApi': { default: { contract: async () => response(data.contract), confirmPaper: async (...args) => { calls.push({ kind: 'paper', args }); if (failPaper) throw Error('Mất kết nối sau khi gửi'); signed(data); } } },
    '@/api/axiosClient': { default: { post: async (url, body) => { calls.push({ kind: 'handover', url, body }); Object.assign(data.reservation, { status: 'ACTIVE', handoverAt: new Date().toISOString(), handoverByStaffId: managerId, storageCondition: body.storageCondition, handoverAccessNotes: body.accessNotes }); return response(data.reservation); } } },
    '@/components/manager/ManagerUI': Object.fromEntries(['Panel', 'Details', 'Status', 'Message', 'Button', 'Field', 'Input', 'Textarea', 'Select', 'Dialog', 'OpenLink'].map(name => [name, name])),
  };
  mocks['@/components/manager/ManagerUI'].money = String;
  const code = transformSync(readFileSync(new URL('../src/components/manager/ManagedPaperLifecyclePanel.jsx', import.meta.url), 'utf8'), { loader: 'jsx', jsx: 'automatic', format: 'cjs' }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name in mocks ? { __esModule: true, ...mocks[name] } : require(name), module, module.exports);
  const render = () => { cursor = 0; const wrapper = module.exports.default({ reservation: data.reservation }); return wrapper.type(wrapper.props); };
  function nodes(value, predicate) { if (Array.isArray(value)) return value.flatMap(child => nodes(child, predicate)); if (!value || typeof value !== 'object') return []; return [...(predicate(value) ? [value] : []), ...nodes(value.props?.children, predicate)]; }
  const find = predicate => nodes(render(), predicate)[0];
  const change = (label, value) => find(node => node.type === 'Input' && node.props['aria-label'] === label).props.onChange({ target: { value } });
  const button = text => find(node => node.type === 'Button' && node.props.children === text);
  return { calls, render, find, button, change, async submit() { await find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); } };
}

test('Managed paper form sends timestamps/version and waits for verified CHECKIN_READY', async () => {
  const data = fixture(), ui = harness(data);
  ui.find(node => node.type === 'Input' && node.props.type === 'file').props.onChange({ target: { files: [{ type: 'application/pdf', size: 100 }] } });
  const time = new Date(Date.now() - 10000).toISOString();
  ui.change('Thời điểm khách hàng ký', time); ui.change('Thời điểm đại diện cơ sở ký', time);
  ui.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  assert.equal(ui.button('Kiểm tra và xác minh hợp đồng giấy').props.disabled, false);
  ui.button('Kiểm tra và xác minh hợp đồng giấy').props.onClick(); await ui.submit();
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].kind, 'paper');
  assert.equal(ui.calls[0].args[3].documentVersion, 2); assert.equal(ui.calls[0].args[3].customerIdentityVerified, true);
  assert.equal(data.reservation.status, 'CHECKIN_READY');
});
test('Managed full-upfront handover works without legacy balanceSettledAt', async () => {
  const data = signed(fixture()), ui = harness(data);
  ui.find(node => node.type === 'Textarea').props.onChange({ target: { value: 'Khách đã nhận đúng các ô thuê.' } });
  ui.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  assert.equal(ui.button('Kiểm tra và bàn giao không gian').props.disabled, false);
  ui.button('Kiểm tra và bàn giao không gian').props.onClick(); await ui.submit();
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].url, `/reservations/managed/${reservationId}/handover`);
  assert.deepEqual(ui.calls[0].body, { storageCondition: 'GOOD', accessNotes: 'Khách đã nhận đúng các ô thuê.' });
  assert.equal(data.reservation.status, 'ACTIVE');
});
test('uncertain upload cannot be submitted twice without reloading and reconciling', async () => {
  const data = fixture(), ui = harness(data, { failPaper: true });
  ui.find(node => node.type === 'Input' && node.props.type === 'file').props.onChange({ target: { files: [{ type: 'image/png', size: 100 }] } });
  const time = new Date(Date.now() - 10000).toISOString();ui.change('Thời điểm khách hàng ký', time);ui.change('Thời điểm đại diện cơ sở ký', time);
  ui.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  ui.button('Kiểm tra và xác minh hợp đồng giấy').props.onClick(); await ui.submit(); await ui.submit(); assert.equal(ui.calls.length, 1);
});
test('Staff sees missing read permission instead of an unusable full-upfront form', () => {
  const ui = harness(fixture(), { role: 'FACILITY_STAFF' });
  assert.equal(ui.button('Kiểm tra và xác minh hợp đồng giấy'), undefined);
  assert.match(ui.render().props.children.props.children, /Quyền nhân viên đọc đơn hàng hóa cần được backend bổ sung/);
});
