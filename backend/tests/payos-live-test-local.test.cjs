const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');

const serverPath = path.join(__dirname, '../dist/server.js');
const mongoUrl = 'mongodb://127.0.0.1:27019/wdp_payos_test?replicaSet=wdp-pay-mock&directConnection=true';
const testEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(KEYCLOAK_|PAYOS_|MONGO_|AUTH_MOCK_MODE$|NODE_OPTIONS$)/i.test(key))),
  NODE_ENV: 'development', AUTH_MOCK_MODE: 'true', PAYOS_LIVE_TEST_MODE: 'true',
  PAYOS_ENABLED: 'false', PAYOS_MOCK_MODE: 'false', MONGO_URL: mongoUrl, PORT: '5000',
  PAYOS_CUSTOMER_ORIGIN: 'http://127.0.0.1:5000',
  PAYOS_LIVE_TEST_CLIENT_ID: 'fixture-client', PAYOS_LIVE_TEST_API_KEY: 'fixture-key',
  PAYOS_LIVE_TEST_CHECKSUM_KEY: 'fixture-checksum', PAYOS_LIVE_TEST_PROBE_ORDER_CODE: '123456',
  PAYOS_BASE_URL: 'https://incorrect.invalid', PAYOS_PARTNER_CODE: 'not-for-this-channel',
  PAYOS_API_KEY: 'legacy-unused', KEYCLOAK_BASE_URL: 'https://keycloak-must-not-be-used.invalid',
};

function boot(serverFile) {
  const assert = require('node:assert/strict');
  const Module = require('node:module');
  const net = require('node:net');
  const { PayOS } = require('@payos/node');
  const socketConnect = net.Socket.prototype.connect;
  const load = Module._load;
  Module._load = function (name, ...rest) {
    if (/keycloak|^jose$/.test(name)) throw Error('Keycloak/JWT modules forbidden');
    return load.call(this, name, ...rest);
  };
  net.Socket.prototype.connect = function (options, ...rest) {
    const target = Array.isArray(options) ? options[0] : options;
    if (target?.host !== '127.0.0.1' || target?.port !== 27019) throw Error('Outbound socket forbidden');
    return socketConnect.call(this, options, ...rest);
  };
  const signing = new PayOS({ clientId: 'fixture-client', apiKey: 'fixture-key', checksumKey: 'fixture-checksum', logLevel: 'off' });
  const signed = async data => Response.json({
    code: '00', data, signature: await signing.crypto.createSignatureFromObj(data, 'fixture-checksum'),
  });
  let probes = 0;
  let createdOrder;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api-merchant.payos.vn');
    assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('x-client-id'), 'fixture-client');
    assert.equal(headers.get('x-api-key'), 'fixture-key');
    assert.equal(headers.has('x-partner-code'), false);
    if (init.method === 'GET' && url.pathname === '/v2/payment-requests/123456') {
      probes++;
      if (probes === 1) return Response.json({ code: 'TEST_NOT_FOUND', desc: 'fixture' }, { status: 404 });
      const data = { id: 'probe-link', orderCode: 123456, amount: 2000, amountPaid: 0, status: 'PENDING' };
      if (probes === 2) return Response.json({ code: '00', data });
      if (probes === 3) return Response.json({ code: '00', data, signature: '0'.repeat(64) });
      return signed(data);
    }
    if (init.method === 'POST' && url.pathname === '/v2/payment-requests') {
      assert.ok(probes >= 4);
      assert.equal(createdOrder, undefined);
      const body = JSON.parse(init.body);
      assert.equal(body.amount, 2000);
      assert.match(body.description, /^WDPD[a-f0-9]{5}$/);
      assert.equal(new URL(body.returnUrl).origin, 'http://127.0.0.1:' + process.env.PORT);
      assert.equal(body.returnUrl, body.cancelUrl);
      assert.equal(body.signature, await signing.crypto.createSignatureOfPaymentRequest(body, 'fixture-checksum'));
      createdOrder = body.orderCode;
      console.log('SDK_FIXTURE_POST');
      if (process.env.WDP_FIXTURE_OUTCOME === '214') {
        return Response.json({ code: '214', desc: 'secret-sensitive-fixture-description' });
      }
      return signed({
        orderCode: createdOrder, amount: 2000, currency: 'VND', status: 'PENDING',
        paymentLinkId: 'fixture-link', checkoutUrl: 'https://pay.payos.vn/web/fixture-link',
      });
    }
    if (init.method === 'GET' && createdOrder && url.pathname === '/v2/payment-requests/' + createdOrder) {
      return signed({ id: 'fixture-link', orderCode: createdOrder, amount: 2000, amountPaid: 0, status: 'PENDING' });
    }
    throw Error('Unexpected SDK request');
  };
  require(serverFile);
}
const isolatedStartup = '(' + boot.toString() + ')(process.argv[1])';

