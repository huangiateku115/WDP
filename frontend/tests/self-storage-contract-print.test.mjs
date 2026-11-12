import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { contractPrintModel, verifySelfStoragePrintTerms } from '../src/lib/contractPrint.js';
import { canSign, selfStoragePaperProgress } from '../src/lib/customerReservationService.js';

const [contractId, reservationId, customerId, facilityId, storageUnitId] = [...'12345'].map(d => d.repeat(24));
const ids = { contractId, reservationId, customerId };
const terms = { documentCode: 'TEST', version: '1', versionId: 'TEST@1', status: 'PUBLISHED',
  effectiveFrom: '2026-01-01T00:00:00Z', services: ['SELF_STORAGE'],
  groups: [{ title: 'Điều khoản đã chấp nhận', appliesTo: ['SELF_STORAGE'], sections: { SELF_STORAGE: ['Nội dung fixture'] } }] };
const acceptance = { documentCode: terms.documentCode, version: terms.version, versionId: terms.versionId,
  serviceType: 'SELF_STORAGE', acceptedAt: '2026-11-12T00:00:00Z',
  contentHash: createHash('sha256').update(JSON.stringify(terms)).digest('hex') };
const flat = { schemaVersion: 1, reservationId, customerId, facilityId, storageUnitId, reservationCode: 'VS-001',
  serviceType: 'SELF_STORAGE', rentalPaymentFlow: 'FULL_UPFRONT_V1', termsAcceptance: acceptance,
  startDate: '2026-11-13T00:00:00Z', endDate: '2026-12-13T00:00:00Z', pricing: { estimatedRent: 50000, currency: 'VND' } };
const fixture = (content = flat) => ({ _id: contractId, customerId, reservationId, status: 'DRAFT',
  contractCode: 'CTR-001', currentContentVersion: 1,
  contentVersions: [{ version: 1, contentHash: 'a'.repeat(64), content }] });

test('prints flat Self Storage snapshot as a summary with original price and no Managed fallback', () => {
  const model = contractPrintModel(fixture(), ids);
  assert.equal(model.rental.serviceType, 'SELF_STORAGE');
  assert.equal(model.rental.unit, storageUnitId);
  assert.equal(model.rental.code, 'VS-001');
  assert.equal(model.facility.id, facilityId);
  assert.equal(model.termsVersion, '1');
  assert.equal(model.amounts[0][1], '50.000 ₫');
  assert.match(model.title, /TÓM TẮT/);
  assert.match(model.warnings[0], /chưa thay thế hợp đồng giấy chính thức/);
});

test('nested Managed snapshot remains supported', () => {
  const content = { reservation: { id: reservationId, cellIds: [storageUnitId] }, pricing: { quotaM3: 0.24 }, terms: ['Fixture'] };
  const model = contractPrintModel(fixture(content), { ...ids, v2: true });
  assert.equal(model.rental.serviceType, 'MANAGED_INVENTORY');
  assert.equal(model.rental.cells[0].id, storageUnitId);
  assert.deepEqual(model.terms, ['Fixture']);
});

test('rejects incorrect IDs, version, hash, and snapshot identity', () => {
  for (const key of Object.keys(ids)) assert.throws(() => contractPrintModel(fixture(), { ...ids, [key]: '9'.repeat(24) }));
  assert.throws(() => contractPrintModel({ ...fixture(), currentContentVersion: 2 }, ids));
  assert.throws(() => contractPrintModel({ ...fixture(), currentContentVersion: undefined }, ids));
  const invalidHash = fixture();
  invalidHash.contentVersions[0].contentHash = 'not-a-hash';
  assert.throws(() => contractPrintModel(invalidHash, ids));
  for (const key of ['reservationId', 'customerId']) {
    assert.throws(() => contractPrintModel(fixture({ ...flat, [key]: '9'.repeat(24) }), ids));
  }
  assert.throws(() => contractPrintModel({ ...fixture(), reservationId: { _id: reservationId, storageUnitId: '9'.repeat(24) } }, ids));
});

test('accepts only exact historical terms with verified content', async () => {
  const verifiedTerms = await verifySelfStoragePrintTerms(acceptance, terms);
  assert.equal(verifiedTerms[0].lines[0], 'Nội dung fixture');
  assert.doesNotMatch(contractPrintModel(fixture(), { ...ids, verifiedTerms }).title, /TÓM TẮT/);
  for (const document of [null, { ...terms, version: '2' }, { ...terms, note: 'Changed content' }]) {
    assert.deepEqual(await verifySelfStoragePrintTerms(acceptance, document), []);
  }
});

test('paper progress follows Backend lifecycle and keeps staged online eligibility separate', () => {
  const upfront = status => ({ serviceType: 'SELF_STORAGE', rentalPaymentFlow: 'FULL_UPFRONT_V1', status });
  const draft = { status: 'DRAFT' }, verified = { status: 'SIGNED', verifiedAt: '2026-11-12T00:00:00Z' };
  assert.match(selfStoragePaperProgress(upfront('CONTRACTED'), draft).message, /Chờ thanh toán/);
  assert.equal(selfStoragePaperProgress(upfront('PAID'), draft).visitFacility, true);
  assert.match(selfStoragePaperProgress(upfront('CHECKIN_READY'), verified).message, /Chờ bàn giao/);
  assert.match(selfStoragePaperProgress(upfront('ACTIVE'), verified).message, /Đang thuê/);
  assert.deepEqual(selfStoragePaperProgress(upfront('CANCELLED'), draft), { message: 'Đơn thuê đã hủy.' });
  for (const status of ['CONTRACTED', 'PAID', 'DEPOSIT_PAID', 'CHECKIN_READY', 'ACTIVE', 'CANCELLED']) assert.equal(canSign(draft, upfront(status)), false);
  const staged = { serviceType: 'SELF_STORAGE', status: 'DEPOSIT_PAID' };
  assert.equal(selfStoragePaperProgress(staged, draft), null);
  assert.equal(canSign(draft, staged), true);
});
