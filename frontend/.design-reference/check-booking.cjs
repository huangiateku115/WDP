const assert = require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const go=async path=>{await page.goto('http://127.0.0.1:5173'+path,{waitUntil:'networkidle'});};
 await go('/portal/rent');
 assert.equal(await page.locator('aside').count(),0);
 assert.equal(await page.getByRole('navigation',{name:'Portal navigation'}).count(),1);
 assert(!/climate|humidity/i.test(await page.locator('body').innerText()));
 await page.getByRole('button',{name:'Select Unit',exact:true}).first().click();
 await page.waitForURL('**/portal/rent/period');
 const continueButton=page.getByRole('button',{name:'CONTINUE TO REVIEW'});
 assert(await continueButton.isDisabled());
 await page.getByLabel('Choose your move-in date').fill('2020-01-01');
 assert(await continueButton.isDisabled());
 await page.getByLabel('Choose your move-in date').fill('2027-01-31');
 await page.getByRole('button',{name:/3 MONTHS/}).click();
 assert.equal(await page.getByRole('button',{name:/3 MONTHS/}).getAttribute('aria-pressed'),'true');
 assert((await page.locator('body').innerText()).includes('10,780,000'));
 await page.reload({waitUntil:'networkidle'});
 assert.equal(await page.getByLabel('Choose your move-in date').inputValue(),'2027-01-31');
 assert.equal(await page.getByRole('button',{name:/3 MONTHS/}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'CONTINUE TO REVIEW'}).click();
 await page.waitForURL('**/portal/rent/review');
 await page.getByText(/30 Apr 2027/).waitFor();
 const submit=page.getByRole('button',{name:'SUBMIT RESERVATION'});
 assert(await submit.isDisabled());
 await page.locator('label[for="confirm-personal-data"]').click();
 assert(await submit.isEnabled());
 await page.getByLabel('Full legal name').fill('Test Customer');
 assert(await submit.isDisabled());
 await page.locator('label[for="confirm-personal-data"]').click();
 await submit.click();
 await page.waitForURL('**/portal/reservations/RES-*');
 await page.getByText('Test Customer!',{exact:true}).waitFor();
 await page.getByRole('button',{name:'VIEW RESERVATION'}).click();
 await page.waitForURL('**/portal/contracts');
 assert.equal(await page.getByRole('link',{name:'Review & confirm contract'}).count(),1);
 await page.reload({waitUntil:'networkidle'});
 assert.equal(await page.getByRole('link',{name:'Review & confirm contract'}).count(),1);
 await page.screenshot({path:'.design-reference/contracts-green-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'Review & confirm contract'}).click();
 await page.waitForURL('**/portal/contracts/RES-*');
 const sign=page.getByRole('button',{name:'CONFIRM CONTRACT & PROCEED TO PAYMENT'});
 assert(await sign.isDisabled());
 await page.locator('label[for="accept-contract"]').click();
 await sign.waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('#accept-contract').disabled && ![...document.querySelectorAll('button')].find(b=>b.textContent.includes('CONFIRM CONTRACT &')).disabled);
 // A failed signing request must leave the contract in the pending list.
 await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('contract_'))throw new Error('Signing unavailable for test');return window.originalSetItem.call(this,key,value);};});
 await sign.click();
 await page.getByRole('alert').waitFor();
 assert((await page.evaluate(()=>JSON.parse(localStorage.getItem('SelfStorage_pendingContracts'))))[0].contractStatus==='AWAITING_SIGNATURE');
 await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;});
 await sign.click();
 await page.waitForURL('**/portal/payments/RES-*');
 await page.getByRole('heading',{name:'Complete your payment'}).waitFor();
 assert((await page.locator('body').innerText()).includes('10,780,000'));
 await go('/portal/contracts');
 assert.equal(await page.getByRole('link',{name:'Review & confirm contract'}).count(),0);
 await page.reload({waitUntil:'networkidle'});
 assert.equal(await page.getByRole('link',{name:'Review & confirm contract'}).count(),0);
 console.log('PASS: selection, dates, duration/pricing, confirmation gating, submit, persistence, failed sign recovery, successful sign removal');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  for(const path of ['/portal','/portal/rent','/portal/rent/period','/portal/rent/review','/portal/contracts','/login','/register','/','/facilities','/pricing','/support']){
   await go(path);await page.waitForTimeout(400);
   const climate=await page.locator('body').innerText();assert(!/climate|humidity|dehumidified/i.test(climate),path);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,path+' overflow');
   if(['/portal','/portal/rent/period'].includes(path))await page.screenshot({path:'.design-reference/green-'+path.replaceAll('/','-')+'-'+width+'.png',fullPage:true});
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS: desktop/mobile pages, no climate content, no horizontal overflow, no runtime errors');
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});

