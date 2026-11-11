import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertConfirmedRequest } from '../src/api/confirmedContract.js';

test('Terms reads are allowlisted only as GET, with no Terms mutation route', () => {
  for (const url of ['/public/terms', '/public/terms/current', '/public/terms/VS-POLICY-002%402.0'])
    assert.doesNotThrow(() => assertConfirmedRequest({ method: 'GET', url }));
  for (const [method, url] of [['POST', '/public/terms'], ['PATCH', '/public/terms/2.0'], ['DELETE', '/public/terms/2.0']])
    assert.throws(() => assertConfirmedRequest({ method, url }), /not confirmed/);
});

test('Customer Terms content is rendered in an accessible accordion modal with retry and version metadata', () => {
  const modal = readFileSync(new URL('../src/components/customer/terms/TermsModal.jsx', import.meta.url), 'utf8');
  const legacyRoute = readFileSync(new URL('../src/pages/public/TermsPage.jsx', import.meta.url), 'utf8');
  const selfReview = readFileSync(new URL('../src/components/customer/SelfStorageReservationReview.jsx', import.meta.url), 'utf8');
  const managedReview = readFileSync(new URL('../src/components/customer/warehouse/ManagedCellBooking.jsx', import.meta.url), 'utf8');
  assert.match(modal, /title="Điều khoản & Chính sách"/);
  assert.match(modal, /group\.sections\[serviceType\]\.map/);
  assert.match(modal, /<details key=\{group\.id\}/);
  assert.match(modal, /aria-label="Danh sách điều khoản P01 đến P18"/);
  assert.match(modal, /legalReviewStatus/);
  assert.match(modal, /Thử lại/);
  assert.match(legacyRoute, /Compatibility route/);
  assert.doesNotMatch(legacyRoute, /<section/);
  assert.match(selfReview, /termsAccepted: true, termsVersionId: fresh\.terms\.versionId/);
  assert.match(managedReview, /termsAccepted: true, termsVersionId: terms\.data\.versionId/);
  assert.match(selfReview, /Xem điều khoản &amp; chính sách/);
  assert.match(managedReview, /Xem điều khoản &amp; chính sách/);
  assert.match(selfReview, /\[termsAccepted, setTermsAccepted\] = useState\(false\)/);
  assert.match(managedReview, /termsAccepted, setTermsAccepted\] = useState\(false\)/);
  assert.doesNotMatch(selfReview, /to="\/terms\?/);
  assert.doesNotMatch(managedReview, /to="\/terms\?/);
  assert.match(selfReview, /setTermsOpen\(true\)/);
  assert.match(managedReview, /setTermsOpen\(true\)/);
});
