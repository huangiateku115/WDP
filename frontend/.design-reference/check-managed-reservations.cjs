const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const base=process.env.MI_TEST_URL||'http://127.0.0.1:5189';
const fid='1'.repeat(24),rid='2'.repeat(24),sid='3'.repeat(24),cid='4'.repeat(24),uid='5'.repeat(24),unknown='6'.repeat(24);
const facility={_id:fid,name:'Managed fixture facility',serviceTypes:['MANAGED_INVENTORY','SELF_STORAGE']};
let status='RESERVED',hold=new Date(Date.now()+3600000).toISOString(),contractStatus='DRAFT',mode='',verified=true;
const managed=()=>({_id:rid,serviceType:'MANAGED_INVENTORY',facilityId:facility,status,reservationCode:'MIR-FIXTURE',allocatedCapacity:1.5,startDate:'2030-01-31T00:00:00.000Z',endDate:'2030-02-28T00:00:00.000Z',expiresAt:hold,estimatedRent:150,depositAmount:30});
const self=()=>({_id:sid,serviceType:'SELF_STORAGE',facilityId:facility,status,reservationCode:'SELF-FIXTURE',storageUnitId:{_id:uid,unitCode:'UNIT-FIXTURE',size:'SMALL',volumeM3:9},estimatedRent:70,depositAmount:20});
const contract=()=>({_id:cid,reservationId:{_id:rid,serviceType:'MANAGED_INVENTORY'},contractCode:'CTR-FIXTURE',status:contractStatus,...(contractStatus==='SIGNED'?{signedByCustomerAt:'2030-01-01T00:00:00Z'}:{}),pricingSnapshot:{amountBreakdown:{estimatedRent:150,depositAmount:30,totalDue:180},pricingRule:{currency:'VND'}}});
const quote=body=>({facilityId:fid,allocatedCapacityM3:body.allocatedCapacityM3,startDate:body.startDate,endDate:'2030-02-28T00:00:00.000Z',term:body.term,sellableCapacityM3:100,committedPeakCapacityM3:20,availableCapacityM3:80,pricing:{estimatedRent:150,ratePerM3:100,currency:'VND'},deposit:{amount:30,percentage:20},taxAmount:0});
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),calls=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/api/v1/**',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1',''),method=req.method(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
  if(method==='OPTIONS')return route.fulfill({status:204,headers});let body;try{body=req.postDataJSON();}catch{}
  calls.push({path,method,body,auth:req.headers().authorization,query:Object.fromEntries(url.searchParams)});let data,code=200,message;
  if(path==='/public/facilities')data=[facility,{_id:'a'.repeat(24),name:'Self only',serviceTypes:['SELF_STORAGE']}];
  else if(path===`/public/facilities/${fid}`)data=facility;
  else if(path.endsWith('/storage-options')||path.endsWith('/pricing'))data={};
  else if(path===`/facilities/${fid}/storage-units`)data=[{_id:uid,facilityId:fid,unitCode:'UNIT-FIXTURE',size:'SMALL',status:'AVAILABLE',volumeM3:9}];
  else if(path===`/storage-units/${uid}`)data={_id:uid,facilityId:fid,unitCode:'UNIT-FIXTURE',size:'SMALL',status:'AVAILABLE'};
  else if(path==='/customers/me/profile')data={verificationStatus:verified?'VERIFIED':'PENDING'};
  else if(path==='/pricing-rules')data=mode==='no-terms'?[]:[{_id:'b'.repeat(24),facilityId:fid,serviceType:'MANAGED_INVENTORY',billingBasis:'PER_M3',isActive:true,term:{value:1,unit:'MONTH'},effectiveFrom:'2020-01-01T00:00:00Z',price:100,currency:'VND'}];
  else if(path===`/reservations/managed/capacity/${fid}`){data={facilityId:fid,sellableCapacityM3:100,committedPeakCapacityM3:20,unresolvedOverdueObligationM3:5,availableCapacityM3:mode==='insufficient'?1:80,interval:{startDate:url.searchParams.get('startDate'),endDate:url.searchParams.get('endDate')}};if(mode==='capacity-error'){code=404;message='Managed capacity configuration not found';}}
  else if(path==='/reservations/managed/quote'){data=quote(body);if(mode==='quote-error'){code=409;message='Effective Managed deposit policy is not configured';}}
  else if(path==='/reservations/managed'&&method==='POST'){if(mode==='network'){return route.abort('failed');}if(mode==='create-conflict'){code=409;message='Requested quota exceeds available Managed capacity for this interval';}else if(mode==='malformed'){data=managed();}else{await new Promise(r=>setTimeout(r,200));status='RESERVED';data={reservation:managed(),quote:quote(body)};}}
  else if(path==='/reservations/me')data=[managed(),self(),{_id:unknown,status,facilityId:facility,reservationCode:'UNKNOWN-FIXTURE'}];
  else if(path===`/reservations/managed/${rid}`)data={...managed(),facilityId:fid};
  else if(path===`/reservations/managed/${rid}/cancel`){status='CANCELLED';data=managed();}
  else if(path===`/reservations/${sid}/cancel`){status='CANCELLED';data=self();}
  else if(path==='/contracts/me')data=[contract()];
  else if(path===`/contracts/${cid}`&&method==='GET')data=contract();
  else if(path===`/contracts/${cid}/sign`){contractStatus='SIGNED';data=contract();}
  else if(path===`/reservations/managed/${rid}/mock-pay`){if(mode==='disabled-pay'){code=404;message='Mock payment is disabled';}else{status='PAID';data=managed();}}
  else if(path===`/reservations/${sid}/mock-pay`){status='PAID';data=self();}
  else if(path==='/access/me')data=[];
  else throw Error('Unexpected fixture request '+method+' '+path);
  await route.fulfill({status:code,headers,json:{success:code===200,data,...(message?{message}:{}),...(path==='/pricing-rules'||path==='/public/facilities'||path.endsWith('/storage-units')?{pagination:{page:1,totalPages:1}}:{})}});
 });
 await page.goto(base+'/login');await page.evaluate(()=>{localStorage.setItem('SelfStorage_token','fixture-access');localStorage.setItem('SelfStorage_refreshToken','fixture-refresh');localStorage.setItem('SelfStorage_user',JSON.stringify({id:'fixture-customer',role:'CUSTOMER'}));});
 async function go(path){await page.goto(base+path);await page.getByRole('heading',{level:1}).waitFor();}
 async function booking(){await go('/portal/rent?service=managed');await page.getByLabel('Managed Facility').selectOption(fid);await page.getByLabel('Managed move-in date (UTC)').fill('2030-01-31');await page.getByLabel('Managed commitment duration').selectOption('MONTH:1');await page.getByLabel('Requested quota (m³)').fill('1.5');}
 async function checkQuote(){await page.getByRole('button',{name:'Check Managed capacity',exact:true}).click();await page.getByRole('button',{name:'Get Managed quote',exact:true}).click();await page.getByRole('heading',{name:'Review server quote'}).waitFor();}
 async function confirmAction(label){await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Confirm action',exact:true}).click();}
 await go('/portal');await page.getByLabel('Storage service').selectOption('MANAGED_INVENTORY');await page.getByText('MIR-FIXTURE',{exact:true}).waitFor();assert.equal(await page.getByText('SELF-FIXTURE',{exact:true}).count(),0);
 await booking();assert.equal(await page.getByRole('option',{name:'Self only',exact:true}).count(),0);
 await checkQuote();assert(await page.getByRole('button',{name:'Create Managed reservation',exact:true}).isDisabled());
 assert.equal(await page.getByText('Total due',{exact:true}).count(),0,'Do not invent quote total');
 const capacityCall=calls.find(c=>c.path.includes('/capacity/'));assert.deepEqual(capacityCall.query,{startDate:'2030-01-31T00:00:00.000Z',endDate:'2030-02-28T00:00:00.000Z'});
 for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overflow '+width);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`.design-reference/managed-booking-${width}.png`,fullPage:true});}
 await page.getByLabel('Confirm Managed reservation details').check();await page.getByRole('button',{name:'Create Managed reservation',exact:true}).evaluate(el=>{el.click();el.click();});await page.waitForURL('**/portal/reservations/'+rid);await page.getByText('MIR-FIXTURE',{exact:true}).waitFor();
 const creates=calls.filter(c=>c.path==='/reservations/managed'&&c.method==='POST');assert.equal(creates.length,1);assert.deepEqual(creates[0].body,{facilityId:fid,allocatedCapacityM3:1.5,startDate:'2030-01-31T00:00:00.000Z',term:{value:1,unit:'MONTH'}});
 await confirmAction('Cancel reservation');await page.getByText('Managed reservation is cancelled.',{exact:false}).waitFor();assert(calls.some(c=>c.path===`/reservations/managed/${rid}/cancel`));assert(!calls.some(c=>c.path===`/reservations/${rid}/cancel`));
 status='RESERVED';await go('/portal/reservations/'+sid);await confirmAction('Cancel reservation');await page.waitForTimeout(150);assert(calls.some(c=>c.path===`/reservations/${sid}/cancel`));
 for(const typeId of [rid,unknown]){status='ACTIVE';await go('/portal/reservations/'+typeId);await page.getByText(typeId===rid?'MIR-FIXTURE':'UNKNOWN-FIXTURE',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Simulated unit access',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Cancel reservation',exact:true}).count(),0);}
 await go('/portal/reservations/'+sid);await page.getByRole('link',{name:'Simulated unit access',exact:true}).waitFor();await go('/portal/rentals/'+rid+'/access');assert(await page.getByRole('button',{name:'Simulate Unlock',exact:true}).isDisabled());
 status='CONTRACTED';contractStatus='DRAFT';await go('/portal/contracts/'+rid);await page.getByText('Total due',{exact:true}).waitFor();assert((await page.textContent('main')).includes('180'));await confirmAction('Sign Contract');await page.getByText('2030-01-01T00:00:00Z',{exact:true}).waitFor();assert(calls.some(c=>c.path===`/contracts/${cid}/sign`&&c.method==='PATCH'&&!c.body));
 await go('/portal/payments/'+rid);if(process.env.MI_EXPECT_DISABLED){assert.equal(await page.getByRole('button',{name:'Simulate Payment (Demo)',exact:true}).count(),0);}else{await confirmAction('Simulate Payment (Demo)');await page.getByText('Backend reservation status:',{exact:false}).waitFor();assert(calls.some(c=>c.path===`/reservations/managed/${rid}/mock-pay`));}
 status='CONTRACTED';await go('/portal/payments/'+sid);await confirmAction('Simulate Payment (Demo)');await page.getByText('Backend reservation status:',{exact:false}).waitFor();assert(calls.some(c=>c.path===`/reservations/${sid}/mock-pay`));
 status='CONTRACTED';hold=new Date(Date.now()-1000).toISOString();contractStatus='DRAFT';await go('/portal/contracts/'+rid);await page.getByText('Signing unavailable:',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Sign Contract',exact:true}).count(),0);await go('/portal/payments/'+rid);await page.getByText('MIR-FIXTURE',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Simulate Payment (Demo)',exact:true}).count(),0);
 hold=new Date(Date.now()+3600000).toISOString();mode='insufficient';await booking();await page.getByRole('button',{name:'Check Managed capacity',exact:true}).click();await page.getByText('Requested quota exceeds available Managed capacity for this interval.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Get Managed quote',exact:true}).count(),0);
 mode='quote-error';await booking();await page.getByRole('button',{name:'Check Managed capacity',exact:true}).click();await page.getByRole('button',{name:'Get Managed quote',exact:true}).click();await page.getByText('Effective Managed deposit policy is not configured',{exact:true}).waitFor();
 mode='';verified=false;await booking();await checkQuote();await page.getByLabel('Confirm Managed reservation details').check();assert(await page.getByRole('button',{name:'Create Managed reservation',exact:true}).isDisabled());verified=true;
 for(const failure of ['create-conflict','network','malformed']){mode=failure;await booking();await checkQuote();await page.getByLabel('Confirm Managed reservation details').check();const before=calls.filter(c=>c.path==='/reservations/managed').length;await page.getByRole('button',{name:'Create Managed reservation',exact:true}).click();await page.getByRole('alert').waitFor();await page.waitForTimeout(200);assert.equal(calls.filter(c=>c.path==='/reservations/managed').length,before+1,'No automatic duplicate '+failure);if(failure!=='create-conflict')assert(await page.getByRole('button',{name:'Create Managed reservation',exact:true}).isDisabled());}
 assert(!calls.some(c=>/approve|activate|reject|inventory-items|warehouse-zones|rack-cells/.test(c.path)));
 assert(!calls.some(c=>c.path===`/reservations/${rid}/mock-pay`));
 assert(calls.filter(c=>!c.path.startsWith('/public/')).every(c=>c.auth==='Bearer fixture-access'));
 mode='capacity-error';await booking();await page.getByRole('button',{name:'Check Managed capacity',exact:true}).click();await page.getByText('Managed capacity configuration not found',{exact:true}).waitFor();
 mode='no-terms';await go('/portal/rent?service=managed&facility='+fid);await page.getByLabel('Managed move-in date (UTC)').fill('2030-01-31');await page.getByText('No effective PER_M3 rental terms',{exact:false}).waitFor();assert(await page.getByLabel('Managed commitment duration').isDisabled());
 mode='disabled-pay';status='CONTRACTED';contractStatus='SIGNED';hold=new Date(Date.now()+3600000).toISOString();if(!process.env.MI_EXPECT_DISABLED){await go('/portal/payments/'+rid);await confirmAction('Simulate Payment (Demo)');await page.getByText('Mock payment is disabled',{exact:true}).waitFor();assert.equal(status,'CONTRACTED');}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',fixture:true,requests:calls.length,responsive:[1440,1024,768,390,320],productionGate:!!process.env.MI_EXPECT_DISABLED,scenarios:'capacity, quote, payload/envelope, create, cancel routing, service filters, unknown/access guards, nested contract amounts, PATCH sign, payment routing/hold, unverified, quote errors, insufficient quota, no duplicate retries'}));
 await context.close();
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
