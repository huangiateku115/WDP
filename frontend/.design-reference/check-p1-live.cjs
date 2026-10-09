const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext();const page=await context.newPage();const errors=[];const writes=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(['POST','PUT','PATCH','DELETE'].includes(request.method()))writes.push(request.url());});
 await page.addInitScript(()=>localStorage.setItem('VaultSpace_customer_priority1_demo_v1',JSON.stringify({profile:{fullName:'Fake saved profile'},items:[{name:'Fake saved item'}],payments:[{id:'FAKE-PAY'}],rentals:[{id:'FAKE-RENTAL'}],notifications:[{title:'Fake update'}]})));
 await page.route('http://localhost:5000/api/auth/me',route=>route.fulfill({json:{fullName:'Connected customer',email:'connected@example.com',phone:'0900000000'}}));
 await page.goto('http://127.0.0.1:5187/portal/profile',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Connected customer',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Edit profile',exact:true}).isDisabled());
 for(const path of ['/portal/payments','/portal/inventory','/portal/inventory/register','/portal/notifications','/portal/rentals/FAKE-RENTAL/access']){await page.goto('http://127.0.0.1:5187'+path,{waitUntil:'networkidle'});assert(!/Fake saved|FAKE-PAY|DEMO-4821/.test(await page.locator('body').innerText()));}
 assert.equal(await page.getByRole('button',{name:'Reveal demo code'}).count(),0);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await browser.close();console.log('PASS: live mode ignores demo storage, profile reads existing API, unsupported writes disabled, no invented endpoints');
})().catch(error=>{console.error(error);process.exit(1)});
