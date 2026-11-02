import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import * as balance from '../src/lib/customerBalance.js';
import * as registration from '../src/lib/inventoryRegistration.js';
const require=createRequire(import.meta.url);
function compile(path,mocks={},env={DEV:true,VITE_ENABLE_MANAGED_BALANCE_MOCK:'true'}){
 const code=transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader:path.endsWith('jsx')?'jsx':'js',format:'cjs',jsx:'automatic',define:{'import.meta.env':JSON.stringify(env)}}).code;
 const module={exports:{}};new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);return module.exports;
}
const rid='2'.repeat(24),uid='4'.repeat(24),pid='8'.repeat(24),fid='1'.repeat(24),cid='3'.repeat(24),cell='6'.repeat(24),hash='a'.repeat(64);
const user={id:uid,role:'CUSTOMER'},amounts={totalDue:36000,depositCredit:7200,balanceDue:28800};
const reservation={_id:rid,customerId:uid,facilityId:fid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:'DEPOSIT_PAID',allocatedCellIds:[cell],managedPricingSnapshot:{pricingRule:{currency:'VND'},amountBreakdown:amounts}};
const contract={_id:cid,customerId:uid,reservationId:rid,status:'SIGNED',currentContentVersion:1,contentVersions:[{version:1,contentHash:hash,content:{reservation:{id:rid,facilityId:fid,cellIds:[cell]},pricing:amounts,handover:[]}}],signatures:['CUSTOMER','FACILITY_MANAGER'].map(signerRole=>({version:1,contentHash:hash,signerId:signerRole==='CUSTOMER'?uid:'5'.repeat(24),signerRole,signedAt:'2026-10-18T01:00:00Z'}))};
const payment={_id:pid,reservationId:rid,customerId:uid,serviceType:'MANAGED_INVENTORY',purpose:'BALANCE',provider:'MOCK',amount:28800,currency:'VND',status:'PENDING',idempotencyKey:balance.balanceKey(rid)};
const settled={...reservation,status:'CHECKIN_READY',balanceSettledAt:'2026-10-18T01:00:00Z'};
const confirmation={reservation:settled,payment:{...payment,status:'SUCCEEDED',succeededAt:settled.balanceSettledAt}};
const initiation={reservation,payment,amount:28800,currency:'VND'};
const response=data=>({data:{success:true,data}});
test('Backend initiation and confirmation envelopes are independently verified',()=>{
 assert.equal(balance.confirmedBalanceResult(initiation,reservation,user),'PENDING');
 assert.equal(balance.confirmedBalanceSettlement(confirmation,reservation,user,payment),'SUCCEEDED');
 assert(balance.verifiedPendingBalance(payment,reservation,user));
 for(const p of [null,{...payment,status:'FAILED'},{...payment,amount:1},{...payment,idempotencyKey:'different'}])assert(!balance.verifiedPendingBalance(p,reservation,user));
 for(const result of [{...confirmation,payment:{...confirmation.payment,_id:'9'.repeat(24)}},{...confirmation,payment:{...confirmation.payment,amount:1}},{...confirmation,reservation},{...confirmation,payment:{...confirmation.payment,succeededAt:null}}])assert.throws(()=>balance.confirmedBalanceSettlement(result,reservation,user,payment));
});
test('zero balance completion remains payment-free',()=>{
 const r={...reservation,managedPricingSnapshot:{...reservation.managedPricingSnapshot,amountBreakdown:{...amounts,balanceDue:0}}};
 assert.equal(balance.confirmedBalanceResult({reservation:{...r,...settled},amount:0,currency:'VND',zeroBalance:true,payment:null},r,user),'SUCCEEDED');
});
for(const env of [{DEV:false,VITE_ENABLE_MANAGED_BALANCE_MOCK:'true'},{DEV:true},{}])test('production or missing opt-in blocks helper and allowlist '+JSON.stringify(env),()=>{
 const api=compile('../src/api/customerBalanceApi.js',{'./axiosClient':{default:{post:()=>{throw Error('Unexpected HTTP');}}},'@/lib/inventoryRegistration':registration},env);
 assert(!api.balanceMockEnabled());assert.throws(()=>api.confirmCustomerBalance(rid,payment.idempotencyKey),/opt-in/);
 const allow=compile('../src/api/confirmedContract.js',{},env).assertConfirmedRequest;
 assert.throws(()=>allow({method:'POST',url:`/reservations/managed/${rid}/balance/mock-confirm`}),/not confirmed/);
 assert.doesNotThrow(()=>allow({method:'POST',url:`/reservations/managed/${rid}/balance`}));
});
test('confirmation uses exact verified POST, body key and existing client; retry keeps key',()=>{
 const calls=[],api=compile('../src/api/customerBalanceApi.js',{'./axiosClient':{default:{post:(...args)=>calls.push(args)}},'@/lib/inventoryRegistration':registration});
 api.confirmCustomerBalance(rid,payment.idempotencyKey);api.confirmCustomerBalance(rid,payment.idempotencyKey);
 assert.deepEqual(calls,Array(2).fill([`/reservations/managed/${rid}/balance/mock-confirm`,{idempotencyKey:payment.idempotencyKey}]));
 assert.throws(()=>api.confirmCustomerBalance(rid,'another-key'));assert.throws(()=>api.confirmCustomerBalance('invalid',payment.idempotencyKey));
 const allow=compile('../src/api/confirmedContract.js').assertConfirmedRequest;
 allow({method:'POST',url:calls[0][0]});
 for(const method of ['GET','PATCH','PUT','DELETE'])assert.throws(()=>allow({method,url:calls[0][0]}));
 assert.throws(()=>allow({method:'POST',url:calls[0][0]+'/extra'}));
});
function harness({enabled=true,persist=false,fail,zero=false}={}){
 const values=[],refs=[],storage=new Map();let cursor=0,latest={reservation,contract},posts=[],gets=0,refreshes=0,retries=0;
 if(persist){storage.set(`VaultSpace_balance_attempt:${uid}:${rid}`,'submitted');storage.set(`VaultSpace_balance_attempt:${uid}:${rid}:pending`,JSON.stringify(payment));}
 const prior=globalThis.localStorage;globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const hooks={useState:initial=>{const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],v=>values[i]=v];},useRef:initial=>{const i=cursor++;return refs[i]??= {current:initial};},useEffect:()=>{}};
 const passthrough=()=>null;
 const Component=compile('../src/components/customer/CustomerBalancePayment.jsx',{
 react:hooks,'@/api/customerBalanceApi':{balanceMockEnabled:()=>enabled,initiateCustomerBalance:async(...args)=>{posts.push(['init',...args]);if(zero)return response({reservation:settled,payment:null,amount:0,currency:'VND',zeroBalance:true});return response(initiation);},confirmCustomerBalance:async(...args)=>{posts.push(['confirm',...args]);if(fail)throw {response:{status:fail,data:{message:'Fixture rejection'}}};latest={reservation:settled,contract};return response(confirmation);}},
 '@/lib/customerBalance':balance,'@/lib/customerManagedContractState':{customerManagedContractState:()=>({progress:{status:'SIGNED'}})},'@/lib/customerReservationDisplay':{reservationAmount:String},'@/lib/authSession':{useAuthSession:()=>({user}),getAccessToken:()=> 'fixture'},
 './RentalBackendUI':{...Object.fromEntries(['Card','CardContent','Button','Details','Message','LoadState'].map(k=>[k,passthrough])),recordId:v=>v?._id||v?.id,record:r=>r.data.data,rentalError:()=> 'Fixture rejection',useBackend:()=>({data:latest,loading:false,retry:()=>retries++})},
 }).default;
 function render(){cursor=0;return Component({reservation,loadLatest:async()=>{gets++;return latest;},onReservationRefresh:()=>refreshes++});}
 function find(text,node=render()){if(!node||typeof node!=='object')return null;if(node.props?.children===text)return node;for(const child of [node.props?.children].flat(Infinity)){const found=child===undefined?null:find(text,child);if(found)return found;}return null;}
 return {render,find,posts,get gets(){return gets;},get refreshes(){return refreshes;},get retries(){return retries;},setLatest:v=>latest=v,close:()=>{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;}};
}
test('PENDING requires explicit confirmation; duplicate clicks guarded; GET refresh follows success',async()=>{
 const h=harness();try{
 const pay=h.find('Pay Balance (MOCK)');await Promise.all([pay.props.onClick(),pay.props.onClick()]);assert.equal(h.posts.length,1);
 const confirm=h.find('Confirm Balance (Development MOCK)');assert(confirm);assert.equal(h.posts[0][0],'init');
 await Promise.all([confirm.props.onClick(),confirm.props.onClick()]);assert.deepEqual(h.posts.map(p=>p[0]),['init','confirm']);assert.equal(h.posts[1][2],payment.idempotencyKey);assert(h.refreshes>0&&h.retries>0);assert.equal(h.find('Confirm Balance (Development MOCK)'),null);assert(h.find('Balance payment confirmed'));
 }finally{h.close();}
});
test('503 retry preserves key and never reinitiates balance',async()=>{
 const h=harness({persist:true,fail:503});try{for(let i=0;i<2;i++)await h.find('Confirm Balance (Development MOCK)').props.onClick();assert.equal(h.posts.length,2);assert(h.posts.every(p=>p[0]==='confirm'&&p[2]===payment.idempotencyKey));assert(h.gets===2);assert(h.find('Pay Balance (MOCK)').props.disabled);}finally{h.close();}
});
for(const status of [400,401,403,404,409])test(`confirmation ${status} disables action until successful GET refresh`,async()=>{
 const h=harness({persist:true,fail:status});try{await h.find('Confirm Balance (Development MOCK)').props.onClick();assert(h.find('Confirm Balance (Development MOCK)').props.disabled);await h.find('Confirm Balance (Development MOCK)').props.onClick();assert.equal(h.posts.length,1);await h.find('Refresh balance status (GET)').props.onClick();assert(!h.find('Confirm Balance (Development MOCK)').props.disabled);}finally{h.close();}
});
test('production UI hides confirmation even with persisted PENDING',()=>{const h=harness({persist:true,enabled:false});try{assert.equal(h.find('Confirm Balance (Development MOCK)'),null);assert.equal(h.posts.length,0);}finally{h.close();}});
test('already settled GET prevents confirmation POST',async()=>{const h=harness({persist:true});try{const action=h.find('Confirm Balance (Development MOCK)');h.setLatest({reservation:settled,contract});await action.props.onClick();assert.equal(h.posts.length,0);assert(h.refreshes>0);}finally{h.close();}});


