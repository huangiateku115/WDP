// All API calls are fulfilled locally; unmatched external traffic is blocked.
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:5189',fid='1'.repeat(24),rid='2'.repeat(24),iid='3'.repeat(24),rack='4'.repeat(24),cell='5'.repeat(24),zone='6'.repeat(24),foreign='7'.repeat(24);
let stage='DEPOSIT_PAID',itemStage='REGISTERED',mode='',version=2,calls=[],errors=[];
const rental=()=>({_id:rid,facilityId:fid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:version,status:stage,allocatedCapacity:2,allocatedCellIds:[cell],startDate:'2026-01-01T00:00:00Z',endDate:'2030-01-01T00:00:00Z',reservationCode:'PHASE3-RES'});
const item=()=>({_id:iid,facilityId:fid,managedReservationId:rid,itemCode:'LOT-01',name:'Documents',category:'DOCUMENTS',quantity:2,quantityUnit:'BOX',unitWeightKg:20,unitDimensionsM:{widthM:.3,depthM:.25,heightM:.2},unitVolumeM3:.015,totalVolumeM3:.03,totalWeightKg:40,status:itemStage,currentCellId:null,images:[]});
(async()=>{
 const h=await import('../src/lib/inventoryRegistration.js');
 for(const status of ['RESERVED','CONTRACTED','PAID','CHECKIN_READY','CLOSED'])assert(!h.eligibleInventoryRegistration({...rental(),status}));
 assert(h.eligibleInventoryRegistration(rental()));assert(!h.eligibleInventoryRegistration({...rental(),endDate:'2020-01-01'}));assert(!h.editableInventory(item(),rental()));
 for(const status of ['DEPOSIT_PAID','CHECKIN_READY','ACTIVE'])assert(h.eligibleV2Inbound(item(),{...rental(),status}));
 assert(!h.eligibleV2Inbound(item(),{...rental(),status:'RESERVED'}));assert(!h.eligibleV2Inbound(item(),{...rental(),facilityId:foreign}));assert(!h.eligibleV2Inbound(item(),{...rental(),status:'ACTIVE',startDate:'2030-01-01'}));assert(!h.eligibleV2Inbound({...item(),status:'PENDING_INBOUND'},rental()));assert(!h.eligibleV2Inbound(item(),{...rental(),bookingFlowVersion:1}));
 const form={managedReservationId:rid,itemCode:'LOT-01',name:'Documents',category:'DOCUMENTS',quantity:'2',quantityUnit:'BOX',unitWeightKg:'20',widthM:'.3',depthM:'.25',heightM:'.2',description:'',images:''};
 for(const change of [{quantity:'0'},{quantity:'1.2'},{unitWeightKg:'0'},{widthM:'-1'},{depthM:'Infinity'},{category:''},{category:'x'.repeat(81)},{preferredCellId:'invalid'}])assert.throws(()=>h.inventoryFormPayload({...form,...change}));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem('SelfStorage_token','phase3-fixture');localStorage.setItem('SelfStorage_refreshToken','fixture');localStorage.setItem('SelfStorage_user',JSON.stringify({role:'CUSTOMER'}));});
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));
 await context.route('**/api/v1/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1',''),method=req.method();if(method==='OPTIONS')return route.fulfill({status:204});
  calls.push({method,p,body:req.postData()?JSON.parse(req.postData()):null});let data,status=200,pagination;
  if(method==='POST'&&mode==='timeout')return route.abort('timedout');
  if(method==='POST'&&/^error-/.test(mode))return route.fulfill({status:Number(mode.slice(6)),headers:{'access-control-allow-origin':'*'},json:{success:false,message:'Fixture request rejected'}});
  if(p==='/reservations/me')data=[rental()];else if(p===`/reservations/managed/${rid}`)data=rental();
  else if(p===`/public/facilities/${fid}`)data={_id:fid,name:'Phase3 Facility',status:'ACTIVE',serviceTypes:['MANAGED_INVENTORY']};
  else if(p==='/warehouse-map')data={facilityId:fid,zones:[{_id:zone,code:'A',aisles:[{aisleCode:'A1',racks:[{_id:rack,rackCode:'R1',mapX:0,mapY:0,orientation:0,operationalStatus:'AVAILABLE'}]}]}]};
  else if(p===`/racks/${rack}/detail-map`)data={rack:{_id:rack,facilityId:fid,zoneId:zone,operationalStatus:'AVAILABLE'},capacity:{},levels:[{levelNumber:1,cells:[{_id:cell,cellNumber:1,code:'ALLOCATED',operationalStatus:mode==='blocked-cell'?'BLOCKED':'AVAILABLE'},{_id:foreign,cellNumber:2,code:'FOREIGN',operationalStatus:'AVAILABLE'}]}]};
  else if(p===`/inventory-items/${iid}/inbound-request`&&method==='POST'){assert.deepEqual(req.postDataJSON(),{});await new Promise(r=>setTimeout(r,100));itemStage='PENDING_INBOUND';data=item();}
  else if(p==='/inventory-items'&&method==='POST'){assert.equal(req.postDataJSON().preferredCellId,cell);itemStage='REGISTERED';data=item();status=201;}
  else if(p===`/inventory-items/${iid}`)data=item();
  else if(p==='/inventory-items/me'){data=[item()];pagination={page:1,limit:20,total:1,totalPages:1};}
  else throw Error('Unexpected fixture '+method+' '+p);
  await route.fulfill({status,headers:{'access-control-allow-origin':'*'},json:{success:true,data,...(pagination?{pagination}:{})}});
 });
 const writes=()=>calls.filter(c=>c.method!=='GET').length;
 async function go(path){await page.goto(base+path);await page.getByRole('heading',{level:1}).waitFor();}
 async function inbound(){await go(`/portal/inventory/${iid}/inbound`);await page.getByRole('button',{name:'Refresh item status',exact:true}).waitFor();}
 stage='RESERVED';await go(`/portal/inventory/register?reservationId=${rid}`);await page.getByText(/Reservation: PHASE3-RES/).waitFor();assert(await page.getByRole('button',{name:'Register item',exact:true}).isDisabled());assert.equal(writes(),0);
 stage='DEPOSIT_PAID';await go(`/portal/inventory/register?reservationId=${rid}`);await page.getByLabel('Preferred Cell ID (optional)',{exact:true}).locator('option',{hasText:'ALLOCATED'}).waitFor({state:'attached'});
 assert.equal(await page.getByRole('option',{name:/FOREIGN/}).count(),0);
 for(const [key,value] of Object.entries(form)){const id={managedReservationId:'rental',itemCode:'code',preferredCellId:'preferred'}[key]||key;if(['managedReservationId','description','images'].includes(key))continue;await page.locator(`#inventory-${id}`).fill(value);}
 await page.getByLabel('Preferred Cell ID (optional)',{exact:true}).selectOption(cell);
 for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Registration overflow '+width);}
 assert.equal(writes(),0);mode='blocked-cell';await page.getByRole('button',{name:'Register item',exact:true}).click();await page.getByRole('alert').filter({hasText:'Preferred Cell must be'}).waitFor();assert.equal(writes(),0);
 mode='';await page.locator('#inventory-preferred').evaluate((el,id)=>el.add(new Option('Injected foreign Cell',id)),foreign);await page.locator('#inventory-preferred').selectOption(foreign);await page.getByRole('button',{name:'Register item',exact:true}).click();await page.getByRole('alert').filter({hasText:'Preferred Cell must be'}).waitFor();assert.equal(writes(),0);await page.locator('#inventory-preferred').selectOption(cell);await page.getByRole('button',{name:'Register item',exact:true}).evaluate(b=>{b.click();b.click();});await page.waitForURL('**/portal/inventory/'+iid);await page.getByText('REGISTERED',{exact:true}).waitFor();assert.equal(writes(),1);
 await inbound();assert.equal(writes(),1);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Submit inbound request',exact:true}).evaluate(b=>{b.click();b.click();});await page.getByText('Backend confirmed PENDING_INBOUND.',{exact:false}).waitFor();assert.equal(writes(),2);assert(await page.getByRole('button',{name:'Submit inbound request',exact:true}).isDisabled());
 await inbound();assert(await page.getByRole('button',{name:'Submit inbound request',exact:true}).isDisabled());assert.equal(writes(),2);
 for(const code of [400,401,403,404,409]){itemStage='REGISTERED';mode=`error-${code}`;await inbound();await page.getByRole('checkbox').check();const n=writes();await page.getByRole('button',{name:'Submit inbound request',exact:true}).click();if(code===401){await page.waitForURL('**/login');}else await page.getByRole('alert').waitFor();assert.equal(writes(),n+1);}
 mode='timeout';itemStage='REGISTERED';await inbound();await page.getByRole('checkbox').check();let n=writes();await page.getByRole('button',{name:'Submit inbound request',exact:true}).click();await page.getByRole('alert').filter({hasText:'Inbound result is unknown'}).waitFor();assert(await page.getByRole('button',{name:'Submit inbound request',exact:true}).isDisabled());
 itemStage='PENDING_INBOUND';await page.getByRole('button',{name:'Refresh item status',exact:true}).click();await page.getByText('PENDING_INBOUND',{exact:true}).waitFor();assert.equal(writes(),n+1);
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Inbound overflow '+width);}
 mode='';version=1;stage='ACTIVE';await go(`/portal/inventory/${iid}/inbound`);await page.getByText(/available here for Managed Inventory V2 only/).waitFor();assert.equal(await page.getByRole('button',{name:'Submit inbound request',exact:true}).count(),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',fixtureRequests:calls.length,realBackendRequests:0,scenarios:'V2 eligibility, fields, allocated/preferred membership and stale availability, create/inbound explicit single POST, pending guard, 400/401/403/404/409, timeout read recovery, no writes on open, legacy isolation, 5 responsive widths'}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
