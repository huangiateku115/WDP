// No live API traffic: unmatched external requests are blocked, fixture writes are forbidden.
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/laptop/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:5199',fid='1'.repeat(24),rack='2'.repeat(24),zone='3'.repeat(24),cell='4'.repeat(24),code='MI-DEMO-R01-L4-C1';
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

 const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem('SelfStorage_token','cell-period-fixture');localStorage.setItem('SelfStorage_refreshToken','fixture');localStorage.setItem('SelfStorage_user',JSON.stringify({role:'CUSTOMER'}));});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort('blockedbyclient'));
 await context.route('**/api/v1/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');if(req.method()==='OPTIONS')return route.fulfill({status:204});assert.equal(req.method(),'GET','No write allowed in map status fixtures');calls.push(p);let data;
  if(p===`/public/facilities/${fid}`)data={_id:fid,name:'Cell status fixture Facility',status:'ACTIVE',serviceTypes:['MANAGED_INVENTORY']};
  else if(p==='/warehouse-map')data={facilityId:fid,zones:[{_id:zone,code:'ZONE',aisles:[{aisleCode:'A1',racks:[{_id:rack,rackCode:'R01',mapX:0,mapY:0,orientation:0,operationalStatus:'AVAILABLE',cellCount:1,availableCellCount:1}]}]}]};
  else if(p===`/racks/${rack}/detail-map`)data={rack:{_id:rack,facilityId:fid,zoneId:zone,rackCode:'R01',operationalStatus:'AVAILABLE'},capacity:{usedWeightKg:0,usedVolumeM3:0},levels:[{levelNumber:4,cells:['RESERVED','AVAILABLE','OCCUPIED','RESERVED','UNKNOWN','UNAVAILABLE'].map((status,i)=>({...cellBase,_id:(i+5).toString(16).repeat(24),cellNumber:i+1,code:'SORT-C'+(i+1),periodStatus:status==='UNAVAILABLE'?'AVAILABLE':status,isBookable:status==='AVAILABLE'}))}]};
  else throw Error('Unexpected map fixture '+p);
  await route.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:{success:true,data}});
 });
 const url=`${base}/portal/warehouse-map/${fid}/racks/${rack}?start=2030-01-31&termValue=1&termUnit=MONTH`;

 await page.goto(url);await page.locator('.wm-cell-choice').first().waitFor();
 assert.equal(await page.getByLabel('Sort Cells',{exact:true}).count(),0);assert.equal(await page.locator('[data-list-cell]').count(),0);
 const geometry=()=>page.locator('[data-cell-number]').evaluateAll(ns=>ns.map(n=>({number:n.dataset.cellNumber,left:n.offsetLeft,top:n.offsetTop})));
 const initial=await geometry();const eligibility=await page.locator('.wm-cell-choice button').evaluateAll(ns=>ns.map(n=>n.disabled));
 await page.getByRole('button',{name:/^Inspect SORT-C4,/}).click();
 for(const [status,count] of [['AVAILABLE',1],['RESERVED',2],['OCCUPIED',1],['BLOCKED',0],['MAINTENANCE',0]]){
  await page.getByRole('button',{name:'Filter Cells: '+status,exact:true}).click();
  assert.equal(await page.locator('[data-status-match=true]').count(),count);
  assert.equal(await page.locator('[data-status-match=false]').count(),6-count);
  assert.equal(await page.getByRole('button',{name:'Filter Cells: '+status,exact:true}).getAttribute('aria-pressed'),'true');
  assert.deepEqual(await geometry(),initial);
  assert.deepEqual(await page.locator('.wm-cell-choice button').evaluateAll(ns=>ns.map(n=>n.disabled)),eligibility);
  assert.equal(await page.getByRole('button',{name:/^Inspect SORT-C4,/}).getAttribute('aria-pressed'),'true');
  if(!count)await page.getByText('No Cells match this status in the current Rack.',{exact:true}).waitFor();
 }
 await page.getByRole('button',{name:'Filter Cells: MAINTENANCE',exact:true}).click();assert.equal(await page.locator('[data-status-match]').count(),0);
 await page.getByRole('button',{name:'Filter Cells: RESERVED',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('[data-status-match=true]').count(),2);
 await page.locator('.wm-search').fill('SORT-C4');assert.equal(await page.locator('[data-status-match=true]').count(),1);await page.locator('.wm-search').fill('');
 await page.getByRole('button',{name:'Clear filter',exact:true}).first().click();assert.equal(await page.locator('[data-status-match]').count(),0);
 await page.getByRole('button',{name:'Filter Cells: RESERVED',exact:true}).click();
 for(const width of [320,390,768,1024,1440,1920]){await page.setViewportSize({width,height:1000});if(await page.getByRole('button',{name:'Close details',exact:true}).isVisible())await page.getByRole('button',{name:'Close details',exact:true}).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('.wm-cell-filter-summary').scrollIntoViewIfNeeded();await page.screenshot({path:'.design-reference/cell-filter-'+width+'.png'});if(width<1200){if(!await page.getByRole('button',{name:'Filter Cells: AVAILABLE',exact:true}).isVisible())await page.getByRole('button',{name:'Zones & search',exact:true}).click();await page.getByRole('button',{name:'Filter Cells: AVAILABLE',exact:true}).click();assert.equal(await page.locator('[data-status-match=true]').count(),1);await page.getByRole('button',{name:'Filter Cells: RESERVED',exact:true}).click();}}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',filterCases:5,widths:[320,390,768,1024,1440,1920],fixtureGETs:calls.length,liveRequests:0,mutations:0}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
