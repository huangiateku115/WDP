import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as review from '../src/lib/facilityReview.js';

const facility='a'.repeat(24), id='b'.repeat(24);
function renderDirectory(managed) {
  const require=createRequire(import.meta.url), {transformSync}=require('esbuild');
  const row={id,facility,reservationCode:'BKG-TEST',status:'PAID',allocatedCapacity:2,unit:'KHO-01',startDate:'2026-11-12',endDate:'2026-12-12'};
  const panel=props=>React.createElement('section',null,props.title,props.children);
  const ui={Screen:panel,Panel:panel,Details:()=>null,Timeline:()=>null,Select:()=>null,Message:()=>null,Input:()=>null,money:String,
    Button:props=>React.createElement('button',null,props.children),Status:props=>React.createElement('span',null,props.value),
    OpenLink:props=>React.createElement('a',{href:props.to},props.children),
    Table:props=>React.createElement('table',null,React.createElement('thead',null,React.createElement('tr',null,props.columns.map(c=>React.createElement('th',{key:c.key},c.label)))),React.createElement('tbody',null,props.rows.map(r=>React.createElement('tr',{key:r.id},props.columns.map(c=>React.createElement('td',{key:c.key},c.render?c.render(r):r[c.key])))))),
  };
  const mocks={
    'react-router-dom':{useParams:()=>({}),useSearchParams:()=>[new URLSearchParams(managed?'service=managed':''),()=>{}],useNavigate:()=>()=>{}},
    '@/lib/authSession':{useAuthSession:()=>({user:{role:'FACILITY_MANAGER',assignedFacilityId:facility},accessToken:'test'})},
    '@/lib/useFacilityResource':{default:()=>({data:[row],loading:false,error:'',reload(){}})},
    '@/api/facilityReviewApi':{facilityReservationApi:{}},'@/lib/facilityReview':review,'@/components/manager/ManagerUI':ui,
    '@/components/staff/FacilityHandoverPanel':{default:()=>null},'@/components/manager/ManagedV3LifecyclePanel':{default:()=>null},
  };
  const code=transformSync(readFileSync(new URL('../src/pages/manager/ReservationApiView.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code;
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default));
}
test('managed directory labels capacity and preserves managed service in detail links',()=>{
  const html=renderDirectory(true);
  assert.match(html,/Đơn lưu trữ hàng hóa tại cơ sở được phân công/);
  assert.ok(html.includes(`/manager/reservations/${id}?service=managed`));
  assert.match(html,/Dung lượng thuê/);assert.match(html,/2 m³/);
  assert.doesNotMatch(html,/Đơn thuê kho riêng tại cơ sở được phân công/);
});
test('self-storage directory keeps its original title, unit and detail route',()=>{
  const html=renderDirectory(false);
  assert.match(html,/Đơn thuê kho riêng tại cơ sở được phân công/);
  assert.ok(html.includes(`/manager/reservations/${id}"`));
  assert.match(html,/KHO-01/);assert.doesNotMatch(html,/\?service=managed/);
});
