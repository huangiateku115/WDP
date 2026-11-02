// Fixture-only: all API calls are fulfilled locally; no live mutation is permitted.
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5198',iid='a'.repeat(24),uid='b'.repeat(24),rid='c'.repeat(24),fid='d'.repeat(24),cell='e'.repeat(24),dest='f'.repeat(24),newId='1'.repeat(24);
const item={_id:iid,customerId:uid,managedReservationId:rid,facilityId:fid,currentCellId:cell,status:'IN_STORAGE',itemCode:'RECEIPT-FIXTURE',name:'Repeated receipt fixture',category:'BOX',quantity:99,quantityUnit:'box',unitWeightKg:2,unitVolumeM3:.008,totalWeightKg:198,totalVolumeM3:.792,unitDimensionsM:{widthM:.2,depthM:.2,heightM:.2},images:[]};
const rental={_id:rid,customerId:uid,facilityId:fid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:'ACTIVE',startDate:'2020-01-01',endDate:'2099-01-01',allocatedCellIds:[cell],allocatedCapacity:1};
const payload={requestedQuantity:2,quantityUnit:'box',declaredUnitWeightKg:2,declaredUnitDimensionsM:{widthM:.2,depthM:.2,heightM:.2}};
const row=(changes={})=>({_id:newId,itemId:iid,reservationId:rid,facilityId:fid,...payload,state:'PENDING_INSPECTION',custodyState:'NOT_TAKEN',version:0,createdAt:'2026-10-20T01:00:00Z',...changes});
let rows=Array.from({length:51},(_,i)=>row({_id:(100+i).toString(16).padStart(24,'0'),state:'CONFIRMED',custodyState:'IN_CUSTODY'})),creates=0,amends=0,cancels=0,calls=[],errors=[];
const receipt='2'.repeat(24),legacy={_id:'3'.repeat(24),itemId:iid,facilityId:fid,managedReservationId:rid,type:'INBOUND',sourceCellId:null,destinationCellId:cell,quantity:1,quantityUnit:'box',actualUnitWeightKg:2,actualTotalWeightKg:2,actualUnitDimensionsM:{widthM:.2,depthM:.2,heightM:.2},actualTotalVolumeM3:.008,performedAt:'2026-10-20T01:00:00Z',inspectionNote:'First receipt fixture'};
const line=(changes={})=>({batchId:'receipt-A',receiptMovementId:receipt,action:'REMOVE',quantity:1,quantityUnit:'box',actualUnitWeightKg:2,actualUnitDimensionsM:{widthM:.2,depthM:.2,heightM:.2},actualTotalWeightKg:2,actualTotalVolumeM3:.008,...changes});
const canonical={...legacy,_id:'4'.repeat(24),type:'OUTBOUND',sourceCellId:cell,destinationCellId:null,quantity:3,actualTotalWeightKg:8,actualTotalVolumeM3:.032,arithmeticPolicy:'CANONICAL_V1',schemaVersion:2,handoverNote:'Partial handover',batchLines:[line(),line({batchId:'receipt-B',quantity:2,actualUnitWeightKg:3,actualUnitDimensionsM:{widthM:.3,depthM:.2,heightM:.2},actualTotalWeightKg:6,actualTotalVolumeM3:.024})]};
const relocation={...canonical,_id:'5'.repeat(24),type:'RELOCATION',destinationCellId:dest,relocationNote:'Moved by Staff',batchLines:canonical.batchLines.map(b=>({...b,action:'MOVE'}))};
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(user=>{sessionStorage.setItem('SelfStorage_token','receipt-fixture');sessionStorage.setItem('SelfStorage_user',JSON.stringify(user));},{id:uid,role:'CUSTOMER'});
await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
await context.route('**/api/v1/**',async route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname.replace('/api/v1',''),method=req.method();if(method==='OPTIONS')return route.fulfill({status:204});calls.push({p,method,query:url.search,body:req.postDataJSON(),key:req.headers()['idempotency-key'],match:req.headers()['if-match']});let data,extra={};
if(method==='GET'&&p==='/inventory-items/'+iid)data=item;
else if(method==='GET'&&p==='/reservations/me')data=[rental];
else if(method==='GET'&&p==='/reservations/managed/'+rid)data=rental;
else if(method==='GET'&&p==='/public/facilities/'+fid)data={_id:fid,name:'Receipt fixture facility',status:'ACTIVE',serviceTypes:['MANAGED_INVENTORY']};
else if(method==='GET'&&p==='/inventory-items/'+iid+'/movements')data=[legacy,canonical,relocation];
else if(method==='GET'&&p==='/inventory-items/'+iid+'/stock-balance')data={itemId:iid,customerId:uid,managedReservationId:rid,facilityId:fid,currentCellId:cell,source:'LEDGER_V2',onHandQuantity:5,heldQuantity:0,batches:[{batchId:'receipt-A',receiptMovementId:receipt,quantity:5,heldQuantity:0,quantityUnit:'box'}]};
else if(method==='GET'&&p==='/inventory-items/'+iid+'/outbound-requests')data={data:[],pagination:{page:1,limit:50,total:0,totalPages:0}};
else if(method==='GET'&&p==='/inventory-items/'+iid+'/inbound-requests'){const n=Number(url.searchParams.get('page'));assert.equal(url.searchParams.get('limit'),'50');data=rows.slice((n-1)*50,n*50);extra={pagination:{page:n,limit:50,total:rows.length,totalPages:Math.ceil(rows.length/50)}};}
else if(method==='GET'&&p==='/inbound-requests/'+newId)data=rows.find(r=>r._id===newId);
else if(method==='POST'&&p==='/inventory-items/'+iid+'/inbound-requests'){
 creates++;assert.deepEqual(req.postDataJSON(),payload);assert(req.headers()['idempotency-key']);await new Promise(r=>setTimeout(r,80));
 if(creates===1)return route.fulfill({status:503,json:{success:false,message:'Fixture create outcome unknown',code:'INBOUND_REQUEST_OUTCOME_UNKNOWN'}});
 data=row();rows=[data,...rows];
}else if(method==='PATCH'&&p==='/inbound-requests/'+newId){
 amends++;const body=req.postDataJSON();assert.equal(body.requestedQuantity,3);assert(req.headers()['idempotency-key']);await new Promise(r=>setTimeout(r,80));
 if(amends===1){assert.equal(req.headers()['if-match'],'"0"');rows[0]={...rows[0],version:1};return route.fulfill({status:409,json:{success:false,message:'Fixture stale version',code:'INBOUND_REQUEST_VERSION_CONFLICT'}});}
 assert.equal(req.headers()['if-match'],'"1"');
 if(amends===2)return route.fulfill({status:503,json:{success:false,message:'Fixture amend outcome unknown',code:'INBOUND_REQUEST_OUTCOME_UNKNOWN'}});
 data={...rows[0],...body,version:2};rows[0]=data;
}else if(method==='POST'&&p==='/inbound-requests/'+newId+'/cancel'){
 cancels++;assert.deepEqual(req.postDataJSON(),{});assert.equal(req.headers()['if-match'],'"2"');assert(req.headers()['idempotency-key']);await new Promise(r=>setTimeout(r,80));
 if(cancels===1)return route.fulfill({status:503,json:{success:false,message:'Fixture cancel outcome unknown',code:'INBOUND_REQUEST_OUTCOME_UNKNOWN'}});
 data={...rows[0],state:'CANCELLED',version:3};rows[0]=data;
}else throw Error('Unexpected fixture request '+method+' '+p);
return route.fulfill({status:200,json:{success:true,data,...extra}});
});
await page.goto(base+'/portal/inventory/'+iid);const region=()=>page.locator('[aria-label="Repeated inbound requests"]');await region().getByText('Page 1 of 2 · 51 requests',{exact:true}).waitFor();
await region().getByRole('button',{name:'Next receipts',exact:true}).click();await region().getByText('Page 2 of 2 · 51 requests',{exact:true}).waitFor();assert.equal(await region().locator('article').count(),1);await region().getByRole('button',{name:'Previous receipts',exact:true}).click();await region().getByText('Page 1 of 2 · 51 requests',{exact:true}).waitFor();
await region().getByLabel('Receipt quantity (box)',{exact:true}).fill('2');await region().getByRole('button',{name:'Create receipt request',exact:true}).evaluate(b=>{b.click();b.click();});await region().getByRole('alert').filter({hasText:'Outcome is uncertain'}).waitFor();assert.equal(creates,1);
await page.reload();await region().getByRole('button',{name:'Retry same request',exact:true}).waitFor();await region().getByRole('button',{name:'Retry same request',exact:true}).click();await region().getByRole('button',{name:'Amend',exact:true}).waitFor();assert.equal(creates,2);
const createCalls=calls.filter(c=>c.method==='POST'&&c.p.endsWith('/inbound-requests'));assert.equal(createCalls[0].key,createCalls[1].key);assert.deepEqual(createCalls[0].body,createCalls[1].body);
await region().getByRole('button',{name:'Details',exact:true}).first().click();await region().getByRole('heading',{name:'Request details · PENDING_INSPECTION',exact:true}).waitFor();await region().getByRole('button',{name:'Amend',exact:true}).click();await region().getByLabel('Receipt quantity (box)',{exact:true}).fill('3');await region().getByRole('button',{name:'Save amendment',exact:true}).click();await region().getByRole('alert').filter({hasText:'State/version conflict'}).waitFor();
await region().getByRole('button',{name:'Amend',exact:true}).click();await region().getByLabel('Receipt quantity (box)',{exact:true}).fill('3');await region().getByRole('button',{name:'Save amendment',exact:true}).click();await region().getByRole('alert').filter({hasText:'Outcome is uncertain'}).waitFor();await region().getByRole('button',{name:'Retry same request',exact:true}).click();await region().getByText('Receipt request amended.',{exact:true}).waitFor();
const amendCalls=calls.filter(c=>c.method==='PATCH');assert.equal(amendCalls.length,3);assert.equal(amendCalls[1].key,amendCalls[2].key);assert.equal(amendCalls[1].match,amendCalls[2].match);assert.deepEqual(amendCalls[1].body,amendCalls[2].body);
await region().getByRole('button',{name:'Cancel',exact:true}).evaluate(b=>{b.click();b.click();});await region().getByRole('alert').filter({hasText:'Outcome is uncertain'}).waitFor();assert.equal(cancels,1);await region().getByRole('button',{name:'Retry same request',exact:true}).click();await region().getByText('Receipt request cancelled.',{exact:true}).waitFor();assert.equal(cancels,2);const cancelCalls=calls.filter(c=>c.p.endsWith('/cancel'));assert.equal(cancelCalls[0].key,cancelCalls[1].key);assert.equal(cancelCalls[0].match,cancelCalls[1].match);
await page.getByRole('link',{name:'View Movement History',exact:true}).click();await page.getByRole('heading',{name:'Movement history',exact:true}).waitFor();await page.getByText('Parent total weight: 8 kg',{exact:true}).first().waitFor();
const batchDetails=page.locator('details').filter({hasText:'Batch details (2)'});assert.equal(await batchDetails.count(),2);await batchDetails.first().locator('summary').click();await page.getByText('Batch unit weight: 3 kg',{exact:true}).first().waitFor();await page.getByText('Relocation: Moved by Staff',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/Confirm relocation|Move item/}).count(),0);
for(const width of [320,390,768,1024,1440,1920]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'overflow '+width);}
assert(calls.filter(c=>['POST','PATCH','DELETE'].includes(c.method)).every(c=>c.p.endsWith('/inbound-requests')||c.p==='/inbound-requests/'+newId||c.p.endsWith('/cancel')));assert.deepEqual(errors,[]);
console.log(JSON.stringify({result:'PASS',fixtureRequests:calls.length,creates,amends,cancels,liveRequests:0,checks:'pagination 51 records, create reload same-key retry, current-detail amendment, 409/503, cancel double click/retry, top-level envelope, parent/batch measures, relocation read-only, six widths'}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
