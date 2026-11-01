import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import * as staged from '../src/lib/selfStorageStagedPayment.js';
import * as registration from '../src/lib/inventoryRegistration.js';
import {assertConfirmedRequest} from '../src/api/confirmedContract.js';
const require=createRequire(import.meta.url),rid='1'.repeat(24),uid='2'.repeat(24),fid='3'.repeat(24),cid='4'.repeat(24),pid='5'.repeat(24);
const user={_id:uid,role:'CUSTOMER'};
const reservation={_id:rid,customerId:uid,facilityId:fid,serviceType:'SELF_STORAGE',status:'RESERVED',estimatedRent:100000,depositAmount:20000,taxAmount:1000,discountAmount:0};
const contract={_id:cid,reservationId:rid,customerId:uid,status:'SIGNED',signedProofUrl:'https://example.invalid/proof.jpg'};
const breakdown={rentAmount:100000,depositCredit:20000,taxAmount:1000,discountAmount:0,totalDue:101000,balanceDue:81000};
const quote=purpose=>({reservationId:rid,purpose,amount:purpose==='DEPOSIT'?20000:81000,currency:'VND',breakdown,...(purpose==='BALANCE'?{contract:{_id:cid,signedProofUrl:contract.signedProofUrl}}:{})});
function compile(path,mocks={},env={DEV:true}){
 const code=transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader:path.endsWith('jsx')?'jsx':'js',format:'cjs',jsx:'automatic',define:{'import.meta.env':JSON.stringify(env)}}).code;
 const module={exports:{}};new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);return module.exports;
}
test('owned RESERVED supports deposit initiation before a contract exists',()=>{
 assert.deepEqual(staged.selfStorageStage(reservation,null,user).purpose,'DEPOSIT');assert(staged.selfStorageStage(reservation,null,user).eligible);
 for(const r of [null,{...reservation,serviceType:'MANAGED_INVENTORY'},{...reservation,customerId:'6'.repeat(24)}])assert(!staged.selfStorageStage(r,contract,user).eligible);
});
test('balance requires Staff paper proof, not only electronic SIGNED',()=>{
 for(const status of ['DEPOSIT_PAID','CHECKIN_READY']){
  const r={...reservation,status};assert(staged.selfStorageStage(r,contract,user).eligible);
  for(const c of [null,{...contract,status:'DRAFT'},{...contract,signedProofUrl:''},{...contract,reservationId:'6'.repeat(24)},{...contract,customerId:'6'.repeat(24)}])assert(!staged.selfStorageStage(r,c,user).eligible);
 }
});
test('PAID and ACTIVE have distinct completion messages; no new payment allowed',()=>{
 for(const status of ['PAID','ACTIVE']){const s=staged.selfStorageStage({...reservation,status},contract,user);assert(s.complete);assert(!s.eligible);}
 assert.match(staged.selfStorageStage({...reservation,status:'PAID'},contract,user).reason,/Awaiting Staff/);
});
test('legacy CONTRACTED and old paid reservations keep original flow; Managed excluded',()=>{
 for(const status of ['CONTRACTED','PAID','ACTIVE'])assert(!staged.usesSelfStorageStagedPayment({...reservation,status}));
 for(const status of ['RESERVED','DEPOSIT_PAID','CHECKIN_READY'])assert(staged.usesSelfStorageStagedPayment({...reservation,status}));
 assert(staged.usesSelfStorageStagedPayment({...reservation,status:'PAID',balancePaymentId:pid}));
 assert(!staged.usesSelfStorageStagedPayment({...reservation,serviceType:'MANAGED_INVENTORY'}));
});
for(const purpose of ['DEPOSIT','BALANCE'])test(purpose+' initiation mapping uses Backend breakdown without recalculating amounts',()=>{
 assert.equal(staged.selfStorageQuote(quote(purpose),reservation,purpose).amount,quote(purpose).amount);
 for(const value of [{...quote(purpose),amount:1},{...quote(purpose),currency:'USD'},{...quote(purpose),reservationId:uid},{...quote(purpose),breakdown:{...breakdown,rentAmount:0}}])assert.throws(()=>staged.selfStorageQuote(value,reservation,purpose));
});
test('confirmation fixture maps SUCCEEDED and reservation payment pointer, not PENDING',()=>{
 for(const purpose of ['DEPOSIT','BALANCE']){
  const r={...reservation,status:purpose==='DEPOSIT'?'DEPOSIT_PAID':'PAID',[purpose==='DEPOSIT'?'depositPaymentId':'balancePaymentId']:pid};
  const payment={_id:pid,reservationId:rid,customerId:uid,facilityId:fid,serviceType:'SELF_STORAGE',purpose,provider:'MOCK',status:'SUCCEEDED',amount:quote(purpose).amount,currency:'VND',idempotencyKey:purpose+'-server-generated-key',succeededAt:'2026-10-27T01:00:00Z'};
  assert(staged.selfStorageSettlement({reservation:r,payment},reservation,purpose,quote(purpose),user));
  for(const p of [{...payment,status:'PENDING'},{...payment,amount:0},{...payment,customerId:fid}])assert.throws(()=>staged.selfStorageSettlement({reservation:r,payment:p},reservation,purpose,quote(purpose),user));
 }
});
for(const dev of [true,false])test('mock callback remains blocked without verified Backend environment, DEV='+dev,()=>{
 const policy=staged.selfStorageConfirmationPolicy({DEV:dev,VITE_ENABLE_SELF_STORAGE_MOCK:'true'});assert(!policy.enabled);
 const calls=[];const api=compile('../src/api/selfStoragePaymentApi.js',{'./axiosClient':{default:{post:(...args)=>calls.push(args)}},'@/lib/inventoryRegistration':registration,'@/lib/selfStorageStagedPayment':staged},{DEV:dev});
 for(const purpose of ['DEPOSIT','BALANCE'])assert.throws(()=>api.confirmSelfStoragePayment(rid,purpose),dev?/not been verified/:/production/);
 assert.equal(calls.length,0);
 for(const purpose of ['deposit','balance'])assert.throws(()=>assertConfirmedRequest({method:'POST',url:`/reservations/${rid}/${purpose}/mock-confirm`}),/not confirmed/);
});
test('exact initiation POSTs send empty bodies without invented retry headers',()=>{
 const calls=[],api=compile('../src/api/selfStoragePaymentApi.js',{'./axiosClient':{default:{post:(...args)=>calls.push(args)}},'@/lib/inventoryRegistration':registration,'@/lib/selfStorageStagedPayment':staged});
 for(const purpose of ['DEPOSIT','BALANCE'])api.initiateSelfStoragePayment(rid,purpose);
 assert.deepEqual(calls,[[`/reservations/${rid}/deposit`,{}],[`/reservations/${rid}/balance`,{}]]);
 for(const [url] of calls){assertConfirmedRequest({method:'POST',url});for(const method of ['PATCH','DELETE','PUT'])assert.throws(()=>assertConfirmedRequest({method,url}));}
 assert.throws(()=>api.initiateSelfStoragePayment('invalid','DEPOSIT'));assert.throws(()=>api.initiateSelfStoragePayment(rid,'OTHER'));
 assert.doesNotThrow(()=>assertConfirmedRequest({method:'POST',url:`/reservations/${rid}/mock-pay`}));
});
function harness({status='RESERVED',failure,dev=true,allowConfirmation=false,confirmFailure}={}){
 let state=[],refs=[],cursor=0,posts=[],gets=0,latest={reservation:{...reservation,status},contract:status==='RESERVED'?null:contract},refreshFailure=false;
 const hooks={useState:initial=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>state[i]=v];},useRef:initial=>{const i=cursor++;return refs[i]??= {current:initial};},useEffect:()=>{}};
 const prior=globalThis.localStorage,storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const dummy=()=>null;
 const component=compile('../src/components/customer/SelfStorageStagedPayment.jsx',{
 react:hooks,'@/lib/authSession':{useAuthSession:()=>({user}),getAccessToken:()=> 'fixture'},
 '@/api/selfStoragePaymentApi':{initiateSelfStoragePayment:async(id,purpose)=>{posts.push(['init',id,purpose]);if(failure)throw {response:{status:failure,data:{message:'Fixture unavailable'}}};return {data:{success:true,data:quote(purpose)}};},confirmSelfStoragePayment:async(id,purpose)=>{posts.push(['confirm',id,purpose]);if(confirmFailure)throw {response:{status:confirmFailure}};const r={...latest.reservation,status:purpose==='DEPOSIT'?'DEPOSIT_PAID':'PAID',[purpose==='DEPOSIT'?'depositPaymentId':'balancePaymentId']:pid};latest={reservation:r,contract};return {data:{success:true,data:{reservation:r,payment:{_id:pid,reservationId:rid,customerId:uid,facilityId:fid,serviceType:'SELF_STORAGE',purpose,provider:'MOCK',status:'SUCCEEDED',amount:quote(purpose).amount,currency:'VND',idempotencyKey:'server-key',succeededAt:'2026-10-27T01:00:00Z'}}}};}},
 '@/lib/selfStorageStagedPayment':{...staged,...(allowConfirmation?{selfStorageConfirmationPolicy:()=>({enabled:true})}:{})},'@/lib/selfStoragePayment':{selfPaymentError:()=> 'Fixture unavailable'},'@/lib/customerReservationDisplay':{reservationAmount:n=>String(n)},
 './RentalBackendUI':{...Object.fromEntries(['CustomerScreen','Card','CardContent','Button','Link','Details','Message','LoadState'].map(k=>[k,dummy])),recordId:registration.inventoryId,record:r=>r.data.data,useBackend:()=>({data:latest,loading:false})},
 },{DEV:dev}).default;
 function render(){cursor=0;return component({reservationId:rid,loadContext:async()=>{gets++;if(refreshFailure)throw Error('Read failed');return latest;}});}
 function text(node){if(!node||typeof node!=='object')return String(node??'');return [node.props?.children].flat(Infinity).map(text).join('');}
 function find(label,node=render()){if(!node||typeof node!=='object')return null;if(typeof node.props?.onClick==='function'&&text(node)===label)return node;for(const child of [node.props?.children].flat(Infinity)){if(child!==undefined){const f=find(label,child);if(f)return f;}}return null;}
 return {posts,find,render,text,get gets(){return gets;},setLatest:v=>latest=v,failReads:()=>refreshFailure=true,close:()=>{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;}};
}
for(const purpose of ['DEPOSIT','BALANCE'])test(purpose+' component: duplicate initiation clicks guarded, no automatic confirmation',async()=>{
 const h=harness({status:purpose==='DEPOSIT'?'RESERVED':'CHECKIN_READY'});try{const b=h.find(purpose==='DEPOSIT'?'Review deposit amount':'Review balance amount');await Promise.all([b.props.onClick(),b.props.onClick()]);assert.equal(h.posts.length,1);assert(h.find(`Confirm ${purpose==='DEPOSIT'?'Deposit':'Balance'} (Development MOCK)`).props.disabled);assert.match(h.text(h.render()),/No payment PENDING record/);assert(h.gets>=2);}finally{h.close();}
});
for(const code of [400,401,403,404,409,503])test('initiation error '+code+' has no callback or legacy fallback',async()=>{
 const h=harness({failure:code});try{await h.find('Review deposit amount').props.onClick();assert.deepEqual(h.posts.map(p=>p[0]),['init']);assert.equal(h.find('Confirm Deposit (Development MOCK)'),null);}finally{h.close();}
});
test('production hides mock confirmation after verified quote',async()=>{const h=harness({dev:false});try{await h.find('Review deposit amount').props.onClick();assert.equal(h.find('Confirm Deposit (Development MOCK)'),null);assert.equal(h.posts.length,1);}finally{h.close();}});
// Injected policy below exercises dormant callback/reconciliation only; actual runtime gate remains closed.
for(const purpose of ['DEPOSIT','BALANCE'])test(purpose+' callback fixture validates success and refresh under injected test policy',async()=>{
 const h=harness({status:purpose==='DEPOSIT'?'RESERVED':'CHECKIN_READY',allowConfirmation:true});try{await h.find(purpose==='DEPOSIT'?'Review deposit amount':'Review balance amount').props.onClick();const action=h.find(`Confirm ${purpose==='DEPOSIT'?'Deposit':'Balance'} (Development MOCK)`);await Promise.all([action.props.onClick(),action.props.onClick()]);assert.deepEqual(h.posts.map(p=>p[0]),['init','confirm']);assert.match(h.text(h.render()),/SUCCEEDED/);assert(h.gets>=4);}finally{h.close();}
});
test('uncertain non-idempotent callback is never retried, including after successful GET',async()=>{
 const h=harness({allowConfirmation:true,confirmFailure:503});try{await h.find('Review deposit amount').props.onClick();const confirm=h.find('Confirm Deposit (Development MOCK)');await confirm.props.onClick();await confirm.props.onClick();await h.find('Refresh reservation and contract (GET)').props.onClick();await h.find('Review deposit amount').props.onClick();assert.deepEqual(h.posts.map(p=>p[0]),['init','confirm']);assert.match(h.text(h.render()),/Confirmation is locked/);}finally{h.close();}
});

