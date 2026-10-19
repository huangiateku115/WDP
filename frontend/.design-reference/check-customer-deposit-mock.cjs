// All API traffic is fulfilled locally. No development/mock payment reaches a live Backend.
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const rid='2'.repeat(24),fid='1'.repeat(24),owner='4'.repeat(24),cell='6'.repeat(24),user={id:owner,role:'CUSTOMER'};
const b={estimatedRent:36000,depositAmount:7200,taxAmount:0,discountAmount:0,totalDue:36000,depositCredit:7200,balanceDue:28800};
let stage='RESERVED',mode='',customer=owner,requests=[],errors=[];
const rental=()=>({_id:rid,reservationCode:'MOCK-DEPOSIT-FIXTURE',customerId:customer,facilityId:fid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:stage,expiresAt:'2030-01-01T00:00:00Z',startDate:'2030-01-01T00:00:00Z',endDate:'2031-01-01T00:00:00Z',allocatedCellIds:[cell],allocatedCapacity:1,estimatedRent:36000,depositAmount:7200,taxAmount:0,discountAmount:0,managedPricingSnapshot:{pricingRule:{currency:'VND'},amountBreakdown:b}});
const payment=()=>({_id:'8'.repeat(24),reservationId:rid,customerId:owner,facilityId:fid,serviceType:'MANAGED_INVENTORY',purpose:'DEPOSIT',amount:7200,currency:'VND',provider:'MOCK',status:'PENDING',idempotencyKey:`wdp-deposit-${rid}`});
(async()=>{
 const {canMockConfirmDeposit:eligible,confirmedDepositMockResult:verify}=await import('../src/lib/customerDeposit.js');
 assert(eligible(rental(),user,payment()));assert(!eligible(rental(),user,null));assert(!eligible(rental(),user,{...payment(),status:'SUCCEEDED'}));assert(!eligible(rental(),{...user,id:'7'.repeat(24)},payment()));
 for(const patch of [{amount:1},{purpose:'BALANCE'},{reservationId:'7'.repeat(24)},{idempotencyKey:'other'}])assert(!eligible(rental(),user,{...payment(),...patch}));
 for(const status of ['DEPOSIT_PAID','CHECKIN_READY','ACTIVE'])assert(!eligible({...rental(),status},user,payment()));
 const result={payment:{...payment(),status:'SUCCEEDED'},reservation:{...rental(),status:'DEPOSIT_PAID'}};
 assert.equal(verify(result,rental(),user,payment()),'SUCCEEDED');assert.throws(()=>verify({payment:payment(),reservation:rental()},rental(),user,payment()));assert.throws(()=>verify({...result,payment:{...result.payment,amount:1}},rental(),user,payment()));
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 async function setup(base){const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(u=>{localStorage.setItem('SelfStorage_token','mock-deposit-fixture');localStorage.setItem('SelfStorage_refreshToken','fixture');localStorage.setItem('SelfStorage_user',JSON.stringify(u));},user);
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
 await context.route('**/api/v1/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');if(req.method()==='OPTIONS')return route.fulfill({status:204});requests.push({p,method:req.method(),body:req.postDataJSON()});let data;
 if(req.method()==='GET'&&p==='/reservations/me')data=[rental()];else if(req.method()==='GET'&&p===`/reservations/managed/${rid}`)data=rental();else if(req.method()==='GET'&&p==='/contracts/me')data=[];
 else if(req.method()==='POST'&&p===`/reservations/managed/${rid}/deposit`){assert.deepEqual(req.postDataJSON(),{idempotencyKey:`wdp-deposit-${rid}`});data={payment:payment(),reservationId:rid,amount:7200,currency:'VND',idempotent:false};}
 else if(req.method()==='POST'&&p===`/reservations/managed/${rid}/deposit/mock-confirm`){assert.deepEqual(req.postDataJSON(),{idempotencyKey:`wdp-deposit-${rid}`});if(mode==='TIMEOUT')return route.abort('timedout');if(mode==='409')return route.fulfill({status:409,json:{success:false,message:'Fixture pending conflict'}});await new Promise(r=>setTimeout(r,120));if(mode==='RECON')data={payment:{...payment(),status:'RECONCILIATION_REQUIRED'},reservation:rental(),reconciliationRequired:true};else if(mode==='MALFORMED')data={payment:payment(),reservation:rental()};else{if(mode!=='GET_RESERVED')stage='DEPOSIT_PAID';data={payment:{...payment(),status:'SUCCEEDED'},reservation:{...rental(),status:'DEPOSIT_PAID'}};}}
 else throw Error('Unexpected fixture request '+req.method()+' '+p);
 return route.fulfill({status:req.method()==='POST'&&p.endsWith('/deposit')?201:200,json:{success:true,data}});
 });return {context,page,go:async()=>{await page.goto(`${base}/portal/reservations/${rid}`);await page.getByText('Current reservation status',{exact:true}).waitFor();}};}
 const enabled=await setup('http://127.0.0.1:5190'),{page,go}=enabled;
 const mock=()=>page.getByRole('button',{name:'Mock Confirm Deposit',exact:true}),confirm=()=>page.getByRole('button',{name:'Confirm simulated Deposit',exact:true}),refresh=()=>page.getByRole('button',{name:'Refresh Payment Status',exact:true});
 const confirms=()=>requests.filter(r=>r.method==='POST'&&r.p.endsWith('/mock-confirm')).length;
 const section=()=>page.locator('div').filter({has:page.getByRole('heading',{name:'Deposit Payment',exact:true})}).last();
 async function initiate(){await page.getByRole('button',{name:'Pay Deposit',exact:true}).click();await page.getByRole('status').filter({hasText:'Deposit payment initiated.'}).waitFor();assert(await mock().isEnabled());}
 async function reset(){stage='RESERVED';mode='';customer=owner;await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('VaultSpace_deposit_attempt:')).forEach(k=>localStorage.removeItem(k)));await go();await mock().waitFor();}
 await go();await mock().waitFor();assert(await mock().isDisabled());assert.equal(confirms(),0);await initiate();await mock().click();await page.getByRole('dialog').waitFor();assert((await page.getByRole('dialog').innerText()).includes('DEVELOPMENT ONLY'));await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(confirms(),0);
 await mock().click();const start=requests.length;await confirm().evaluate(b=>{b.click();b.click();});await page.getByRole('button',{name:'Deposit Paid',exact:true}).waitFor();assert.equal(confirms(),1);assert(requests.slice(start).some(r=>r.method==='GET'&&r.p===`/reservations/managed/${rid}`));assert(await page.getByRole('link',{name:'Register inventory item',exact:true}).isVisible());assert.equal(await mock().count(),0);assert.equal(stage,'DEPOSIT_PAID');
 for(const status of ['CHECKIN_READY','ACTIVE']){stage=status;await go();assert.equal(await mock().count(),0);}
 await reset();await initiate();await go();assert(await mock().isDisabled(),'Receipt must not be recovered from storage');
 await reset();customer='7'.repeat(24);await go();assert.equal(await mock().count(),0);customer=owner;
 // Fresh reservation preflight blocks a changed stage before POST05.
 await reset();await initiate();await mock().click();stage='CHECKIN_READY';const count=confirms();await confirm().click();await section().getByRole('alert').waitFor();assert.equal(confirms(),count);
 for(const failure of ['409','TIMEOUT','MALFORMED','RECON','GET_RESERVED']){await reset();await initiate();mode=failure;await mock().click();const n=confirms();await confirm().click();if(['409','TIMEOUT','MALFORMED'].includes(failure))await section().getByRole('alert').filter({hasText:'GET refresh only'}).waitFor();else await page.getByRole('status').filter({hasText:failure==='RECON'?'requires reconciliation':'Backend payment reports SUCCEEDED'}).waitFor();assert.equal(confirms(),n+1);assert(await mock().isDisabled());assert.equal(await page.getByRole('button',{name:'Deposit Paid',exact:true}).count(),0);await refresh().click();await page.getByText('Current reservation status',{exact:true}).waitFor();assert.equal(confirms(),n+1);await go();assert(await mock().isDisabled());}
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);}
 await enabled.context.close();
 // Runtime visibility in DEV with flag off, and production built with the flag set true.
 for(const base of ['http://127.0.0.1:5189','http://127.0.0.1:5191']){stage='RESERVED';mode='';const t=await setup(base);await t.go();assert.equal(await t.page.getByRole('button',{name:'Mock Confirm Deposit',exact:true}).count(),0);await t.page.getByRole('button',{name:'Pay Deposit',exact:true}).click();await t.page.getByRole('status').filter({hasText:'Deposit payment initiated.'}).waitFor();assert.equal(await t.page.getByRole('button',{name:'Mock Confirm Deposit',exact:true}).count(),0);await t.context.close();}
 assert(!requests.some(r=>r.method!=='GET'&&(!r.p.endsWith('/deposit')&&!r.p.endsWith('/deposit/mock-confirm'))));assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',fixtureRequests:requests.length,explicitMockConfirmPosts:confirms(),liveRequests:0,checks:'DEV opt-in, flag off, production absent even with flag, pending-only receipt, cancel/double click, GET paid/inventory, wrong owner/stages, reload lock, preflight race, HTTP failure/timeout/malformed/reconciliation, no paid from200, responsive'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
