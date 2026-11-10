import {facilityLabel} from '../src/lib/facilityLabels.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import { receiptOperation, validateReceiptOperation } from '../src/lib/receiptOperation.js';
import { inventoryQueuePage } from '../src/lib/inventoryQueuePage.js';
import { receivingCellReason } from '../src/lib/receivingCellEligibility.js';

const require = createRequire(import.meta.url);
const uid = '1'.repeat(24), fid = '2'.repeat(24), cellId = '3'.repeat(24);
const a = 'a'.repeat(24), b = 'b'.repeat(24);
const response = data => ({ data: { success: true, data } });
const detail = (id, quantity = 2) => ({
  request: { _id: id, itemId: id, facilityId: fid, state: 'PENDING_INSPECTION', version: 0, requestedQuantity: quantity,
    quantityUnit: 'BOX', declaredUnitWeightKg: 2, declaredUnitDimensionsM: { widthM: 0.2, depthM: 0.2, heightM: 0.2 } },
  item: { _id: id, itemCode: id, name: `Item ${id}`, status: 'IN_STORAGE', currentCellId: cellId },
  cells: [{ _id: cellId, code: 'CELL', operationalStatus: 'AVAILABLE', maxWeightKg: 200, usedWeightKg: 4, usedVolumeM3: 0.016,
    dimensions: { widthM: 1, depthM: 1, usableHeightM: 1 } }], inspections: [],
});

function harness(page, api, storage = new Map()) {
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  };
  let cursor = 0, tree, params = new URLSearchParams();
  const values = [], effects = [], pending = [];
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return values[i] ??= { current: initial }; },
    useCallback(fn, deps) {
      const i = cursor++, old = values[i];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) values[i] = { fn, deps };
      return values[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++, old = effects[i];
      if (!old || deps.some((value, index) => !Object.is(value, old.deps[index]))) {
        effects[i] = { deps, cleanup: old?.cleanup };
        pending.push(() => { effects[i].cleanup?.(); effects[i].cleanup = fn(); });
      }
    },
  };
  const session = { accessToken: 'staff-token', user: { id: uid, role: 'FACILITY_STAFF', assignedFacilityId: fid } };
  const mocks = {
    '@/lib/facilityLabels': {facilityLabel},
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-router-dom': { useSearchParams: () => [params, value => { params = new URLSearchParams(value); }] },
    '@/api/inventoryApi': { inventoryApi: api },
    '@/lib/authSession': { useAuthSession: () => session, getAccessToken: () => session.accessToken },
    '@/lib/receiptOperation': { receiptOperation, validateReceiptOperation },
    '@/lib/inventoryQueuePage': { inventoryQueuePage },
    '@/lib/receivingCellEligibility': { receivingCellReason },
    '@/components/staff/QueuePagination': { default: 'pagination' },
    '@/components/staff/ReceivingEvidencePicker': { default: 'evidence-picker' },
  };
  const source = readFileSync(new URL(`../src/pages/staff/${page}.jsx`, import.meta.url), 'utf8');
  const code = transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => name in mocks ? { __esModule: true, ...mocks[name] } : require(name), module, module.exports);
  function render() { cursor = 0; tree = module.exports.default(); return tree; }
  const nodes = (node, result = []) => {
    if (Array.isArray(node)) node.forEach(value => nodes(value, result));
    else if (node && typeof node === 'object') { result.push(node); nodes(node.props?.children, result); }
    return result;
  };
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
  return {
    render, text: () => text(render()), storage,
    button(label) { return nodes(render()).find(node => node.type === 'button' && text(node).includes(label)); },
    input(label, type = 'input') {
      const parent = nodes(render()).find(node => node.type === 'label' && text(node).startsWith(label));
      return nodes(parent).find(node => node.type === type);
    },
    async flush() {
      for (let i = 0; i < 8; i++) { render(); pending.splice(0).forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)); }
      render();
    },
    close() { effects.forEach(effect => effect?.cleanup?.()); globalThis.sessionStorage = previous; },
  };
}

const queue = rows => async () => response({ data: rows, pagination: { page: 1, limit: 20, total: rows.length, totalPages: rows.length ? 1 : 0 } });

