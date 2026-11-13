import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as registration from '../src/lib/inventoryRegistration.js';

const require=createRequire(import.meta.url);
const passthrough=({children})=>React.createElement('div',null,children);
function compile(path,mocks){
 const code=transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code;
 const module={exports:{}};new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);return module.exports;
}
const id='a'.repeat(24),rentalId='b'.repeat(24),facilityId='c'.repeat(24);
let state,loads,children;
const outbound=({item})=>{assert(registration.validInventoryId(item?._id));children.push('outbound');return React.createElement('p',null,'Outbound actions');};
const modules={
 'react-router-dom':{useParams:()=>({id}),useLocation:()=>({state:null})},
 '@/lib/authSession':{useAuthSession:()=>({accessToken:'fixture'})},
 '@/lib/inventoryRegistration':registration,
 '@/components/common/CustomerScreen':{CustomerScreen:passthrough},
 '../CustomerMediaUI':{CustomerImagePreview:passthrough},
 '../CustomerResourceState':{default:({resource})=>React.createElement('p',null,resource.loading?'Loading':resource.error||'')},
 './InventoryStatus':{default:()=>null},
 './CanonicalCustomerOutbound':{default:outbound},
 '../RentalBackendUI':Object.fromEntries(['Card','CardContent','Button','Link','Details','RentalStatus'].map(k=>[k,passthrough])),
 './InventoryBackendUI':{inventoryApi:{get:()=>{throw Error('Unexpected request during render');}},inventoryRentals:()=>[],useInventoryBackend:()=>loads++===0?state:{data:[],loading:false}},
 './InventoryItemForm':{default:()=>null},
 './ManagedSelfInboundV3':{default:()=>null},
 './ManagedSelfOutboundV3':{default:()=>null},
 './RepeatedInboundRequests':{default:({item})=>{assert(item._id);children.push('inbound');return null;}},
 './PlacementPreview':{default:({item})=>{assert(item._id);children.push('preview');return null;}},
};
const Detail=compile('../src/components/customer/inventory/InventoryIntegration.jsx',modules).InventoryDetailIntegration;
for(const [name,resource] of [['initial loading',{loading:true,data:undefined}],['API failure',{loading:false,error:'Fixture API unavailable',data:null}],['missing data',{loading:false,data:undefined}]])test('Item Detail safely renders '+name,()=>{
 state=resource;loads=0;children=[];const html=renderToStaticMarkup(React.createElement(Detail));assert.deepEqual(children,[]);if(resource.loading)assert.match(html,/Loading/);if(resource.error)assert.match(html,/Fixture API unavailable/);
});
test('loaded Item mounts existing actions with valid data',()=>{
 state={loading:false,data:{_id:id,managedReservationId:rentalId,facilityId,itemCode:'FIXTURE',name:'Loaded item',status:'IN_STORAGE',quantity:1,quantityUnit:'box',images:[],currentCellId:null}};loads=0;children=[];
 assert.match(renderToStaticMarkup(React.createElement(Detail)),/FIXTURE/);assert.deepEqual(children,['preview','outbound']);
});
test('canonical outbound ignores missing/invalid Item before any hooks or reads',()=>{
 const Component=compile('../src/components/customer/inventory/CanonicalCustomerOutbound.jsx',{
  '@/api/inventoryApi':{inventoryApi:new Proxy({},{get(){throw Error('Unexpected API access');}})},
  '@/lib/authSession':{useAuthSession:()=>{throw Error('Invalid Item mounted the loaded component');}},
  './CustomerOutbound':{CustomerOutboundAction:passthrough},'@/lib/inventoryRegistration':registration,
 }).default;
 for(const item of [null,undefined,{}, {_id:'invalid'}])assert.equal(renderToStaticMarkup(React.createElement(Component,{item})), '');
});
for(const status of [404,503])test(`canonical feature-disabled ${status} stays in error mode without legacy fallback`,async()=>{
 const values=[],effects=[];let cursor=0,scheduled=false;const calls=[];
 const hooks={
  useState:initial=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},
  useRef:initial=>{const i=cursor++;if(!(i in values))values[i]={current:initial};return values[i];},
  useEffect:fn=>{if(!scheduled)effects.push(fn);},
 };
 const Component=compile('../src/components/customer/inventory/CanonicalCustomerOutbound.jsx',{
  react:hooks,
  '@/api/inventoryApi':{inventoryApi:{
   movements:async()=>{calls.push('movements');return {data:{data:[{schemaVersion:2}]}};},
   stockBalance:async()=>{calls.push('stockBalance');throw {response:{status,data:{message:'Canonical feature disabled'}}};},
   canonicalOutboundHistory:async()=>{calls.push('history');return {data:{data:{data:[]}}};},
  }},
  '@/lib/authSession':{useAuthSession:()=>({accessToken:'fixture'}),getAccessToken:()=> 'fixture'},
  './CustomerOutbound':{CustomerOutboundAction:()=>{throw Error('Unsafe legacy fallback');}},
  '@/lib/inventoryRegistration':registration,
 }).default;
 const previous=globalThis.sessionStorage;globalThis.sessionStorage={getItem:()=>null};
 try{
  const loaded=Component({item:{_id:id}});cursor=0;loaded.type(loaded.props);scheduled=true;effects.forEach(fn=>fn());
  await new Promise(resolve=>setImmediate(resolve));cursor=0;
  const errorView=loaded.type(loaded.props);assert.equal(errorView.props['aria-label'],'Canonical outbound');
  assert.match(renderToStaticMarkup(errorView),/Canonical feature disabled/);assert.deepEqual(calls,['movements','stockBalance','history']);
 }finally{if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous;}
});
