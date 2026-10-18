// Isolated Customer Phase 1 browser fixtures. No real backend traffic or files written.
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:5189',fid='1'.repeat(24),rid='2'.repeat(24),rack='3'.repeat(24),zone='4'.repeat(24),cid='5'.repeat(24),cell='6'.repeat(24);
let status='RESERVED',version=2,flags={},quoteMode='',calls=[],pageErrors=[];
const snapshot=()=>({pricingRule:{currency:'VND'},amountBreakdown:{estimatedRent:100,depositAmount:20,taxAmount:0,discountAmount:0,totalDue:100,depositCredit:20,balanceDue:80}});
const reservation=()=>({_id:rid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:version,status,facilityId:fid,allocatedCellIds:[cell],allocatedCapacity:.12,managedPricingSnapshot:snapshot(),estimatedRent:100,depositAmount:20,taxAmount:0,discountAmount:0,startDate:'2030-01-31T00:00:00.000Z',endDate:'2030-02-28T00:00:00.000Z',expiresAt:'2030-01-31T00:00:00.000Z'});
const row=()=>({_id:cell,code:'V2-CELL',cellNumber:1,operationalStatus:'AVAILABLE',bookingStatus:'AVAILABLE',displayStatus:'AVAILABLE',periodStatus:'AVAILABLE',isBookable:true,physicalUsageKnown:true,usedWeightKg:0,usedVolumeM3:0,dimensions:{widthM:.5,depthM:.6,usableHeightM:.4},...flags});
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>pageErrors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem('SelfStorage_token','phase1-fixture');localStorage.setItem('SelfStorage_refreshToken','phase1-fixture-refresh');localStorage.setItem('SelfStorage_user',JSON.stringify({role:'CUSTOMER'}));});
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===base?route.continue():route.abort('blockedbyclient');});
 await context.route('**/api/v1/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1','');calls.push({method:req.method(),path:p});
  if(req.method()==='OPTIONS')return route.fulfill({status:204});
  let data;if(p==='/reservations/me')data=[reservation()];else if(p===`/reservations/managed/${rid}`)data=reservation();
  else if(p==='/contracts/me')data=[{_id:cid,reservationId:rid,status:'DRAFT'}];
  else if(p===`/contracts/${cid}`)data={_id:cid,reservationId:rid,status:'DRAFT',pricingSnapshot:snapshot(),termsVersion:'fixture'};
  else if(p==='/customers/me/profile')data={verificationStatus:'VERIFIED'};
  else if(p.startsWith('/public/facilities/'))data={_id:fid,name:'Phase1 fixture',status:'ACTIVE',serviceTypes:['MANAGED_INVENTORY']};
  else if(p==='/warehouse-map')data={facilityId:fid,zones:[{_id:zone,code:'V2-ZONE',aisles:[{aisleCode:'A1',racks:[{_id:rack,rackCode:'V2-RACK',mapX:0,mapY:0,orientation:0,operationalStatus:'AVAILABLE',cellCount:1,availableCellCount:1}]}]}]};
  else if(p===`/racks/${rack}/detail-map`)data={rack:{_id:rack,facilityId:fid,zoneId:zone,rackCode:'V2-RACK',operationalStatus:'AVAILABLE'},capacity:{usedWeightKg:0,usedVolumeM3:0},levels:[{levelNumber:1,cells:[row()]}]};
  else if(p==='/reservations/managed/quote'){
   const q=req.postDataJSON();data={facilityId:fid,bookingFlowVersion:2,allocatedCapacityM3:q.allocatedCapacityM3,startDate:q.startDate,endDate:q.startDate==='2030-01-31T00:00:00.000Z'?'2030-02-28T00:00:00.000Z':'2030-03-01T00:00:00.000Z',term:q.term,pricing:{estimatedRent:100,currency:'VND',ratePerM3:100},deposit:{amount:20,percentage:20},taxAmount:0,paymentBreakdown:{totalDue:100,depositCredit:20,balanceDue:80}};
   if(quoteMode==='missing')delete data.paymentBreakdown;if(quoteMode==='invalid')data.paymentBreakdown.balanceDue=100;
  }else throw Error('Unexpected fixture API '+req.method()+' '+p);
  await route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:{success:true,data}});
 });
 for(const stage of ['RESERVED','DEPOSIT_PAID','CHECKIN_READY','ACTIVE']){
  status=stage;await page.goto(`${base}/portal/reservations/${rid}`);await page.getByText(rid,{exact:true}).first().waitFor();
  const text=await page.locator('main').innerText();assert(!text.includes('Waiting for management approval.'));assert(!text.includes('must activate'));assert(!text.includes('physical occupancy requires'));
  if(stage==='CHECKIN_READY')assert(text.includes('not ACTIVE'));if(stage==='ACTIVE')assert(text.includes('Staff confirmed first physical inbound'));
  assert.equal(await page.getByRole('link',{name:'Review simulated payment',exact:true}).count(),0);
 }
 await page.goto(`${base}/portal/payments/${rid}`);await page.getByText('No payment can be submitted here.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:/Initiate|Confirm development|Simulate Payment/}).count(),0);
 for(const stage of ['DEPOSIT_PAID','CONTRACTED']){status=stage;await page.goto(`${base}/portal/contracts/${rid}`);await page.getByRole('heading',{name:'Review rental contract'}).waitFor();await page.getByText('DRAFT',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Sign Contract',exact:true}).count(),0);}
 version=undefined;status='CONTRACTED';await page.goto(`${base}/portal/contracts/${rid}`);await page.getByRole('button',{name:'Sign Contract',exact:true}).waitFor();
 const mapUrl=`${base}/portal/warehouse-map/${fid}/racks/${rack}?start=2030-01-31&termValue=1&termUnit=MONTH`;
 for(const patch of [{physicalUsageKnown:false},{isBookable:false},{physicalUsageKnown:null},{isBookable:null}]){flags=patch;await page.goto(mapUrl);const b=page.getByRole('button',{name:'Select for booking V2-CELL',exact:true});await b.waitFor();assert(await b.isDisabled());}
 flags={};await page.goto(mapUrl);await page.getByRole('button',{name:'Select for booking V2-CELL',exact:true}).click();await page.getByText('Selected Cells (1)',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Buy',exact:true}).click();await page.getByRole('button',{name:'Get Cell quote',exact:true}).click();await page.getByText('Total rent payable',{exact:true}).waitFor();assert(await page.getByText('100 VND',{exact:true}).count()>0);assert(await page.getByText('80 VND',{exact:true}).count()>0);assert.equal(await page.getByText(/Calculated estimate: 120/).count(),0);
 for(const mode of ['missing','invalid']){quoteMode=mode;await page.getByRole('button',{name:'Get Cell quote',exact:true}).click();await page.getByText('Managed V2 pricing is unavailable or inconsistent. Refresh the confirmed snapshot.',{exact:true}).first().waitFor();assert(await page.getByRole('button',{name:'Confirm Reservation',exact:true}).isDisabled());}
 quoteMode='';await page.getByRole('button',{name:'Get Cell quote',exact:true}).click();await page.getByText('Total rent payable',{exact:true}).waitFor();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByLabel('Cell rental start date (UTC)',{exact:true}).fill('2030-02-01');await page.getByRole('button',{name:'Buy',exact:true}).click();assert.equal(await page.getByText('Total rent payable',{exact:true}).count(),0);await page.getByRole('button',{name:'Cancel',exact:true}).click();
 flags={isBookable:false};await page.reload();assert(await page.getByRole('button',{name:'Buy',exact:true}).isDisabled());
 assert.deepEqual(pageErrors,[]);assert(!calls.some(c=>c.method!=='GET'&&c.method!=='OPTIONS'&&c.path!=='/reservations/managed/quote'));
 console.log(JSON.stringify({result:'PASS',fixture:true,requests:calls.length,scenarios:'4 V2 lifecycle stages; no legacy/V2 mutation controls; legacy sign retained; eligibility flags; 100/20/80 quote; missing/inconsistent money; date invalidation; stale basket blocked',realBackendRequests:0}));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
