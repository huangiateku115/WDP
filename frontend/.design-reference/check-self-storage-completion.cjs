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
 async function login(){await page.goto('http://127.0.0.1:5189/login');await page.evaluate(()=>{localStorage.setItem('SelfStorage_token','fixture-self');localStorage.setItem('SelfStorage_refreshToken','fixture-refresh');localStorage.setItem('SelfStorage_user',JSON.stringify({id:'customer-fixture',role:'CUSTOMER'}));});}
 async function booking(){await page.goto('http://127.0.0.1:5189/portal/rent?facility='+fid);await page.getByRole('button',{name:'Select Unit',exact:true}).click();await page.waitForURL('**/portal/rent/period');await page.getByLabel('Move-in date').fill('2030-01-31');await page.getByRole('combobox',{name:'Select Commitment Duration'}).click();await page.getByRole('option',{name:'1 Month',exact:true}).click();}
 async function review(){await booking();await page.getByRole('button',{name:'Review Reservation',exact:true}).click();await page.waitForURL('**/portal/rent/review');await page.getByText('Duration (days)',{exact:true}).waitFor();}
 async function action(label){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Confirm action',exact:true}).click();}
 await login();await review();assert.equal(await page.getByRole('option',{name:'Managed only',exact:true}).count(),0);assert.equal(await page.getByText('Total due',{exact:true}).count(),0);assert(await page.getByRole('button',{name:'Create Reservation',exact:true}).isDisabled());
 await page.getByLabel('Confirm provided personal data').check();assert(await page.getByRole('button',{name:'Create Reservation',exact:true}).isEnabled());
 for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overflow '+width);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`.design-reference/self-reservation-review-${width}.png`,fullPage:true});}
 await page.getByRole('button',{name:'Create Reservation',exact:true}).evaluate(el=>{el.click();el.click();});await page.waitForURL('**/portal/reservations/'+rid);await page.getByText('BKG-FIXTURE',{exact:true}).waitFor();
 const creation=calls.filter(c=>c.path==='/reservations');assert.equal(creation.length,1);assert.deepEqual(creation[0].body,{facilityId:fid,storageUnitId:uid,startDate:'2030-01-31T00:00:00.000Z',endDate:'2030-02-28T00:00:00.000Z',pricingPolicyId:pid});assert(calls.filter(c=>c.path==='/reservations/estimate').every(c=>Object.keys(c.body).sort().join(',')==='endDate,pricingPolicyId,startDate'));
 await action('Cancel reservation');await page.getByText('Reservation cancelled.',{exact:false}).waitFor();assert(calls.some(c=>c.path===`/reservations/${rid}/cancel`));
 status='CONTRACTED';await page.reload();await page.getByRole('link',{name:'View reservation contract',exact:true}).click();await page.getByText('CTR-SELF-FIXTURE',{exact:true}).waitFor();assert.equal(await page.getByText('Total due',{exact:true}).count(),0);await action('Sign Contract');await page.getByText('2030-01-01T00:00:00Z',{exact:true}).waitFor();assert(calls.some(c=>c.path===`/contracts/${cid}/sign`&&c.method==='PATCH'&&!c.body));
 await page.goto('http://127.0.0.1:5189/portal/payments/'+rid);await action('Simulate Payment (Demo)');await page.getByText('Backend reservation status:',{exact:false}).waitFor();assert(calls.some(c=>c.path===`/reservations/${rid}/mock-pay`));
 await page.goto('http://127.0.0.1:5189/portal/reservations/'+rid);await page.getByText('Waiting for Facility Manager handover.',{exact:false}).waitFor();await page.getByRole('link',{name:'View reservation contract',exact:true}).waitFor();status='ACTIVE';await page.reload();await page.getByRole('link',{name:'Simulated unit access',exact:true}).waitFor();
 await page.goto('http://127.0.0.1:5189/portal/reservations/'+foreign);await page.getByText('Reservation is unavailable in your account.',{exact:true}).waitFor();assert(!calls.some(c=>c.path===`/reservations/${foreign}`));assert.equal(await page.getByRole('button',{name:'Cancel reservation',exact:true}).count(),0);
 verified=false;await review();await page.getByLabel('Confirm provided personal data').check();assert(await page.getByRole('button',{name:'Create Reservation',exact:true}).isDisabled());verified=true;
 for(const errorMode of ['invalid-estimate','estimate-failure']){mode=errorMode;await booking();await page.getByRole('button',{name:'Review Reservation',exact:true}).waitFor();await page.getByRole('alert').filter({hasText:errorMode==='invalid-estimate'?'invalid Self Storage estimate':'backend could not complete'}).waitFor();assert(await page.getByRole('button',{name:'Review Reservation',exact:true}).isDisabled());assert(!(await page.textContent('main')).includes('MongoServerError'));}
 mode='';await review();await page.getByLabel('Confirm provided personal data').check();price=4000000;let before=calls.filter(c=>c.path==='/reservations').length;await page.getByRole('button',{name:'Create Reservation',exact:true}).click();await page.getByText('The Backend price or selected unit changed.',{exact:false}).waitFor();assert.equal(calls.filter(c=>c.path==='/reservations').length,before);assert(await page.getByRole('button',{name:'Create Reservation',exact:true}).isDisabled());
 mode='';await review();await page.getByLabel('Confirm provided personal data').check();unitStatus='MAINTENANCE';before=calls.filter(c=>c.path==='/reservations').length;await page.getByRole('button',{name:'Create Reservation',exact:true}).click();await page.getByText('Select an available Self Storage unit at an eligible facility.',{exact:true}).first().waitFor();assert.equal(calls.filter(c=>c.path==='/reservations').length,before);unitStatus='AVAILABLE';
 for(const errorMode of ['conflict','network','malformed']){mode=errorMode;await review();await page.getByLabel('Confirm provided personal data').check();before=calls.filter(c=>c.path==='/reservations').length;await page.getByRole('button',{name:'Create Reservation',exact:true}).click();await page.getByRole('alert').first().waitFor();await page.waitForTimeout(250);assert.equal(calls.filter(c=>c.path==='/reservations').length,before+1);assert(await page.getByRole('button',{name:'Create Reservation',exact:true}).isDisabled());}
 mode='auth';await booking();await page.getByRole('button',{name:'Review Reservation',exact:true}).click();await page.waitForURL('**/login');assert.equal(await page.evaluate(()=>localStorage.getItem('SelfStorage_token')),null);
 assert(!calls.some(c=>/approve|activate|reject|managed\/.*(cancel|mock-pay)|inspections|warehouse-map/.test(c.path)));assert(calls.filter(c=>!c.path.startsWith('/public/')).every(c=>c.auth==='Bearer fixture-self'));assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',fixture:true,requests:calls.length,widths:[1440,1024,768,390,320],scenarios:'unit/facility, UTC month clamp, estimate/request mapping, confirmed Submit, double click/create, cancel, flat contract/PATCH sign, payment, handover/access, ownership, profile/401, estimate errors, changed price/unit, conflict and uncertain results, no management calls'}));await context.close();
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
