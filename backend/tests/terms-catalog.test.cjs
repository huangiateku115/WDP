const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../dist/services/terms/terms.catalog');
const controller = require('../dist/controllers/public/terms.controller');

test('published Terms versions retain v2.0 and expose the complete next catalog for both services', () => {
  for (const serviceType of ['SELF_STORAGE', 'MANAGED_INVENTORY']) {
    const versions = catalog.listTermsVersions(serviceType);
    assert.deepEqual(versions.map(entry => entry.version), ['2.1', '2.0']);
    assert.equal(catalog.getCurrentTerms(serviceType, new Date('2026-11-11T19:43:41+07:00')).versionId, 'VS-POLICY-002@2.0');
    assert.equal(catalog.getCurrentTerms(serviceType, new Date('2026-11-11T19:43:42+07:00')).versionId, 'VS-POLICY-002@2.1');
    const current = catalog.getTermsVersion(serviceType, 'VS-POLICY-002@2.1');
    assert.deepEqual(current.groups.map(group => group.id), Array.from({ length: 18 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`));
    assert.ok(current.groups.every(group => group.appliesTo.includes(serviceType) && group.sections[serviceType].length));
    assert.equal(current.legalReviewStatus, 'NOT_REVIEWED');
    assert.equal(current.effectiveFrom, '2026-11-11T19:43:42+07:00');
    assert.ok(current.groups.every(group => group.sections[serviceType].length > 0), `${serviceType} groups should retain clauses`);
    assert.ok(current.groups.find(group => group.id === 'P03').sections[serviceType].some(line => line.includes('100%')));
    assert.ok(current.groups.find(group => group.id === 'P05').sections[serviceType].some(line => line.includes('90%') && line.includes('10%')));
  }
  assert.equal(catalog.getCurrentTerms('SELF_STORAGE', new Date('2026-11-10T23:59:59+07:00')), undefined);
});

test('version reads and Customer acceptance are version-bound and create an immutable content hash', () => {
  const terms = catalog.getTermsVersion('MANAGED_INVENTORY', 'VS-POLICY-002@2.0');
  assert.ok(terms);
  const historicalHash = catalog.termsContentHash(terms);
  assert.equal(catalog.termsContentHash(catalog.getTermsVersion('MANAGED_INVENTORY', '2.0')), historicalHash);
  assert.notEqual(catalog.termsContentHash(catalog.getTermsVersion('MANAGED_INVENTORY', '2.1')), historicalHash);
  assert.equal(catalog.termsContentHash(terms), catalog.termsContentHash(terms));
  const legacyAcceptance = catalog.captureTermsAcceptance('SELF_STORAGE', terms.versionId, true, new Date('2026-11-11T03:00:00Z'));
  assert.equal(legacyAcceptance.contentHash, historicalHash);
  assert.equal(legacyAcceptance.versionId, 'VS-POLICY-002@2.0');
  assert.throws(() => catalog.captureTermsAcceptance('SELF_STORAGE', terms.versionId, false), /TERMS_ACCEPTANCE_REQUIRED/);
  assert.throws(() => catalog.captureTermsAcceptance('SELF_STORAGE', 'old-version', true), /TERMS_VERSION_STALE/);
  const accepted = catalog.captureTermsAcceptance('MANAGED_INVENTORY', 'VS-POLICY-002@2.1', true, new Date('2026-11-11T13:00:00Z'));
  assert.equal(accepted.acceptedAt.toISOString(), '2026-11-11T13:00:00.000Z');
  assert.equal(accepted.serviceType, 'MANAGED_INVENTORY');
  assert.equal(accepted.versionId, 'VS-POLICY-002@2.1');
  assert.match(accepted.contentHash, /^[a-f\d]{64}$/);
});

test('public read handlers return current, historical and validation responses without database access', async () => {
  const invoke = async (handler, req) => {
    const result = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler(req, result, error => { throw error; });
    return result;
  };
  const current = await invoke(controller.current, { query: { serviceType: 'SELF_STORAGE' } });
  assert.equal(current.statusCode, 200);
  assert.equal(current.body.data.versionId, 'VS-POLICY-002@2.1');
  const history = await invoke(controller.version, { query: { serviceType: 'MANAGED_INVENTORY' }, params: { version: 'VS-POLICY-002@2.0' } });
  assert.equal(history.statusCode, 200);
  assert.equal(history.body.data.versionId, 'VS-POLICY-002@2.0');
  const invalid = await invoke(controller.current, { query: { serviceType: 'OTHER' } });
  assert.equal(invalid.statusCode, 422);
});
