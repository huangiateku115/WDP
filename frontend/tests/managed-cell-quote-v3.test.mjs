import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import { selectedPayload, verifiedCellQuote } from '../src/lib/managedCellBooking.js';
import { managedCreateRequest, managedQuoteRequest } from '../src/lib/customerReservationService.js';
import { managedQuoteFinancials } from '../src/lib/managedRentalPricing.js';

const require = createRequire(import.meta.url);

const facilityId = '507f1f77bcf86cd799439011';
const cellId = '507f1f77bcf86cd7994390d1';
const range = { startDate: '2030-01-01T00:00:00.000Z', endDate: '2030-02-01T00:00:00.000Z' };
const term = { value: 1, unit: 'MONTH' };
const selection = [{
  cell: { _id: cellId, dimensions: { widthM: 0.12, depthM: 1, usableHeightM: 1 }, operationalStatus: 'AVAILABLE',
    bookingStatus: 'AVAILABLE', displayStatus: 'AVAILABLE', physicalUsageKnown: true, isBookable: true, periodStatus: 'AVAILABLE', usedWeightKg: 0, usedVolumeM3: 0 },
  rack: { _id: '507f1f77bcf86cd7994390e2', facilityId, operationalStatus: 'AVAILABLE' },
}];
const payload = selectedPayload(facilityId, selection, range, term);

function quote(overrides = {}) {
  return {
    bookingFlowVersion: 3, facilityId, cellIds: [cellId], allocatedCapacityM3: 0.12,
    startDate: range.startDate, endDate: range.endDate, term,
    sellableCapacityM3: 10, committedPeakCapacityM3: 0, availableCapacityM3: 10,
    pricing: { ruleId: '507f1f77bcf86cd7994390a1', version: 3, billingBasis: 'PER_M3', ratePerM3: 1000, currency: 'VND', estimatedRent: 120 },
    deposit: { policyId: '507f1f77bcf86cd7994390b1', version: 2, calculation: 'PERCENT_OF_RENT', percentage: 20, amount: 24 },
    taxAmount: 0, paymentBreakdown: { totalDue: 120, depositCredit: 24, balanceDue: 96 },
    ...overrides,
  };
}

test('Backend V3 quote envelope and schema are accepted and can proceed to booking serialization', () => {
  const response = { data: { success: true, data: quote() } };
  const verified = verifiedCellQuote(response.data.data, payload, range);
  assert.equal(verified.bookingFlowVersion, 3);
  assert.deepEqual(managedQuoteFinancials(verified), {
    totalRentPayable: 120, advanceDepositRequired: 24, balanceAfterDeposit: 96, currency: 'VND',
  });
  const quoteBody = managedQuoteRequest(payload);
  const createBody = managedCreateRequest(payload);
  assert.deepEqual(quoteBody.cellIds, [cellId]);
  assert.deepEqual(createBody.cellIds, [cellId]);
  assert.equal(Object.hasOwn(quoteBody, 'allocatedCapacityM3'), false);
  assert.equal(Object.hasOwn(createBody, 'allocatedCapacityM3'), false);
});

test('V3 confirmation summary does not invoke the V2-only guard', () => {
  const confirmedQuote = verifiedCellQuote(quote(), payload, range);
  assert.doesNotThrow(() => managedQuoteFinancials(confirmedQuote));
  assert.match(readFileSync(new URL('../src/components/customer/RentalBackendUI.jsx', import.meta.url), 'utf8'), /quote\?managedQuoteFinancials\(quote\)/);
});

test('unknown Managed quote versions are rejected explicitly', () => {
  assert.throws(() => verifiedCellQuote(quote({ bookingFlowVersion: 4 }), payload, range), /Unsupported Managed quote version/);
});

test('Cell IDs in quote must match the selected Cell set exactly and be unique', () => {
  assert.throws(() => verifiedCellQuote(quote({ cellIds: ['507f1f77bcf86cd7994390d2'] }), payload, range), /Cell IDs do not match/);
  assert.throws(() => verifiedCellQuote(quote({ cellIds: [cellId, cellId] }), payload, range), /Cell IDs do not match/);
});

test('server-derived capacity must match selected Cell dimensions', () => {
  assert.throws(() => verifiedCellQuote(quote({ allocatedCapacityM3: 0.13 }), payload, range), /Invalid Managed quote/);
});

test('Managed V3 quote fields must contain internally consistent server pricing', () => {
  assert.throws(() => verifiedCellQuote(quote({ paymentBreakdown: { totalDue: 120, depositCredit: 23, balanceDue: 97 } }), payload, range), /pricing or availability/);
  assert.throws(() => verifiedCellQuote(quote({ facilityId: '507f1f77bcf86cd799439012' }), payload, range), /Invalid Managed quote/);
  assert.throws(() => verifiedCellQuote(quote({ term: { value: 2, unit: 'MONTH' } }), payload, range), /Invalid Managed quote/);
  assert.throws(() => verifiedCellQuote(quote({ pricing: { ...quote().pricing, estimatedRent: 121 } }), payload, range), /pricing or availability/);
});

test('V2 quote financial compatibility remains explicit and independently validated', () => {
  const v2 = quote({ bookingFlowVersion: 2 });
  assert.deepEqual(managedQuoteFinancials(v2), {
    totalRentPayable: 120, advanceDepositRequired: 24, balanceAfterDeposit: 96, currency: 'VND',
  });
  assert.throws(() => managedQuoteFinancials({ ...v2, bookingFlowVersion: 1 }), /Unsupported Managed quote version/);
});

test('confirmation handler calls the real Managed create API with its stable idempotency header', async () => {
  const componentSource = readFileSync(new URL('../src/components/customer/warehouse/ManagedCellBooking.jsx', import.meta.url), 'utf8');
  assert.match(componentSource, /setQuote\(\{ key: rkey, data \}\)/, 'state retains the exact verified Backend quote object');
  assert.match(componentSource, /quote\?\.key === requestKey \? quote\.data : null/, 'only a quote for the current selection is confirmable');
  assert.match(componentSource, /setQuote\(null\); setConfirmed\(false\); \}, \[requestKey\]/, 'Cell, period, or dimensions changing invalidates confirmation');
  assert.match(componentSource, /disabled=\{!b\.payload \|\| !b\.review \|\| !b\.confirmed/);
  assert.match(componentSource, /onClick=\{b\.create\}/);
  assert.match(componentSource, /managedApi\.create\(latest, \{ headers: \{ 'Idempotency-Key': idempotencyKey \} \}\)/);
  assert.match(componentSource, /nav\(`\/portal\/payments\/\$\{result\.reservation\._id\}`/);

  const source = readFileSync(new URL('../src/api/managedReservationApi.js', import.meta.url), 'utf8');
  const compiled = transformSync(source, { loader: 'jsx', format: 'cjs' }).code;
  const module = { exports: {} }, calls = [];
  const axios = { post: async (...args) => { calls.push(args); return { data: { success: true, data: { reservation: { _id: '507f1f77bcf86cd799439099' } } } }; } };
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (name === './axiosClient') return { __esModule: true, default: axios };
    if (name === '@/lib/customerReservationService') return { __esModule: true, managedQuoteRequest, managedCreateRequest };
    return require(name);
  }, module, module.exports);
  const api = module.exports.default;
  const key = 'stable-booking-retry-key-0001';
  await api.create(payload, { headers: { 'Idempotency-Key': key } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/reservations/managed');
  assert.deepEqual(calls[0][1], { facilityId, startDate: range.startDate, term, cellIds: [cellId] });
  assert.equal(calls[0][2].headers['Idempotency-Key'], key);
});
