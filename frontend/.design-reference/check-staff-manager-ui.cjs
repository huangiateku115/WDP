const {chromium}=require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const context=await browser.newContext(),staff=await context.newPage(),manager=await context.newPage(),errors=[];
  for(const page of [staff,manager])page.on('pageerror',e=>errors.push(e.message));
  const go=async(page,path)=>{await page.goto('http://127.0.0.1:5173'+path);await page.locator('h1').waitFor();};
  const saved=()=>staff.evaluate(()=>JSON.parse(localStorage.getItem('VaultSpace_staff_priority3_demo_v1')));
  const confirm=async(page,label)=>{await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Confirm demo operation',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});};
  const checklist=async page=>{for(const box of await page.getByRole('checkbox').all())await box.check();};
  await go(staff,'/staff/dashboard');
  await go(staff,'/staff/tasks/STASK-CI001');await confirm(staff,'Start task');
  assert.equal((await saved()).tasks.find(t=>t.id==='STASK-CI001').status,'IN_PROGRESS');
  console.log('PASS UI assigned task detail/start and timeline');
  if(process.argv[2]!=='desk'){
  await go(staff,'/staff/check-ins/STASK-CI002');await checklist(staff);await staff.getByLabel('Operation notes',{exact:true}).fill('Unpaid rental must remain blocked');
  assert(await staff.getByRole('button',{name:'Activate paid rental',exact:true}).isDisabled());
  await go(staff,'/staff/inspections/STASK-INSP001');
  assert(await staff.getByRole('button',{name:'Save inspection',exact:true}).isDisabled());
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN0sAAAAASUVORK5CYII=','base64');
  await staff.getByLabel('Inspection photos').setInputFiles(Array.from({length:4},(_,i)=>({name:`photo-${i}.png`,mimeType:'image/png',buffer:png})));
  await staff.getByRole('alert').filter({hasText:'Choose up to 3 images'}).waitFor();
  await staff.getByLabel('Inspection photos').setInputFiles({name:'unit-condition.png',mimeType:'image/png',buffer:png});await staff.getByRole('img',{name:'unit-condition.png'}).waitFor();
  await checklist(staff);await staff.getByLabel('Operation notes',{exact:true}).fill('Unit inspected before handover');
  const before=JSON.stringify(await saved());await staff.getByRole('button',{name:'Save inspection',exact:true}).click();await staff.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(JSON.stringify(await saved()),before);
  await confirm(staff,'Save inspection');assert.equal((await saved()).rentals.find(r=>r.id==='SRNT-001').checkInInspection.photos.length,1);
  await go(staff,'/staff/handovers/STASK-HO001');await checklist(staff);await staff.getByLabel('Operation notes',{exact:true}).fill('Showed unit and access instructions');
  assert(await staff.getByRole('button',{name:'Confirm private unit handover',exact:true}).isDisabled());
  await staff.getByLabel('Customer acknowledgement',{exact:true}).fill('Nguyen Van An accepts A-101');await confirm(staff,'Confirm private unit handover');
  await go(staff,'/staff/check-ins/STASK-CI001');await checklist(staff);await staff.getByLabel('Operation notes',{exact:true}).fill('Customer checked in after payment and handover');await confirm(staff,'Activate paid rental');
  assert.equal((await saved()).rentals.find(r=>r.id==='SRNT-001').status,'Active');
  console.log('PASS UI inspection/photo limit/cancel, handover acknowledgement, paid activation and unpaid block');
  await go(manager,'/manager/operations');await manager.getByRole('button',{name:'Access simulation',exact:true}).click();await manager.getByLabel('Rental',{exact:true}).selectOption('SRNT-001');await manager.getByLabel('Operation reason',{exact:true}).fill('Demo access controls');
  for(const name of ['UNLOCK','LOCK','RESET','SUSPEND'])await manager.getByRole('button',{name,exact:true}).click();
  assert.equal((await saved()).rentals.find(r=>r.id==='SRNT-001').access.version,2);
  const suspended=JSON.stringify(await saved());await manager.getByRole('button',{name:'UNLOCK',exact:true}).click();await manager.getByRole('alert').filter({hasText:'Access is suspended'}).waitFor();assert.equal(JSON.stringify(await saved()),suspended);
  for(const name of ['RESUME','UNLOCK','REVOKE'])await manager.getByRole('button',{name,exact:true}).click();
  assert.equal((await saved()).rentals.find(r=>r.id==='SRNT-001').access.status,'REVOKED');
  await go(manager,'/manager/extensions');await manager.getByLabel('Rental',{exact:true}).selectOption('SRNT-003');const date=new Date(Date.now()+7*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});
  await manager.getByLabel('New contract end date',{exact:true}).fill(date);await manager.getByLabel('Operation reason',{exact:true}).fill('Customer requests seven more days');await manager.getByRole('button',{name:'Approve extension',exact:true}).click();
  assert.equal((await saved()).extensions.find(e=>e.rentalId==='SRNT-003').version,2);
  console.log('PASS UI lock/unlock/reset/suspend/resume/revoke and extension approval/version');
  }
  await go(manager,'/manager/operations');await manager.getByRole('button',{name:'Create maintenance',exact:true}).click();await manager.getByLabel('Issue',{exact:true}).fill('UI demo: check B-106 door');await manager.getByLabel('Empty unit',{exact:true}).selectOption('UNIT-B106');await manager.getByLabel('Priority',{exact:true}).selectOption('HIGH');await manager.getByLabel('Maintenance assignee',{exact:true}).selectOption('STAFF-003');await manager.getByRole('button',{name:'Create ticket and block unit',exact:true}).click();
  let data=await saved(),ticket=data.maintenance.find(m=>m.title==='UI demo: check B-106 door'),task=data.tasks.find(t=>t.issueId===ticket.id);assert.equal(data.units.find(u=>u.id==='UNIT-B106').status,'MAINTENANCE');
  await go(staff,'/staff/maintenance');await staff.getByLabel('Demo operator',{exact:true}).selectOption('STAFF-003');await go(staff,'/staff/maintenance/'+task.id);
  await staff.getByLabel('Operational notes',{exact:true}).fill('Door inspection in progress');await confirm(staff,'Save operational status');await staff.getByLabel('Operational status',{exact:true}).selectOption('COMPLETED');await staff.getByLabel('Operational notes',{exact:true}).fill('Door repaired and safe');await confirm(staff,'Save operational status');assert.equal((await saved()).units.find(u=>u.id==='UNIT-B106').status,'AVAILABLE');
  await go(staff,'/staff/support');await staff.getByLabel('Demo operator',{exact:true}).selectOption('STAFF-002');await go(staff,'/staff/support/STASK-SUP001');
  await staff.getByLabel('Demo customer response',{exact:true}).fill('We are investigating your access request');await staff.getByLabel('Operational notes',{exact:true}).fill('Investigation started');await confirm(staff,'Save operational status');
  await staff.getByLabel('Operational status',{exact:true}).selectOption('COMPLETED');await staff.getByLabel('Demo customer response',{exact:true}).fill('Access instructions provided');await staff.getByLabel('Operational notes',{exact:true}).fill('Customer confirmed receipt');await confirm(staff,'Save operational status');
  await staff.getByLabel('Closure note',{exact:true}).fill('Customer confirmed resolution');await confirm(staff,'Close support ticket');
  data=await saved();assert.equal(data.support.find(t=>t.id==='SSUP-001').status,'CLOSED');assert(data.notifications.some(n=>n.customerId==='SCUS-001'));
  await go(manager,'/manager/support');await manager.getByRole('link',{name:'Open checklist',exact:true}).click();await manager.getByText('CLOSED',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS UI maintenance create/start/resolve, support respond/resolve/close and Manager shared view');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
