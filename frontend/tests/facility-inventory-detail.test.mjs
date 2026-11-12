import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as detailHelpers from '../src/lib/facilityInventoryDetail.js';
import * as review from '../src/lib/facilityReview.js';
import {loadFacilityInventory, inventorySource, visibleInventoryMovements} from '../src/lib/facilityInventoryDetail.js';
const id = value => value.repeat(24), itemId=id('a'), facilityId=id('b'), reservationId=id('c'), customerId=id('d'), staffId=id('e');
const user={id:staffId,role:'FACILITY_MANAGER',assignedFacilityId:facilityId};
const response=data=>({data:{success:true,data}});
function fixture(version=3) {
  const item={_id:itemId,facilityId,managedReservationId:reservationId,customerId,...(version?{inventorySchemaVersion:version}:{})};
  const stock={skuId:itemId,reservationId,customerId,facilityId,onHandQuantity:2,heldQuantity:0,availableQuantity:2,totalWeightKg:2,totalVolumeM3:.016,byCell:[],byBatch:[],byPhysicalUnit:[],reconciliationStatus:'RECONCILED'};
  const calls=[];
  const inventoryApi={get:async()=>{calls.push('item');return response(item);},stockBalance:async()=>{calls.push('legacy stock');return response({itemId,facilityId,onHandQuantity:1,heldQuantity:0,batches:[]});},movements:async()=>{calls.push('legacy history');return response([]);}};
  const v3Api={stock:async()=>{calls.push('self stock');return response(stock);},movements:async()=>{calls.push('self history');return response([]);}};
  const accessApi={facilitySessions:async()=>response([])};
  return {item,stock,calls,args:{itemId,user,inventoryApi,v3Api,accessApi}};
}
test('self-managed item reads only its stock source, without legacy totals',async()=>{
  const f=fixture();const data=await loadFacilityInventory(f.args);
  assert.deepEqual(f.calls,['item','self stock','self history']);assert.equal(data.stock.onHandQuantity,2);assert.equal(data.source,'self');
});
test('existing batch item reads only legacy stock and history',async()=>{
  const f=fixture();delete f.item.inventorySchemaVersion;const data=await loadFacilityInventory(f.args);
  assert.deepEqual(f.calls,['item','legacy stock','legacy history']);assert.equal(data.stock.onHandQuantity,1);assert.equal(data.source,'batches');
});
test('failed self-managed stock never falls back to an older API',async()=>{
  const f=fixture();f.args.v3Api.stock=async()=>{throw Error('Unavailable');};
  await assert.rejects(loadFacilityInventory(f.args),/Unavailable/);assert.ok(!f.calls.some(value=>value.startsWith('legacy')));
});
test('foreign facility and unsupported versions stop before reading stock',async()=>{
  const f=fixture();f.item.facilityId=id('f');await assert.rejects(loadFacilityInventory(f.args),/không thuộc/);assert.deepEqual(f.calls,['item']);
  assert.throws(()=>inventorySource({inventorySchemaVersion:4}),/Chưa hỗ trợ/);
});
test('invalid stock scope and impossible quantities are rejected',async()=>{
  for(const patch of [{skuId:id('f')},{reservationId:id('f')},{heldQuantity:3},{availableQuantity:3},{byCell:[{cellId:'wrong'}]}]){
    const f=fixture();Object.assign(f.stock,patch);await assert.rejects(loadFacilityInventory(f.args));
  }
});
test('unreconciled stock remains explicitly unverified',async()=>{
  const f=fixture();f.stock.reconciliationStatus='RECONCILIATION_REQUIRED';const data=await loadFacilityInventory(f.args);
  assert.equal(data.stock.reconciliationStatus,'RECONCILIATION_REQUIRED');assert.equal(data.source,'self');
});
test('staff history stays limited to its active assigned session for this rental',()=>{
  const now=Date.now(),sessionId=id('1'),otherId=id('2');
  const session={_id:sessionId,reservationId,status:'ACTIVE',startedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1000).toISOString()};
  const movements=[{_id:id('3'),v3Effect:{accessSessionId:sessionId}},{_id:id('4'),v3Effect:{accessSessionId:otherId}}];
  const data={source:'self',item:{managedReservationId:reservationId},sessions:[session],movements};
  assert.equal(visibleInventoryMovements(data,{role:'FACILITY_STAFF'},now).length,1);
  assert.equal(visibleInventoryMovements(data,{role:'FACILITY_STAFF'},now+2000).length,0);
  assert.equal(visibleInventoryMovements(data,user,now).length,2);
});
test('mixed-source movement response is not accepted as self-managed history',async()=>{
  const f=fixture();f.args.v3Api.movements=async()=>response([{_id:id('1'),schemaVersion:2,itemId,facilityId,managedReservationId:reservationId}]);
  await assert.rejects(loadFacilityInventory(f.args),/Lịch sử tự quản/);
});

