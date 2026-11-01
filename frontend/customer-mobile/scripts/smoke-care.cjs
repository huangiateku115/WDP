const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:8091';
(async () => {
  fs.mkdirSync('artifacts/phase5b', {recursive: true});
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  try {
    const context = await browser.newContext({viewport: {width: 390, height: 900}}), page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    await context.route('**/*', route => {const r = route.request(); requests.push({url: r.url(), method: r.method()}); return new URL(r.url()).origin === base ? route.continue() : route.abort('blockedbyclient');});
    const active = id => page.locator('[data-testid="screen-' + id + '"]:visible');
    const button = (root, name) => root.getByRole('button', {name, exact: true});
    const tap = async (root, name) => {
      const target = button(root, name);
      for (let i = 0; i < 12 && !await target.count(); i++) {
        await root.evaluate(el => {for (const n of [el, ...el.querySelectorAll('*')]) if (n.scrollHeight > n.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(n).overflowY)) n.scrollBy(0, 550);});
        await page.waitForTimeout(75);
      }
      let lastError;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {await target.click({timeout: 5000}); return;} catch (error) {lastError = error; await page.waitForTimeout(150);}
      }
      await page.screenshot({path: 'artifacts/phase5b/failure.png'}); console.error('Browser errors:', errors); throw lastError;
    };
    const back = root => tap(root, 'Trở về màn hình trước');
    const overflow = async label => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'overflow ' + label);
    const shot = name => page.screenshot({path: 'artifacts/phase5b/' + name + '.png'});
    const login = async () => {await active('login').waitFor(); await page.getByLabel('Mật khẩu bản mẫu', {exact: true}).fill('VaultDemo123!'); await tap(page, 'Đăng nhập bản mẫu'); await active('home').waitFor();};
    const waitDialog = async text => page.waitForFunction(text => {const leaf = Array.from(document.querySelectorAll('*')).find(n => !n.childElementCount && n.textContent === text); if (!leaf) return false; for (let n = leaf; n; n = n.parentElement) {const style = getComputedStyle(n); if (Number(style.opacity) < .999 || style.display === 'none' || style.visibility === 'hidden') return false;} return true;}, text);
    await page.goto(base); await active('login').waitFor();
    for (const width of [320, 375, 390, 430, 768]) {
      await page.setViewportSize({width, height: 900});
      await tap(page, 'Khám phá đăng ký'); const registration = active('register'); await registration.waitFor();
      await overflow('registration ' + width); await shot('registration-' + width);
      await tap(registration, 'Tạo tài khoản · bản mẫu'); await registration.getByText('Vui lòng nhập họ và tên.', {exact: true}).waitFor();
      for (const [name, value] of Object.entries({'Họ và tên mẫu': 'Khách Mẫu', 'Email mẫu': 'demo@example.test', 'Số điện thoại mẫu': '0900000123', 'Mật khẩu mẫu': 'VaultDemo123!', 'Xác nhận mật khẩu': 'VaultDemo123!'})) await registration.getByLabel(name, {exact: true}).fill(value);
      await tap(registration, 'Hiện mật khẩu mẫu'); assert.equal(await registration.getByLabel('Mật khẩu mẫu', {exact: true}).evaluate(el => el.type), 'text');
      await tap(registration, 'Ẩn mật khẩu mẫu');
      await registration.getByRole('checkbox', {name: 'Đồng ý điều khoản và quyền riêng tư minh họa', exact: true}).click();
      await tap(registration, 'Tạo tài khoản · bản mẫu');
      await registration.getByText('Biểu mẫu hợp lệ. Chức năng tạo tài khoản sẽ khả dụng sau khi kết nối hệ thống.', {exact: true}).waitFor();
      assert.equal(await registration.getByLabel('Mật khẩu mẫu', {exact: true}).inputValue(), '');
      assert.equal(await registration.getByLabel('Xác nhận mật khẩu', {exact: true}).inputValue(), '');
      assert.equal(await active('home').count(), 0); await overflow('registration valid ' + width); await shot('registration-valid-' + width);
      await tap(registration, 'Trở về đăng nhập'); await login();
      const home = active('home'); await overflow('Home bell ' + width); await shot('home-bell-' + width); await home.getByRole('button', {name: /^Mở thông báo,/}).click();
      const notifications = active('notifications'); await notifications.waitFor(); await overflow('notifications ' + width); await shot('notifications-' + width);
      await tap(notifications, 'Đánh dấu đã đọc: Cập nhật kỳ thuê ký gửi');
      await notifications.getByText('8 thông báo chưa đọc', {exact: true}).waitFor();
      for (const [title, screen] of [
        ['Cập nhật kỳ thuê ký gửi', 'rental-detail'], ['Theo dõi bước xem hợp đồng', 'contract-review'],
        ['Theo dõi số dư kỳ đầu', 'payment-detail'], ['Lịch sử hàng hóa có cập nhật mẫu', 'item-detail'],
        ['Yêu cầu nhập thêm đang chờ · mẫu', 'inventory-request-detail'], ['Phản hồi hỗ trợ minh họa', 'support-detail'],
      ]) {await tap(notifications, 'Xem nội dung liên quan: ' + title); const destination = active(screen); await destination.waitFor(); await back(destination); await notifications.waitFor();}
      await tap(notifications, 'Xem nội dung liên quan: Tài nguyên mẫu không còn sẵn');
      await notifications.getByText('Nội dung liên quan chưa khả dụng', {exact: true}).waitFor();
      assert.equal(await active('item-detail').count(), 0);
      await tap(notifications, 'Đánh dấu tất cả đã đọc trong phiên'); await tap(notifications, 'Chưa đọc');
      await notifications.getByText('Không còn thông báo chưa đọc trong bản mẫu', {exact: true}).waitFor();
      await overflow('unread empty ' + width); await shot('notifications-read-' + width); await back(notifications); await home.waitFor();
      await home.getByRole('button', {name: 'Mở thông báo, 0 chưa đọc trong phiên', exact: true}).waitFor();
      await page.getByText('Tài khoản', {exact: true}).last().click(); await tap(active('profile'), 'Trung tâm hỗ trợ');
      const support = active('support'); await support.waitFor(); await overflow('support ' + width); await shot('support-' + width);
      await tap(support, 'Xem yêu cầu HT-MAU-002'); const detail = active('support-detail'); await detail.waitFor();
      await overflow('conversation ' + width); await shot('support-detail-' + width);
      assert(await button(detail, 'Gửi phản hồi · chưa khả dụng').isDisabled()); await back(detail); await support.waitFor();
      await tap(support, 'Xem yêu cầu HT-MAU-005'); await detail.getByText('Kỳ thuê liên quan chưa khả dụng.', {exact: true}).waitFor();
      await detail.getByText('Hàng hóa liên quan chưa khả dụng.', {exact: true}).waitFor(); await back(detail); await support.waitFor();
      await tap(support, 'Khác'); const form = active('support-form'); await form.waitFor();
      await tap(form, 'Lưu bản nháp hỗ trợ trong phiên'); await form.getByText('Tiêu đề cần từ 5 ký tự.', {exact: true}).waitFor();
      await form.getByLabel('Tiêu đề yêu cầu', {exact: true}).fill('Hỏi về cách xem hàng hóa');
      await form.getByLabel('Mô tả cần hỗ trợ', {exact: true}).fill('Nội dung giả để kiểm tra bản nháp hỗ trợ trong phiên.');
      await tap(form, 'VS-MAU-001'); await tap(form, 'PKG-0102'); await tap(form, 'Lưu bản nháp hỗ trợ trong phiên');
      await form.getByText('Hàng hóa và kỳ thuê liên quan không khớp.', {exact: true}).waitFor();
      await tap(form, 'MIR-HANG-MAU · ngữ cảnh hàng hóa'); await tap(form, 'Lưu bản nháp hỗ trợ trong phiên');
      await form.getByText('Đã lưu bản nháp yêu cầu hỗ trợ trong phiên — chưa gửi lên hệ thống.', {exact: true}).waitFor();
      await overflow('support draft ' + width); await shot('support-draft-' + width); await back(form); await support.waitFor();
      await tap(support, 'Tạo yêu cầu hỗ trợ'); await form.waitFor(); assert.equal(await form.getByLabel('Tiêu đề yêu cầu', {exact: true}).inputValue(), 'Hỏi về cách xem hàng hóa');
      await form.getByLabel('Tiêu đề yêu cầu', {exact: true}).fill('Thay đổi chưa lưu'); await back(form);
      await waitDialog('Rời biểu mẫu chưa lưu?'); await overflow('dirty dialog ' + width); await shot('support-discard-' + width);
      await tap(page, 'Tiếp tục chỉnh sửa'); await page.getByText('Rời biểu mẫu chưa lưu?', {exact: true}).waitFor({state: 'hidden'});
      await back(form); await waitDialog('Rời biểu mẫu chưa lưu?'); await tap(page, 'Bỏ thay đổi và rời trang'); await support.waitFor();
      await tap(support, 'Tạo yêu cầu hỗ trợ'); await form.waitFor(); assert.equal(await form.getByLabel('Tiêu đề yêu cầu', {exact: true}).inputValue(), 'Hỏi về cách xem hàng hóa');
      await tap(form, 'Xóa bản nháp hỗ trợ'); await waitDialog('Xóa bản nháp hỗ trợ trong phiên?');
      await tap(page, 'Xác nhận xóa bản nháp hỗ trợ'); await page.getByText('Xóa bản nháp hỗ trợ trong phiên?', {exact: true}).waitFor({state: 'hidden'});
      assert.equal(await form.getByLabel('Tiêu đề yêu cầu', {exact: true}).inputValue(), ''); await back(form); await support.waitFor();
      await back(support); await tap(active('profile'), 'Đăng xuất bản mẫu'); await active('login').waitFor();
      await login(); await active('home').getByRole('button', {name: 'Mở thông báo, 9 chưa đọc trong phiên', exact: true}).waitFor();
      await page.getByText('Tài khoản', {exact: true}).last().click(); await tap(active('profile'), 'Trung tâm hỗ trợ'); await support.waitFor();
      await tap(support, 'Tạo yêu cầu hỗ trợ'); await form.waitFor(); assert.equal(await form.getByLabel('Tiêu đề yêu cầu', {exact: true}).inputValue(), '');
      await back(form); await back(support); await tap(active('profile'), 'Đăng xuất bản mẫu'); await active('login').waitFor(); console.log(JSON.stringify({completedWidth: width}));
    }
    for (const url of ['/notifications', '/support/new', '/support/missing']) {await page.goto(base + url); await active('login').waitFor();}
    assert.deepEqual(errors, []); assert(!requests.some(r => !['GET', 'HEAD'].includes(r.method)));
    assert(!requests.some(r => /localhost:5000|127\.0\.0\.1:5000|\/api\/v1/.test(r.url)));
    const result = {result: 'PASS', target: 'Supplementary React Native Web preview; NOT native device E2E', widths: [320,375,390,430,768], checks: 'Registration validation/visibility/consent/no auth/password reset; demo login; bell/local read/filter/reset; validated resource navigation; unavailable target; Support list/detail/conversation/missing references; RHF draft validation/restore/dirty dialog/removal; logout/deep-link guard; document overflow', backendRequests: 0, mutations: 0, pageErrors: errors};
    fs.writeFileSync('artifacts/phase5b/smoke-result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