test('live test refuses unsafe startup configuration', () => {
  for (const override of [
    { NODE_ENV: 'production' }, { AUTH_MOCK_MODE: 'false' }, { PAYOS_ENABLED: 'true' },
    { PAYOS_MOCK_MODE: 'true' }, { MONGO_URL: mongoUrl.replace('wdp_payos_test', 'wdp') },
    { PAYOS_LIVE_TEST_API_KEY: '' }, { PAYOS_LIVE_TEST_PROBE_ORDER_CODE: '' },
    { PAYOS_CUSTOMER_ORIGIN: 'https://incorrect.invalid' },
  ]) {
    const result = spawnSync(process.execPath, ['-e', isolatedStartup, serverPath], {
      env: { ...testEnv, ...override }, encoding: 'utf8', timeout: 8000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid configuration: PAYOS_LIVE_TEST_MODE/);
    assert.doesNotMatch(result.stdout, /MongoDB connected|SDK_FIXTURE_POST/);
  }
});

for (const outcome of ['success', '214']) {
  test('local replica set with intercepted PayOS SDK: ' + outcome, {
    skip: process.env.WDP_PAYOS_LOCAL_E2E !== '1', timeout: 25_000,
  }, async t => {
    const probe = net.createServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    const origin = 'http://127.0.0.1:' + port;
    const child = spawn(process.execPath, ['-e', isolatedStartup, serverPath], {
      env: { ...testEnv, PORT: String(port), PAYOS_CUSTOMER_ORIGIN: origin, WDP_FIXTURE_OUTCOME: outcome },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const fixture = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', code => reject(Error('Live test server exited ' + code + ': ' + stderr)));
      child.stdout.on('data', chunk => {
        stdout += chunk;
        const line = stdout.match(/^PAYOS_LIVE_TEST_POSTMAN (.+)\r?$/m);
        if (line && stdout.includes('Server is running on port ' + port)) resolve(JSON.parse(line[1]));
      });
    });
    assert.equal(fixture.amount, 2000);
    const checkout = origin + '/api/v1/reservations/' + fixture.reservationId + '/payments/payos';
    const preflight = checkout + '/live-test/preflight';
    const headers = token => ({ Authorization: 'Bearer ' + token });
    const post = () => fetch(checkout, {
      method: 'POST', headers: { ...headers(fixture.ownerToken), 'Idempotency-Key': fixture.paymentAttemptKey,
        'Content-Type': 'application/json' }, body: '{"purpose":"DEPOSIT"}',
    });
    const blocked = await post();
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, 'PAYOS_LIVE_TEST_PREFLIGHT_REQUIRED');
    assert.equal((await fetch(preflight, { headers: headers(fixture.otherToken) })).status, 404);
    assert.equal((await fetch(preflight, { method: 'HEAD', headers: headers(fixture.ownerToken) })).status, 404);
    for (let i = 0; i < 3; i++) {
      assert.equal((await fetch(preflight, { headers: headers(fixture.ownerToken) })).status, 502);
      assert.equal((await post()).status, 409);
    }
    assert.doesNotMatch(stdout, /SDK_FIXTURE_POST/);
    const verified = await fetch(preflight, { headers: headers(fixture.ownerToken) });
    assert.equal(verified.status, 200);
    assert.equal((await verified.json()).data.verified, true);
    const attempts = await Promise.all([post(), post()]);
    const blockedSecond = attempts.find(res => res.status === 409);
    assert.ok(blockedSecond);
    assert.equal((await blockedSecond.json()).code, 'PAYOS_LIVE_TEST_ATTEMPT_USED');
    const created = attempts.find(res => res !== blockedSecond);
    const result = await created.json();
    if (outcome === 'success') {
      assert.equal(created.status, 201);
      assert.equal(result.outcome, 'CREATED');
      assert.equal(result.data.checkoutStatus, 'READY');
      assert.equal(result.data.checkoutUrl, 'https://pay.payos.vn/web/fixture-link');
      const lookup = checkout + '/orders/' + result.data.orderCode;
      assert.equal((await fetch(lookup, { headers: headers(fixture.ownerToken) })).status, 200);
      assert.equal((await fetch(lookup, { headers: headers(fixture.otherToken) })).status, 404);
    } else {
      assert.equal(created.status, 503);
      assert.equal(result.code, 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN');
      assert.match(stderr, /providerErrorCode: '214'/);
      assert.match(stderr, /providerDescription: 'REDACTED'/);
      assert.match(stderr, /orderCode: [1-9][0-9]{9}/);
      assert.doesNotMatch(stderr + stdout, /secret-sensitive-fixture-description|fixture-checksum|fixture-key/);
    }
    assert.equal((await fetch(preflight, { headers: headers(fixture.ownerToken) })).status, 409);
    assert.equal((stdout.match(/^SDK_FIXTURE_POST$/gm) || []).length, 1);
  });
}
