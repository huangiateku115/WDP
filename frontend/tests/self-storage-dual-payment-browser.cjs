const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const { chromium } = require(process.env.WDP_PLAYWRIGHT_MODULE ||
  'C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const origin = process.env.SELF_PAYMENT_TEST_URL || 'http://127.0.0.1:5198';
const [id, owner, facilityId, contractId, unitId, paymentId] = '123456'.split('').map(value => value.repeat(24));
const url = 'https://pay.payos.vn/web/dual-fixture';
const qrCode = '00020101021229370016A0000006770101110113006688123456785204581253037045802VN6304ABCD';
const details = { bin: '970436', accountNumber: '00001234', accountName: 'PAYOS FIXTURE', description: 'WDPF11111' };

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const expectedQr = await QRCode.toDataURL(qrCode, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
    for (const scenario of ['create', 'focus-cancel', 'lookup-error', 'hosted-only', 'unknown', 'expired', 'verified', 'applied', 'return', 'failed', 'cancelled', 'checkin', 'wrong-reservation', 'wrong-owner', 'staged', 'managed']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' });
      const user = { _id: owner, id: owner, role: 'CUSTOMER', displayName: 'Fixture' };
      const managed = scenario === 'managed';
      const staged = scenario === 'staged';
      const serviceType = managed ? 'MANAGED_INVENTORY' : 'SELF_STORAGE';
      const reservation = { _id: id, customerId: owner, facilityId, storageUnitId: unitId, reservationCode: 'FIXTURE',
        serviceType, ...(managed ? { bookingFlowVersion: 3 } : {}), ...(staged ? {} : { rentalPaymentFlow: 'FULL_UPFRONT_V1' }),
        status: managed ? 'RESERVED' : scenario === 'checkin' ? 'CHECKIN_READY' : 'CONTRACTED',
        estimatedRent: 100000, startDate: '2099-01-01T00:00:00Z', endDate: '2099-02-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' };
      const contract = { _id: contractId, reservationId: id, customerId: owner, status: scenario === 'checkin' ? 'SIGNED' : 'DRAFT',
        signedProofUrl: 'https://fixture.invalid/proof', signedProofPublicId: 'fixture', verifiedAt: '2098-12-01T00:00:00Z' };
      const ready = { id: paymentId, reservationId: id, provider: 'PAYOS', amount: 100000, currency: 'VND', purpose: staged ? 'DEPOSIT' : 'FULL_RENT',
        status: 'PENDING', checkoutStatus: 'READY', providerSettlementStatus: 'NOT_VERIFIED', applicationStatus: 'NOT_APPLIED',
        checkoutUrl: url, qrCode, transferDetails: details, retryAllowed: false, reconciliationRequired: false, orderCode: 1234567890,
        paymentLinkId: 'dual-fixture', createdAt: '2098-12-01T00:00:00Z' };
      let payment = ['create','checkin','wrong-owner'].includes(scenario) ? null : { ...ready };
      if (scenario === 'hosted-only') Object.assign(payment, { qrCode: null, transferDetails: null });
      if (scenario === 'unknown') Object.assign(payment, { checkoutStatus: 'UNKNOWN' });
      if (scenario === 'expired') Object.assign(payment, { expiresAt: '2000-01-01T00:00:00Z' });
      if (['verified', 'applied'].includes(scenario)) Object.assign(payment, { status: 'SUCCEEDED', providerSettlementStatus: 'VERIFIED', applicationStatus: scenario === 'applied' ? 'APPLIED' : 'NOT_APPLIED' });
      if (scenario === 'failed') Object.assign(payment, { status: 'FAILED', checkoutStatus: 'FAILED' });
      if (scenario === 'cancelled') Object.assign(payment, { status: 'CANCELLED', checkoutStatus: 'CANCELLED', cancelVerifiedAt: '2098-12-01T00:00:00Z' });
      if (scenario === 'wrong-reservation') payment.reservationId = facilityId;
      const keys = [];
      const cancelledRows = [];
      let posts = 0, hosted = 0, reads = 0, reconciles = 0;
      let providerCancelled = scenario === 'focus-cancel';
      await context.addInitScript(identity => {
        sessionStorage.setItem('SelfStorage_token', 'fixture-only');
        sessionStorage.setItem('SelfStorage_user', JSON.stringify(identity));
      }, user);
      await context.route('**/*', async route => {
        const request = route.request(), parsed = new URL(request.url());
        if (parsed.href === url) { hosted++; return route.fulfill({ body: 'Hosted fixture' }); }
        if (parsed.origin === origin && !parsed.pathname.startsWith('/api/v1')) return route.continue();
        if (!parsed.pathname.startsWith('/api/v1')) return route.abort();
        const path = parsed.pathname.slice(7);
        const reservationPath = (managed ? '/reservations/managed/' : '/reservations/') + id;
        const paymentPath = reservationPath + '/payments/payos';
        if (path.endsWith('/reconcile')) {
          assert.equal(path, reservationPath + '/payments/' + payment.id + '/reconcile');
          reconciles++;
          if (scenario === 'lookup-error') return route.fulfill({ status: 503, json: { success: false, code: 'PAYMENT_RECONCILIATION_PENDING' } });
          if (providerCancelled && payment.status !== 'CANCELLED') {
            payment = { ...payment, status: 'CANCELLED', checkoutStatus: 'CANCELLED', checkoutUrl: null,
              qrCode: null, transferDetails: null, retryAllowed: true, cancelVerifiedAt: '2098-12-01T00:00:00Z' };
            cancelledRows.push(payment);
          }
          return route.fulfill({ json: { success: true, data: payment } });
        }
        if (request.method() !== 'GET') {
          assert.equal(path, paymentPath);
          assert.deepEqual(request.postDataJSON(), { purpose: 'FULL_RENT' });
          assert.match(request.headers()['idempotency-key'], /^wdp-/);
          keys.push(request.headers()['idempotency-key']);
          posts++;
          payment = posts === 1 ? ready : { ...ready, id: '7'.repeat(24), createdAt: '2098-12-02T00:00:00Z' };
          return route.fulfill({ status: 201, json: { success: true, outcome: 'CREATED', data: payment } });
        }
        if (path === '/reservations/' + id + '/payments/' + paymentId) reads++;
        if (scenario === 'wrong-owner' && path === '/reservations/' + id) return route.fulfill({ status: 404, json: { success: false } });
        const data = path === '/reservations/me' ? (scenario === 'wrong-owner' ? [] : [reservation])
          : path.startsWith('/contracts/reservation/') ? contract : path === '/contracts/me' ? [contract]
          : path === paymentPath ? { items: payment ? [payment, ...cancelledRows.filter(row => row.id !== payment.id)] : [], nextCursor: null }
          : path.includes('/payments/') ? (cancelledRows.find(row => path.endsWith('/' + row.id)) || payment)
          : path === reservationPath ? reservation
          : path.includes('storage-units') ? { _id: unitId, facilityId, status: 'AVAILABLE' }
          : path.includes('/facilities/') ? { _id: facilityId, name: 'Fixture Facility' }
          : path.endsWith('/me') ? user : [];
        return route.fulfill({ json: { success: true, data, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const path = scenario === 'return'
        ? '/portal/payments/return?reservationId=' + id + '&paymentId=' + paymentId + '&serviceType=SELF_STORAGE&cancel=true&status=PAID'
        : '/portal/payments/' + id;
      await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      await page.locator('h1').waitFor();
      const qr = page.getByRole('img', { name: 'Mã VietQR do PayOS cung cấp' });
      const openHosted = page.getByRole('button', { name: 'Mở trang PayOS' });
      const create = page.getByRole('button', { name: 'Tạo mã thanh toán PayOS' });
      if (scenario === 'create') {
        await create.waitFor();
        assert.equal(posts, 0);
        await create.evaluate(button => { button.click(); button.click(); });
        await qr.waitFor();
        const sameQrPixels = await qr.evaluate(async (actual, expectedSource) => {
          const expected = new Image();
          expected.src = expectedSource;
          await Promise.all([actual.decode(), expected.decode()]);
          const pixels = image => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const a = pixels(actual), b = pixels(expected);
          return a.length === b.length && a.every((value, index) => value === b[index]);
        }, expectedQr);
        assert.equal(sameQrPixels, true, 'browser QR encodes exactly the original PayOS payload');
        assert.equal(hosted, 0);
        assert.equal(posts, 1);
        await page.getByRole('button', { name: 'Sao chép nội dung chuyển khoản' }).click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), details.description);
        await page.getByRole('button', { name: 'Kiểm tra trạng thái' }).click();
        await qr.waitFor();
        assert.ok(reconciles > 0);
        for (const width of [390, 768, 1280, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          const heading = await page.getByRole('heading', { name: 'Chuyển khoản qua ứng dụng ngân hàng' }).boundingBox();
          const image = await qr.boundingBox();
          assert.ok(width === 390 ? image.y < heading.y : image.x < heading.x);
        }
        await Promise.all([page.waitForURL(url), openHosted.click()]);
        assert.equal(hosted, 1);
        assert.equal(posts, 1);
        providerCancelled = true;
        const cancelPath = '/portal/payments/return?reservationId=' + id + '&paymentId=' + paymentId + '&serviceType=SELF_STORAGE&cancel=true&status=CANCELLED&orderCode=999';
        const before = reconciles;
        await page.goto(origin + cancelPath);
        await page.getByText('Đã hủy thanh toán', { exact: true }).first().waitFor();
        assert.equal(reconciles, before + 1);
        await page.goto(origin + '/portal/payments/' + id);
        await page.getByText('Đã hủy thanh toán. Đơn thuê vẫn được giữ theo thời hạn hiện tại.').waitFor();
        assert.equal(await qr.count(), 0);
        assert.equal(await openHosted.count(), 0);
        assert.equal(posts, 1);
        const retry = page.getByRole('button', { name: 'Thanh toán lại', exact: true });
        await retry.evaluate(button => { button.click(); button.click(); });
        await qr.waitFor();
        assert.equal(posts, 2);
        assert.notEqual(keys[0], keys[1]);
        assert.notEqual(payment.id, paymentId);
      } else if (scenario === 'focus-cancel' || scenario === 'lookup-error') {
        await qr.waitFor();
        await page.evaluate(() => {
          window.dispatchEvent(new Event('focus'));
          window.dispatchEvent(new Event('focus'));
        });
        if (scenario === 'focus-cancel') await page.getByText('Đã hủy thanh toán. Đơn thuê vẫn được giữ theo thời hạn hiện tại.').waitFor();
        else await page.getByText(/Chưa xác minh được trạng thái giao dịch với PayOS/).first().waitFor();
        await qr.waitFor({ state: 'hidden' });
        assert.equal(await openHosted.count(), 0);
        assert.equal(reconciles, 1);
        assert.equal(posts, 0);
      } else if (managed || staged) {
        await page.getByRole('button', { name: 'Tiếp tục thanh toán qua PayOS' }).waitFor();
        assert.equal(await qr.count(), 0);
        assert.equal(posts, 0);
      } else if (scenario === 'hosted-only') {
        await openHosted.waitFor();
        assert.equal(await qr.count(), 0);
        assert.equal(posts, 0);
      } else {
        if (scenario === 'applied' || scenario === 'return') await page.waitForURL('**/portal/payments?*');
        else if (scenario === 'checkin') await page.getByText('Đã xác minh hợp đồng. Đơn thuê đang chờ bàn giao.').waitFor();
        else await page.waitForLoadState('networkidle');
        assert.equal(await qr.count(), 0, scenario);
        assert.equal(await openHosted.count(), 0, scenario);
        assert.equal(await page.getByRole('heading', { name: 'Thanh toán tiền thuê còn lại' }).count(), 0, scenario);
        assert.equal(await page.getByText(details.accountNumber, { exact: true }).count(), 0, scenario);
        assert.equal(posts, 0, scenario);
        if (scenario === 'return') {
          assert.equal(reconciles, 1);
          assert.equal(await page.getByText('Thanh toán đã được xác minh và ghi nhận thành công.').count(), 0);
        }
      }
      assert.deepEqual(errors, [], scenario);
      console.log('PASS', scenario);
      await context.close();
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
