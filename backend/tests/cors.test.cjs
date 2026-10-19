const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
require('dotenv').config = () => ({});
Object.assign(process.env, {
  NODE_ENV: 'production', MONGO_URL: 'mongodb+srv://cluster.example.invalid/wdp',
  KEYCLOAK_BASE_URL: 'http://localhost:8081', KEYCLOAK_REALM: 'wdp-realm',
  KEYCLOAK_CLIENT_ID: 'wdp-backend', KEYCLOAK_CLIENT_SECRET: 'secret-test-marker',
  KEYCLOAK_ISSUER: 'http://localhost:8081/realms/wdp-realm',
  KEYCLOAK_JWKS_URI: 'http://localhost:8081/realms/wdp-realm/protocol/openid-connect/certs',
  CORS_ORIGINS: 'http://localhost:5173,https://frontend.example.invalid',
});
test('CORS exact origins and preflight; health regression', async t => {
  const server = require('../dist/app').default.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  let response;
  for (const origin of ['http://localhost:5173', 'https://frontend.example.invalid']) {
    response = await fetch(base + '/api/v1/health', { headers: { Origin: origin } });
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.status, 503); // No DB is connected in these tests.
    response = await fetch(base + '/api/v1/storage-units/id', {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'Authorization,Content-Type,Idempotency-Key' },
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('access-control-allow-methods'), /PATCH/);
    assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
    assert.match(response.headers.get('access-control-allow-headers'), /Idempotency-Key/i);
  }
  for (const origin of ['https://untrusted.example.invalid', 'https://frontend.example.invalid.evil.invalid']) {
    response = await fetch(base + '/api/v1/health', { headers: { Origin: origin } });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  response = await fetch(base + '/api/v1');
  assert.equal(response.status, 200); // Postman/server clients without Origin still work.
});

test('CORS startup config rejects wildcard/credential/path origins and has safe defaults', () => {
  function run(cors, nodeEnv = 'production') {
    const env = { ...process.env, NODE_ENV: nodeEnv };
    if (cors === undefined) delete env.CORS_ORIGINS; else env.CORS_ORIGINS = cors;
    return spawnSync(process.execPath, ['-e',
      "require('dotenv').config=()=>({});try{console.log(JSON.stringify(require('./dist/config/env').env.corsOrigins));}catch{process.exit(1);}"],
      { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 20000 });
  }
  for (const origin of ['*', 'https://user:secret@example.invalid', 'https://example.invalid/path', 'null']) {
    assert.equal(run(origin).status, 1);
  }
  assert.deepEqual(JSON.parse(run(undefined).stdout), []);
  assert.deepEqual(JSON.parse(run(undefined, 'development').stdout), ['http://localhost:5173', 'http://127.0.0.1:5173']);
});

