// No live API traffic: unmatched external requests are blocked, fixture writes are forbidden.
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5189',fid='1'.repeat(24),rack='2'.repeat(24),zone='3'.repeat(24),cell='4'.repeat(24),code='MI-DEMO-R01-L4-C1';
const cellBase={_id:cell,cellNumber:1,code,operationalStatus:'AVAILABLE',bookingStatus:'AVAILABLE',displayStatus:'AVAILABLE',periodStatus:'AVAILABLE',isBookable:true,physicalUsageKnown:true,isMine:false,hasMyInventory:false,usedWeightKg:0,usedVolumeM3:0,maxWeightKg:100,dimensions:{widthM:1,depthM:1,usableHeightM:1}};
const cases=[
 [{periodStatus:'RESERVED',isBookable:false,isMine:true},'RESERVED',false],
 [{periodStatus:'RESERVED',isBookable:false,isMine:false},'RESERVED',false],
 [{},'AVAILABLE',true],
 [{periodStatus:'AVAILABLE',isBookable:false},'UNAVAILABLE',false],
 [{periodStatus:'OCCUPIED',isBookable:false},'OCCUPIED',false],
 [{periodStatus:undefined},'UNKNOWN',false],
 [{periodStatus:'INVALID'},'UNKNOWN',false],
 [{isBookable:undefined},'UNKNOWN',false],
 [{isBookable:'true'},'UNKNOWN',false],
 [{physicalUsageKnown:false},'UNKNOWN',false],
 [{usedVolumeM3:1},'UNKNOWN',false],
 [{operationalStatus:'BLOCKED'},'UNKNOWN',false],
 [{periodStatus:'RESERVED',isBookable:false,isMine:true,hasMyInventory:true},'RESERVED',false],
 [{isMine:true,hasMyInventory:true},'AVAILABLE',true],
];
let patch=cases[0][0],calls=[],errors=[];
(async()=>{
 const {cellPeriodStatus}=await import('../src/lib/warehouseMap.js'),{cellBookingReason,bookingInterval}=await import('../src/lib/managedCellBooking.js');
 for(const [change,status,selectable] of cases){const row={...cellBase,...change};assert.equal(cellPeriodStatus(row),status);if(!selectable)assert(cellBookingReason(row,{_id:rack,facilityId:fid,operationalStatus:'AVAILABLE'},bookingInterval('2030-01-31',{value:1,unit:'MONTH'})));}
 assert.equal(cellPeriodStatus({...cellBase,bookingStatus:'RESERVED',displayStatus:'RESERVED'}),'AVAILABLE','Current-time and requested-period statuses can legitimately differ');
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem('SelfStorage_token','cell-period-fixture');localStorage.setItem('SelfStorage_refreshToken','fixture');localStorage.setItem('SelfStorage_user',JSON.stringify({role:'CUSTOMER'}));});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
 await context.route('**/api/v1/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');if(req.method()==='OPTIONS')return route.fulfill({status:204});assert.equal(req.method(),'GET','No write allowed in map status fixtures');calls.push(p);let data;
  if(p===`/public/facilities/${fid}`)data={_id:fid,name:'Cell status fixture Facility',status:'ACTIVE',serviceTypes:['MANAGED_INVENTORY']};
  else if(p==='/warehouse-map')data={facilityId:fid,zones:[{_id:zone,code:'ZONE',aisles:[{aisleCode:'A1',racks:[{_id:rack,rackCode:'R01',mapX:0,mapY:0,orientation:0,operationalStatus:'AVAILABLE',cellCount:1,availableCellCount:1}]}]}]};
  else if(p===`/racks/${rack}/detail-map`)data={rack:{_id:rack,facilityId:fid,zoneId:zone,rackCode:'R01',operationalStatus:'AVAILABLE'},capacity:{usedWeightKg:0,usedVolumeM3:0},levels:[{levelNumber:4,cells:[{...cellBase,...patch}]}]};
  else throw Error('Unexpected map fixture '+p);
  await route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:{success:true,data}});
 });
 const url=`${base}/portal/warehouse-map/${fid}/racks/${rack}?start=2030-01-31&termValue=1&termUnit=MONTH`;
 for(const [change,status,selectable] of cases){patch=change;await page.goto(url);const inspect=page.getByRole('button',{name:new RegExp('^Inspect '+code+',')});await inspect.waitFor();assert.equal(await inspect.getAttribute('class').then(s=>s.includes('wm-available')),status==='AVAILABLE');assert.equal(await inspect.getAttribute('aria-label').then(s=>s.endsWith(status+(change.isMine===true?' · YOURS':''))),true);assert.equal(await page.getByRole('button',{name:'Select for booking '+code,exact:true}).isEnabled(),selectable);
  if(status!=='AVAILABLE')assert.notEqual(await inspect.locator('.wm-status').innerText(),'AVAILABLE');if(change.isMine===true)assert((await inspect.innerText()).includes('YOURS'));if(status==='RESERVED')assert((await inspect.getAttribute('class')).includes('wm-reserved'));if(status==='OCCUPIED')assert((await inspect.getAttribute('class')).includes('wm-occupied'));
 }
 patch=cases[0][0];await page.goto(url);const inspect=page.getByRole('button',{name:new RegExp('^Inspect '+code+',')});await inspect.click();await page.getByLabel('RESERVED · YOURS',{exact:true}).first().waitFor();const info=page.locator('.wm-info-heading').filter({hasText:code}).first();assert((await info.innerText()).includes('RESERVED'));assert(!(await info.innerText()).includes('AVAILABLE'));assert(await page.getByText('Reservation-period status',{exact:true}).count()>0);assert(await page.getByText('Operational status',{exact:true}).count()>0);await page.mouse.move(0,0);
 await page.locator('.wm-cell-choice').screenshot({path:'.design-reference/customer-cell-status-reserved-yours.png'});
 for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Map overflow '+width);assert(await page.getByRole('button',{name:'Select for booking '+code,exact:true}).isDisabled());}
 patch={};await page.setViewportSize({width:1440,height:1000});await page.goto(url);await page.getByRole('button',{name:'Select for booking '+code,exact:true}).click();assert(await page.getByRole('button',{name:'Deselect '+code,exact:true}).isEnabled());assert(await page.getByRole('button',{name:'Buy',exact:true}).isEnabled());
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',cases:cases.length,requests:calls.length,realBackendRequests:0,writeRequests:0,screenshot:'.design-reference/customer-cell-status-reserved-yours.png',responsive:[1440,1024,768,390,320]}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
