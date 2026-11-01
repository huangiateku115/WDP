// Every API request is fulfilled by local fixtures. Other origins are blocked.
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.SELF_PAYMENT_TEST_URL||'http://127.0.0.1:5198',rid='1'.repeat(24),uid='2'.repeat(24),fid='3'.repeat(24),cid='4'.repeat(24),pid='5'.repeat(24);
let stage='RESERVED',proof=false,mode='',calls=[],errors=[];
const reservation=()=>({_id:rid,customerId:uid,facilityId:fid,storageUnitId:'6'.repeat(24),serviceType:'SELF_STORAGE',reservationCode:'SELF-FIXTURE',status:stage,estimatedRent:100000,depositAmount:20000,taxAmount:1000,discountAmount:0,...(stage==='PAID'?{balancePaymentId:pid}:{})});
const contract=()=>({_id:cid,reservationId:rid,customerId:uid,status:'SIGNED',...(proof?{signedProofUrl:'https://example.invalid/proof.jpg'}:{})});
const breakdown={rentAmount:100000,depositCredit:20000,taxAmount:1000,discountAmount:0,totalDue:101000,balanceDue:81000};
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(user=>{localStorage.setItem('SelfStorage_token','self-fixture');localStorage.setItem('SelfStorage_user',JSON.stringify(user));},{id:uid,role:'CUSTOMER'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
 await context.route('**/api/v1/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');if(req.method()==='OPTIONS')return route.fulfill({status:204});
  calls.push({p,method:req.method(),body:req.postDataJSON()});let data;
  if(req.method()==='GET'&&p==='/reservations/me')data=[reservation()];
  else if(req.method()==='GET'&&p==='/contracts/me')data=stage==='RESERVED'?[]:[contract()];
  else if(req.method()==='GET'&&p==='/contracts/'+cid)data=contract();
  else if(req.method()==='POST'&&['/reservations/'+rid+'/deposit','/reservations/'+rid+'/balance'].includes(p)){
   assert.deepEqual(req.postDataJSON(),{});await new Promise(r=>setTimeout(r,100));
   if(mode)return route.fulfill({status:Number(mode),json:{success:false,message:'Fixture unavailable'}});
   const purpose=p.endsWith('/deposit')?'DEPOSIT':'BALANCE';data={reservationId:rid,purpose,amount:purpose==='DEPOSIT'?20000:81000,currency:'VND',breakdown,...(purpose==='BALANCE'?{contract:{_id:cid,signedProofUrl:contract().signedProofUrl}}:{})};
  }else throw Error('Unexpected fixture request '+req.method()+' '+p);
  return route.fulfill({status:200,json:{success:true,data}});
 });
 const go=async()=>{await page.goto(base+'/portal/payments/'+rid);await page.getByRole('heading',{name:'Self Storage Deposit & Balance',exact:true}).waitFor();};
 const ready=async(label)=>{await page.waitForFunction(name=>[...document.querySelectorAll('button')].some(b=>b.textContent===name&&!b.disabled),label);return page.getByRole('button',{name:label,exact:true});};
 await page.goto(base+'/portal/reservations/'+rid);await page.getByRole('link',{name:'Review Deposit & Balance',exact:true}).waitFor();await page.getByRole('link',{name:'Review Deposit & Balance',exact:true}).click();await page.getByRole('heading',{name:'Self Storage Deposit & Balance',exact:true}).waitFor();
 await (await ready('Review deposit amount')).evaluate(b=>{b.click();b.click();});
 const confirmDeposit=page.getByRole('button',{name:'Confirm Deposit (Development MOCK)',exact:true});await confirmDeposit.waitFor();assert(await confirmDeposit.isDisabled());assert.equal(calls.filter(c=>c.method==='POST').length,1);
 await page.getByText('Amount ready — awaiting explicit confirmation. No payment PENDING record or settlement was created by initiation.',{exact:true}).waitFor();
 await confirmDeposit.evaluate(b=>b.click());assert.equal(calls.filter(c=>c.method==='POST').length,1);
 // Reconciliation uses owned GETs; Staff operations are not called from Customer.
 stage='DEPOSIT_PAID';await page.getByRole('button',{name:'Refresh reservation and contract (GET)',exact:true}).click();
 await page.getByText(/Visit the facility for paper contract signing/).waitFor();assert(await page.getByRole('button',{name:'Review balance amount',exact:true}).isDisabled());
 proof=true;stage='CHECKIN_READY';await page.getByRole('button',{name:'Refresh reservation and contract (GET)',exact:true}).click();await (await ready('Review balance amount')).evaluate(b=>{b.click();b.click();});
 const confirmBalance=page.getByRole('button',{name:'Confirm Balance (Development MOCK)',exact:true});await confirmBalance.waitFor();assert(await confirmBalance.isDisabled());assert.equal(calls.filter(c=>c.method==='POST').length,2);
 for(const width of [320,390,768,1024,1440,1920]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);}
 stage='PAID';await page.getByRole('button',{name:'Refresh reservation and contract (GET)',exact:true}).click();await page.getByText('Payment recorded. Awaiting Staff handover; the rental is not active yet.',{exact:true}).waitFor();assert.equal(await confirmBalance.count(),0);
 for(const status of ['400','403','404','409','503']){stage='RESERVED';mode=status;await go();await (await ready('Review deposit amount')).click();await page.getByRole('alert').waitFor();assert.equal(await confirmDeposit.count(),0);}
 assert(calls.filter(c=>c.method==='POST').every(c=>c.p==='/reservations/'+rid+'/deposit'||c.p==='/reservations/'+rid+'/balance'));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',fixtureRequests:calls.length,initiationPosts:calls.filter(c=>c.method==='POST').length,confirmationPosts:0,liveRequests:0,checks:'navigation, deposit and balance breakdown, no fake PENDING, duplicate click, missing Staff paper proof, confirmation fail-closed, GET reconciliation, errors, no legacy fallback, six responsive widths'}));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
