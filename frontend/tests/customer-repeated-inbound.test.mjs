import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as receipt from '../src/lib/customerRepeatedInbound.js';
import * as registration from '../src/lib/inventoryRegistration.js';
const require=createRequire(import.meta.url),iid='a'.repeat(24),uid='b'.repeat(24),rid='c'.repeat(24),fid='d'.repeat(24),cell='e'.repeat(24),requestId='1'.repeat(24);
const item={_id:iid,customerId:uid,managedReservationId:rid,facilityId:fid,status:'IN_STORAGE',currentCellId:cell,quantityUnit:'box',unitWeightKg:2,unitDimensionsM:{widthM:.2,depthM:.3,heightM:.4}};
const rental={_id:rid,facilityId:fid,serviceType:'MANAGED_INVENTORY',status:'ACTIVE',startDate:'2020-01-01',endDate:'2099-01-01'},user={id:uid,role:'CUSTOMER'};
const payload={requestedQuantity:2,quantityUnit:'box',declaredUnitWeightKg:2,declaredUnitDimensionsM:{widthM:.2,depthM:.3,heightM:.4}};
const row=(changes={})=>({_id:requestId,itemId:iid,reservationId:rid,facilityId:fid,...payload,state:'PENDING_INSPECTION',custodyState:'NOT_TAKEN',version:0,createdAt:'2026-10-20T01:00:00Z',...changes});
const response=(data,status=200)=>({status,data:{success:true,data}});
test('receipt quantity and dimensions use exact positive Backend validation and units',()=>{
 assert.deepEqual(receipt.receiptPayload(payload,'box'),payload);
 for(const value of [{...payload,requestedQuantity:0},{...payload,requestedQuantity:1.5},{...payload,requestedQuantity:Number.MAX_SAFE_INTEGER+1},{...payload,quantityUnit:'kg'},{...payload,declaredUnitWeightKg:Infinity},{...payload,declaredUnitDimensionsM:{widthM:0,depthM:1,heightM:1}},{...payload,declaredUnitDimensionsM:{widthM:1e308,depthM:1e308,heightM:1}}])assert.throws(()=>receipt.receiptPayload(value,'box'));
 assert(receipt.receiptPayload({...payload,declaredUnitWeightKg:1e-8},'box'));
});
test('newly REGISTERED first inbound is excluded; only owned in-term eligible Items pass UI checks',()=>{
 assert(receipt.eligibleRepeatedReceipt(item,rental,user));assert(receipt.eligibleRepeatedReceipt({...item,status:'CHECKED_OUT',currentCellId:null},rental,user));
 for(const change of [{status:'REGISTERED'},{status:'PENDING_INBOUND'},{status:'IN_STORAGE',currentCellId:null},{customerId:fid}])assert(!receipt.eligibleRepeatedReceipt({...item,...change},rental,user));
 for(const r of [null,{...rental,status:'DEPOSIT_PAID'},{...rental,endDate:'2020-01-01'}])assert(!receipt.eligibleRepeatedReceipt(item,r,user));
});
test('history uses top-level pagination and rejects malformed data instead of empty fallback',()=>{
 const r={data:{success:true,data:[row()],pagination:{page:2,limit:50,total:51,totalPages:2}}};assert.equal(receipt.receiptList(r,item,2).pagination.total,51);
 for(const value of [{data:{success:true,data:[]}},{data:{success:true,data:{data:[]},pagination:r.data.pagination}},{data:{...r.data,data:[row({version:-1})]}},{data:{...r.data,data:[row({itemId:fid})]}},{data:{...r.data,pagination:{...r.data.pagination,page:1}}}])assert.throws(()=>receipt.receiptList(value,item,2));
 assert(!receipt.mayChangeReceipt(row({custodyState:'IN_CUSTODY'})));assert(!receipt.mayChangeReceipt(row({currentInspectionAttemptId:fid})));
});
function compile(mocks,env={PROD:false}){
 const code=transformSync(readFileSync(new URL('../src/components/customer/inventory/RepeatedInboundRequests.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic',define:{'import.meta.env':JSON.stringify(env)}}).code;
 const module={exports:{}};new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);return module.exports.default;
}
function harness({initial=[],createFailure,amendFailure,cancelFailure,featureCode,prod=false,store=new Map(),deferPage2=false}={}){
 let rows=[...initial],values=[],refs=[],cursor=0,effects=[],scheduled=false,calls=[],createCount=0,cancelCount=0,page2Resolve;
 const prior=globalThis.sessionStorage;globalThis.sessionStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const hooks={useState:initial=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>values[i]=typeof v==='function'?v(values[i]):v];},useRef:initial=>{const i=cursor++;return refs[i]??={current:initial};},useEffect:fn=>{if(!scheduled)effects.push(fn);}};
 function history(page){return {data:{success:true,data:rows.slice((page-1)*50,page*50),pagination:{page,limit:50,total:rows.length,totalPages:Math.ceil(rows.length/50)}}};}
 const api={repeatedInboundHistory:async(id,params)=>{calls.push(['list',id,params]);if(deferPage2&&params.page===2)return new Promise(resolve=>page2Resolve=()=>resolve(history(2)));return history(params.page);},repeatedInboundDetail:async id=>{calls.push(['detail',id]);return response(rows.find(r=>r._id===id));},createRepeatedInbound:async(id,body,key)=>{calls.push(['create',id,body,key]);createCount++;if(createFailure&&createCount===1)throw {response:{status:createFailure,data:{message:'Fixture unavailable',code:featureCode}}};const result=row({...body});rows=[result,...rows];return response(result,201);},amendRepeatedInbound:async(id,body,version,key)=>{calls.push(['amend',id,body,version,key]);if(amendFailure){rows=rows.map(r=>r._id===id?{...r,version:r.version+1}:r);throw {response:{status:amendFailure,data:{message:'Fixture stale amendment'}}};}const result={...rows.find(r=>r._id===id),...body,version:version+1};rows=rows.map(r=>r._id===id?result:r);return response(result);},cancelRepeatedInbound:async(id,version,key)=>{calls.push(['cancel',id,version,key]);cancelCount++;if(cancelFailure&&cancelCount===1)throw {response:{status:cancelFailure,data:{message:'Fixture cancel uncertain'}}};const result={...rows.find(r=>r._id===id),state:'CANCELLED',version:version+1};rows=rows.map(r=>r._id===id?result:r);return response(result);}};
 const Component=compile({react:hooks,'./InventoryBackendUI':{inventoryApi:api},'@/lib/authSession':{getAccessToken:()=> 'fixture',useAuthSession:()=>({accessToken:'fixture',user})},'@/lib/customerRepeatedInbound':receipt,'@/lib/inventoryRegistration':registration,'@/lib/customerReservationDisplay':{reservationVietnamTime:String}},{PROD:prod});
 const outer=Component({item,rental});
 function render(){cursor=0;return outer.type(outer.props);}
 function walk(predicate,node=render()){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){if(child!==undefined){const found=walk(predicate,child);if(found)return found;}}return null;}
 const button=text=>walk(n=>n.type==='button'&&n.props.children===text);
 const input=index=>{let i=0;return walk(n=>n.type==='input'&&i++===index);};
 return {calls,store,render,button,input,form:()=>walk(n=>n.type==='form'),html:()=>renderToStaticMarkup(render()),async start(){render();scheduled=true;effects.forEach(fn=>fn());await new Promise(r=>setImmediate(r));},resolvePage2:async()=>{page2Resolve();await new Promise(r=>setImmediate(r));},close:()=>{if(prior===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=prior;}};
}
test('valid create, duplicate click guard, actual history/detail and no physical mutation',async()=>{const h=harness();try{await h.start();h.input(0).props.onChange({target:{value:'2'}});const form=h.form();await Promise.all([form.props.onSubmit({preventDefault(){}}),form.props.onSubmit({preventDefault(){}})]);await new Promise(r=>setImmediate(r));assert.equal(h.calls.filter(c=>c[0]==='create').length,1);assert.deepEqual(h.calls.find(c=>c[0]==='create')[2],payload);assert.match(h.html(),/Facility Staff must inspect/);await h.button('Details').props.onClick();assert.match(h.html(),/Request details/);assert.match(h.html(),/NOT_TAKEN/);}finally{h.close();}});
test('invalid input displays validation without HTTP mutation',async()=>{const h=harness();try{await h.start();h.input(0).props.onChange({target:{value:'1.5'}});h.form().props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));assert.equal(h.calls.filter(c=>c[0]==='create').length,0);assert.match(h.html(),/positive whole quantity/);}finally{h.close();}});
test('amend loads current detail version and sends full verified payload',async()=>{const h=harness({initial:[row({version:3})]});try{await h.start();await h.button('Amend').props.onClick();h.input(0).props.onChange({target:{value:'4'}});h.form().props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));const call=h.calls.find(c=>c[0]==='amend');assert.equal(call[3],3);assert.equal(call[2].requestedQuantity,4);assert.match(h.html(),/Receipt request amended/);}finally{h.close();}});
for(const status of [409,428])test(`amend ${status} refreshes state and does not overwrite version`,async()=>{const h=harness({initial:[row()],amendFailure:status});try{await h.start();await h.button('Amend').props.onClick();h.form().props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));assert.equal(h.calls.filter(c=>c[0]==='amend').length,1);assert.match(h.html(),/State\/version conflict/);assert.equal(h.button('Save amendment'),null);assert(h.calls.filter(c=>c[0]==='list').length>=2);}finally{h.close();}});
test('cancel is synchronous double-click safe and uses selected version',async()=>{const h=harness({initial:[row({version:4})]});try{await h.start();const b=h.button('Cancel');await Promise.all([b.props.onClick(),b.props.onClick()]);const call=h.calls.find(c=>c[0]==='cancel');assert.equal(h.calls.filter(c=>c[0]==='cancel').length,1);assert.equal(call[2],4);assert.equal(h.button('Cancel'),null);assert.match(h.html(),/Receipt request cancelled/);}finally{h.close();}});
test('uncertain create persists key/payload across remount and locks new submissions',async()=>{
 const store=new Map(),first=harness({createFailure:503,store});try{await first.start();first.form().props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));assert.match(first.html(),/Outcome is uncertain/);assert(first.button('Create receipt request').props.disabled);}finally{first.close();}
 const saved=JSON.parse([...store.values()][0]),second=harness({store});try{await second.start();await second.button('Retry same request').props.onClick();const call=second.calls.find(c=>c[0]==='create');assert.equal(call[3],saved.key);assert.deepEqual(call[2],saved.payload);assert.equal(store.size,0);}finally{second.close();}
});
test('cancel 503 retry keeps version/key and never becomes a create',async()=>{const h=harness({initial:[row({version:2})],cancelFailure:503});try{await h.start();await h.button('Cancel').props.onClick();await h.button('Retry same request').props.onClick();const calls=h.calls.filter(c=>c[0]==='cancel');assert.equal(calls.length,2);assert.equal(calls[0][2],calls[1][2]);assert.equal(calls[0][3],calls[1][3]);assert.equal(h.calls.filter(c=>c[0]==='create').length,0);}finally{h.close();}});
test('disabled create does not fall back and production leaves cancel/read separate',async()=>{const h=harness({createFailure:404,featureCode:'INBOUND_REQUEST_FEATURE_DISABLED'});try{await h.start();h.form().props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));assert.match(h.html(),/disabled by Backend/);assert(h.button('Create receipt request').props.disabled);}finally{h.close();}const p=harness({prod:true,initial:[row()]});try{await p.start();assert(p.button('Create receipt request').props.disabled);assert(p.button('Amend').props.disabled);await p.button('Cancel').props.onClick();assert.equal(p.calls.filter(c=>c[0]==='cancel').length,1);}finally{p.close();}});
test('pagination passes page/limit and stale page responses cannot overwrite a newer refresh',async()=>{
 const initial=Array.from({length:51},(_,i)=>row({_id:(i+100).toString(16).padStart(24,'0'),state:'CONFIRMED',custodyState:'IN_CUSTODY'}));
 const h=harness({initial,deferPage2:true});try{await h.start();const loading=h.button('Next receipts').props.onClick();await h.button('Refresh receipt history (GET)').props.onClick();await h.resolvePage2();await loading;assert.match(h.html(),/Page 1 of 2/);assert.equal(h.calls.filter(c=>c[0]==='list').length,3);assert.equal(h.calls[1][2].page,2);}finally{h.close();}
 const p=harness({initial});try{await p.start();await p.button('Next receipts').props.onClick();assert.match(p.html(),/Page 2 of 2/);assert.equal(p.calls.at(-1)[2].page,2);await p.button('Previous receipts').props.onClick();assert.match(p.html(),/Page 1 of 2/);}finally{p.close();}
});



