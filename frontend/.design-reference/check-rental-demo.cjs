const {chromium}=require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
if(['persistence','staff'].includes(process.argv[2])){
 const fs=require('node:fs');
 fs.mkdirSync('.design-reference/rental-regression',{recursive:true});
 const source=fs.readFileSync(`.design-reference/check-${process.argv[2]}.cjs`,'utf8')
  .replaceAll('C:/Users/laptop/','C:/Users/Admin/')
  .replaceAll("path:'.design-reference/","path:'.design-reference/rental-regression/");
 eval(source);
}else (async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const context=await browser.newContext(),staff=await context.newPage(),manager=await context.newPage(),errors=[];
 for(const page of [staff,manager])page.on('pageerror',e=>errors.push(e.message));
 const go=async(page,path)=>{await page.goto('http://127.0.0.1:5173'+path);await page.locator('h1, main h2').first().waitFor();};
 const saved=()=>manager.evaluate(()=>JSON.parse(localStorage.getItem('VaultSpace_manager_priority2_demo_v1')));
 await go(staff,'/staff/customers');
 await staff.getByLabel('Search customer',{exact:true}).fill('0902345678');
 assert.equal(await staff.locator('tbody tr').count(),1);
 assert.match(await staff.locator('tbody').innerText(),/Mai Trading/);
 await go(manager,'/manager/customers/CUS-002');
 await go(staff,'/staff/customers/CUS-002');
 assert(await staff.getByRole('button',{name:'Save verification',exact:true}).isDisabled());
 await staff.getByLabel('Verification review notes').fill('Customer reviewed by Staff during demo');
 await staff.getByRole('button',{name:'Save verification',exact:true}).click();
 await manager.getByText('Pham Quoc Bao: Customer reviewed by Staff during demo',{exact:true}).waitFor();
 assert.equal((await saved()).customers.find(c=>c.id==='CUS-002').verification,'VERIFIED');
 console.log('PASS phone search, Staff verification audit and cross-tab Manager refresh');
 await go(staff,'/staff/reservations/RES-M002');
 await staff.getByRole('button',{name:'Approve',exact:true}).click();
 await staff.getByRole('button',{name:'Confirm approval',exact:true}).click();
 await staff.getByText('Recorded locally; no message was sent.',{exact:true}).waitFor();
 assert.equal((await saved()).reservations.find(r=>r.id==='RES-M002').reviewedBy,'Pham Quoc Bao');
 await staff.reload();
 assert.equal(await staff.getByRole('button',{name:'Approve',exact:true}).count(),0);
 await go(manager,'/manager/reservations/RES-M003');
 assert.equal(await manager.getByRole('button',{name:'Approve',exact:true}).count(),0);
 console.log('PASS reservation approval, local notification and persistence');
 await go(manager,'/manager/refunds/REF-M001');
 await manager.getByRole('button',{name:'Approve',exact:true}).click();
 assert(await manager.getByRole('button',{name:'Confirm approval',exact:true}).isDisabled());
 await manager.getByLabel('Approval reason',{exact:true}).fill('Unused prepaid days checked against illustrative policy');
 await manager.getByRole('button',{name:'Confirm approval',exact:true}).click();
 await manager.getByRole('dialog').waitFor({state:'hidden'});
 await go(staff,'/staff/refunds/REF-M001');
 assert(await staff.getByRole('button',{name:'Review refund processing',exact:true}).isDisabled());
 await staff.getByLabel('Demo operator',{exact:true}).selectOption('STAFF-002');
 await staff.getByLabel('Demo processing reference',{exact:true}).fill('DEMO-BANK-2026-001');
 await staff.getByRole('checkbox').check();
 await staff.getByRole('button',{name:'Review refund processing',exact:true}).click();
 await staff.getByRole('button',{name:'Confirm demo processing',exact:true}).click();
 await staff.getByRole('heading',{name:'Demo refund receipt',exact:true}).waitFor();
 await manager.getByRole('heading',{name:'Demo refund receipt',exact:true}).waitFor();
 let state=await saved(),refund=state.refunds.find(r=>r.id==='REF-M001');
 assert.equal(refund.processingStatus,'COMPLETED');
 assert.equal(refund.reference,'DEMO-BANK-2026-001');
 assert.equal(state.payments.find(p=>p.id==='PAY-M001').status,'REFUNDED');
 await go(manager,'/portal/payments');
 await manager.getByRole('button',{name:/View demo refund receipt/}).click();
 await manager.getByText('DEMO-BANK-2026-001',{exact:true}).waitFor();
 await go(manager,'/manager/reports/revenue');
 const scoped=await manager.evaluate(async()=> (await import('/src/lib/demoScope.js')).demoScopeEnabled);
 if(scoped){
  await manager.getByRole('heading',{name:'Tạm ẩn trong bản demo M4',exact:true}).waitFor();
  const totals=await manager.evaluate(async()=>{const api=await import('/src/lib/managerDemoStore.js'),data=JSON.parse(localStorage.getItem(api.managerStorageKey));return {settled:data.payments.filter(p=>['PAID','REFUNDED'].includes(p.status)).reduce((sum,p)=>sum+api.paymentNet(p),0),refunded:data.payments.filter(p=>p.status==='REFUNDED').reduce((sum,p)=>sum+api.paymentNet(p),0)};});
  assert.equal(totals.settled,2900000);assert.equal(totals.refunded,900000);
 }else{
  assert.match(await manager.getByRole('heading',{name:'Collected rental revenue',exact:true}).locator('..').locator('..').locator('..').innerText(),/2\.900\.000/);
  await manager.getByLabel('Report status',{exact:true}).selectOption('REFUNDED');
  assert.match(await manager.locator('tbody').innerText(),/900\.000/);
 }
 await go(manager,'/manager/refunds/REF-M001');
 await staff.reload();
 assert.equal(await staff.getByRole('button',{name:'Review refund processing',exact:true}).count(),0);
 console.log('PASS required approval reason, operator permissions, shared payment/receipt and reload');
 await go(staff,'/staff/customers/CUS-DEMO-004');
 await staff.getByLabel('Verification decision',{exact:true}).selectOption('REJECTED');
 await staff.getByLabel('Verification review notes').fill('Demo identity review needs clarification');
 await staff.getByRole('button',{name:'Save verification',exact:true}).click();
 assert.equal((await saved()).customers.find(c=>c.id==='CUS-DEMO-004').verification,'REJECTED');
 await go(staff,'/staff/reservations/RES-DEMO-APPROVE');
 await staff.getByRole('button',{name:'Approve',exact:true}).click();
 await staff.getByRole('button',{name:'Confirm approval',exact:true}).click();
 assert.equal((await saved()).reservations.find(r=>r.id==='RES-DEMO-APPROVE').status,'APPROVED');
 await go(manager,'/manager/reservations/RES-DEMO-REJECT');
 await manager.getByRole('button',{name:'Reject',exact:true}).click();
 await manager.getByLabel('Rejection reason',{exact:true}).fill('Customer requested different dates');
 await manager.getByRole('button',{name:'Confirm rejection',exact:true}).click();
 assert.equal((await saved()).reservations.find(r=>r.id==='RES-DEMO-REJECT').status,'REJECTED');
 await go(manager,'/manager/reservations/RES-DEMO-BLOCKED');
 assert(await manager.getByRole('button',{name:'Approve',exact:true}).isDisabled());
 await go(manager,'/manager/refunds/REF-DEMO-REJECT');
 await manager.getByRole('button',{name:'Reject',exact:true}).click();
 await manager.getByLabel('Rejection reason',{exact:true}).fill('Insufficient evidence of unused days');
 await manager.getByRole('button',{name:'Confirm rejection',exact:true}).click();
 assert.equal((await saved()).refunds.find(r=>r.id==='REF-DEMO-REJECT').status,'REJECTED');
 console.log('PASS new customer rejection, reservation approval/rejection/maintenance block and refund rejection cases');
 await go(staff,'/staff/refunds');
 await staff.getByRole('button',{name:'New refund request',exact:true}).click();
 await staff.getByLabel('Original paid payment',{exact:true}).selectOption('PAY-M002');
 await staff.getByLabel('Unused prepaid days',{exact:true}).fill('31');
 await staff.getByLabel('Refund request reason',{exact:true}).fill('Customer requested refund for unused period');
 assert(await staff.getByRole('button',{name:'Submit demo request',exact:true}).isDisabled());
 await staff.getByLabel('Unused prepaid days',{exact:true}).fill('3');
 await staff.getByRole('button',{name:'Submit demo request',exact:true}).click();
 await staff.getByRole('heading',{name:'Staff processing',exact:true}).waitFor();
 const pendingId=new URL(staff.url()).pathname.split('/').pop();
 assert(await staff.getByRole('button',{name:'Review refund processing',exact:true}).isDisabled());
 state=await saved();assert.equal(state.refunds.find(r=>r.id===pendingId).calculatedRefund,200000);
 console.log('PASS Staff refund request, day validation, calculation and approval prerequisite');
 const guardResults=await staff.evaluate(async id=>{
  const m=await import('/src/lib/managerDemoStore.js'),actor={id:'STAFF-002'};
  const before=localStorage.getItem(m.managerStorageKey),messages=[];
  const attempts=[()=>m.processFacilityRefund('REF-M001',{method:'Cash',reference:'DUPLICATE',confirmed:true},actor),()=>m.processFacilityRefund(id,{method:'Cash',reference:'UNAPPROVED',confirmed:true},actor),()=>m.decide('refunds',id,'APPROVED','Staff must not approve',actor),()=>m.verifyCustomer('FOREIGN','VERIFIED','Foreign record',actor),()=>m.decide('reservations','RES-M002','REJECTED','Second decision',actor),()=>m.createRefund({paymentId:'PAY-M002',unusedDays:2,periodDays:30,reason:'Duplicate pending'},actor)];
  for(const attempt of attempts){try{attempt();messages.push('UNEXPECTED SUCCESS');}catch(e){messages.push(e.message);}}
  return {messages,unchanged:before===localStorage.getItem(m.managerStorageKey)};
 },pendingId);
 assert(!guardResults.messages.includes('UNEXPECTED SUCCESS'));assert(guardResults.unchanged);
 console.log('PASS duplicate/unauthorized/unapproved/foreign-record guards leave persisted data unchanged');
 await go(manager,'/manager/refunds/'+pendingId);
 await manager.getByRole('button',{name:'Reject',exact:true}).click();
 await manager.getByLabel('Rejection reason',{exact:true}).fill('Customer chose to keep the rental');
 await manager.getByRole('button',{name:'Confirm rejection',exact:true}).click();
 await go(staff,'/staff/refunds/'+pendingId);
 assert(await staff.getByRole('button',{name:'Review refund processing',exact:true}).isDisabled());
 await go(manager,'/admin/customers/CUS-003');
 await manager.getByLabel('Verification review notes').fill('Admin reviewed demo customer');
 await manager.getByRole('button',{name:'Save verification',exact:true}).click();
 assert.equal((await saved()).customers.find(c=>c.id==='CUS-003').verifiedBy,'Demo administrator');
 const paths=['/staff/customers','/staff/reservations','/staff/refunds','/staff/refunds/REF-M001','/manager/customers/CUS-002','/manager/refunds/REF-M001','/admin/customers','/staff/tasks','/manager/storage-units','/portal','/'];
 for(const width of [1440,390]){
  await manager.setViewportSize({width,height:900});
  for(const path of paths){await go(manager,path);assert(await manager.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overflow '+width+' '+path);}
 }
 await go(manager,'/manager/refunds/REF-M001');
 await manager.screenshot({path:'C:/WDP/WDP/frontend/.design-reference/rental-demo-refund-390.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS refund rejection, Admin customer demo, 22 desktop/mobile routes and no JS errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
