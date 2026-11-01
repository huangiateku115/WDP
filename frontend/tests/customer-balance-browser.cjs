// Fixture-only: every API request is fulfilled locally; other external traffic is blocked.
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5198',rid='2'.repeat(24),fid='1'.repeat(24),cid='3'.repeat(24),owner='4'.repeat(24),cell='6'.repeat(24),hash='a'.repeat(64);
const user={id:owner,role:'CUSTOMER'},breakdown={estimatedRent:36000,depositAmount:7200,taxAmount:0,discountAmount:0,totalDue:36000,depositCredit:7200,balanceDue:28800};
let stage='DEPOSIT_PAID',signed='SIGNED',sigs=true,timeout=false,settled=false,requests=[],errors=[];
const rental=()=>({_id:rid,customerId:owner,facilityId:fid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:stage,...(settled?{balanceSettledAt:'2026-10-18T01:00:00Z'}:{}),allocatedCellIds:[cell],estimatedRent:36000,depositAmount:7200,taxAmount:0,discountAmount:0,managedPricingSnapshot:{pricingRule:{currency:'VND'},amountBreakdown:breakdown}});
const signature=role=>({version:1,contentHash:hash,signerId:role==='CUSTOMER'?owner:'5'.repeat(24),signerRole:role,signedAt:'2026-10-18T01:00:00Z'});
const contract=()=>({_id:cid,customerId:owner,reservationId:rid,status:signed,currentContentVersion:1,contentVersions:[{version:1,contentHash:hash,content:{reservation:{id:rid,facilityId:fid,cellIds:[cell]},pricing:breakdown,handover:[]}}],signatures:sigs?[signature('CUSTOMER'),signature('FACILITY_MANAGER')]:signed==='DRAFT'?[signature('CUSTOMER')]:[]});

// All HTTP operations below are fulfilled by fixtures; no live payment requests.
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const context=await browser.newContext(),page=await context.newPage();let confirmCalls=0,firstFailure=true;
 page.on('pageerror',e=>errors.push(e.message));
 const key='wdp-balance-'+rid;
 const payment=()=>({_id:'8'.repeat(24),reservationId:rid,customerId:owner,serviceType:'MANAGED_INVENTORY',purpose:'BALANCE',provider:'MOCK',amount:28800,currency:'VND',status:'PENDING',idempotencyKey:key});
 await context.addInitScript(u=>{localStorage.setItem('SelfStorage_token','balance-fixture');localStorage.setItem('SelfStorage_refreshToken','fixture');localStorage.setItem('SelfStorage_user',JSON.stringify(u));},user);
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
 await context.route('**/api/v1/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');if(req.method()==='OPTIONS')return route.fulfill({status:204});
  requests.push({p,method:req.method(),body:req.postDataJSON()});let data;
  if(req.method()==='GET'&&p==='/reservations/me')data=[rental()];
  else if(req.method()==='GET'&&p==='/reservations/managed/'+rid)data=rental();
  else if(req.method()==='GET'&&p==='/contracts/me')data=[contract()];
  else if(req.method()==='GET'&&p==='/contracts/'+cid)data=contract();
  else if(req.method()==='POST'&&p==='/reservations/managed/'+rid+'/balance'){
   assert.deepEqual(req.postDataJSON(),{idempotencyKey:key});await new Promise(r=>setTimeout(r,120));
   data={reservation:rental(),payment:payment(),amount:28800,currency:'VND'};
  }else if(req.method()==='POST'&&p==='/reservations/managed/'+rid+'/balance/mock-confirm'){
   confirmCalls++;assert.deepEqual(req.postDataJSON(),{idempotencyKey:key});await new Promise(r=>setTimeout(r,120));
   if(firstFailure){firstFailure=false;return route.fulfill({status:503,json:{success:false,message:'Fixture uncertain settlement'}});}
   settled=true;stage='CHECKIN_READY';data={reservation:rental(),payment:{...payment(),status:'SUCCEEDED',succeededAt:'2026-10-18T01:00:00Z'},idempotent:true};
  }else throw Error('Unexpected fixture request '+req.method()+' '+p);
  return route.fulfill({status:200,json:{success:true,data}});
 });
 const go=async()=>{await page.goto(base+'/portal/reservations/'+rid);await page.getByRole('heading',{name:'Balance Payment',exact:true}).waitFor();};
 const pay=()=>page.getByRole('button',{name:'Pay Balance (MOCK)',exact:true});
 const confirm=()=>page.getByRole('button',{name:'Confirm Balance (Development MOCK)',exact:true});
 await go();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Pay Balance (MOCK)'&&!b.disabled));
 assert.equal(await confirm().count(),0);
 await pay().evaluate(b=>{b.click();b.click();});await confirm().waitFor();
 assert.equal(requests.filter(r=>r.method==='POST').length,1);assert(await pay().isDisabled());
 // PENDING receipt survives refresh without reinitiating a payment.
 await go();await confirm().waitFor();assert(await pay().isDisabled());
 await confirm().evaluate(b=>{b.click();b.click();});
 await page.getByRole('alert').filter({hasText:'Refresh Backend state'}).waitFor();assert.equal(confirmCalls,1);
 await page.getByRole('button',{name:'Refresh balance status (GET)',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Confirm Balance (Development MOCK)'&&!b.disabled));
 await confirm().evaluate(b=>{b.click();b.click();});
 await page.getByText('Balance payment confirmed. Awaiting first physical inbound.',{exact:true}).waitFor();
 assert.equal(confirmCalls,2);assert.equal(await confirm().count(),0);assert(await page.getByRole('button',{name:'Balance payment confirmed',exact:true}).isDisabled());
 assert.equal(requests.filter(r=>r.method==='POST'&&r.p.endsWith('/balance')).length,1);
 assert(requests.filter(r=>r.method!=='GET').every(r=>r.method==='POST'&&r.p.startsWith('/reservations/managed/'+rid+'/balance')));
 for(const width of [320,390,768,1024,1440,1920]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',fixtureRequests:requests.length,initiationPosts:1,confirmationPosts:confirmCalls,liveRequests:0,checks:'PENDING, reload, manual confirmation, duplicate guard, 503 same-key retry, authoritative GET refresh, no legacy fallback, six responsive widths'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

