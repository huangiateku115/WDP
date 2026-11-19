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
 './managedInventoryContext':{inventoryCellLabels:async()=>({})},
 './inventoryUiFormat':{formatInventoryDateTime:value=>String(value||'')},
 './InventoryItemForm':{default:()=>null},
 './ManagedSelfInboundV3':{default:()=>null},
 './ManagedSelfOutboundV3':{default:({item})=>{assert(registration.validInventoryId(item?._id));children.push('direct-outbound');return React.createElement('p',null,'Direct outbound fixture');}},
 './ManagedSelfRelocationV3':{default:()=>null},
 './ItemSpecifications':{default:()=>null},
 './ManagedUnifiedSelfInbound':{default:({item})=>{assert(registration.validInventoryId(item?._id));children.push('unified-inbound');return React.createElement('p',null,'Unified inbound fixture');}},
 './RepeatedInboundRequests':{default:({item})=>{assert(item._id);children.push('inbound');return null;}},
 './PlacementPreview':{default:({item})=>{assert(item._id);children.push('preview');return null;}},
};
const Detail=compile('../src/components/customer/inventory/InventoryIntegration.jsx',modules).InventoryDetailIntegration;
for(const [name,resource] of [['initial loading',{loading:true,data:undefined}],['API failure',{loading:false,error:'Fixture API unavailable',data:null}],['missing data',{loading:false,data:undefined}]])test('Item Detail safely renders '+name,()=>{
 state=resource;loads=0;children=[];const html=renderToStaticMarkup(React.createElement(Detail));assert.deepEqual(children,[]);if(resource.loading)assert.match(html,/Loading/);if(resource.error)assert.match(html,/Fixture API unavailable/);
});
test('loaded V3 SKU renders Unified Inbound and direct Customer Outbound without legacy writers',()=>{
 state={loading:false,data:{_id:id,managedReservationId:rentalId,facilityId,itemCode:'FIXTURE',name:'Loaded item',status:'IN_STORAGE',inventorySchemaVersion:3,quantity:1,quantityUnit:'box',images:[],currentCellId:null}};loads=0;children=[];
 const html=renderToStaticMarkup(React.createElement(Detail));assert.match(html,/FIXTURE/);assert.match(html,/Unified inbound fixture/);assert.match(html,/Direct outbound fixture/);assert.deepEqual(children,['unified-inbound','direct-outbound']);
});