function renderDetail(state, tab='stock', actor=user) {
  const require=createRequire(import.meta.url), {transformSync}=require('esbuild');
  let hook=0;
  const container=props=>React.createElement('section',null,props.title,props.children);
  const mocks={
    react:{...React,useCallback:fn=>fn,useEffect(){},useState:initial=>[hook++===0?tab:initial,()=>{}]},
    '@/api/inventoryApi':{default:{}}, '@/api/managedInventoryV3Api':{managedInventoryV3Api:{}}, '@/api/managedAccessApi':{managedAccessApi:{}},
    '@/lib/useFacilityResource':{default:()=>({loading:false,error:'',reload(){},...state})},
    '@/lib/facilityReview':review, '@/lib/facilityInventoryDetail':detailHelpers, '@/lib/facilityLabels':{facilityLabel:value=>value},
    '@/components/manager/ManagerUI':{
      Panel:container, Details:props=>React.createElement('div',null,props.values.map(([label,value],i)=>React.createElement('p',{key:i},label,': ',value))),
      Table:props=>React.createElement('section',null,props.label,props.rows.length?props.rows.map(row=>React.createElement('p',{key:row.id},props.columns.map(c=>React.createElement('span',{key:c.key},c.render?c.render(row):row[c.key])))):props.empty),
      Button:props=>React.createElement('button',{disabled:props.disabled},props.children), Message:props=>React.createElement('p',null,props.error),
      Status:props=>React.createElement('span',null,props.value), OpenLink:props=>React.createElement('a',{href:props.to},props.children),
    },
  };
  const code=transformSync(readFileSync(new URL('../src/components/facility/FacilityInventoryDetail.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default,{itemId,user:actor,role:actor.role==='FACILITY_MANAGER'?'manager':'staff'}));
}
test('detail shows one stock source and keeps all tabs read-only',async()=>{
  const f=fixture();f.item.quantityUnit='thùng';f.item.itemCode='TEST';const data=await loadFacilityInventory(f.args);
  const html=renderDetail({data});assert.match(html,/Tồn hiện tại.*2 thùng/);assert.match(html,/Khách tự quản hàng hóa/);
  assert.doesNotMatch(html,/Xác nhận nhập|Xác nhận xuất|Ghi biến động/);
  assert.match(renderDetail({data},'batches'),/Chưa có lô hàng được ghi nhận/);
});
test('detail does not present unreconciled totals or failed reads as zero stock',async()=>{
  const f=fixture();f.item.quantityUnit='thùng';f.stock.reconciliationStatus='RECONCILIATION_REQUIRED';const data=await loadFacilityInventory(f.args);
  const html=renderDetail({data});assert.match(html,/Chưa xác minh/);assert.doesNotMatch(html,/Tồn hiện tại.*2 thùng/);
  const failed=renderDetail({data:null,error:'Không tải được tồn'});assert.match(failed,/Không tải được tồn/);assert.doesNotMatch(failed,/Tồn hiện tại/);
});
