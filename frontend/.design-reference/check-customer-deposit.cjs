// Fixture-only: APIs are intercepted and every other external request is blocked.
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5189',rid='2'.repeat(24),fid='1'.repeat(24),owner='4'.repeat(24),cell='6'.repeat(24);
const user={id:owner,role:'CUSTOMER'},amounts={estimatedRent:36000,depositAmount:7200,taxAmount:0,discountAmount:0,totalDue:36000,depositCredit:7200,balanceDue:28800};
let stage='RESERVED',mode='',missing=false,expired=false,requests=[],errors=[];
const rental=()=>({_id:rid,reservationCode:'MIR-DEPOSIT-FIXTURE',customerId:owner,facilityId:fid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:stage,startDate:'2030-01-01T00:00:00Z',endDate:'2031-01-01T00:00:00Z',expiresAt:expired?'2000-01-01T00:00:00Z':'2030-01-01T00:00:00Z',allocatedCellIds:[cell],allocatedCapacity:1,estimatedRent:36000,depositAmount:7200,taxAmount:0,discountAmount:0,...(!missing?{managedPricingSnapshot:{pricingRule:{currency:'VND'},amountBreakdown:amounts}}:{})});
(async()=>{
 const {customerDepositState:state,confirmedDepositResult:verify,depositKey}=await import('../src/lib/customerDeposit.js');
 const {assertConfirmedRequest:allow}=await import('../src/api/confirmedContract.js');
 const before=JSON.stringify(rental());assert(state(rental(),user).eligible);assert.equal(depositKey(rid),`wdp-deposit-${rid}`);
 allow({method:'post',url:`/reservations/managed/${rid}/deposit`});for(const suffix of ['deposit/mock-confirm','balance/mock-confirm'])assert.throws(()=>allow({method:'post',url:`/reservations/managed/${rid}/${suffix}`}));
 assert(!state(rental(),{...user,id:'7'.repeat(24)}).eligible);assert(!state(rental(),{...user,role:'FACILITY_MANAGER'}).eligible);
 for(const r of [{...rental(),bookingFlowVersion:1},{...rental(),bookingFlowVersion:'2'},{...rental(),serviceType:'SELF_STORAGE'},{...rental(),managedPricingSnapshot:null},{...rental(),expiresAt:null},{...rental(),expiresAt:'invalid'},{...rental(),status:'CANCELLED'},{...rental(),managedPricingSnapshot:{pricingRule:{currency:'USD'},amountBreakdown:amounts}}])assert(!state(r,user).eligible);
 const expires=Date.parse(rental().expiresAt);assert(state(rental(),user,expires-1).eligible);assert(!state(rental(),user,expires).eligible);assert(!state(rental(),user,expires+1).eligible);
 for(const status of ['DEPOSIT_PAID','CHECKIN_READY','ACTIVE']){assert(state({...rental(),status},user).complete);assert(!state({...rental(),status},user).eligible);}
 const payment=()=>({_id:'8'.repeat(24),reservationId:rid,facilityId:fid,customerId:owner,serviceType:'MANAGED_INVENTORY',purpose:'DEPOSIT',provider:'MOCK',amount:7200,currency:'VND',status:'PENDING',idempotencyKey:depositKey(rid)});
 const result=()=>({payment:payment(),reservationId:rid,amount:7200,currency:'VND',idempotent:false});
 assert.equal(verify(result(),rental(),user),'PENDING');for(const status of ['SUCCEEDED','RECONCILIATION_REQUIRED'])assert.equal(verify({...result(),payment:{...payment(),status}},rental(),user),status);
 for(const patch of [{amount:36000},{purpose:'BALANCE'},{customerId:'7'.repeat(24)},{reservationId:'7'.repeat(24)},{provider:'PAYOS'},{currency:'USD'},{status:'FAILED'},{idempotencyKey:'new-key'}])assert.throws(()=>verify({...result(),payment:{...payment(),...patch}},rental(),user));
 assert.throws(()=>verify({payment:payment()},rental(),user));assert.equal(JSON.stringify(rental()),before);
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(u=>{localStorage.setItem('SelfStorage_token','deposit-fixture');localStorage.setItem('SelfStorage_refreshToken','fixture');localStorage.setItem('SelfStorage_user',sessionStorage.getItem('deposit-user')||JSON.stringify(u));},user);
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
 await context.route('**/api/v1/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');if(req.method()==='OPTIONS')return route.fulfill({status:204});requests.push({p,method:req.method(),body:req.postDataJSON()});let data;
 if(req.method()==='GET'&&p==='/reservations/me')data=[rental()];else if(req.method()==='GET'&&p===`/reservations/managed/${rid}`){if(mode==='GET_ERROR')return route.fulfill({status:500,json:{success:false,message:'Fixture error'}});data=rental();}
 else if(req.method()==='GET'&&p==='/contracts/me')data=[];
 else if(req.method()==='POST'&&p===`/reservations/managed/${rid}/deposit`){assert.deepEqual(req.postDataJSON(),{idempotencyKey:depositKey(rid)});if(mode==='TIMEOUT')return route.abort('timedout');if(/^\d+$/.test(mode))return route.fulfill({status:Number(mode),json:{success:false,message:'Fixture rejection'}});await new Promise(r=>setTimeout(r,100));data=mode==='MALFORMED'?{payment:{...payment(),amount:1}}:result();return route.fulfill({status:201,json:{success:true,data}});}
 else throw Error('Unexpected fixture API '+req.method()+' '+p);
 return route.fulfill({status:200,json:{success:true,data}});
 });
 const section=()=>page.locator('div').filter({has:page.getByRole('heading',{name:'Deposit Payment',exact:true})}).last();
 const pay=()=>page.getByRole('button',{name:'Pay Deposit',exact:true}),refresh=()=>page.getByRole('button',{name:'Refresh Payment Status',exact:true});
 const posts=()=>requests.filter(r=>r.method==='POST');
 async function go(){await page.goto(`${base}/portal/reservations/${rid}`);await page.getByRole('heading',{name:'Deposit Payment',exact:true}).waitFor();await page.getByText('Current reservation status',{exact:true}).waitFor();}
 async function enabled(){await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Pay Deposit'&&!b.disabled));}
 async function clearAttempt(){await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('VaultSpace_deposit_attempt:')).forEach(k=>localStorage.removeItem(k)));}
 await go();await enabled();const text=await section().innerText();for(const s of ['MIR-DEPOSIT-FIXTURE','36.000 VND','7.200 VND','28.800 VND','advance rent'])assert(text.includes(s));assert.equal(posts().length,0);
 await pay().evaluate(b=>{b.click();b.click();});await page.getByRole('status').filter({hasText:'Deposit payment initiated. Waiting for confirmation.'}).waitFor();assert.equal(posts().length,1);assert(await pay().isDisabled());assert.equal(await page.getByRole('button',{name:'Deposit Paid',exact:true}).count(),0);assert.equal(stage,'RESERVED');
 const refreshStart=requests.length;await refresh().click();await page.getByText('Current reservation status',{exact:true}).waitFor();assert(requests.slice(refreshStart).every(r=>r.method==='GET'));assert.equal(posts().length,1);assert(await pay().isDisabled());
 await go();await page.getByRole('status').filter({hasText:'Deposit confirmation is unresolved'}).waitFor();assert(await pay().isDisabled());
 stage='DEPOSIT_PAID';await refresh().click();await page.getByRole('button',{name:'Deposit Paid',exact:true}).waitFor();assert.equal(await pay().count(),0);assert(await page.getByRole('link',{name:'Register inventory item',exact:true}).isVisible());assert.equal(stage,'DEPOSIT_PAID');assert.equal(posts().length,1);
 for(const status of ['CHECKIN_READY','ACTIVE']){stage=status;await go();await page.getByRole('button',{name:'Deposit Paid',exact:true}).waitFor();assert.equal(await pay().count(),0);}
 stage='RESERVED';await clearAttempt();missing=true;await go();await section().getByRole('note').filter({hasText:'pricing snapshot is missing'}).waitFor();assert(await pay().isDisabled());missing=false;
 expired=true;await go();await section().getByRole('note').filter({hasText:'hold has expired'}).waitFor();assert(await pay().isDisabled());expired=false;
 // Eligibility is checked again on GET preflight, including expiry while the form is open.
 await go();await enabled();expired=true;const n=posts().length;await pay().click();await section().getByRole('alert').filter({hasText:'hold has expired'}).waitFor();assert.equal(posts().length,n);expired=false;
 await page.evaluate(()=>sessionStorage.setItem('deposit-user',JSON.stringify({id:'7'.repeat(24),role:'CUSTOMER'})));await go();await section().getByRole('note').filter({hasText:'does not belong'}).waitFor();assert(await pay().isDisabled());await page.evaluate(()=>sessionStorage.removeItem('deposit-user'));
 for(const failure of ['400','401','403','404','409','TIMEOUT','MALFORMED']){mode=failure;await clearAttempt();await go();await enabled();const start=posts().length;await pay().click();if(failure==='401'){await page.waitForURL(/login/);await go();}else await section().getByRole('alert').filter({hasText:'Deposit confirmation is unresolved'}).waitFor();assert.equal(posts().length,start+1);if(failure==='401')await page.getByRole('status').filter({hasText:'Deposit confirmation is unresolved'}).waitFor();assert(await pay().isDisabled());mode='';await refresh().click();await page.getByText('Current reservation status',{exact:true}).waitFor();assert(await pay().isDisabled());assert.equal(posts().length,start+1);await go();assert(await pay().isDisabled());}
 mode='GET_ERROR';await refresh().click();await section().getByRole('alert').waitFor();assert(await pay().isDisabled());mode='';
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);}
 assert(!requests.some(r=>r.p.includes('mock-confirm')));assert(!requests.some(r=>r.method==='POST'&&!r.p.endsWith('/deposit')));assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',fixtureRequests:requests.length,explicitDepositPosts:posts().length,liveRequests:0,checks:'eligible RESERVED, financial display, ID/key/body, double click, PENDING, GET settlement/inventory action, paid stages, expiry/preflight, wrong owner, invalid pricing, errors401/400/403/404/409, timeout/reload lock, GET-only refresh, no mock-confirm, responsive'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