test('Vite flags and NODE_ENV cannot unlock Self Storage callbacks or bypass allowlist',()=>{
 for(const DEV of [true,false]){
  const env={DEV,NODE_ENV:'development',MODE:'development',PROD:!DEV,VITE_ENABLE_SELF_STORAGE_MOCK:'true',VITE_ENABLE_SELF_STORAGE_PAYMENT_MOCK:'true',VITE_ENABLE_SELF_STORAGE_MOCK_CONFIRM:'true',VITE_ENABLE_MANAGED_DEPOSIT_MOCK:'true',VITE_ENABLE_MANAGED_BALANCE_MOCK:'true',VITE_MI_MANAGED_DEPOSIT_FLOW_ENABLED:'true'};
  assert.equal(staged.selfStorageConfirmationPolicy(env).enabled,false);
  const calls=[],api=compile('../src/api/selfStoragePaymentApi.js',{'./axiosClient':{default:{post:(...args)=>calls.push(args)}},'@/lib/inventoryRegistration':registration,'@/lib/selfStorageStagedPayment':staged},env);
  const allow=compile('../src/api/confirmedContract.js',{},env).assertConfirmedRequest;
  for(const purpose of ['DEPOSIT','BALANCE']){
   assert.throws(()=>api.confirmSelfStoragePayment(rid,purpose));
   assert.throws(()=>allow({method:'POST',url:`/reservations/${rid}/${purpose.toLowerCase()}/mock-confirm`}),/not confirmed/);
   assert.doesNotThrow(()=>allow({method:'POST',url:`/reservations/${rid}/${purpose.toLowerCase()}`}));
  }
  assert.equal(calls.length,0);
 }
});
test('invoking disabled UI handlers directly still cannot send either mock-confirm',async()=>{
 for(const purpose of ['DEPOSIT','BALANCE']){
  const h=harness({status:purpose==='DEPOSIT'?'RESERVED':'CHECKIN_READY'});
  try{
   await h.find(purpose==='DEPOSIT'?'Review deposit amount':'Review balance amount').props.onClick();
   const action=h.find(`Confirm ${purpose==='DEPOSIT'?'Deposit':'Balance'} (Development MOCK)`);
   assert.equal(action.props.disabled,true);
   await Promise.all([action.props.onClick(),action.props.onClick()]);
   assert.deepEqual(h.posts.map(p=>p[0]),['init']);
  }finally{h.close();}
 }
});
