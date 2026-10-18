// Fixture-only: every API request is fulfilled locally; other external traffic is blocked.
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5189',rid='2'.repeat(24),fid='1'.repeat(24),cid='3'.repeat(24),owner='4'.repeat(24),cell='6'.repeat(24),hash='a'.repeat(64);
const user={id:owner,role:'CUSTOMER'},breakdown={estimatedRent:36000,depositAmount:7200,taxAmount:0,discountAmount:0,totalDue:36000,depositCredit:7200,balanceDue:28800};
let stage='DEPOSIT_PAID',signed='SIGNED',sigs=true,timeout=false,settled=false,requests=[],errors=[];
const rental=()=>({_id:rid,customerId:owner,facilityId:fid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:stage,...(settled?{balanceSettledAt:'2026-10-18T01:00:00Z'}:{}),allocatedCellIds:[cell],estimatedRent:36000,depositAmount:7200,taxAmount:0,discountAmount:0,managedPricingSnapshot:{pricingRule:{currency:'VND'},amountBreakdown:breakdown}});
const signature=role=>({version:1,contentHash:hash,signerId:role==='CUSTOMER'?owner:'5'.repeat(24),signerRole:role,signedAt:'2026-10-18T01:00:00Z'});
const contract=()=>({_id:cid,customerId:owner,reservationId:rid,status:signed,currentContentVersion:1,contentVersions:[{version:1,contentHash:hash,content:{reservation:{id:rid,facilityId:fid,cellIds:[cell]},pricing:breakdown,handover:[]}}],signatures:sigs?[signature('CUSTOMER'),signature('FACILITY_MANAGER')]:signed==='DRAFT'?[signature('CUSTOMER')]:[]});
(async()=>{
 const {customerBalanceState:state,confirmedBalanceResult:verify,balanceKey}=await import('../src/lib/customerBalance.js');
 const {assertConfirmedRequest:allow}=await import('../src/api/confirmedContract.js');
 allow({method:'post',url:`/reservations/managed/${rid}/balance`});
 allow({method:'post',url:`/reservations/managed/${rid}/deposit`});
 for(const suffix of ['deposit/mock-confirm','balance/mock-confirm'])assert.throws(()=>allow({method:'post',url:`/reservations/managed/${rid}/${suffix}`}));
 assert(state(rental(),contract(),user).eligible);
 for(const c of [{...contract(),status:'DRAFT',signatures:[]},{...contract(),status:'DRAFT',signatures:[signature('CUSTOMER')]},{...contract(),signatures:[signature('CUSTOMER'),{...signature('FACILITY_MANAGER'),version:0}]},{...contract(),signatures:[signature('CUSTOMER'),{...signature('FACILITY_MANAGER'),contentHash:'b'.repeat(64)}]}])assert(!state(rental(),c,user).eligible);
 assert(!state(rental(),contract(),{...user,id:'7'.repeat(24)}).eligible);
 for(const r of [{...rental(),serviceType:'SELF_STORAGE'},{...rental(),bookingFlowVersion:1},{...rental(),status:'RESERVED'},{...rental(),balanceSettledAt:'invalid'},{...rental(),status:'CHECKIN_READY'}])assert(!state(r,contract(),user).eligible);
 const before=JSON.stringify(rental());assert.equal(balanceKey(rid),balanceKey(rid));assert.equal(JSON.stringify(rental()),before);
 stage='CHECKIN_READY';settled=true;assert(state(rental(),contract(),user).complete);assert(!state(rental(),contract(),user).eligible);stage='ACTIVE';assert(state(rental(),contract(),user).reason.includes('activated'));stage='DEPOSIT_PAID';settled=false;
 const payment=()=>({_id:'8'.repeat(24),reservationId:rid,customerId:owner,serviceType:'MANAGED_INVENTORY',purpose:'BALANCE',provider:'MOCK',amount:28800,currency:'VND',status:'PENDING',idempotencyKey:balanceKey(rid)});
 const result=()=>({payment:payment(),reservation:rental(),amount:28800,currency:'VND'});
 assert.equal(verify(result(),rental(),user),'PENDING');assert.throws(()=>verify({...result(),payment:{...payment(),amount:36000}},rental(),user));assert.throws(()=>verify({...result(),payment:{...payment(),status:'SUCCEEDED'}},rental(),user));
 const settledRental={...rental(),status:'CHECKIN_READY',balanceSettledAt:'2026-10-18T01:00:00Z'};
 assert.equal(verify({...result(),payment:{...payment(),status:'SUCCEEDED'},reservation:settledRental},rental(),user),'SUCCEEDED');
 const zeroRental={...rental(),managedPricingSnapshot:{pricingRule:{currency:'VND'},amountBreakdown:{...breakdown,balanceDue:0}}};
 assert.equal(verify({payment:null,reservation:settledRental,zeroBalance:true,amount:0,currency:'VND'},zeroRental,user),'SUCCEEDED');
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(u=>{localStorage.setItem('SelfStorage_token','balance-fixture');localStorage.setItem('SelfStorage_refreshToken','fixture');localStorage.setItem('SelfStorage_user',JSON.stringify(u));},user);
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
 await context.route('**/api/v1/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');if(req.method()==='OPTIONS')return route.fulfill({status:204});requests.push({p,method:req.method(),body:req.postDataJSON()});let data;
 if(req.method()==='GET'&&p==='/reservations/me')data=[rental()];else if(req.method()==='GET'&&p===`/reservations/managed/${rid}`)data=rental();else if(req.method()==='GET'&&p==='/contracts/me')data=[contract()];else if(req.method()==='GET'&&p===`/contracts/${cid}`)data=contract();
 else if(req.method()==='POST'&&p===`/reservations/managed/${rid}/balance`){assert.deepEqual(req.postDataJSON(),{idempotencyKey:balanceKey(rid)});if(timeout)return route.abort('timedout');await new Promise(r=>setTimeout(r,150));return route.fulfill({status:201,json:{success:true,data:result()}});}
 else throw Error('Unexpected fixture request '+req.method()+' '+p);
 return route.fulfill({status:200,json:{success:true,data}});
 });
 const pay=()=>page.getByRole('button',{name:'Pay Balance (MOCK)',exact:true});
 async function go(){await page.goto(`${base}/portal/reservations/${rid}`);await page.getByRole('heading',{name:'Balance Payment',exact:true}).waitFor();await page.getByText('Contract signature progress',{exact:true}).waitFor();}
 const posts=()=>requests.filter(r=>r.method==='POST');
 signed='DRAFT';sigs=false;await go();await page.getByRole('note').filter({hasText:'Awaiting Facility signature'}).waitFor();assert(await pay().isDisabled());assert.equal(posts().length,0);
 signed='SIGNED';sigs=true;await go();await pay().waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Pay Balance (MOCK)'&&!b.disabled));
 assert((await page.locator('main').innerText()).includes('28.800 VND'));
 await pay().evaluate(b=>{b.click();b.click();});await page.getByRole('status').filter({hasText:'Balance PENDING'}).waitFor();assert.equal(posts().length,1);assert(await pay().isDisabled());
 await go();await page.getByRole('status').filter({hasText:'Payment outcome is not verified'}).waitFor();assert(await pay().isDisabled());assert.equal(posts().length,1);
 settled=true;stage='CHECKIN_READY';await page.getByRole('button',{name:'Refresh balance status (GET)',exact:true}).click();await page.getByText('Balance payment confirmed. Awaiting first physical inbound.',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Balance payment confirmed',exact:true}).isDisabled());assert.equal(posts().length,1);assert(!await page.getByText('Rental activated after physical inbound.',{exact:true}).count());assert.equal(stage,'CHECKIN_READY');
 stage='ACTIVE';await go();await page.getByText('Rental activated after physical inbound.',{exact:true}).waitFor();assert.equal(posts().length,1);
 // Independent timeout fixture: explicit user attempt, no automatic retry, no re-enable after GET still DEPOSIT_PAID.
 await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('VaultSpace_balance_attempt:')).forEach(k=>localStorage.removeItem(k)));stage='DEPOSIT_PAID';settled=false;timeout=true;await go();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Pay Balance (MOCK)'&&!b.disabled));await pay().click();await page.getByRole('alert').filter({hasText:'GET refresh only'}).waitFor();assert.equal(posts().length,2);await page.getByRole('button',{name:'Refresh balance status (GET)',exact:true}).click();await page.getByRole('status').filter({hasText:'Payment outcome is not verified'}).waitFor();assert(await pay().isDisabled());await go();assert(await pay().isDisabled());assert.equal(posts().length,2);
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);}
 assert(!requests.some(r=>r.p.includes('deposit')||r.p.includes('mock-confirm')));assert(requests.every(r=>['GET','POST'].includes(r.method)));assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',fixtureRequests:requests.length,explicitBalancePosts:posts().length,liveRequests:0,checks:'signature eligibility, correct ID/body/key, double click, PENDING, reload/timeout lock, GET settlement, CHECKIN_READY versus ACTIVE, no deposit or mock confirmation, responsive'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
