const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');

const serverPath = process.env.WDP_PAYOS_SERVER_PATH || path.join(__dirname, '../dist/server.js');
const mongoUrl = 'mongodb://127.0.0.1:27019/wdp_payos_test?replicaSet=wdp-pay-mock&directConnection=true';
const mockEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(KEYCLOAK_|PAYOS_|MONGO_|AUTH_MOCK_MODE$|NODE_OPTIONS$)/i.test(key))),
  NODE_ENV: 'development', AUTH_MOCK_MODE: 'true', PAYOS_MOCK_MODE: 'true', PAYOS_ENABLED: 'false',
  MONGO_URL: mongoUrl,
  PAYOS_CUSTOMER_ORIGIN: 'http://127.0.0.1:5000',
  KEYCLOAK_BASE_URL: 'https://keycloak-must-not-be-used.invalid',
};

const isolatedStartup = [
  "const net = require('node:net');",
  "const Module = require('node:module');",
  "const socketConnect = net.Socket.prototype.connect;",
  "const load = Module._load;",
  "globalThis.fetch = () => { throw Error('Outbound HTTP forbidden'); };",
  "net.Socket.prototype.connect = function (options, ...rest) {",
  "  const target = Array.isArray(options) ? options[0] : options;",
  "  if (target?.host !== '127.0.0.1' || target?.port !== 27019) throw Error('Outbound socket forbidden');",
  "  return socketConnect.call(this, options, ...rest);",
  "};",
  "Module._load = function (name, ...rest) {",
  "  if (/keycloak|^jose$/.test(name)) throw Error('Keycloak/JWT modules forbidden in mock auth');",
  "  return load.call(this, name, ...rest);",
  "};",
  "require(process.argv[1]);",
].join('\n');

test('mock auth refuses unsafe configuration before loading the app', () => {
  for (const override of [
    { NODE_ENV: 'production' }, { NODE_ENV: '' },
    { PAYOS_MOCK_MODE: 'false' }, { PAYOS_ENABLED: 'true' },
    { MONGO_URL: mongoUrl.replace('wdp_payos_test', 'wdp') },
    { MONGO_URL: mongoUrl.replace('127.0.0.1', 'remote.example') },
  ]) {
    const result = spawnSync(process.execPath, ['-e', isolatedStartup, serverPath], {
      env: { ...mockEnv, ...override }, encoding: 'utf8', timeout: 8000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid configuration: (AUTH_MOCK_MODE|PAYOS_MOCK_MODE)/);
    assert.doesNotMatch(result.stdout, /MongoDB connected|PAYOS_MOCK_POSTMAN/);
  }
});

test('real local replica set: startup fixtures, checkout and owner-only access', {
  skip: process.env.WDP_PAYOS_LOCAL_E2E !== '1',
  timeout: 25_000,
}, async t => {
  const portProbe = net.createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const { port } = portProbe.address();
  await new Promise(resolve => portProbe.close(resolve));

  const child = spawn(process.execPath, ['-e', isolatedStartup, serverPath], {
    env: { ...mockEnv, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const fixture = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => reject(Error('Mock server exited ' + code + ': ' + stderr)));
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const line = stdout.match(/^PAYOS_MOCK_POSTMAN (.+)\r?$/m);
      if (line && stdout.includes('Server is running on port ' + port)) resolve(JSON.parse(line[1]));
    });
  });

  assert.notEqual(fixture.customerAId, fixture.customerBId);
  const baseUrl = 'http://127.0.0.1:' + port + '/api/v1';
  const checkout = baseUrl + '/reservations/' + fixture.reservationId + '/payments/payos';
  const headers = token => ({ Authorization: 'Bearer ' + token });
  const body = JSON.stringify({ purpose: 'DEPOSIT' });
  const create = await fetch(checkout, {
    method: 'POST', headers: { ...headers(fixture.ownerToken), 'Content-Type': 'application/json',
      'Idempotency-Key': fixture.paymentAttemptKey }, body,
  });
  const response = await create.json();
  assert.equal(create.status, 201, JSON.stringify(response));
  assert.equal(response.outcome, 'CREATED');
  assert.equal(response.data.checkoutStatus, 'READY');
  assert.equal(response.data.amount, 100_000);
  assert.equal(response.data.checkoutUrl, 'https://payos-mock.invalid/checkout/' + response.data.orderCode);

  const lookup = checkout + '/orders/' + response.data.orderCode;
  const read = await fetch(lookup, { headers: headers(fixture.ownerToken) });
  assert.equal(read.status, 200);
  const { data } = await read.json();
  assert.equal(data.orderCode, response.data.orderCode);
  assert.equal(data.paymentLinkId, response.data.paymentLinkId);
  assert.equal(data.amountPaid, 0);
  assert.equal(data.providerStatus, 'PENDING');

  assert.equal((await fetch(lookup, { headers: headers(fixture.otherToken) })).status, 404);
  assert.equal((await fetch(lookup, { headers: headers('invalid-test-token') })).status, 401);
  assert.equal((await fetch(baseUrl + '/auth/login', {
    method: 'POST', headers: { ...headers(fixture.ownerToken), 'Content-Type': 'application/json' }, body: '{}',
  })).status, 404);

  const replay = await fetch(checkout, {
    method: 'POST', headers: { ...headers(fixture.ownerToken), 'Content-Type': 'application/json',
      'Idempotency-Key': fixture.paymentAttemptKey }, body,
  });
  assert.equal(replay.status, 200);
  const replayed = await replay.json();
  assert.equal(replayed.outcome, 'REPLAYED');
  assert.equal(replayed.data.orderCode, data.orderCode);
});
