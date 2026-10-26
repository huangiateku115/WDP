const {chromium}=require(process.env.PLAYWRIGHT_MODULE||require('node:path').join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const assert=require('node:assert/strict');
const ids={facility:'a'.repeat(24),rental:'b'.repeat(24),unit:'c'.repeat(24),inspection:'d'.repeat(24),user:'e'.repeat(24)};
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 async function setup({role='FACILITY_STAFF',condition='GOOD',draft=true,status='ACTIVE',unitStatus='OCCUPIED',foreign=false,failure=0,inconsistent=false,completed=false}={}){
  const context=await browser.newContext(),calls=[],errors=[],prefix=role==='FACILITY_STAFF'?'/staff/checkouts':'/manager/work/CHECKOUT';
  let rental={_id:ids.rental,facilityId:foreign?'0'.repeat(24):ids.facility,storageUnitId:ids.unit,serviceType:'SELF_STORAGE',status,reservationCode:'BKG-RETURN'},unit={_id:ids.unit,facilityId:ids.facility,status:unitStatus};
  let rows=draft?[{_id:ids.inspection,reservationId:ids.rental,facilityId:ids.facility,storageUnitId:ids.unit,type:'CHECK_OUT',status:completed?'COMPLETED':'DRAFT',condition,notes:'Fixture return'}]:[];
  await context.addInitScript(()=>{localStorage.setItem('SelfStorage_token','FIXTURE');localStorage.setItem('SelfStorage_refreshToken','FIXTURE');});
  await context.route('http://localhost:5000/api/v1/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1',''),m=req.method();calls.push({p,m,body:req.postDataJSON()});const send=(code,data)=>route.fulfill({status:code,contentType:'application/json',body:JSON.stringify(data)}),ok=data=>send(200,{success:true,data});
   if(p==='/users/me/')return ok({_id:ids.user,role,assignedFacilityId:ids.facility});
   if(p==='/reservations/facility/'+ids.facility)return ok([rental]);
   if(p==='/reservations/'+ids.rental)return ok(rental);
   if(p==='/storage-units/'+ids.unit)return ok(unit);
   if(p==='/inspections'&&m==='GET')return ok(rows);
   if(p==='/inspections'&&m==='POST'){rows=[{...req.postDataJSON(),_id:ids.inspection,status:'DRAFT'}];return ok(rows[0]);}
   if(p==='/inspections/'+ids.inspection+'/complete'){
    await new Promise(r=>setTimeout(r,150));if(failure)return send(failure,{success:false,message:'Fixture failure'});
    rows[0].status='COMPLETED';if(!inconsistent){rental.status='CHECKED_OUT';unit.status=['DAMAGED','NEEDS_CLEANING'].includes(rows[0].condition)?'MAINTENANCE':'AVAILABLE';}return ok(rows[0]);
   }
   return send(404,{success:false,message:'Unexpected fixture request'});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  const go=path=>page.goto((process.env.REVIEW_FRONTEND_URL||'http://127.0.0.1:5173')+path);
  async function ready(){await go(prefix+'/'+ids.inspection);await page.getByRole('button',{name:'Complete checkout',exact:true}).waitFor();for(const box of await page.getByRole('checkbox').all())await box.check();await page.getByRole('button',{name:'Complete checkout',exact:true}).click();}
  return {context,page,calls,errors,prefix,go,ready};
 }
 let x=await setup({draft:false});await x.go(x.prefix);await x.page.getByLabel('Active reservation',{exact:true}).selectOption(ids.rental);await x.page.getByLabel('Checkout notes',{exact:true}).fill('Đã thu hồi khóa, kiểm tra đồ đạc');for(const box of await x.page.getByRole('checkbox').all())await box.check();await x.page.getByRole('button',{name:'Save checkout inspection',exact:true}).click();await x.page.waitForURL('**/'+ids.inspection);const created=x.calls.find(c=>c.m==='POST');assert.equal(created.body.type,'CHECK_OUT');assert.equal(created.body.storageUnitId,ids.unit);assert(!('status'in created.body));assert(!('inspectedBy'in created.body));assert(!('damageFee'in created.body));await x.context.close();console.log('PASS create CHECK_OUT with backend IDs and no fake fees/state');
 for(const [role,condition] of [['FACILITY_STAFF','GOOD'],['FACILITY_MANAGER','EXCELLENT'],['FACILITY_STAFF','DAMAGED'],['FACILITY_MANAGER','NEEDS_CLEANING']]){
  x=await setup({role,condition});await x.ready();await x.page.getByRole('button',{name:'Confirm checkout',exact:true}).click();await x.page.getByText('Confirmed CHECKED_OUT; unit '+(['DAMAGED','NEEDS_CLEANING'].includes(condition)?'MAINTENANCE':'AVAILABLE')+'.',{exact:true}).waitFor();assert.equal(x.calls.filter(c=>c.m==='PATCH').length,1);assert.equal(await x.page.getByRole('button',{name:'Complete checkout',exact:true}).count(),0);assert.deepEqual(x.errors,[]);await x.context.close();
 }console.log('PASS both roles, four conditions, confirmed CHECKED_OUT/unit and no repeated completion');
 for(const options of [{status:'PAID'},{status:'CHECKED_OUT'},{unitStatus:'AVAILABLE'},{foreign:true},{failure:400},{failure:403},{failure:409},{inconsistent:true}]){
  x=await setup(options);await x.ready();await x.page.getByRole('button',{name:'Confirm checkout',exact:true}).click();await x.page.getByRole('alert').first().waitFor();assert.equal(await x.page.getByText(/Confirmed CHECKED_OUT/).count(),0);if(options.status||options.unitStatus||options.foreign)assert(!x.calls.some(c=>c.m==='PATCH'));assert.deepEqual(x.errors,[]);await x.context.close();
 }console.log('PASS state/scope guards, API errors and inconsistent backend state');
 x=await setup({failure:401});await x.ready();await x.page.getByRole('button',{name:'Confirm checkout',exact:true}).click();await x.page.waitForURL('**/login');await x.context.close();
 x=await setup({completed:true});await x.go(x.prefix+'/'+ids.inspection);await x.page.getByText('This inspection is complete. Do not check out again.',{exact:true}).waitFor();assert.equal(await x.page.getByRole('button',{name:'Complete checkout',exact:true}).count(),0);await x.context.close();
 for(const role of ['FACILITY_STAFF','FACILITY_MANAGER']){
  x=await setup({role});const root=role==='FACILITY_STAFF'?'staff':'manager';await x.go('/'+root+'/dashboard');await x.page.waitForURL('**/'+root+'/reservations');await x.page.getByRole('navigation',{name:root==='staff'?'Staff navigation':'Manager navigation'}).waitFor();
  const links=await x.page.getByRole('navigation').getByRole('link').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  assert(links.includes(x.prefix));assert(!links.some(s=>/dashboard|inventory|refunds|reports|charges|extensions|storage-units|storage-locations/.test(s)));
  for(const suffix of ['refunds','inventory/inbound','reports/revenue']){const start=x.calls.length;await x.go('/'+root+'/'+suffix);await x.page.getByText('Page temporarily hidden',{exact:true}).waitFor();assert(!x.calls.slice(start).some(c=>c.m!=='GET'));}
  await x.go(x.prefix+'/'+ids.inspection);await x.page.setViewportSize({width:390,height:850});assert(await x.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(x.errors,[]);await x.context.close();
 }console.log('PASS session expiry, completed protection, API-only menus/deep links/default page and mobile layout');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
