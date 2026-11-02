// All APIs are intercepted fixtures; external traffic is blocked.
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5198',iid='1'.repeat(24),uid='2'.repeat(24),rid='3'.repeat(24),fid='4'.repeat(24),cell='5'.repeat(24),requestId='6'.repeat(24),receipt='7'.repeat(24);
const item={_id:iid,customerId:uid,managedReservationId:rid,facilityId:fid,currentCellId:cell,status:'IN_STORAGE',itemCode:'STOCK-FIXTURE',name:'Canonical stock fixture',quantity:99,quantityUnit:'box',category:'BOX',unitWeightKg:2,unitVolumeM3:0.008,totalWeightKg:198,totalVolumeM3:0.792,unitDimensionsM:{widthM:0.2,depthM:0.2,heightM:0.2},images:[]};
const rental={_id:rid,customerId:uid,facilityId:fid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:'ACTIVE',startDate:'2020-01-01',endDate:'2099-01-01'};
let held=0,state='PENDING',version=0,created=false,creates=0,cancels=0,requests=[],errors=[];
const stock=()=>({itemId:iid,customerId:uid,managedReservationId:rid,facilityId:fid,currentCellId:cell,onHandQuantity:5,heldQuantity:held,source:'LEDGER_V2',batches:[{batchId:'receipt-A',receiptMovementId:receipt,quantity:5,heldQuantity:held,quantityUnit:'box'}]});
const row=()=>({_id:requestId,itemId:iid,reservationId:rid,facilityId:fid,state,version,requestedQuantity:2,heldQuantity:state==='PENDING'?2:0,quantityUnit:'box'});
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(user=>{sessionStorage.setItem('SelfStorage_token','canonical-fixture');sessionStorage.setItem('SelfStorage_user',JSON.stringify(user));},{id:uid,role:'CUSTOMER'});
await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
await context.route('**/api/v1/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');if(req.method()==='OPTIONS')return route.fulfill({status:204});requests.push({p,method:req.method(),body:req.postDataJSON(),key:req.headers()['idempotency-key'],match:req.headers()['if-match']});let data;
if(req.method()==='GET'&&p==='/inventory-items/'+iid)data=item;
else if(req.method()==='GET'&&p==='/reservations/me')data=[rental];
else if(req.method()==='GET'&&p==='/reservations/managed/'+rid)data=rental;
else if(req.method()==='GET'&&p==='/inventory-items/'+iid+'/movements')data=[{schemaVersion:2,arithmeticPolicy:'CANONICAL_V1'}];
else if(req.method()==='GET'&&p==='/inventory-items/'+iid+'/stock-balance')data=stock();
else if(req.method()==='GET'&&p==='/inventory-items/'+iid+'/outbound-requests')data={data:created?[row()]:[],pagination:{page:1,limit:50,total:created?1:0,totalPages:created?1:0}};
else if(req.method()==='GET'&&p==='/outbound-requests/'+requestId)data=row();
else if(req.method()==='POST'&&p==='/inventory-items/'+iid+'/outbound-requests'){
 creates++;assert.deepEqual(req.postDataJSON(),{requestedQuantity:2});assert(req.headers()['idempotency-key']);await new Promise(r=>setTimeout(r,100));
 if(creates===1)return route.fulfill({status:503,json:{success:false,message:'Fixture outcome uncertain',code:'OUTBOUND_REQUEST_OUTCOME_UNKNOWN'}});
 held=2;created=true;data=row();
}else if(req.method()==='POST'&&p==='/outbound-requests/'+requestId+'/cancel'){
 cancels++;assert.deepEqual(req.postDataJSON(),{});assert(req.headers()['idempotency-key']);await new Promise(r=>setTimeout(r,100));
 if(cancels===1){assert.equal(req.headers()['if-match'],'"0"');version=1;return route.fulfill({status:409,json:{success:false,message:'Fixture stale version'}});}
 assert.equal(req.headers()['if-match'],'"1"');
 if(cancels===2)return route.fulfill({status:503,json:{success:false,message:'Fixture cancellation uncertain'}});
 held=0;state='CANCELLED';version=2;data=row();
}else throw Error('Unexpected fixture request '+req.method()+' '+p);
return route.fulfill({status:200,json:{success:true,data}});
});
await page.goto(base+'/portal/inventory/'+iid+'/outbound');await page.getByRole('heading',{name:'Partial outbound',exact:true}).waitFor();
const quantity=page.getByRole('spinbutton',{name:'Quantity to withdraw',exact:true}),create=page.getByRole('button',{name:'Request outbound',exact:true});
await page.waitForFunction(()=>document.querySelector('input[aria-label="Quantity to withdraw"]')?.max==='5');assert.equal(await quantity.getAttribute('max'),'5');await quantity.fill('6');assert(await create.isDisabled());await quantity.fill('2');
await create.evaluate(b=>{b.click();b.click();});await page.getByRole('alert').filter({hasText:'uncertain'}).waitFor();assert.equal(creates,1);
await page.getByRole('button',{name:'Retry same request',exact:true}).click();await page.getByRole('button',{name:'Cancel and release hold',exact:true}).waitFor();assert.equal(creates,2);
const createPosts=requests.filter(r=>r.method==='POST'&&r.p.endsWith('/outbound-requests'));assert.equal(createPosts[0].key,createPosts[1].key);assert.deepEqual(createPosts[0].body,createPosts[1].body);
await page.getByRole('button',{name:'Details',exact:true}).click();await page.getByRole('heading',{name:'Request detail · PENDING',exact:true}).waitFor();
const cancel=()=>page.getByRole('button',{name:'Cancel and release hold',exact:true});await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Cancel and release hold'&&!b.disabled));await cancel().evaluate(b=>{b.click();b.click();});await page.getByRole('alert').filter({hasText:'version changed'}).waitFor();assert.equal(cancels,1);await page.getByText('Version 1',{exact:true}).waitFor();
await cancel().click();await page.getByRole('alert').filter({hasText:'cancellation result is uncertain'}).waitFor();assert.equal(cancels,2);await cancel().click();await page.getByText('Outbound hold released.',{exact:true}).waitFor();assert.equal(cancels,3);
const cancelPosts=requests.filter(r=>r.method==='POST'&&r.p.endsWith('/cancel'));assert.equal(cancelPosts[1].key,cancelPosts[2].key);assert.equal(cancelPosts[1].match,cancelPosts[2].match);
assert.equal(await cancel().count(),0);assert.equal(await quantity.getAttribute('max'),'5');
for(const width of [320,390,768,1024,1440,1920]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);}
assert(requests.filter(r=>r.method==='POST').every(r=>r.p.endsWith('/outbound-requests')||r.p.endsWith('/cancel')));assert.deepEqual(errors,[]);
console.log(JSON.stringify({result:'PASS',fixtureRequests:requests.length,createPosts:creates,cancelPosts:cancels,liveRequests:0,checks:'dedicated canonical route, stock/units, partial quantity, double-click, same-key retry, details, 409 version refresh, cancellation retry, stock refresh, no legacy fallback, six widths'}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
