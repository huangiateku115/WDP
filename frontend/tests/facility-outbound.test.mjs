import test from 'node:test';
import assert from 'node:assert/strict';
import {outboundPage,outboundDetail,outboundLabel} from '../src/lib/facilityOutbound.js';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const facility='a'.repeat(24), requestId='b'.repeat(24);
const request={requestId,skuId:'c'.repeat(24),reservationId:'d'.repeat(24),facilityId:facility,state:'PENDING',requestedQuantity:3,sourceCellIds:['e'.repeat(24)]};
const response=(rows=[request],page=2)=>({data:{data:{data:rows,pagination:{page,total:21,totalPages:2}}}});
test('facility outbound reads the real nested queue envelope and server pagination',()=>{
  const data=outboundPage(response(),facility,2);
  assert.equal(data.rows[0].requestedQuantity,3);
  assert.equal(data.pagination.total,21);
});
test('wrong facility, malformed rows and wrong pagination fail without claiming empty results',()=>{
  assert.throws(()=>outboundPage(response(), 'f'.repeat(24),2));
  assert.throws(()=>outboundPage(response([{...request,requestedQuantity:-1}]),facility,2));
  assert.throws(()=>outboundPage(response(),facility,1));
  assert.throws(()=>outboundPage({data:{data:[]}},facility,1));
});
test('facility detail must match the selected request and include its history',()=>{
  const data={request,events:[],movements:[]};
  assert.equal(outboundDetail({data:{data}},facility,requestId),data);
  assert.throws(()=>outboundDetail({data:{data}},facility,'f'.repeat(24)));
  assert.throws(()=>outboundDetail({data:{data:{...data,events:null}}},facility,requestId));
});
test('empty authorised pages remain distinct from errors and labels explain customer ownership',()=>{
  assert.equal(outboundPage(response([],1),facility,1).rows.length,0);
  assert.equal(outboundLabel('PENDING'),'Chờ khách xuất hàng');
  assert.equal(outboundLabel('CONFIRMED'),'Đã xuất hàng');
});

function renderQueue(resource) {
  const require=createRequire(import.meta.url);
  const {transformSync}=require('esbuild');
  const mocks={
    '@/api/managedInventoryV3OutboundApi':{managedInventoryV3OutboundApi:{}},
    '@/lib/useFacilityResource':{default:()=>({...resource,reload(){}})},
    '@/lib/facilityOutbound':{outboundPage,outboundDetail,outboundLabel},
    '@/components/manager/ManagerUI':{OpenLink:props=>React.createElement('a',{href:props.to},props.children)},
  };
  const code=transformSync(readFileSync(new URL('../src/components/facility/FacilityOutboundRequests.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default,{role:'staff',facilityId:facility}));
}
test('queue renders server totals, Vietnamese status and links without staff stock write actions',()=>{
  const html=renderQueue({data:outboundPage(response(),facility,2),loading:false,error:''});
  assert.match(html,/21 yêu cầu/);
  assert.match(html,/Chờ khách xuất hàng/);
  assert.match(html,/\/staff\/managed-access/);
  assert.match(html,/\/staff\/managed\?itemId=/);
  assert.doesNotMatch(html,/>Approve<|>Xác nhận xuất hàng<|>Confirm</);
});
test('queue API failure is shown as an error rather than an empty authorised result',()=>{
  const html=renderQueue({data:null,loading:false,error:'Dịch vụ chưa sẵn sàng'});
  assert.match(html,/role="alert"/);
  assert.match(html,/Không tải được yêu cầu xuất/);
  assert.doesNotMatch(html,/Không có yêu cầu phù hợp/);
});