test('missing/null Item guard never mounts receipt reads',()=>{
 const Component=compile({react:{},'./InventoryBackendUI':{inventoryApi:new Proxy({},{get(){throw Error('Unexpected API access');}})},'@/lib/authSession':{useAuthSession:()=>({accessToken:'fixture',user})},'@/lib/customerRepeatedInbound':receipt,'@/lib/inventoryRegistration':registration,'@/lib/customerReservationDisplay':{reservationVietnamTime:String}});
 for(const value of [null,undefined,{}, {_id:'invalid'}])assert.equal(Component({item:value}),null);
});
test('uncertain amendment retry keeps request identity, version and frozen payload',async()=>{
 const h=harness({initial:[row({version:4})],amendFailure:503});try{await h.start();await h.button('Amend').props.onClick();h.input(0).props.onChange({target:{value:'3'}});h.form().props.onSubmit({preventDefault(){}});await new Promise(r=>setImmediate(r));h.input(0).props.onChange({target:{value:'99'}});await h.button('Retry same request').props.onClick();const calls=h.calls.filter(c=>c[0]==='amend');assert.equal(calls.length,2);assert.equal(calls[0][1],calls[1][1]);assert.deepEqual(calls[0][2],calls[1][2]);assert.equal(calls[1][2].requestedQuantity,3);assert.equal(calls[0][3],4);assert.equal(calls[1][3],4);assert.equal(calls[0][4],calls[1][4]);}finally{h.close();}
});
test('existing API helpers preserve exact idempotency and quoted If-Match headers',()=>{
 const calls=[],client={post:(...args)=>calls.push(['POST',...args]),patch:(...args)=>calls.push(['PATCH',...args])};
 const code=transformSync(readFileSync(new URL('../src/api/inventoryApi.js',import.meta.url),'utf8'),{loader:'js',format:'cjs',define:{'import.meta.env':'{}'}}).code,module={exports:{}};
 new Function('require','module','exports',code)(()=>({__esModule:true,default:client}),module,module.exports);
 const api=module.exports.inventoryApi,key='receipt-fixture-key';api.createRepeatedInbound(iid,payload,key);api.amendRepeatedInbound(requestId,payload,3,key);api.cancelRepeatedInbound(requestId,3,key);
 assert.deepEqual(calls.map(c=>c[0]),['POST','PATCH','POST']);assert.deepEqual(calls[0][2],payload);assert.deepEqual(calls[1][2],payload);assert.deepEqual(calls[2][2],{});
 for(const call of calls)assert.equal(call[3].headers['Idempotency-Key'],key);
 for(const call of calls.slice(1))assert.equal(call[3].headers['If-Match'],'"3"');
});
