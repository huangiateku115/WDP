'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { Types } = mongoose;
const Payment = require('../../dist/models/payments/reservation-payment.model').default;
const { StatisticsService } = require('../../dist/services/statistics/statistics.service');
const { parseStatisticsQuery } = require('../../dist/services/statistics/statistics.validation');

const enabled = process.env.WDP_STATISTICS_IT_RUN === '1';
const uri = process.env.WDP_STATISTICS_IT_MONGODB_URI;
function assertDisposableLocalUri(value) {
  if (!value) throw new Error('WDP_STATISTICS_IT_MONGODB_URI is required when WDP_STATISTICS_IT_RUN=1');
  const parsed = new URL(value);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || dbName !== 'wdp_statistics_test') {
    throw new Error('Integration tests require a local MongoDB database named exactly wdp_statistics_test');
  }
}

if (!enabled) {
  test('statistics Mongo integration requires explicit local disposable database opt-in', { skip: true }, () => {});
} else {
  assertDisposableLocalUri(uri);
  test('revenue aggregation sums distinct verified PayOS captures only and enforces Facility scope', async t => {
    await mongoose.connect(uri, { autoIndex: false });
    await mongoose.connection.dropDatabase();
    t.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
    const facilityA = new Types.ObjectId('507f1f77bcf86cd799439011');
    const facilityB = new Types.ObjectId('507f1f77bcf86cd799439012');
    const common = { reservationId: new Types.ObjectId(), customerId: new Types.ObjectId(), serviceType: 'SELF_STORAGE', purpose: 'FULL_RENT', amount: 400, currency: 'VND', idempotencyKey: 'it-key', providerReference: 'it-order', checkoutState: 'READY', providerPaymentLinkId: 'it-link', providerCurrency: 'VND', createdAt: new Date('2026-11-01T00:00:00Z'), updatedAt: new Date('2026-11-01T00:00:00Z') };
    const capture = { eventHash: 'verified-event', reference: 'verified-ref', amount: 400, currency: 'VND', transactionDateTime: '2026-11-10 10:00:00', receivedAt: new Date('2026-11-10T03:00:00Z') };
    await Payment.collection.insertMany([
      { ...common, _id: new Types.ObjectId(), facilityId: facilityA, provider: 'PAYOS', status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED', applicationStatus: 'APPLIED', providerCaptures: [capture, capture] },
      { ...common, _id: new Types.ObjectId(), facilityId: facilityA, provider: 'MOCK', status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED', applicationStatus: 'APPLIED', providerCaptures: [{ ...capture, eventHash: 'mock' }] },
      { ...common, _id: new Types.ObjectId(), facilityId: facilityA, provider: 'PAYOS', status: 'PENDING', providerSettlementStatus: 'NOT_VERIFIED', applicationStatus: 'NOT_APPLIED', providerCaptures: [{ ...capture, eventHash: 'pending' }] },
      { ...common, _id: new Types.ObjectId(), facilityId: facilityA, provider: 'PAYOS', status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED', applicationStatus: 'MANUAL_REVIEW', providerCaptures: [{ ...capture, eventHash: 'review' }] },
      { ...common, _id: new Types.ObjectId(), facilityId: facilityB, provider: 'PAYOS', status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED', applicationStatus: 'APPLIED', providerCaptures: [{ ...capture, eventHash: 'other-facility' }] },
    ]);
    const query = parseStatisticsQuery({ fromDate: '2026-11-01', toDate: '2026-11-30' });
    const global = await StatisticsService.revenue(query, { type: 'ALL' });
    assert.equal(global.data.collectedAmount, 800);
    assert.equal(global.data.paymentCount, 2);
    const scoped = await StatisticsService.revenue(query, { type: 'FACILITY', facilityId: facilityA });
    assert.equal(scoped.data.collectedAmount, 400);
    assert.equal(scoped.data.paymentCount, 1);
    assert.equal(scoped.data.refundedAmount, null);
    assert.equal(scoped.data.netCashFlow, null);
    assert.equal(scoped.data.recognizedRevenue, null);
  });
}
