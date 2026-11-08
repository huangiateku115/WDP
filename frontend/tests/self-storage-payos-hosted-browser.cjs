const assert = require('node:assert/strict');
const { chromium } = require(process.env.WDP_PLAYWRIGHT_MODULE ||
  'C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const base = process.env.SELF_PAYMENT_TEST_URL || 'http://127.0.0.1:5198';
const [reservationId, customerId, facilityId, unitId, pricingId, contractId, paymentId] =
  ['1', '2', '3', '4', '5', '6', '7'].map(value => value.repeat(24));
const hosted = 'https://pay.payos.vn/web/wdp-test-fixture';
const checkoutPath = '/reservations/' + reservationId + '/payments/payos';
const paymentPage = '/portal/payments/' + reservationId;
const facility = { _id: facilityId, name: 'Hosted Checkout fixture', serviceTypes: ['SELF_STORAGE'], status: 'ACTIVE' };
const unit = { _id: unitId, facilityId, size: 'SMALL', unitCode: 'FIX-01', status: 'AVAILABLE', volumeM3: 4 };
const price = { _id: pricingId, facilityId, serviceType: 'SELF_STORAGE', unitSize: 'SMALL', isActive: true,
  term: { value: 1, unit: 'MONTH' }, price: 100000, currency: 'VND', effectiveFrom: '2020-01-01T00:00:00.000Z' };
const estimate = { estimatedRent: 100000, depositAmount: 20000, taxAmount: 0, basePrice: 100000, durationDays: 30 };
const user = { id: customerId, _id: customerId, displayName: 'Customer fixture', role: 'CUSTOMER' };

async function scenario(browser, mode) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [], unexpected = [], bookingPosts = [], checkoutPosts = [];
  let hostedVisits = 0, bookings = null, contractAvailable = mode !== 'contract-missing';
  let payment = ['ready', 'unknown'].includes(mode) ? paymentFixture(mode === 'unknown' ? 'UNKNOWN' : 'READY') : null;
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(identity => {
    sessionStorage.setItem('SelfStorage_token', 'fixture-only');
    sessionStorage.setItem('SelfStorage_user', JSON.stringify(identity));
  }, user);
  function paymentFixture(checkoutStatus) {
    return { id: paymentId, reservationId, purpose: 'DEPOSIT', amount: 20000, currency: 'VND', provider: 'PAYOS',
      status: 'PENDING', applicationStatus: 'NOT_APPLIED', providerSettlementStatus: 'NOT_VERIFIED',
      checkoutStatus, checkoutUrl: checkoutStatus === 'READY' ? hosted : null,
      reconciliationRequired: false, createdAt: new Date().toISOString() };
  }
  const reservation = () => bookings && ({
    ...bookings, _id: reservationId, customerId, serviceType: 'SELF_STORAGE', reservationCode: 'E2E-FIXTURE',
    status: payment?.applicationStatus === 'APPLIED' ? 'DEPOSIT_PAID' : 'CONTRACTED',
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), ...estimate,
  });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.href === hosted) {
      hostedVisits++;
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Intercepted PayOS checkout</h1>' });
    }
    if (url.origin !== base) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const p = url.pathname.slice('/api/v1'.length);
    let data, status = 200, outcome, pagination;
    if (method === 'POST' && p === '/reservations/estimate') data = estimate;
    else if (method === 'POST' && p === '/reservations') {
      bookingPosts.push(req.headers()['idempotency-key']);
      bookings = req.postDataJSON();
      data = reservation();
      status = 201;
    } else if (method === 'POST' && p === checkoutPath) {
      checkoutPosts.push(req.headers()['idempotency-key']);
      assert.deepEqual(req.postDataJSON(), { purpose: 'DEPOSIT' });
      assert.ok(bookings && contractAvailable);
      if (mode === 'provider-error') {
        payment = paymentFixture('UNKNOWN');
        return route.fulfill({ status: 503, json: { success: false, code: 'PAYOS_CHECKOUT_OUTCOME_UNKNOWN' } });
      }
      payment = paymentFixture('READY');
      if (mode === 'unsafe-url') payment.checkoutUrl = 'https://pay.payos.vn.evil.invalid/web/no';
      data = payment;
      status = 201;
      outcome = 'CREATED';
    } else if (method === 'GET') {
      if (p === '/users/me') data = user;
      else if (p === '/customers/me/profile') data = { verificationStatus: 'VERIFIED', identityCard: 'test' };
      else if (p === '/public/facilities') { data = [facility]; pagination = { totalPages: 1 }; }
      else if (p === '/public/facilities/' + facilityId) data = facility;
      else if (['/public/facilities/' + facilityId + '/storage-options', '/public/facilities/' + facilityId + '/pricing'].includes(p)) data = {};
      else if (p === '/facilities/' + facilityId + '/storage-units') { data = [unit]; pagination = { totalPages: 1 }; }
      else if (p === '/storage-units/' + unitId) data = unit;
      else if (p === '/storage-units/' + unitId + '/availability') {
        const [month, start, end] = ['month', 'startDate', 'endDate'].map(key => url.searchParams.get(key));
        data = { storageUnitId: unitId, month, intervals: [], availabilityState: 'VERIFIED',
          ...(start && end ? { rangeAvailability: 'AVAILABLE',
            requestedRange: { startDate: start + 'T00:00:00.000Z', endDate: end + 'T00:00:00.000Z' } } : {}) };
      } else if (p === '/pricing-rules') { data = [price]; pagination = { totalPages: 1 }; }
      else if (p === '/pricing-rules/resolve') data = price;
      else if (p === '/policies/resolve') data = { type: 'DEPOSIT', config: {} };
      else if (p === '/reservations/' + reservationId) data = reservation();
      else if (p === '/reservations/me') data = bookings ? [reservation()] : [];
      else if (p === '/contracts/reservation/' + reservationId) {
        if (!contractAvailable) return route.fulfill({ status: 404, json: { success: false } });
        data = { _id: contractId, reservationId, customerId, status: 'DRAFT' };
      } else if (p === checkoutPath) data = { items: payment ? [payment] : [], nextCursor: null };
      else if (p === '/reservations/' + reservationId + '/payments/' + paymentId) data = payment;
    }
    if (data === undefined) {
      unexpected.push(method + ' ' + p);
      return route.fulfill({ status: 500, json: { success: false } });
    }
    return route.fulfill({ status, json: { success: true, data, ...(outcome && { outcome }), ...(pagination && { pagination }) } });
  });
  async function confirmBooking() {
    await page.goto(base + '/portal/rent?facility=' + facilityId, { waitUntil: 'commit' });
    await page.getByRole('button', { name: 'Select Unit' }).click();
    await page.getByRole('button', { name: /: available$/ }).first().click();
    await page.getByRole('combobox', { name: 'Select commitment duration' }).click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Review Reservation' }).click();
    await page.getByRole('checkbox', { name: 'Confirm provided personal data' }).click();
    const confirm = page.getByRole('button', { name: 'Xác nhận đặt kho và thanh toán' });
    await confirm.evaluate(button => { button.click(); button.click(); });
  }
  try {
    await confirmBooking();
    if (mode === 'contract-missing') {
      await page.getByRole('button', { name: 'Thử tải lại hợp đồng' }).waitFor();
      assert.equal(checkoutPosts.length, 0);
      contractAvailable = true;
      await page.getByRole('button', { name: 'Thử tải lại hợp đồng' }).click();
    }
    if (['new', 'ready', 'contract-missing'].includes(mode)) {
      await page.waitForURL(hosted, { waitUntil: 'commit' });
      await page.getByRole('heading', { name: 'Intercepted PayOS checkout' }).waitFor();
      assert.equal(hostedVisits, 1);
    } else {
      await page.waitForURL(base + paymentPage, { waitUntil: 'commit' });
      if (mode === 'unknown' || mode === 'provider-error') await page.getByText(/Chưa thể xác nhận liên kết thanh toán/).waitFor();
      else await page.getByText(/The payment service could not confirm the request/).waitFor();
      assert.equal(hostedVisits, 0);
    }
    assert.equal(bookingPosts.length, 1);
    assert.match(bookingPosts[0], /^wdp-booking-/);
    const expectedCheckoutPosts = ['ready', 'unknown'].includes(mode) ? 0 : 1;
    assert.equal(checkoutPosts.length, expectedCheckoutPosts);
    if (expectedCheckoutPosts) assert.match(checkoutPosts[0], /^wdp-/);

    if (mode === 'new') {
      await page.goto(base + paymentPage + '?status=PAID&code=00&cancel=true', { waitUntil: 'commit' });
      await page.getByText(/Bạn đã quay lại từ trang hủy PayOS/).waitFor();
      await page.getByText(/Đang chờ PayOS xác nhận thanh toán/).waitFor();
      assert.equal(await page.getByText(/Thanh toán thành công/).count(), 0);
      await page.reload({ waitUntil: 'commit' });
      await page.getByText(/Đang chờ PayOS xác nhận thanh toán/).waitFor();
      assert.equal(checkoutPosts.length, 1);
      payment = { ...payment, status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED',
        applicationStatus: 'APPLIED', checkoutUrl: null };
      await page.waitForURL(base + '/portal/payments', { timeout: 14000, waitUntil: 'commit' });
      await page.getByText('Thanh toán đã được xác minh và ghi nhận thành công.').waitFor();
    } else if (mode === 'provider-error') {
      await page.reload({ waitUntil: 'commit' });
      await page.getByText(/Chưa thể xác nhận liên kết thanh toán/).waitFor();
      assert.equal(checkoutPosts.length, 1);
      await confirmBooking();
      await page.waitForURL(base + paymentPage, { waitUntil: 'commit' });
      await page.getByText(/Chưa thể xác nhận liên kết thanh toán/).waitFor();
      assert.equal(bookingPosts.length, 1, 'a saved Reservation is reused after checkout failure');
      assert.equal(checkoutPosts.length, 1);
    }
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []);
    return { mode, bookingPosts: bookingPosts.length, checkoutPosts: checkoutPosts.length, hostedVisits };
  } catch (error) {
    const visible = (await page.locator('main').first().innerText().catch(() => '')).slice(0, 1800);
    throw new Error(mode + ': ' + error.message + '\n' + visible + '\nUnexpected requests: ' + unexpected.join(', '));
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const mode of ['new', 'contract-missing', 'ready', 'unknown', 'provider-error', 'unsafe-url']) {
      console.log(JSON.stringify(await scenario(browser, mode)));
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

