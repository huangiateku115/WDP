const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const baseEnv = {
  ...process.env, NODE_ENV: 'production', PORT: '3000',
  // Reserved domain: mocked tests never connect to this URI.
  MONGO_URL: 'mongodb+srv://cluster.example.invalid/wdp',
  KEYCLOAK_BASE_URL: 'http://localhost:8081',
  KEYCLOAK_REALM: 'wdp-realm', KEYCLOAK_CLIENT_ID: 'wdp-backend',
  KEYCLOAK_CLIENT_SECRET: 'test-placeholder',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
};
function run(code, overrides = {}) {
  const result = spawnSync(process.execPath, ['-e',
    "require('dotenv').config = () => ({});\n" + code], {
    cwd: path.resolve(__dirname, '..'), env: { ...baseEnv, ...overrides },
    encoding: 'utf8', timeout: 60000,
  });
  assert.ifError(result.error);
  return result;
}

for (const [name, value] of [
  ['MONGO_URL', ''], ['MONGO_URL', 'invalid-secret-uri'],
  ['PORT', '70000'], ['KEYCLOAK_BASE_URL', 'not-a-url'],
  ['KEYCLOAK_CLIENT_SECRET', ''],
]) {
  test('startup rejects invalid ' + name + ' (' + (value ? 'invalid' : 'missing') + ')', () => {
    const result = run("require('./dist/server');", { [name]: value });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(name));
    assert.doesNotMatch(result.stderr, /invalid-secret-uri|test-placeholder|at .*server/);
  });
}

test('MongoDB failure is sanitized and exits nonzero', () => {
  const result = run(`
    require('mongoose').connect = async () => { throw new Error('secret-credential'); };
    require('./dist/server');
  `);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MongoDB connection failed/);
  assert.doesNotMatch(result.stderr, /secret-credential/);
});

function lifecycle(failKeycloak, signal) {
  return run(`
    const assert = require('node:assert/strict');
    const events = [];
    const inject = (name, exports) => {
      const id = require.resolve(name);
      require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    inject('./dist/config/database', {
      connectDatabase: async () => { events.push('mongo'); },
      disconnectDatabase: async () => {
        events.push('disconnect');
        assert.deepEqual(events, ${JSON.stringify(failKeycloak
          ? ['mongo', 'keycloak', 'disconnect']
          : ['mongo', 'keycloak', 'listen', 'close', 'disconnect'])});
        console.log('LIFECYCLE_OK');
      },
    });
    inject('./dist/config/keycloak-admin.config', {
      authKeycloakAdmin: async () => {
        events.push('keycloak');
        ${failKeycloak ? "throw new Error('secret-keycloak');" : ''}
      },
    });
    inject('./dist/app', { default: () => {}, __esModule: true });
    const { EventEmitter } = require('node:events');
    const server = new EventEmitter();
    server.listening = false;
    server.listen = (_port, callback) => {
      events.push('listen'); server.listening = true; callback();
      setImmediate(() => { process.emit('${signal}'); process.emit('${signal}'); });
    };
    server.close = callback => { events.push('close'); server.listening = false; callback(); };
    server.closeIdleConnections = () => {};
    require('node:http').createServer = () => server;
    require('./dist/server');
  `);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  test('startup order and idempotent shutdown: ' + signal, () => {
    const result = lifecycle(false, signal);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LIFECYCLE_OK/);
  });
}
test('Keycloak failure disconnects MongoDB without listening', () => {
  const result = lifecycle(true, 'SIGTERM');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /LIFECYCLE_OK/);
  assert.doesNotMatch(result.stderr, /secret-keycloak/);
});

test('health, existing root, 404 and production error responses over HTTP', () => {
  const result = run(`
    const assert = require('node:assert/strict');
    const mongoose = require('mongoose');
    const app = require('./dist/app').default;
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        let response = await fetch(base + '/api/v1/health');
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
          success: false, service: 'wdp-backend', database: 'disconnected',
        });
        // Simulate readiness only; this test does not connect or write to MongoDB.
        Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, value: 1 });
        response = await fetch(base + '/api/v1/health');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          success: true, service: 'wdp-backend', database: 'connected',
        });
        response = await fetch(base + '/api/v1');
        assert.deepEqual(await response.json(), { title: 'Welcome to Storage API' });
        response = await fetch(base + '/missing');
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { success: false, message: 'Not Found' });
        response = await fetch(base + '/api/v1/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{secret',
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { success: false, message: 'Bad Request' });
        const { errorHandler } = require('./dist/middlewares/error.middleware');
        let output;
        const res = { headersSent: false, status(s) { assert.equal(s, 500); return this; },
          json(body) { output = body; } };
        errorHandler(new Error('secret-internal'), {}, res, () => {});
        assert.deepEqual(output, { success: false, message: 'Internal Server Error' });
        console.log('HTTP_OK');
      } catch (error) { console.error(error); process.exitCode = 1; }
      finally { server.close(); server.closeAllConnections(); }
    });
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HTTP_OK/);
});
