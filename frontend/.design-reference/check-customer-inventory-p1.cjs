const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5198',rid='2'.repeat(24),fid='1'.repeat(24),iid='3'.repeat(24),owner='4'.repeat(24),cell='5'.repeat(24);
let png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOb8AAAAASUVORK5CYII=','base64');
const rental={_id:rid,facilityId:fid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:'ACTIVE',allocatedCapacity:1,allocatedCellIds:[cell],reservationCode:'MIR-IMAGE-FIXTURE',startDate:'2026-01-01',endDate:'2035-01-01'};
const facility={_id:fid,name:'Image fixture facility',serviceTypes:['MANAGED_INVENTORY'],status:'ACTIVE'};
let item={_id:iid,facilityId:fid,managedReservationId:rid,customerId:owner,itemCode:'IMAGE-TEST',name:'Image fixture lot',category:'BOX',quantity:1,quantityUnit:'box',unitWeightKg:2,unitDimensionsM:{widthM:.2,depthM:.2,heightM:.2},unitVolumeM3:.008,totalVolumeM3:.008,totalWeightKg:2,currentCellId:null,status:'REGISTERED',images:[],updatedAt:'2026-10-19T00:00:00Z'};
let calls=[],errors=[],uploads=new Map(),uploadMode='',failCreate=true,n=0;
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1;c.height=1;c.getContext('2d').fillRect(0,0,1,1);return c.toDataURL('image/png').split(',')[1];}),'base64');page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(u=>{sessionStorage.setItem('SelfStorage_token','image-fixture');sessionStorage.setItem('SelfStorage_refreshToken','fixture');sessionStorage.setItem('SelfStorage_user',JSON.stringify({id:u,role:'CUSTOMER'}));},owner);
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
await context.route('https://images.example.test/**',route=>route.fulfill({contentType:'image/png',body:png}));
await context.route('**/api/v1/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1',''),method=req.method();if(method==='OPTIONS')return route.fulfill({status:204});calls.push({path,method,key:req.headers()['idempotency-key'],body:req.postData()});let data,status=200,message='';
if(path==='/reservations/me')data=[rental];else if(path==='/reservations/managed/'+rid)data=rental;else if(path==='/public/facilities/'+fid)data=facility;else if(path==='/warehouse-map')data={facilityId:fid,zones:[]};
else if(path==='/inventory-items/image-uploads'&&method==='POST'){
 assert(req.headers()['content-type'].includes('multipart/form-data; boundary='));assert(req.postData().includes('name="file"'));assert(req.postData().includes('name="managedReservationId"'));assert(req.postData().includes(rid));assert.equal(req.headers().authorization,'Bearer image-fixture');assert(req.headers()['idempotency-key']);
 if(uploadMode==='network')return route.abort();if(uploadMode==='auth')return route.fulfill({status:401,json:{success:false,message:'Authentication expired'}});if(uploadMode==='quota'){status=429;message='Too many unused inventory image uploads';}else{const key=req.headers()['idempotency-key'];if(!uploads.has(key)){n++;uploads.set(key,{uploadId:n.toString(16).padStart(24,'0'),publicId:'fixture/'+n,secureUrl:'https://images.example.test/'+n+'.png',width:1,height:1,format:'png',expiresAt:new Date(Date.now()+86400000).toISOString()});}data=uploads.get(key);}
}else if(path.startsWith('/inventory-items/image-uploads/')&&method==='DELETE')data={deleted:false,scheduledFor:new Date(Date.now()+86400000).toISOString()};
else if(path==='/inventory-items'&&method==='POST'){if(failCreate){status=400;message='Fixture registration validation failure';}else{item={...item,...req.postDataJSON()};data=item;}}
else if(path==='/inventory-items/'+iid&&method==='GET')data=item;
else if(path==='/inventory-items/'+iid&&method==='PATCH'){item={...item,...req.postDataJSON(),updatedAt:new Date().toISOString()};data=item;}
else throw Error('Unexpected API '+method+' '+path);
await route.fulfill({status,json:{success:status===200,data,...(message?{message}:{})}});
});

let detailMode='loading',releaseDetail;const itemPath='/api/v1/inventory-items/'+iid;
await context.route('**/api/v1/inventory-items/'+iid,async route=>{calls.push({path:itemPath,method:route.request().method()});assert.equal(route.request().method(),'GET');if(detailMode==='loading')await new Promise(resolve=>releaseDetail=resolve);if(detailMode==='error')return route.fulfill({status:500,json:{success:false,message:'Fixture item unavailable'}});return route.fulfill({json:{success:true,data:detailMode==='missing'?null:{...item,status:'IN_STORAGE',currentCellId:cell}}});});
await context.route('**/api/v1/inventory-items/'+iid+'/movements',r=>{calls.push({path:'movements',method:r.request().method()});return r.fulfill({json:{success:true,data:[{schemaVersion:2}]}});});
await context.route('**/api/v1/inventory-items/'+iid+'/stock-balance',r=>{calls.push({path:'stock-balance',method:r.request().method()});return r.fulfill({status:503,json:{success:false,message:'Canonical feature disabled'}});});
await context.route('**/api/v1/inventory-items/'+iid+'/outbound-requests*',r=>{calls.push({path:'outbound-requests',method:r.request().method()});return r.fulfill({json:{success:true,data:{data:[],pagination:{page:1,limit:50,total:0,totalPages:0}}}});});
await context.route('**/api/v1/inventory-items/'+iid+'/inbound-requests*',r=>{calls.push({path:'inbound-requests',method:r.request().method()});return r.fulfill({status:404,json:{success:false,message:'Repeated inbound requests are not available'}});});
await page.goto(base+'/portal/inventory/'+iid);await page.getByText('Loading account data…',{exact:false}).first().waitFor();assert.equal(calls.filter(c=>['movements','stock-balance','inbound-requests'].includes(c.path)).length,0);assert.deepEqual(errors,[]);
releaseDetail();await page.getByRole('heading',{name:item.itemCode,exact:true}).waitFor();await page.getByText('Canonical feature disabled',{exact:true}).waitFor();await page.getByText('Repeated inbound requests are not available',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Request outbound',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'View Movement History',exact:true}).count(),1);
for(const mode of ['error','missing']){detailMode=mode;await page.reload();await page.getByRole('alert').first().waitFor();assert.equal(await page.locator('[aria-label="Canonical outbound"]').count(),0);assert.equal(await page.locator('[aria-label="Repeated inbound requests"]').count(),0);assert.deepEqual(errors,[]);}
assert(calls.every(c=>c.method==='GET'));console.log(JSON.stringify({result:'PASS',scenarios:['loading with no dependent requests','success','feature-disabled 404/503, no legacy fallback','500 item error','null item response'],requests:calls.length,liveRequests:0,mutations:0}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
