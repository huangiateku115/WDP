import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { eligiblePayosPurpose } from '../src/lib/selfStoragePayos.js';

const require = createRequire(import.meta.url);
const reservationId = '507f1f77bcf86cd799439011';
const customerId = '507f1f77bcf86cd799439012';
const contractId = '507f1f77bcf86cd799439013';
const facilityId = '507f1f77bcf86cd799439014';
const unitId = '507f1f77bcf86cd799439015';
const reservation = {
  _id: reservationId, customerId, serviceType: 'SELF_STORAGE', status: 'CONTRACTED',
  reservationCode: 'BKG-TEST-01', facilityId, storageUnitId: unitId,
  startDate: '2026-12-01T00:00:00.000Z', endDate: '2027-01-01T00:00:00.000Z',
  expiresAt: new Date(Date.now() + 60_000).toISOString(), estimatedRent: 3000000,
  depositAmount: 1000000, taxAmount: 0, discountAmount: 0,
};
const draftContract = { _id: contractId, reservationId, customerId, status: 'DRAFT' };
const element = (type, props = {}, children = props.children) => React.createElement(type, props, children);
const box = ({ children, ...props }) => element('div', props, children);
const button = ({ children, asChild, ...props }) => element('button', props, children);
const message = ({ error, success, children }) => (error || success || children) ? element('p', { role: error ? 'alert' : 'status' }, error || success || children) : null;
const details = ({ values = [] }) => React.createElement('dl', null, values.map(([label, value]) => React.createElement('div', { key: label }, React.createElement('dt', null, label), React.createElement('dd', null, value))));
const screen = ({ title, children }) => React.createElement('main', null, React.createElement('h1', null, title), children);
const summary = ({ item }) => element('section', { 'data-testid': 'reservation-summary' }, item.reservationCode || item._id);
const record = response => {
  const value = response?.data?.data;
  if (!value || typeof value !== 'object') throw Error('Invalid fixture response');
  return value;
};
const recordId = value => typeof value === 'string' ? value : value?._id || value?.id;
const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

function compile(relativePath, mocks) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const code = transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return { __esModule: true, ...mocks[name] };
    return require(name);
  }, module, module.exports);
  return module.exports;
}

function lifecycleModule({ routeResource, contractResponse } = {}) {
  const calls = { byReservation: [], detail: 0 };
  let checkoutProps = null;
  const SelfStoragePayosCheckout = props => { checkoutProps = props; return element('div', { 'data-testid': 'payos-checkout' }, props.initialReservation?._id); };
  const mocks = {
    './CustomerResourceState': { default: ({ resource }) => resource.loading ? element('p', { role: 'status' }, 'Loading backend data…') : null },
    './CustomerPortalUI': { PortalSummaryCards: box, PortalEmptyState: box, PortalTextLink: box },
    './ContractPrintAction': { default: () => null }, './inventory/ManagedContractReview': { default: () => null },
    './CustomerBalancePayment': { default: () => null }, './CustomerDepositPayment': { default: () => null },
    '@/lib/managedCellBooking': { volumeText: () => '' }, '@/lib/inventoryRegistration': { eligibleInventoryRegistration: () => false },
    './SelfStoragePayosCheckout': { default: SelfStoragePayosCheckout },
    './CustomerPaymentNavigation': { SelfPaymentNavigation: () => null },
    '@/lib/selfStoragePayos': { eligiblePayosPurpose }, './warehouse/ManagedCellSummary': { default: () => null },
    './warehouse/ManagedCellBooking': { clearMapAvailability: () => {} },
    '@/lib/customerReservationService': {
      SELF_STORAGE: 'SELF_STORAGE', MANAGED_INVENTORY: 'MANAGED_INVENTORY',
      serviceType: item => item?.serviceType, serviceLabel: () => '', liveHold: () => false,
      canCancel: () => false, canSign: () => false, contractAmounts: () => ({}),
      isManagedV2: item => item?.serviceType === 'MANAGED_INVENTORY' && item?.bookingFlowVersion === 2,
      isLegacyManaged: item => item?.serviceType === 'MANAGED_INVENTORY' && item?.bookingFlowVersion !== 2,
      hasLegacyRentalFlow: () => false, reservationLifecycle: () => ({ label: '' }),
    },
    react: { useState: initial => [initial, () => {}], useEffect: () => {}, useRef: initial => ({ current: initial }) },
    'react-router-dom': { useParams: () => ({ reservationId }), useLocation: () => ({ state: null }), useNavigate: () => () => {} },
    '@/api/reservationApi': { default: { detailForCustomer: async (...args) => { calls.detail++; return { data: { success: true, data: routeResource?.data || reservation } }; } } },
    '@/api/managedReservationApi': { default: {} },
    '@/api/contractApi': { default: {
      byReservationReal: async (...args) => { calls.byReservation.push(args); if (contractResponse instanceof Error) throw contractResponse; return contractResponse || { data: { success: true, data: { ...draftContract, reservationId: { _id: reservationId }, customerId: { _id: customerId } } } }; },
      mineReal: async () => ({ data: { success: true, data: [] } }), detailReal: async () => undefined,
    } },
    '@/api/facilityApi': { default: { publicDetail: async () => undefined } }, '@/api/storageApi': { default: { unitDetail: async () => undefined } },
    '@/api/customerRentalApi': { accessApi: {} }, '@/components/ui/input': { Input: box },
    '@/lib/authSession': { useAuthSession: () => ({ accessToken: 'token', user: { id: customerId } }), getAccessToken: () => 'token' },
    './RentalBackendUI': {
      BackendScreen: screen, Card: box, CardContent: box, Button: button, Link: box, Details: details, Message: message,
      RentalSummary: summary, ManagedFinancialSummary: box, RentalStatus: ({ status }) => element('span', null, status),
      statusLabels: {}, useBackend: (() => { let index = 0; return () => index++ === 0 ? (routeResource || { data: reservation, loading: false, error: '', retry: () => {} }) : { data: [], loading: false, error: '', retry: () => {} }; })(),
      rows: response => response?.data?.data, record, recordId, validId, rentalError: error => error.message, ConfirmAction: box,
    },
  };
  return { component: compile('../src/components/customer/RentalLifecycleIntegration.jsx', mocks).PaymentIntegration, calls, get checkoutProps() { return checkoutProps; } };
}

