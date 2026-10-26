const {chromium}=require(process.env.PLAYWRIGHT_MODULE||require('node:path').join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const assert=require('node:assert/strict');
const base=process.env.REVIEW_FRONTEND_URL||'http://127.0.0.1:5173';
const ids={facility:'a'.repeat(24),rental:'b'.repeat(24),unit:'c'.repeat(24),user:'d'.repeat(24),customer:'e'.repeat(24),ticket:'f'.repeat(24),second:'1'.repeat(24),inspection:'2'.repeat(24)};
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
async function setup(role='FACILITY_MANAGER'){
 const context=await browser.newContext(),calls=[],errors=[],flags={status:'ACTIVE',foreign:false,bad:false,expired:false,deskError:false};
 const rental=()=>({_id:ids.rental,facilityId:flags.foreign?'0'.repeat(24):ids.facility,customerId:ids.customer,storageUnitId:{_id:ids.unit,unitCode:'T-01'},serviceType:'SELF_STORAGE',reservationCode:'BKG-ACCESS',status:flags.status,startDate:'2026-10-01',endDate:'2026-10-25'});
 await context.addInitScript(()=>{localStorage.setItem('SelfStorage_token','FIXTURE');localStorage.setItem('SelfStorage_refreshToken','FIXTURE');});
 await context.route('http://localhost:5000/api/v1/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1',''),m=req.method();calls.push({p,m,query:u.search});const json=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}),ok=data=>json(200,{success:true,data});
  if(p==='/users/me/')return ok({_id:ids.user,role,assignedFacilityId:ids.facility});
  if(flags.expired)return json(401,{success:false,message:'Session expired'});
  if(p==='/reservations/facility/'+ids.facility)return ok([rental(),{...rental(),_id:'3'.repeat(24),facilityId:'0'.repeat(24),reservationCode:'FOREIGN-SECRET'}]);
  if(p==='/reservations/'+ids.rental)return ok(rental());
  if(p==='/inspections')return ok([{_id:ids.inspection,facilityId:ids.facility,reservationId:ids.rental,inspectedBy:ids.user,type:'CHECK_OUT',status:'DRAFT',createdAt:'2026-10-25'}]);
  if(p==='/maintenance-tickets'){
   if(flags.deskError)return json(503,{success:false,message:'Maintenance unavailable'});
   const page=Number(u.searchParams.get('page'))||1;
   return json(200,{success:true,data:[{_id:page===1?ids.ticket:ids.second,title:page===1?'Urgent fixture':'Page two fixture',facilityId:ids.facility,status:page===1?'OPEN':'ASSIGNED',priority:'HIGH',...(page===2?{assignedTo:ids.user}:{}),createdAt:'2026-10-24'}],pagination:{page,limit:100,total:2,totalPages:2}});
  }
  if(p==='/support-requests')return json(200,{success:true,data:[],pagination:{page:1,total:0,totalPages:0}});
  if(p==='/access/simulate-unlock'){
   const body=req.postDataJSON();assert.equal(body.reservationCode,'BKG-ACCESS');
   const log={reservationId:flags.bad?'0'.repeat(24):ids.rental,storageUnitId:ids.unit,customerId:ids.customer,action:body.pinCode==='1234'?'UNLOCK_SUCCESS':'UNLOCK_FAILED'};
   return json(body.pinCode==='1234'?200:401,{success:body.pinCode==='1234',data:log,message:body.pinCode==='1234'?'OK':'Sai mã PIN'});
  }
  return json(404,{success:false,message:'Unknown fixture endpoint'});
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 return {page,context,calls,errors,flags,root:role==='FACILITY_MANAGER'?'manager':'staff',go:p=>page.goto(base+p)};
}
for(const role of ['FACILITY_MANAGER','FACILITY_STAFF']){
 const x=await setup(role);await x.go('/'+x.root+(x.root==='manager'?'/operations':'/tasks'));await x.page.getByRole('link',{name:'Page two fixture',exact:true}).waitFor();
 assert(x.calls.some(c=>c.p==='/maintenance-tickets'&&c.query.includes('page=2')));assert.equal(await x.page.getByText('FOREIGN-SECRET',{exact:true}).count(),0);
 if(x.root==='manager'){await x.page.getByText('High priority, unassigned',{exact:true}).waitFor();await x.page.getByLabel('Assigned staff').selectOption(ids.user);assert.equal(await x.page.getByRole('link',{name:'Urgent fixture'}).count(),0);await x.page.getByLabel('Assigned staff').selectOption('');}
 else assert.equal(await x.page.getByRole('link',{name:'Urgent fixture'}).count(),0);
 if(process.env.FACILITY_SCREENSHOTS){require('node:fs').mkdirSync(process.env.FACILITY_SCREENSHOTS,{recursive:true});await x.page.screenshot({path:require('node:path').join(process.env.FACILITY_SCREENSHOTS,x.root+'-board.png'),fullPage:true});}
 x.flags.deskError=true;await x.page.getByRole('button',{name:'Refresh tasks'}).click();await x.page.getByRole('alert').filter({hasText:'Maintenance unavailable'}).waitFor();await x.page.getByRole('link',{name:'BKG-ACCESS',exact:true}).waitFor();
 await x.page.setViewportSize({width:390,height:850});assert(await x.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(x.errors,[]);await x.context.close();
}console.log('PASS facility board pagination, Staff assignment scope, partial errors, grouping and mobile');
for(const role of ['FACILITY_MANAGER','FACILITY_STAFF']){
 const x=await setup(role);await x.go('/'+x.root+'/access');await x.page.getByLabel('Access reservation').selectOption(ids.rental);await x.page.getByLabel('Simulation PIN',{exact:true}).fill('9999');await x.page.getByRole('button',{name:'Simulate unlock',exact:true}).click();await x.page.getByRole('button',{name:'Confirm unlock',exact:true}).click();await x.page.getByText('Incorrect PIN. Unlock denied; your session is still active.',{exact:true}).first().waitFor();assert(!x.page.url().endsWith('/login'));
 await x.page.getByLabel('Close dialog').click();await x.page.getByLabel('Simulation PIN',{exact:true}).fill('1234');await x.page.getByRole('button',{name:'Simulate unlock',exact:true}).click();await x.page.getByRole('button',{name:'Confirm unlock',exact:true}).click();await x.page.getByText(/The server recorded UNLOCK_SUCCESS/).waitFor();assert.equal(await x.page.getByLabel('Simulation PIN',{exact:true}).inputValue(),'');
 assert(!x.calls.some(c=>c.p==='/access/me'));if(process.env.FACILITY_SCREENSHOTS)await x.page.screenshot({path:require('node:path').join(process.env.FACILITY_SCREENSHOTS,x.root+'-access.png'),fullPage:true});await x.page.setViewportSize({width:390,height:850});assert(await x.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(x.errors,[]);await x.context.close();
}console.log('PASS both roles unlock, wrong PIN preserves session, no PIN persistence or forbidden log API');
for(const mode of ['foreign','status','bad','expired']){
 const x=await setup();await x.go('/manager/access');await x.page.getByLabel('Access reservation').selectOption(ids.rental);await x.page.getByLabel('Simulation PIN',{exact:true}).fill('1234');await x.page.getByRole('button',{name:'Simulate unlock',exact:true}).click();if(mode==='status')x.flags.status='CHECKED_OUT';else x.flags[mode]=true;await x.page.getByRole('button',{name:'Confirm unlock',exact:true}).click();
 if(mode==='expired')await x.page.waitForURL('**/login');else{await x.page.getByRole('alert').first().waitFor();assert.equal(await x.page.getByText(/The server recorded UNLOCK_SUCCESS/).count(),0);}
 if(mode!=='bad')assert(!x.calls.some(c=>c.p==='/access/simulate-unlock'));assert.deepEqual(x.errors,[]);await x.context.close();
}console.log('PASS fresh state/facility checks, mismatched success rejection and real session expiry');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
