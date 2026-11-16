import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const facility='a'.repeat(24), skuId='c'.repeat(24), movementId='b'.repeat(24);
const movement={_id:movementId,type:'OUTBOUND',schemaVersion:4,stockEffect:{action:'REMOVE',source:[{receiptId:'receipt-1',cellId:'cell-1',quantity:2,allocatedWeightKg:4,allocatedVolumeM3:.016}]},quantity:2,quantityUnit:'BOX',performedAt:'2026-10-01T10:00:00.000Z',managedReservationId:'reservation-1',movementCode:'OUT-1',inspectionNote:'Đã lấy đủ'};

function renderHistory(resource) {
  const require=createRequire(import.meta.url);
  const mocks={
    '@/api/managedInventoryV3Api':{managedInventoryV3Api:{facilityOverview:async()=>({})}},
    '@/lib/useFacilityResource':{default:()=>({...resource,reload(){}})},
  };
  const code=require('esbuild').transformSync(readFileSync(new URL('../src/components/facility/FacilityOutboundRequests.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default,{role:'staff',facilityId:facility}));
}

test('facility history renders canonical Customer REMOVE movements read-only',()=>{
  const html=renderHistory({data:[{sku:{_id:skuId,name:'SKU A'},movement}],loading:false,error:''});
  assert.match(html,/Lịch sử Customer xuất kho/);
  assert.match(html,/SKU A/);
  assert.match(html,/OUT-1/);
  assert.match(html,/Cell cell-1 · 2 BOX/);
  assert.match(html,/Customer attestation: Đã lấy đủ/);
  assert.doesNotMatch(html,/Approve|Xác nhận xuất hàng|Confirm/);
});

test('facility history dependency failure is shown as an error rather than empty history',()=>{
  const html=renderHistory({data:null,loading:false,error:'Dịch vụ chưa sẵn sàng'});
  assert.match(html,/role="alert"/);
  assert.match(html,/Không tải được lịch sử xuất kho/);
  assert.doesNotMatch(html,/Chưa có Movement OUT/);
});
