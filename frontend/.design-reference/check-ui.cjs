const { chromium } = require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
 const browser = await chromium.launch({headless:true, channel:'msedge'});
 const page = await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[]; page.on('pageerror', error=>errors.push(error.message));
 const paths=['/login','/register','/portal','/portal/rent','/portal/rent/period','/portal/rent/review','/portal/reservations/VS-2025-0849','/portal/contracts/VS-2025-0849','/portal/payments/VS-2025-0849','/portal/handover/VS-2025-0849','/portal/inventory','/portal/support'];
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});
  for(const path of paths) {
   await page.goto('http://127.0.0.1:5173'+path,{waitUntil:'networkidle'});
   await page.waitForTimeout(450);
   const data=await page.evaluate(()=>({title:document.querySelector('h1')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth,brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length}));
   console.log(JSON.stringify({width,path,...data}));
   if(['/login','/portal','/portal/rent'].includes(path)) await page.screenshot({path:'.design-reference/preview-'+path.replaceAll('/','-')+'-'+width+'.png',fullPage:true});
  }
 }
 console.log(JSON.stringify({errors})); await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
