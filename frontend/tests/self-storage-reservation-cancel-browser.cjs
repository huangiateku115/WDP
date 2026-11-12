const assert = require('node:assert/strict');
const { chromium } = require(process.env.WDP_PLAYWRIGHT_MODULE || 'C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const origin = process.env.SELF_PAYMENT_TEST_URL || 'http://127.0.0.1:5198';
const id = '1'.repeat(24), customerId = '2'.repeat(24);
const cases = [
  ['unpaid', 'CONTRACTED', true], ['verified-cancel', 'CONTRACTED', true],
  ['ready', 'CONTRACTED', false], ['unknown', 'CONTRACTED', false],
  ['unverified', 'CONTRACTED', undefined], ['paid', 'PAID'],
  ['checkin', 'CHECKIN_READY'], ['active', 'ACTIVE'], ['cancelled', 'CANCELLED'],
  ['wrong-owner', 'CONTRACTED'], ['rejected', 'CONTRACTED', true],
  ['staged', 'CONTRACTED', true], ['managed', 'ACTIVE', true],
];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [name, status, eligible] of cases) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const user = { id: customerId, _id: customerId, role: 'CUSTOMER', displayName: 'Fixture' };
      const managed = name === 'managed';
      let reservation = { _id: id, customerId, status, serviceType: managed ? 'MANAGED_INVENTORY' : 'SELF_STORAGE',
        ...(name !== 'staged' ? { rentalPaymentFlow: 'FULL_UPFRONT_V1' } : {}),
        customerCancellationEligible: eligible, estimatedRent: 100000, startDate: '2099-01-01T00:00:00Z',
        endDate: '2099-02-01T00:00:00Z', expiresAt: '2098-12-31T05:55:00Z' };
      let patches = 0, reads = 0;
      await context.addInitScript(identity => {
        sessionStorage.setItem('SelfStorage_token', 'fixture-only');
        sessionStorage.setItem('SelfStorage_user', JSON.stringify(identity));
      }, user);
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin === origin && !url.pathname.startsWith('/api/v1')) return route.continue();
        if (!url.pathname.startsWith('/api/v1')) return route.abort();
        const path = url.pathname.slice(7);
        if (req.method() === 'PATCH') {
          assert.equal(path, '/reservations/' + id + '/cancel');
          patches++;
          if (name === 'rejected') return route.fulfill({ status: 409, json: { success: false, message: 'Giao dịch cần đối soát.' } });
          reservation = { ...reservation, status: 'CANCELLED', customerCancellationEligible: false };
          return route.fulfill({ json: { success: true, data: reservation } });
        }
        assert.equal(req.method(), 'GET');
        if (path === '/reservations/me') reads++;
        const data = path === '/reservations/me' ? (name === 'wrong-owner' ? [] : [reservation])
          : path === '/reservations/managed/' + id ? reservation : path === '/contracts/me' ? []
          : path.endsWith('/me') ? user : [];
        return route.fulfill({ json: { success: true, data } });
      });
      const page = await context.newPage();
      await page.goto(origin + '/portal/reservations/' + id);
      await page.locator('h1').waitFor();
      if (name !== 'wrong-owner') await page.getByRole('button', { name: managed ? 'Refresh status' : 'Kiểm tra trạng thái', exact: true }).waitFor();
      else await page.getByRole('alert').waitFor();
      const trigger = page.getByRole('button', { name: 'Hủy đơn thuê', exact: true });
      if (['unpaid', 'verified-cancel', 'rejected'].includes(name)) {
        await page.getByText('Chờ thanh toán 100% tiền thuê', { exact: true }).waitFor();
        await page.getByText('01/01/2099', { exact: true }).waitFor();
        await page.getByText(/12:55.*31\/12\/2098/).waitFor();
        await trigger.click();
        assert.equal(patches, 0);
        const confirm = page.getByRole('button', { name: 'Xác nhận hủy đơn thuê', exact: true });
        await confirm.evaluate(button => { button.click(); button.click(); });
        if (name === 'rejected') await page.getByText('Giao dịch cần đối soát.').waitFor();
        else {
          await page.getByText('Đã hủy đơn thuê', { exact: true }).waitFor();
          assert.ok(reads >= 2);
          assert.equal(await page.getByRole('link', { name: /thanh toán qua PayOS/i }).count(), 0);
        }
        assert.equal(patches, 1);
      } else {
        assert.equal(await trigger.count(), 0);
        assert.equal(patches, 0);
        if (name === 'cancelled') assert.equal(await page.getByRole('link', { name: /thanh toán qua PayOS/i }).count(), 0);
        if (name === 'staged') await page.getByText('Booking confirmed — advance-rent Deposit pending').waitFor();
      }
      await context.close();
      console.log('PASS', name);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
