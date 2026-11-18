const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

const root = fs.existsSync(path.join(__dirname, '../dist/app.js')) ? '../dist' : '../src';
const { resolvePayosMockMode } = require(root + '/config/payos-mock-mode');
const configuration = {
  NODE_ENV: 'development',
  PAYOS_MOCK_MODE: 'true',
  PAYOS_ENABLED: 'false',
  MONGO_URL: 'mongodb://127.0.0.1:27019/wdp_payos_test?replicaSet=wdp-pay-mock&directConnection=true',
};

test('mock configuration requires explicit development, live disabled and an isolated local test URI', () => {
  assert.equal(resolvePayosMockMode(configuration), true);
  assert.equal(resolvePayosMockMode({ NODE_ENV: 'production' }), false);
  for (const override of [
    { NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { NODE_ENV: undefined },
    { PAYOS_ENABLED: 'true' }, { PAYOS_ENABLED: undefined },
    { MONGO_URL: configuration.MONGO_URL.replace('127.0.0.1', 'production.example') },
    { MONGO_URL: configuration.MONGO_URL.replace('wdp_payos_test', 'wdp') },
    { MONGO_URL: configuration.MONGO_URL.replace('127.0.0.1', 'username:password@127.0.0.1') },
    { MONGO_URL: configuration.MONGO_URL.replace('directConnection=true', 'directConnection=false') },
    { MONGO_URL: configuration.MONGO_URL + '&dbName=wdp' },
    { MONGO_URL: configuration.MONGO_URL + '&replicaSet=other' },
  ]) {
    assert.throws(() => resolvePayosMockMode({ ...configuration, ...override }), /PAYOS_MOCK_MODE/);
  }
});

const oid = () => new mongoose.Types.ObjectId();
const query = value => ({ session() { return this; }, exec: async () => value });

test('Express checkout and order lookup use the configured mock with no provider or database connections', async t => {
  for (const key of Object.keys(process.env)) {
    if (/^(PAYOS_|KEYCLOAK_|MONGO_)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, configuration, {
    PORT: '5000', CORS_ORIGINS: 'http://127.0.0.1:5000',
    PAYOS_CUSTOMER_ORIGIN: 'http://127.0.0.1:5000',
    KEYCLOAK_BASE_URL: 'http://127.0.0.1:1', KEYCLOAK_CLIENT_SECRET: 'fixture-only',
  });
  t.mock.method(dotenv, 'config', () => ({ parsed: {} }));
  let blockedConnections = 0;
  const blockConnection = () => {
    blockedConnections++;
    throw new Error('Only fixture HTTP loopback is allowed');
  };
  t.mock.method(globalThis, 'fetch', blockConnection);
  t.mock.method(mongoose, 'connect', blockConnection);

  const reservation = {
    _id: oid(), customerId: oid(), facilityId: oid(), serviceType: 'SELF_STORAGE', status: 'CONTRACTED',
    inventoryVersion: 4, expiresAt: new Date(Date.now() + 60_000), estimatedRent: 300_000,
    depositAmount: 100_000, taxAmount: 0, discountAmount: 0, statusHistory: [],
  };
  const contract = { _id: oid(), customerId: reservation.customerId, reservationId: reservation._id, status: 'DRAFT' };
  const foreignCustomerId = oid();
  const authPath = require.resolve(root + '/middlewares/auth/requireAuth');
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      requireAuth(req, res, next) {
        const token = req.get('authorization');
        if (!['Bearer owner', 'Bearer foreign'].includes(token)) return res.sendStatus(401);
        req.user = { _id: token === 'Bearer owner' ? reservation.customerId : foreignCustomerId, role: 'CUSTOMER' };
        next();
      },
    },
  };
  const app = require(root + '/app').default;
  const Reservation = require(root + '/models/reservations/reservation.model').default;
  const Payment = require(root + '/models/payments/reservation-payment.model').default;
  const Contract = require(root + '/models/contracts/contract.model').default;
  const session = { withTransaction: async work => work(), endSession: async () => {} };
  t.mock.method(mongoose, 'startSession', async () => session);
  t.mock.method(Reservation, 'findOne', filter => query(
    String(filter._id) === String(reservation._id) && String(filter.customerId) === String(reservation.customerId)
      ? reservation : null,
  ));
  t.mock.method(Reservation, 'findOneAndUpdate', (_filter, update, options) => {
    assert.equal(options.session, session);
    reservation.inventoryVersion += update.$inc.inventoryVersion;
    return query(reservation);
  });
  t.mock.method(Contract, 'findOne', () => query(contract));
  let payment;
  let writes = 0;
  t.mock.method(Payment, 'findOne', filter => query(payment && Object.entries(filter).every(([key, value]) =>
    value?.$in ? value.$in.includes(payment[key]) : String(payment[key]) === String(value),
  ) ? payment : null));
  t.mock.method(Payment.prototype, 'save', async function (options) {
    assert.equal(options.session, session);
    writes++;
    payment = this;
    return this;
  });
  t.mock.method(Payment, 'findOneAndUpdate', (_filter, update) => {
    writes++;
    Object.assign(payment, update.$set);
    return query(payment);
  });
  t.mock.method(Payment, 'updateOne', (_filter, update) => {
    writes++;
    Object.assign(payment, update.$set);
    return query({ matchedCount: 1 });
  });
  t.mock.method(Payment, 'findById', () => query(payment));

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const socketConnect = net.Socket.prototype.connect;
  t.mock.method(net.Socket.prototype, 'connect', function (options, ...rest) {
    const target = Array.isArray(options) ? options[0] : options;
    if (target?.host !== '127.0.0.1' || target?.port !== port) return blockConnection();
    return socketConnect.call(this, options, ...rest);
  });

  function request(method, path, { token = 'owner', key, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, method, path, agent: false, headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      } }, res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode,
          body: res.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : raw }));
      });
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }

  const checkout = '/api/v1/reservations/' + reservation._id + '/payments/payos';
  const payload = { key: 'fixture-mock-attempt', body: { purpose: 'DEPOSIT' } };
  const created = await request('POST', checkout, payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.outcome, 'CREATED');
  const data = created.body.data;
  assert.equal(data.checkoutStatus, 'READY');
  assert.equal(data.status, 'PENDING');
  assert.equal(data.amount, 100_000);
  assert.equal(data.paymentLinkId, 'wdp-mock-' + data.orderCode);
  assert.equal(data.checkoutUrl, 'https://payos-mock.invalid/checkout/' + data.orderCode);
  assert.equal(writes, 3);

  const replay = await request('POST', checkout, payload);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.outcome, 'REPLAYED');
  assert.equal(replay.body.data.id, data.id);
  assert.equal(replay.body.data.checkoutUrl, data.checkoutUrl);
  const duplicate = await request('POST', checkout, { ...payload, key: 'fixture-different-attempt' });
  assert.equal(duplicate.status, 409);

  const lookupPath = checkout + '/orders/' + data.orderCode;
  const lookup = await request('GET', lookupPath);
  assert.equal(lookup.status, 200, JSON.stringify(lookup.body));
  assert.equal(lookup.body.data.orderCode, data.orderCode);
  assert.equal(lookup.body.data.paymentLinkId, data.paymentLinkId);
  assert.equal(lookup.body.data.amount, data.amount);
  assert.equal(lookup.body.data.amountPaid, 0);
  assert.equal(lookup.body.data.checkoutStatus, 'READY');
  assert.equal(lookup.body.data.providerStatus, 'PENDING');
  assert.equal(lookup.body.data.providerSettlementStatus, 'NOT_VERIFIED');
  assert.equal((await request('GET', lookupPath, { token: 'foreign' })).status, 404);
  assert.equal((await request('GET', lookupPath, { token: null })).status, 401);

  const webhook = await request('POST', '/api/v1/payments/payos/webhook', {
    token: null, body: { data: { orderCode: data.orderCode }, signature: 'fixture-signature' },
  });
  assert.equal(webhook.status, 400);
  assert.equal(webhook.body.code, 'PAYOS_WEBHOOK_SIGNATURE_INVALID');
  assert.equal(writes, 3);
  assert.equal(blockedConnections, 0);
});

