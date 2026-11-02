const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base='http://127.0.0.1:8091';
(async()=>{fs.mkdirSync('artifacts/screenshots',{recursive:true});const browser=await chromium.launch({headless:true,channel:'msedge'});try{const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>{const req=route.request();requests.push({url:req.url(),method:req.method()});return new URL(req.url()).origin===base?route.continue():route.abort('blockedbyclient');});
await page.goto(base);await page.getByTestId('screen-login').waitFor();await page.screenshot({path:'artifacts/screenshots/01-login-390.png'});
await page.getByRole('button',{name:'Khám phá đăng ký',exact:true}).click();await page.getByTestId('screen-register').waitFor();await page.getByRole('button',{name:'Trở về đăng nhập',exact:true}).click();await page.getByTestId('screen-login').waitFor();
await page.getByLabel('Mật khẩu bản mẫu',{exact:true}).fill('VaultDemo123!');await page.getByRole('button',{name:'Đăng nhập bản mẫu',exact:true}).click();await page.getByTestId('screen-home').waitFor();await page.screenshot({path:'artifacts/screenshots/02-home-390.png'});
const tabs=[['Khám phá','screen-explore','03-explore'],['Kho thuê','screen-rentals','04-rentals'],['Hàng hóa','screen-inventory','05-inventory'],['Tài khoản','screen-profile','06-profile']];
for(const [label,id,name] of tabs){await page.getByText(label,{exact:true}).last().click();await page.getByTestId(id).waitFor();await page.screenshot({path:'artifacts/screenshots/'+name+'-390.png'});}
await page.getByText('Khám phá',{exact:true}).last().click();const explore=page.getByTestId('screen-explore');await explore.getByRole('button',{name:'Xem VaultSpace Nam Sài Gòn',exact:true}).click();await page.getByTestId('screen-detail').waitFor();await page.getByRole('button',{name:'Trở về màn hình trước',exact:true}).click();await explore.waitFor();
await explore.getByLabel('Tìm cơ sở',{exact:true}).fill('khong co');await explore.getByText('Chưa tìm thấy cơ sở',{exact:true}).waitFor();await explore.getByRole('button',{name:'Thử lại',exact:true}).click();
for(const width of [320,390,768]){await page.setViewportSize({width,height:844});for(const label of ['Trang chủ','Khám phá','Kho thuê','Hàng hóa','Tài khoản']){await page.getByText(label,{exact:true}).last().click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width+' '+label);}await page.getByText('Trang chủ',{exact:true}).last().click();await page.screenshot({path:'artifacts/screenshots/home-'+width+'.png'});}
await page.getByText('Tài khoản',{exact:true}).last().click();await page.getByRole('button',{name:'Đăng xuất bản mẫu',exact:true}).click();await page.getByTestId('screen-login').waitFor();
await page.goto(base+'/explore');await page.getByTestId('screen-login').waitFor();
assert.deepEqual(errors,[]);assert(!requests.some(r=>!['GET','HEAD'].includes(r.method)));assert(!requests.some(r=>/localhost:5000|127\.0\.0\.1:5000|\/api\/v1/.test(r.url)));
console.log(JSON.stringify({result:'PASS',target:'supplementary React Native Web preview; NOT device testing',screens:6,widths:[320,390,768],checks:'local demo login/logout, auth register/back, five tabs, native-stack route/back, empty search, no document overflow',mutations:0,backendRequests:0,requests:requests.length}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