function checkoutModule({ contract = draftContract, contractLoading = false, contractError = '', overview = { facility: { name: 'Test Facility' }, unit: { unitCode: 'A-01', size: 'SMALL', volumeM3: 2 } }, historyError = false } = {}) {
  const slots = [], pendingEffects = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(callback) { cursor++; pendingEffects.push(callback); },
  };
  let resourceIndex = 0;
  const useBackend = () => resourceIndex++ === 0
    ? { data: contract, loading: contractLoading, error: contractError, retry: () => {} }
    : { data: overview, loading: false, error: '', retry: () => {} };
  const mocks = {
    react: hooks,
    'react-router-dom': { Link: box }, '@/components/common/CustomerScreen': { CustomerScreen: screen },
    '@/components/ui/card': { Card: box, CardContent: box }, '@/components/ui/button': { Button: button }, '@/components/ui/badge': { Badge: box },
    '@/api/paymentApi': { default: { listPayosPaymentsForReservation: async () => { if (historyError) throw Error('fixture history failure'); return { items: [], nextCursor: null }; }, getPayosPaymentStatus: async () => { throw Error('unexpected status call'); }, createPayosCheckout: async () => { throw Error('unexpected checkout POST'); } } },
    '@/lib/authSession': { useAuthSession: () => ({ accessToken: 'token', user: { id: customerId } }), getAccessToken: () => 'token' },
    '@/lib/booking': { formatMoney: value => String(value) },
    '@/lib/selfStoragePayos': { ...require('../src/lib/selfStoragePayos.js') },
    '@/api/payosPaymentClient': { canOpenPayosCheckout: () => false, canShowPayosQr: () => false },
    '@/lib/selfStoragePayosQr': { createPayosQrDataUrl: async () => null },
    '@/lib/selfStoragePayosPolling': { isPayosPaymentPollable: () => false, pollPayosPaymentStatuses: async () => {} },
    './RentalBackendUI': {
      Details: details, LoadState: ({ resource }) => resource.loading ? element('p', { role: 'status' }, 'Loading contract…') : resource.error ? element('div', null, message({ error: resource.error }), button({ children: 'Retry', onClick: resource.retry })) : null,
      Message: message, RentalSummary: summary, RentalStatus: ({ status }) => element('span', null, status),
      useBackend, recordId, Card: box, CardContent: box, Button: button, Link: box,
    },
  };
  const component = compile('../src/components/customer/SelfStoragePayosCheckout.jsx', mocks).default;
  function render() { cursor = 0; resourceIndex = 0; pendingEffects.length = 0; const tree = component({ reservationId, initialReservation: reservation, loadContext: async () => ({ reservation, contract, rentalOverview: overview }), loadContract: async () => contract, loadOverview: async () => overview }); return tree; }
  async function flushEffects() { const effects = [...pendingEffects]; pendingEffects.length = 0; for (const effect of effects) effect(); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); }
  return { render, flushEffects };
}

test('Payment route renders a real loading state instead of Simulated Payment before Reservation data arrives', () => {
  const { component } = lifecycleModule({ routeResource: { data: null, loading: true, error: '', retry: () => {} } });
  const html = renderToStaticMarkup(component());
  assert.match(html, /Loading payment details/);
  assert.match(html, /Loading backend data/);
  assert.doesNotMatch(html, /Simulated Payment/);
});

