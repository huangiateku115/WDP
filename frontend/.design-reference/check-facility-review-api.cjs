const {chromium}=require(process.env.PLAYWRIGHT_MODULE||require('node:path').join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const assert=require('node:assert/strict');
const base=process.env.REVIEW_FRONTEND_URL||'http://127.0.0.1:5173';
const ids={facility:'a'.repeat(24),profile:'b'.repeat(24),customer:'c'.repeat(24),reservation:'d'.repeat(24),other:'e'.repeat(24)};
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  async function setup(role='FACILITY_MANAGER',assigned=true){
   const context=await browser.newContext(),requests=[],errors=[];
   let profile={_id:ids.profile,userId:{_id:ids.customer,displayName:'Nguyen Van An',email:'an@example.test',phone:'090 123 4567'},verificationStatus:'PENDING',address:'HCM'},reservation={_id:ids.reservation,customerId:profile.userId,facilityId:ids.facility,storageUnitId:{_id:ids.other,unitCode:'A-101'},reservationCode:'BKG-TEST',serviceType:'SELF_STORAGE',status:'RESERVED',startDate:'2027-01-01',endDate:'2027-02-01',estimatedRent:1200000,depositAmount:500000,statusHistory:[]};
   const flags={failure:0,badResponse:false,profileFailure:0};
   await context.addInitScript(()=>{localStorage.setItem('SelfStorage_token','TEST_ONLY_NOT_REAL');localStorage.setItem('SelfStorage_refreshToken','TEST_ONLY_NOT_REAL');});
   await context.route('http://localhost:5000/api/v1/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1',''),method=request.method();requests.push({path,method,body:request.postDataJSON()});
    const json=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(path==='/users/me/')return json(200,{success:true,data:{_id:ids.customer,displayName:'API Operator',role,...(assigned?{assignedFacilityId:ids.facility}:{})}});
    if(path.startsWith('/contracts/reservation/'))return json(404,{success:false,message:'No contract for fixture'});
    if(path==='/customers'&&method==='GET')return json(flags.profileFailure||200,flags.profileFailure?{message:'Customer read failed'}:{success:true,data:[profile]});
    if(path===`/customers/${ids.profile}`&&method==='GET')return json(200,{success:true,data:profile});
    if(path.endsWith('/verify')){await new Promise(r=>setTimeout(r,250));const body=request.postDataJSON();profile={...profile,verificationStatus:body.status,note:body.note,verifiedAt:new Date().toISOString(),verifiedBy:ids.customer};return json(200,{success:true,data:profile});}
    if(path===`/reservations/facility/${ids.facility}`)return json(200,{success:true,data:[reservation]});
    if(path===`/reservations/${ids.reservation}`||path===`/reservations/managed/${ids.reservation}`)return json(200,{success:true,data:{...reservation,...(path.includes('/managed/')?{serviceType:'MANAGED_INVENTORY',allocatedCapacity:2}:{} )}});
    if(/\/(approve|reject)$/.test(path)){
     await new Promise(r=>setTimeout(r,250));if(flags.failure)return json(flags.failure,{success:false,message:'Fixture HTTP '+flags.failure});
     if(flags.badResponse)return json(200,{success:true,data:{...reservation,status:'RESERVED'}});
     reservation={...reservation,status:path.endsWith('/approve')?'CONTRACTED':'CANCELLED',rejectReason:request.postDataJSON()?.reason};
     return json(200,path.includes('/managed/')?{success:true,data:{reservation,contract:{_id:ids.other,contractCode:'CTR-TEST'}}}:{success:true,data:reservation,contract:{_id:ids.other,contractCode:'CTR-TEST'}});
    }
    throw Error('Unexpected API '+method+' '+path);
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   const go=async(path)=>{await page.goto(base+path);await page.locator('h1, main h2').first().waitFor();const demo=await page.evaluate(async()=> (await import('/src/lib/managerDemoStore.js')).managerDemoEnabled);assert.equal(demo,false,'This API fixture suite requires a dev frontend started with VITE_USE_MOCK=false; demo-mode labels are not API-mode labels.');};
   return {context,page,go,requests,flags,errors};
  }
  let x=await setup();await x.go('/manager/customers');await x.page.getByText('Nguyen Van An',{exact:true}).waitFor();
  for(const term of ['Nguyen','an@example.test','0901234567']){await x.page.getByLabel('Search customers',{exact:true}).fill(term);assert.equal(await x.page.locator('tbody tr').count(),1);assert.match(await x.page.locator('tbody').innerText(),/Nguyen Van An/);}
  await x.page.getByLabel('Search customers',{exact:true}).fill('absent');await x.page.getByText('No records match your filters.',{exact:true}).waitFor();
  await x.go('/manager/customers/'+ids.profile);await x.page.getByRole('button',{name:'Save verification',exact:true}).waitFor();assert(await x.page.getByRole('button',{name:'Save verification',exact:true}).isDisabled());
  const second=await x.context.newPage();await second.goto(base+'/manager/customers/'+ids.profile);await second.getByText('PENDING',{exact:true}).first().waitFor();
  await x.page.getByLabel('Verification notes',{exact:true}).fill('Verified against provided profile');await x.page.getByRole('button',{name:'Save verification',exact:true}).click();await x.page.getByText('Verification status saved.',{exact:true}).waitFor();await second.locator('span').getByText('VERIFIED',{exact:true}).waitFor();
  assert.equal(x.requests.filter(r=>r.method==='PATCH'&&r.path.endsWith('/verify')).length,1);assert(!await x.page.getByText('DEMO',{exact:true}).count());
  console.log('PASS API customers/search/empty/verification/profile ID/assigned facility and cross-tab refetch');
  await x.go('/manager/reservations/'+ids.reservation);await x.page.getByRole('button',{name:'Approve reservation',exact:true}).click();await x.page.getByRole('button',{name:'Confirm decision',exact:true}).click();assert(await x.page.getByRole('button',{name:'Submitting…',exact:true}).isDisabled());await x.page.getByText('CONTRACTED',{exact:true}).waitFor();assert.equal(x.requests.filter(r=>r.path.endsWith('/approve')).length,1);assert.equal(await x.page.getByRole('button',{name:'Approve reservation',exact:true}).count(),0);
  await x.go('/manager/refunds');await x.page.getByText('Page temporarily hidden',{exact:true}).waitFor();assert(!x.requests.some(r=>r.path.includes('refund')));assert.equal(await x.page.evaluate(()=>localStorage.getItem('VaultSpace_manager_priority2_demo_v1')),null);
  for(const width of [390,1440]){await x.page.setViewportSize({width,height:900});for(const path of ['/manager/customers','/manager/customers/'+ids.profile,'/manager/reservations','/manager/refunds']){await x.go(path);assert(await x.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overflow '+path);}}
  assert.deepEqual(x.errors,[]);await x.context.close();console.log('PASS API approve/contract/double-submit guards, refunds blocked and responsive routes');
  x=await setup();await x.go('/manager/reservations/'+ids.reservation);await x.page.getByRole('button',{name:'Reject reservation',exact:true}).click();assert(await x.page.getByRole('button',{name:'Confirm decision',exact:true}).isDisabled());await x.page.getByLabel('Rejection reason',{exact:true}).fill('Customer requests cancellation');await x.page.getByRole('button',{name:'Confirm decision',exact:true}).click();await x.page.getByText('CANCELLED',{exact:true}).waitFor();assert.equal(x.requests.find(r=>r.path.endsWith('/reject')).body.reason,'Customer requests cancellation');await x.context.close();
  for(const status of [400,403,404,409]){x=await setup();x.flags.failure=status;await x.go('/manager/reservations/'+ids.reservation);await x.page.getByRole('button',{name:'Approve reservation',exact:true}).click();await x.page.getByRole('button',{name:'Confirm decision',exact:true}).click();await x.page.getByRole('alert').filter({hasText:'Fixture HTTP '+status}).first().waitFor();assert.equal(await x.page.getByText('CONTRACTED',{exact:true}).count(),0);await x.context.close();}
  console.log('PASS API rejection validation and 400/403/404/409 without fake success');
  x=await setup();x.flags.failure=401;await x.go('/manager/reservations/'+ids.reservation);await x.page.getByRole('button',{name:'Approve reservation',exact:true}).click();await x.page.getByRole('button',{name:'Confirm decision',exact:true}).click();await x.page.waitForURL('**/login');assert.equal(await x.page.evaluate(()=>localStorage.getItem('SelfStorage_token')),null);await x.context.close();
  x=await setup();x.flags.badResponse=true;await x.go('/manager/reservations/'+ids.reservation);await x.page.getByRole('button',{name:'Approve reservation',exact:true}).click();await x.page.getByRole('button',{name:'Confirm decision',exact:true}).click();await x.page.getByRole('alert').filter({hasText:'The requested status change was not confirmed'}).first().waitFor();assert.equal(await x.page.getByText('CONTRACTED',{exact:true}).count(),0);await x.context.close();
  x=await setup();x.flags.profileFailure=500;await x.go('/manager/customers');await x.page.getByRole('alert').filter({hasText:'Customer read failed'}).waitFor();x.flags.profileFailure=0;await x.page.getByRole('button',{name:'Refresh',exact:true}).click();await x.page.getByText('Nguyen Van An',{exact:true}).waitFor();await x.context.close();
  console.log('PASS expired session/401, contradictory success response, customer read error and retry');
  x=await setup();await x.go('/manager/reservations/'+ids.reservation+'?service=managed');await x.page.getByRole('button',{name:'Approve reservation',exact:true}).click();await x.page.getByRole('button',{name:'Confirm decision',exact:true}).click();await x.page.getByText('CONTRACTED',{exact:true}).waitFor();assert(x.requests.some(r=>r.path===`/reservations/managed/${ids.reservation}/approve`));await x.context.close();
  x=await setup('FACILITY_STAFF');await x.go('/staff/customers/'+ids.profile);await x.page.getByLabel('Verification notes',{exact:true}).fill('Staff verification');await x.page.getByRole('button',{name:'Save verification',exact:true}).click();await x.page.getByText('Verification status saved.',{exact:true}).waitFor();assert.equal(await x.page.getByLabel('Demo operator',{exact:true}).count(),0);await x.page.getByRole('link',{name:'BKG-TEST',exact:true}).waitFor();
  await x.go('/staff/refunds/SREF-001');await x.page.getByText('Page temporarily hidden',{exact:true}).waitFor();assert.equal(await x.page.getByRole('button',{name:'Record refund processing',exact:true}).count(),0);
  await x.go('/staff/reservations');await x.page.getByRole('link',{name:'BKG-TEST',exact:true}).waitFor();assert(x.requests.some(r=>r.path.includes('reservations/facility/')));assert.equal(await x.page.getByRole('button',{name:'Approve reservation',exact:true}).count(),0);await x.context.close();
  x=await setup('FACILITY_MANAGER',false);await x.go('/manager/reservations');await x.page.getByText('No facility assigned',{exact:true}).waitFor();assert(!x.requests.some(r=>r.path.includes('reservations')));await x.context.close();
  x=await setup('CUSTOMER');await x.go('/manager/reservations');await x.page.getByText('Access denied',{exact:true}).waitFor();assert(!x.requests.some(r=>r.path.includes('reservations')));await x.context.close();
  const empty=await browser.newContext(),page=await empty.newPage();await page.goto(base+'/manager/customers');await page.waitForURL('**/login');await empty.close();
  console.log('PASS managed endpoint mapping, Staff reading/missing facility, wrong role and signed-out gates');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
