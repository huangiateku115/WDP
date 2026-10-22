const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fid='1'.repeat(24),uid='2'.repeat(24),pid='3'.repeat(24),rid='4'.repeat(24),cid='5'.repeat(24),foreign='6'.repeat(24);
let mode='',unitStatus='AVAILABLE',verified=true,price=3000000,status='RESERVED',contractStatus='DRAFT',created=null;
const facility={_id:fid,name:'Self Storage fixture facility',serviceTypes:['SELF_STORAGE']};
const unit=()=>({_id:uid,facilityId:fid,status:unitStatus,size:'SMALL',unitCode:'UNIT-FIXTURE',volumeM3:9});
const rule=()=>({_id:pid,facilityId:fid,serviceType:'SELF_STORAGE',unitSize:'SMALL',isActive:true,term:{value:1,unit:'MONTH'},price,currency:'VND',effectiveFrom:'2020-01-01T00:00:00Z'});
const estimate=body=>{const durationDays=Math.ceil((Date.parse(body.endDate)-Date.parse(body.startDate))/86400000);return {estimatedRent:Math.round(durationDays/30*price),depositAmount:durationDays<30?Math.round(price*.5):price,taxAmount:0,durationDays,basePrice:price};};
const reservation=()=>({...created,_id:rid,serviceType:'SELF_STORAGE',status,reservationCode:'BKG-FIXTURE',facilityId:facility,storageUnitId:unit(),expiresAt:new Date(Date.now()+86400000).toISOString()});
const contract=()=>({_id:cid,reservationId:{_id:rid,serviceType:'SELF_STORAGE'},status:contractStatus,contractCode:'CTR-SELF-FIXTURE',pricingSnapshot:{estimatedRent:created?.estimatedRent,depositAmount:created?.depositAmount},...(contractStatus==='SIGNED'?{signedByCustomerAt:'2030-01-01T00:00:00Z'}:{})});
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),calls=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/api/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1',''),method=req.method(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};if(method==='OPTIONS')return route.fulfill({status:204,headers});
  let body;try{body=req.postDataJSON();}catch{}calls.push({path,method,body,auth:req.headers().authorization});let data,code=200,message;
  if(path==='/public/facilities')data=[facility,{_id:'a'.repeat(24),name:'Managed only',serviceTypes:['MANAGED_INVENTORY']}];
  else if(path===`/public/facilities/${fid}`)data=facility;
  else if(path.endsWith('/storage-options')||path.endsWith('/pricing'))data={};
  else if(path===`/facilities/${fid}/storage-units`)data=[unit()];
  else if(path===`/storage-units/${uid}`)data=unit();
  else if(path==='/pricing-rules')data=[rule()];
  else if(path==='/pricing-rules/resolve')data=rule();
  else if(path==='/policies/resolve'){code=404;message='No effective rule';}
  else if(path==='/customers/me/profile'){data={verificationStatus:verified?'VERIFIED':'PENDING'};if(mode==='auth'){code=401;message='Authentication required';}}
  else if(path==='/reservations/estimate'){data=mode==='invalid-estimate'?{estimatedRent:'not numeric'}:estimate(body);if(mode==='estimate-failure'){code=500;message='Private MongoServerError stack';}}
  else if(path==='/reservations'&&method==='POST'){
   if(mode==='network')return route.abort('failed');
   if(mode==='conflict'){code=409;message='Kho này đã có người đặt trong khoảng thời gian bạn chọn. Vui lòng chọn ngày hoặc kho khác.';}
   else if(mode==='malformed'){data={_id:rid,status:'RESERVED'};}
   else{await new Promise(r=>setTimeout(r,200));created={...body,...estimate(body)};status='RESERVED';data=reservation();}
  }
  else if(path==='/reservations/me')data=created?[reservation()]:[];
  else if(path===`/reservations/${rid}/cancel`){status='CANCELLED';data=reservation();}
  else if(path==='/contracts/me')data=created?[contract()]:[];
  else if(path===`/contracts/${cid}`&&method==='GET')data=contract();
  else if(path===`/contracts/${cid}/sign`){contractStatus='SIGNED';data=contract();}
  else if(path===`/reservations/${rid}/mock-pay`){status='PAID';data=reservation();}
  else if(path==='/access/me')data=[];
  else throw Error('Unexpected fixture request '+method+' '+path);
  await route.fulfill({status:code,headers,json:{success:code===200,data,...(message?{message}:{}),...(['/public/facilities','/pricing-rules',`/facilities/${fid}/storage-units`].includes(path)?{pagination:{totalPages:1}}:{})}});
 });
 async function login(){await page.goto('http://127.0.0.1:5198/login');await page.evaluate(()=>{localStorage.setItem('SelfStorage_token','fixture-self');localStorage.setItem('SelfStorage_refreshToken','fixture-refresh');localStorage.setItem('SelfStorage_user',JSON.stringify({id:'customer-fixture',role:'CUSTOMER'}));});}
 async function booking(){await page.goto('http://127.0.0.1:5198/portal/rent?facility='+fid);await page.getByRole('button',{name:'Select Unit',exact:true}).click();await page.waitForURL('**/portal/rent/period');await page.getByLabel('Move-in date').fill('2030-01-31');await page.getByRole('combobox',{name:'Select Commitment Duration'}).click();await page.getByRole('option',{name:'1 Month',exact:true}).click();}
 async function review(){await booking();await page.getByRole('button',{name:'Review Reservation',exact:true}).click();await page.waitForURL('**/portal/rent/review');await page.getByText('Duration (days)',{exact:true}).waitFor();}
 async function action(label){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Confirm action',exact:true}).click();}

 await login();for(const width of [320,390,768,1024,1440,1920]){await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5198/portal/rent?facility='+fid);await page.getByRole('button',{name:'Select Unit',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Managed Inventory · Select Cells',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Self Storage · Rent a unit',exact:true}).count(),0);assert.deepEqual(await page.locator('.portal-step-text > span').allTextContents(),[]);assert.equal(await page.locator('.portal-step').count(),4);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'.design-reference/simplified-rent-'+width+'.png'});}assert.deepEqual(errors,[]);console.log('PASS Self Storage entry: no tabs, 4 steps, 6 widths, fixture GETs only');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