test('Review creates one CONTRACTED Reservation and navigates to its exact 24-character Deposit route', async () => {
  const payload = { facilityId, storageUnitId: unitId, startDate: '2026-12-01', endDate: '2027-01-01', pricingPolicyId: 'price-1' };
  const facility = { _id: facilityId, name: 'Test Facility' };
  const unit = { _id: unitId, facilityId, unitCode: 'A-01', size: 'SMALL' };
  const reviewData = { facility, unit, profile: { verificationStatus: 'VERIFIED' }, price: { currency: 'VND' }, payload, estimate: { estimatedRent: 3000000, depositAmount: 1000000, taxAmount: 0, durationDays: 31 } };
  const states = [], effects = [];
  let cursor = 0, destination = null, clearedDraft = null, createCalls = 0, createdStatus = null;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in states)) states[i] = { current: initial }; return states[i]; },
    useEffect() { cursor++; },
  };
  const response = data => ({ data: { success: true, data } });
  const mocks = {
    react: hooks,
    'react-router-dom': { useNavigate: () => (...args) => { destination = args; } },
    '@/contexts/ReservationContext': { useReservation: () => ({ rentalDraft: { facility, unit, startDate: payload.startDate, endDate: payload.endDate, term: { value: 1, unit: 'MONTH' } }, updateRentalDraft: value => { clearedDraft = value; } }) },
    '@/lib/authSession': { useAuthSession: () => ({ accessToken: 'token' }), getAccessToken: () => 'token' },
    '@/lib/selfStorageReservation': {
      selfStorageRequest: () => payload,
      selfStorageEstimate: value => value.data.data,
      selfStorageCreation: value => { createdStatus = value.data.data.status; return value.data.data; },
      sameEstimate: () => true,
    },
    '@/api/reservationApi': { default: { estimateReal: async () => response(reviewData.estimate), createReal: async request => { createCalls++; assert.equal(request.facilityId, facilityId); return response({ _id: reservationId, status: 'CONTRACTED', serviceType: 'SELF_STORAGE', customerId, reservationCode: 'BKG-TEST-01' }); } } },
    '@/api/facilityApi': { default: { publicDetail: async () => response(facility) } },
    '@/api/storageApi': { default: { unitDetail: async () => response(unit) } },
    '@/api/customerRentalApi': { pricingApi: { resolve: async () => response(reviewData.price), }, customerProfileApi: { get: async () => response(reviewData.profile) } },
    '@/components/ui/checkbox': { Checkbox: props => element('input', { type: 'checkbox', ...props }) },
    '@/components/common/Steps': { default: () => null },
    './RentalBackendUI': {
      BackendScreen: screen, Card: box, CardContent: box, Button: button, Details: details, Message: message, Link: box,
      useBackend: () => ({ data: reviewData, loading: false, error: '', retry: () => {} }),
      LoadState: () => null, record, recordId, rentalError: error => error.message,
    },
  };
  const component = compile('../src/components/customer/SelfStorageReservationReview.jsx', mocks).default;
  const draft = component();
  const Review = draft.type;
  function render() { cursor = 0; effects.length = 0; return Review(draft.props); }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    if (typeof node.type === 'function') { const found = find(node.type(node.props), predicate); if (found) return found; }
    for (const child of React.Children.toArray(node.props?.children)) { const found = find(child, predicate); if (found) return found; }
    return null;
  }
  let tree = render();
  const checkbox = find(tree, node => node.type === 'input' && node.props['aria-label'] === 'Confirm provided personal data');
  assert(checkbox);
  checkbox.props.onCheckedChange(true);
  tree = render();
  const create = find(tree, node => node.type === 'button' && node.props.children === 'Create Reservation');
  assert(create && !create.props.disabled);
  await create.props.onClick();
  assert.equal(createCalls, 1);
  assert.equal(createdStatus, 'CONTRACTED');
  assert.equal(destination[0], `/portal/payments/${reservationId}`);
  assert.equal(destination[1].state.selfStorageCreated, true);
  assert.equal(clearedDraft.facility, null);
  assert.equal(reservationId.length, 24);
});

test('Reservation retrieval failure and missing records fail closed with retry, never the mock-payment screen', () => {
  for (const routeResource of [
    { data: null, loading: false, error: 'not found', retry: () => {} },
    { data: null, loading: false, error: '', retry: () => {} },
  ]) {
    const { component } = lifecycleModule({ routeResource });
    const html = renderToStaticMarkup(component());
    assert.match(html, /Payment unavailable/);
    assert.match(html, /Không tải được thông tin đơn thuê/);
    assert.match(html, /Retry reservation/);
    assert.doesNotMatch(html, /Simulated Payment/);
  }
});