test('receipt operation keeps a copied payload, original version and request binding', () => {
  const payload = { inspectionKey: 'original-key', receivedQuantity: 2 };
  const saved = receiptOperation('inspection', detail(a).request, payload);
  payload.receivedQuantity = 99;
  assert.equal(saved.payload.receivedQuantity, 2);
  assert.equal(saved.version, 0);
  assert.throws(() => validateReceiptOperation(saved, b));
});

test('receipt retry stays bound to its request and changing request clears form and payload', async () => {
  const requests = [detail(a).request, detail(b, 7).request], posts = [];
  const h = harness('RepeatedInboundQueuePage', {
    repeatedInboundQueue: queue(requests),
    repeatedInboundReceivingDetail: async id => response(detail(id, id === a ? 2 : 7)),
    inspectRepeatedInbound: async (...args) => { posts.push(args); throw { response: { status: 503, data: { message: 'Temporary failure' } } }; },
  });
  try {
    await h.flush(); h.button('2 Thùng').props.onClick(); await h.flush();
    h.input("Nhận xét kiểm tra", 'textarea').props.onChange({ target: { value: 'Request A note' } });
    await h.button("Lưu lần kiểm tra").props.onClick(); await h.flush();
    await h.button("Thử lại thao tác đã lưu kiểm tra").props.onClick(); await h.flush();
    assert.deepEqual(posts[1], posts[0]);
    h.button('7 Thùng').props.onClick(); await h.flush();
    assert.equal(h.input("Nhận xét kiểm tra", 'textarea').props.value, '');
    assert.equal(h.button("Thử lại thao tác đã lưu kiểm tra"), undefined);
    await h.button("Lưu lần kiểm tra").props.onClick();
    assert.equal(posts[2][0], b);
    assert.equal(posts[2][1].receivedQuantity, 7);
    assert.notEqual(posts[2][1].inspectionKey, posts[0][1].inspectionKey);
  } finally { h.close(); }
});

test('outbound retries the original confirmation after GET shows committed state and zero holds', async () => {
  const value = detail(a, 3);
  Object.assign(value.request, { state: 'PARTIALLY_FULFILLED', heldQuantity: 0, confirmedQuantity: 2 });
  value.stock = { currentQty: 2, heldQty: 0, availableQty: 2 };
  const payload = { actualDeliveredQty: 2, handoverConfirmed: true, handoverNote: 'Original delivery' };
  const storage = new Map([[`wdp:mi06:outbound:confirm:${uid}:${a}`, JSON.stringify({ key: 'original-key', payload, version: 0 })]]);
  const posts = [];
  const h = harness('CanonicalOutboundQueuePage', {
    canonicalOutboundStaffQueue: queue([value.request]), canonicalOutboundStaffDetail: async () => response(value),
    confirmCanonicalOutbound: async (...args) => { posts.push(args); return response(value.request); },
    stockBalance: async () => response({}), get: async () => response({}), movements: async () => response([]),
  }, storage);
  try {
    await h.flush(); await h.button('3 Thùng').props.onClick(); await h.flush();
    const retry = h.button("Thử lại cùng xác nhận");
    assert(retry);
    await Promise.all([retry.props.onClick(), retry.props.onClick()]);
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0], [a, payload, 0, 'original-key']);
  } finally { h.close(); }
});

test('outbound ignores an older detail response after another request was selected', async () => {
  const values = [detail(a, 3), detail(b, 7)];
  values.forEach(value => Object.assign(value.request, { state: 'PENDING', heldQuantity: value.request.requestedQuantity }));
  const resolve = {};
  const h = harness('CanonicalOutboundQueuePage', {
    canonicalOutboundStaffQueue: queue(values.map(value => value.request)),
    canonicalOutboundStaffDetail: id => new Promise(done => { resolve[id] = done; }),
  });
  try {
    await h.flush(); const first = h.button('3 Thùng').props.onClick(); const second = h.button('7 Thùng').props.onClick();
    resolve[b](response(values[1])); await second; resolve[a](response(values[0])); await first; await h.flush();
    assert(h.text().includes(`Item ${b}`));
    assert(!h.text().includes(`Item ${a}`));
  } finally { h.close(); }
});
