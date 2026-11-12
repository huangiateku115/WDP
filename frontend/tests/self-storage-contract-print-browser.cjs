const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.WDP_PLAYWRIGHT_MODULE || 'C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const origin = process.env.SELF_PAYMENT_TEST_URL || 'http://127.0.0.1:5199';
const [reservationId, customerId, contractId, facilityId, storageUnitId] = [...'12345'].map(d => d.repeat(24));
const terms = { documentCode: 'FIXTURE', version: '1', versionId: 'FIXTURE@1', status: 'PUBLISHED',
  effectiveFrom: '2026-01-01T00:00:00Z', services: ['SELF_STORAGE'],
  groups: [{ title: 'Điều khoản đã chấp nhận', appliesTo: ['SELF_STORAGE'], sections: { SELF_STORAGE: ['Điều khoản fixture đầy đủ'] } }] };
const content = { schemaVersion: 1, reservationId, customerId, facilityId, storageUnitId, serviceType: 'SELF_STORAGE',
  rentalPaymentFlow: 'FULL_UPFRONT_V1', pricing: { estimatedRent: 50000, currency: 'VND' },
  termsAcceptance: { documentCode: terms.documentCode, version: terms.version, versionId: terms.versionId,
    acceptedAt: '2026-11-12T00:00:00Z', serviceType: 'SELF_STORAGE',
    contentHash: createHash('sha256').update(JSON.stringify(terms)).digest('hex') } };
const messages = { CONTRACTED: 'Chờ thanh toán 100% tiền thuê.', PAID: 'Đã thanh toán — Chờ ký hợp đồng giấy.',
  CHECKIN_READY: 'Hợp đồng đã xác minh — Chờ bàn giao.', ACTIVE: 'Đã bàn giao — Đang thuê.', CANCELLED: 'Đơn thuê đã hủy.' };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [status, width] of [['CONTRACTED', 390], ['PAID', 390], ['PAID', 1440], ['CHECKIN_READY', 1440], ['ACTIVE', 390], ['CANCELLED', 390], ['STAGED', 1440]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      const user = { id: customerId, _id: customerId, role: 'CUSTOMER', displayName: 'Fixture' };
      const verified = ['CHECKIN_READY', 'ACTIVE'].includes(status);
      const reservation = { _id: reservationId, customerId, serviceType: 'SELF_STORAGE',
        status: status === 'STAGED' ? 'DEPOSIT_PAID' : status,
        ...(status !== 'STAGED' ? { rentalPaymentFlow: 'FULL_UPFRONT_V1' } : {}),
        signingDeadline: '2099-11-13T05:55:00Z', expiresAt: '2099-11-13T05:55:00Z' };
      const contract = { _id: contractId, customerId, reservationId, contractCode: 'CTR-FIXTURE',
        status: verified ? 'SIGNED' : 'DRAFT', ...(verified ? { verifiedAt: '2026-11-13T05:55:00Z' } : {}),
        currentContentVersion: 1, contentVersions: [{ version: 1, contentHash: 'a'.repeat(64), content }] };
      const mutations = [], termPaths = [];
      await context.addInitScript(identity => {
        if (window.top === window) {
          sessionStorage.setItem('SelfStorage_token', 'fixture-only');
          sessionStorage.setItem('SelfStorage_user', JSON.stringify(identity));
        }
        window.printCalls = 0;
        window.print = () => { window.printCalls++; };
      }, user);
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin === origin && !url.pathname.startsWith('/api/v1')) return route.continue();
        if (!url.pathname.startsWith('/api/v1')) return route.abort();
        if (req.method() !== 'GET') { mutations.push(req.method() + url.pathname); return route.abort(); }
        const path = url.pathname.slice(7);
        if (path.startsWith('/public/terms/')) {
          termPaths.push(path);
          assert.equal(path, '/public/terms/FIXTURE%401');
          assert.equal(url.searchParams.get('serviceType'), 'SELF_STORAGE');
          if (width === 390) return route.fulfill({ status: 404, json: { success: false } });
          return route.fulfill({ json: { success: true, data: terms } });
        }
        const data = path === '/reservations/me' ? [reservation]
          : path === '/contracts/reservation/' + reservationId || path === '/contracts/' + contractId ? contract
          : path.endsWith('/me') ? user : [];
        return route.fulfill({ json: { success: true, data } });
      });
      const page = await context.newPage();
      await page.goto(origin + '/portal/contracts/' + reservationId);
      const print = page.getByRole('button', { name: 'In hợp đồng / Lưu PDF' });
      await print.waitFor();
      const sign = page.getByRole('button', { name: 'Xác nhận chữ ký hợp đồng', exact: true });
      if (status === 'STAGED') await sign.waitFor();
      else {
        await page.getByText(messages[status], { exact: true }).waitFor();
        assert.equal(await sign.count(), 0);
        assert.equal(await page.getByText(/Hiện chưa đủ điều kiện ký hợp đồng/).count(), 0);
      }
      if (status === 'PAID') {
        await page.getByText(/Vui lòng đến cơ sở để ký hợp đồng giấy trước/).waitFor();
        await print.click();
        const frame = page.frameLocator('iframe[title="Nội dung hợp đồng A4"]');
        await frame.getByText('50.000 ₫', { exact: true }).waitFor();
        if (width === 390) await frame.getByText(/chưa thay thế hợp đồng giấy chính thức/).waitFor();
        else await frame.getByText('Điều khoản fixture đầy đủ', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'In / Lưu PDF', exact: true }).click();
        await frame.locator('body').evaluate(el => {
          if (!el.ownerDocument.defaultView.printCalls) throw Error('Browser print was not invoked');
        });
        assert.equal(termPaths.length, 1);
      }
      assert.deepEqual(mutations, []);
      await context.close();
      console.log('PASS', status, width);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
