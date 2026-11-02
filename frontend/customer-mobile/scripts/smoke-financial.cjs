const assert = require('node:assert/strict'), fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:8091';
(async () => {
  fs.mkdirSync('artifacts/phase5a', {recursive:true});
  const browser = await chromium.launch({headless:true, channel:'msedge'});
  try {
    const context = await browser.newContext({viewport:{width:390,height:900}}), page = await context.newPage(), requests = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type() === 'error') errors.push(m.text());});
    await context.route('**/*', route => {
      const r = route.request(); requests.push({url:r.url(),method:r.method()});
      return new URL(r.url()).origin === base ? route.continue() : route.abort('blockedbyclient');
    });
    const screen = id => page.locator('[data-testid="screen-' + id + '"]:visible');
    const btn = (root,name) => root.getByRole('button',{name,exact:true});
    const back = async root => btn(root,'Trở về màn hình trước').click();
    const overflow = async label => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),label);
    const shot = async name => page.screenshot({path:'artifacts/phase5a/' + name + '.png'});
    const login = async () => {
      await screen('login').waitFor(); await page.getByLabel('Mật khẩu bản mẫu',{exact:true}).fill('VaultDemo123!');
      await btn(page,'Đăng nhập bản mẫu').click(); await screen('home').waitFor();
    };
    const choose = async (root,label) => {
      const expand = btn(root,'Xem tình huống khác');
      if(await expand.count()) await expand.click();
      await btn(root,label).click();
    };
    await page.goto(base); await login();
    for(const width of [320,375,390,430,768]) {
      await page.setViewportSize({width,height:900});
      await page.getByText('Kho thuê',{exact:true}).last().click();
      const rentals = screen('rentals'); await btn(rentals,'Xem thông tin kỳ thuê').nth(0).click();
      const detail = screen('rental-detail'); await detail.waitFor();
      await btn(detail,'Xem hợp đồng minh họa').click();
      const contract = screen('contract-review'); await contract.waitFor();
      await contract.getByText('Hai bên đã ký cùng phiên bản · dữ liệu minh họa',{exact:true}).waitFor();
      await overflow('contract ' + width); await shot('contract-' + width);
      await contract.getByRole('checkbox',{name:'Tôi đã đọc nội dung hợp đồng minh họa.',exact:true}).click();
      assert(await btn(contract,'Đã ghi nhận đủ hai bên · chỉ xem').isDisabled());
      assert(await btn(contract,'Tải PDF · chưa khả dụng').isDisabled());
      await shot('contract-ack-' + width); await back(contract); await detail.waitFor();
      await btn(detail,'Xem chi tiết thanh toán').click();
      const payment = screen('payment-detail'); await payment.waitFor();
      await payment.getByText('Thanh toán số dư kỳ đầu',{exact:true}).waitFor();
      assert(await btn(payment,'Thanh toán · chưa kết nối').isDisabled());
      assert(await btn(payment,'Làm mới trực tuyến · chưa khả dụng').isDisabled());
      await overflow('payment ' + width); await shot('payment-' + width);
      await btn(payment,'Tiền thuê trả trước').click(); await payment.getByText('Khoản trả trước, cấn trừ tiền thuê',{exact:true}).waitFor();
      await back(payment); await detail.waitFor(); await back(detail); await rentals.waitFor();
      await btn(rentals,'Xem thông tin kỳ thuê').nth(1).click(); await detail.waitFor();
      await btn(detail,'Xem hợp đồng minh họa').click(); await contract.getByText('Hợp đồng chưa khả dụng',{exact:true}).waitFor();
      await shot('contract-unavailable-' + width);
      await choose(contract,'Tài liệu sẵn sàng đọc · hai bên chờ ký');
      await contract.getByText('Bản nháp · chưa có chữ ký được ghi nhận',{exact:true}).waitFor();
      await contract.getByRole('checkbox',{name:'Tôi đã đọc nội dung hợp đồng minh họa.',exact:true}).click();
      assert(await btn(contract,'Ký hợp đồng · chưa kết nối').isDisabled());
      await choose(contract,'Khách hàng đã ký · chờ đại diện kho');
      await contract.getByText('Khách hàng đã ký · chờ đại diện cơ sở (mẫu)',{exact:true}).waitFor();
      assert.notEqual(await contract.getByRole('checkbox').getAttribute('aria-checked'),'true');
      await contract.getByText('☐ Tôi đã đọc nội dung hợp đồng minh họa.',{exact:true}).waitFor();
      await choose(contract,'Chữ ký khác phiên bản');
      await contract.getByText('Chữ ký được ghi nhận trên phiên bản hoặc nội dung khác. Không coi là hợp đồng đã ký đủ.',{exact:true}).waitFor();
      await overflow('mismatch ' + width); await shot('contract-mismatch-' + width);
      await choose(contract,'Hai bên cùng phiên bản · chưa thanh toán số dư');
      await contract.getByText('Hai bên đã ký cùng phiên bản · dữ liệu minh họa',{exact:true}).waitFor();
      await back(contract); await detail.waitFor(); await btn(detail,'Xem chi tiết thanh toán').click(); await payment.waitFor();
      await payment.getByText('Chờ thanh toán · mẫu',{exact:true}).waitFor();
      for(const [label,status] of [
        ['Tiền thuê trả trước thất bại','Thanh toán thất bại · mẫu'],
        ['Yêu cầu trả trước hết hiệu lực','Hết hiệu lực · mẫu'],
        ['Kết quả thanh toán chưa xác định','Chưa xác định kết quả · mẫu']
      ]) {await choose(payment,label);await payment.getByText(status,{exact:true}).waitFor();assert(await btn(payment,'Thanh toán · chưa kết nối').isDisabled());}
      await choose(payment,'Đã trả đủ kỳ đầu · nhân viên chưa kích hoạt');
      await payment.getByText('Không cần thanh toán thêm · dữ liệu mẫu',{exact:true}).waitFor();
      await choose(payment,'Đã cấn trừ đủ tổng thuê · không tạo thanh toán 0'); await btn(payment,'Số dư ban đầu').click();
      await payment.getByText('Không tạo yêu cầu thanh toán 0 VND.',{exact:true}).waitFor();
      await overflow('zero balance ' + width); await shot('zero-balance-' + width);
      await choose(payment,'Thiếu dữ liệu tài chính'); await payment.getByText('Dữ liệu tài chính chưa nhất quán',{exact:true}).waitFor();
      await overflow('missing finance ' + width); await shot('missing-finance-' + width);
      await back(payment); await detail.waitFor(); await back(detail); await rentals.waitFor();
      await page.getByText('Tài khoản',{exact:true}).last().click(); await btn(page,'Đăng xuất bản mẫu').click(); await login();
    }
    await page.getByText('Tài khoản',{exact:true}).last().click(); await btn(page,'Đăng xuất bản mẫu').click();
    await page.goto(base + '/rentals/rental-south/contract'); await screen('login').waitFor();
    await page.goto(base + '/rentals/rental-east/payment'); await screen('login').waitFor();
    assert.deepEqual(errors,[]);
    assert(!requests.some(r => !['GET','HEAD'].includes(r.method)));
    assert(!requests.some(r => /localhost:5000|127\.0\.0\.1:5000|\/api\/v1/.test(r.url)));
    const result = {result:'PASS',target:'Supplementary React Native Web preview; NOT native device E2E',widths:[320,375,390,430,768],checks:'Rental entry/Back; both purposes; local acknowledgement; disabled sign/PDF/payment/refresh; unavailable/draft/partial/signed/version mismatch; failed/expired/unknown/settled/zero/missing finance; demo guard; no horizontal document overflow',mutations:0,backendRequests:0,pageErrors:errors};
    fs.writeFileSync('artifacts/phase5a/smoke-result.json',JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
  } finally {await browser.close();}
})().catch(e => {console.error(e);process.exitCode=1;});
