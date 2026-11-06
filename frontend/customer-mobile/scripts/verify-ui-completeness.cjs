const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), map = require('../docs/design-map.json');
assert.equal(map.implemented.length, 23); assert.equal(map.remaining.length, 0); assert.equal(map.scaffolds.length, 0);
assert.equal(new Set(map.implemented.map(e => e.screen)).size, 23);
for (let id = 1; id <= 23; id++) {
  const record = map.implemented.find(e => e.screen === String(id).padStart(2, '0'));
  assert(record && record.route && record.entryPoint && record.tests && record.dataSource && record.limitations, 'Incomplete design metadata ' + id);
  assert.equal(record.backendIntegrationStatus, 'NOT INTEGRATED — OFFLINE FIXTURES');
  assert(record.componentPaths.length > 0);
  for (const file of [...record.componentPaths, ...record.routeFiles]) assert(fs.existsSync(path.join(root, file)), 'Missing ' + file);
}
console.log(JSON.stringify({result: 'PASS', designs: 23, missingDesigns: 0, missingMappedFiles: 0, scope: 'Design/source/route inventory only; not pixel-perfect QA, live integration or device E2E'}));