test('Owned Self-Storage Reservation routes to PayOS and loads its exact owner-scoped contract endpoint', async () => {
  const module = lifecycleModule();
  const html = renderToStaticMarkup(module.component());
  assert.match(html, /payos-checkout/);
  assert.doesNotMatch(html, /Simulated Payment/);
  assert.equal(module.calls.detail, 0, 'the already verified parent Reservation is passed through; no duplicate reservation request is made');
  const loaded = await module.checkoutProps.loadContract(reservationId, customerId, { signal: 'fixture' });
  assert.equal(loaded._id, contractId);
  assert.deepEqual(module.calls.byReservation, [[reservationId, { signal: 'fixture' }]]);

  const mismatched = lifecycleModule({ contractResponse: { data: { success: true, data: { ...draftContract, reservationId: { _id: facilityId }, customerId: { _id: customerId } } } } });
  renderToStaticMarkup(mismatched.component());
  await assert.rejects(mismatched.checkoutProps.loadContract(reservationId, customerId), /does not match this reservation and customer/);
});

test('New CONTRACTED + DRAFT booking can show Deposit after valid context; rental summary survives contract and overview failures', async () => {
  const missingContract = checkoutModule({ contract: null });
  const html = renderToStaticMarkup(missingContract.render());
  assert.match(html, /BKG-TEST-01/);
  assert.match(html, /Estimated rent/);
  assert.match(html, /Estimated Deposit/);
  assert.match(html, /linked contract was not found/);
  assert.doesNotMatch(html, /Thanh toán tiền thuê trả trước với PayOS/);

  const failedContract = checkoutModule({ contract: null, contractError: 'The reservation is saved, but its contract could not be loaded. Retry here; you do not need to book again.' });
  const failedHtml = renderToStaticMarkup(failedContract.render());
  assert.match(failedHtml, /BKG-TEST-01/);
  assert.match(failedHtml, /you do not need to book again/);

  const overviewFailure = checkoutModule({ overview: { error: 'Facility or StorageUnit details could not be loaded. The verified reservation and payment status remain available.' } });
  const overviewHtml = renderToStaticMarkup(overviewFailure.render());
  assert.match(overviewHtml, /BKG-TEST-01/);
  assert.match(overviewHtml, /3000000 VND/);
  assert.match(overviewHtml, /Facility or StorageUnit details could not be loaded/);

  assert.equal(eligiblePayosPurpose(reservation, draftContract), 'DEPOSIT');
});

test('PayOS history failure keeps the Reservation visible and disables new checkout; empty history is valid', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { sessionStorage: { getItem: () => null, setItem: () => {} }, location: { search: '' }, setInterval: () => 1, clearInterval: () => {} };
  globalThis.document = { hidden: true, addEventListener: () => {}, removeEventListener: () => {} };
  try {
  const failed = checkoutModule({ historyError: true });
  let tree = failed.render();
  await failed.flushEffects();
  tree = failed.render();
  const failedHtml = renderToStaticMarkup(tree);
  assert.match(failedHtml, /BKG-TEST-01/);
  assert.match(failedHtml, /Do not start another payment yet/);
  const find = node => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'button' && node.props.children === 'Thanh toán tiền thuê trả trước với PayOS') return node;
    if (node.props?.children) for (const child of React.Children.toArray(node.props.children)) { const result = find(child); if (result) return result; }
    if (typeof node.type === 'function') return find(node.type(node.props));
    return null;
  };
  const paymentButton = find(tree);
  assert(paymentButton);
  assert.equal(paymentButton.props.disabled, true);

  const empty = checkoutModule();
  empty.render();
  await empty.flushEffects();
  const emptyHtml = renderToStaticMarkup(empty.render());
  assert.match(emptyHtml, /No PayOS Payment yet/);
  assert.doesNotMatch(emptyHtml, /Payment history could not be verified/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('Mismatched contract blocks Deposit without hiding the Reservation; Managed Inventory remains separately routed', () => {
  const mismatched = checkoutModule({ contract: { ...draftContract, reservationId: facilityId } });
  const mismatchedHtml = renderToStaticMarkup(mismatched.render());
  assert.match(mismatchedHtml, /BKG-TEST-01/);
  assert.doesNotMatch(mismatchedHtml, /Thanh toán tiền thuê trả trước với PayOS/);

  const managed = { ...reservation, serviceType: 'MANAGED_INVENTORY', bookingFlowVersion: 2 };
  const { component } = lifecycleModule({ routeResource: { data: managed, loading: false, error: '', retry: () => {} } });
  const managedHtml = renderToStaticMarkup(component());
  assert.match(managedHtml, /Managed Inventory payments/);
  assert.doesNotMatch(managedHtml, /payos-checkout/);
  assert.doesNotMatch(managedHtml, /Simulated Payment/);
});
