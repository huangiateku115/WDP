import test from 'node:test';
import assert from 'node:assert/strict';
import {facilityAccessState,validFacilityPin,handoverAccessMessage} from '../src/lib/facilityAccess.js';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {facilityLabel} from '../src/lib/facilityLabels.js';
import * as review from '../src/lib/facilityReview.js';
const now=Date.parse('2026-11-12T10:00:00Z');
const row=()=>({_id:'a'.repeat(24),facilityId:'b'.repeat(24),customerId:'c'.repeat(24),storageUnitId:'d'.repeat(24),reservationCode:'BKG-TEST',status:'ACTIVE',rentalPaymentFlow:'FULL_UPFRONT_V1',startDate:'2020-01-01T00:00:00Z',endDate:'2100-01-01T00:00:00Z'});
test('ACTIVE without issued full-upfront PIN is pending, not eligible',()=>{
 assert.equal(facilityAccessState(row(),now).allowed,false);
 assert.match(facilityAccessState(row(),now).label,/chờ backend cấp PIN/);
 assert.equal(facilityAccessState({...row(),accessPinCode:'1234'},now).allowed,false);
 assert.equal(facilityAccessState({...row(),accessPinCode:'654321'},now).allowed,true);
});
test('checkout, overdue and date boundaries prevent simulated access even with a PIN',()=>{
 for(const status of ['CHECKED_OUT','CANCELLED','OVERDUE','CHECKIN_READY'])assert.equal(facilityAccessState({...row(),status,accessPinCode:'654321'},now).allowed,false);
 assert.equal(facilityAccessState({...row(),accessPinCode:'654321',startDate:'2026-11-13T00:00:00Z'},now).allowed,false);
 assert.equal(facilityAccessState({...row(),accessPinCode:'654321',endDate:new Date(now).toISOString()},now).allowed,false);
 assert.equal(facilityAccessState({...row(),accessPinCode:'654321',endDate:'bad'},now).allowed,false);
});
test('PIN validation differentiates new six-digit PIN from legacy four/six-digit simulation',()=>{
 assert.equal(validFacilityPin(row(),'123456'),true);assert.equal(validFacilityPin(row(),'1234'),false);
 assert.equal(validFacilityPin({},'1234'),true);assert.equal(validFacilityPin({},'12345'),false);
 assert.equal(validFacilityPin({},'12abcd'),false);
});
test('handover message follows actual backend PIN instead of hardcoded provisioning claims',()=>{
 assert.match(handoverAccessMessage(row()),/Chưa xác nhận PIN/);
 const message=handoverAccessMessage({...row(),accessPinCode:'654321'});
 assert.match(message,/Backend đã trả PIN mô phỏng/);assert.ok(!message.includes('654321'));
});
test('Staff and Manager actual page hides PIN controls while provisioning is pending',()=>{
 const require=createRequire(import.meta.url),{transformSync}=require('esbuild');
 const code=transformSync(readFileSync(new URL('../src/pages/staff/FacilityAccessPage.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code;
 function render(role,pin){
  let stateIndex=0,resourceIndex=0;const data={...row(),...(pin?{accessPinCode:pin}:{})};
  const simple=tag=>props=>React.createElement(tag,null,props.title,props.children);
  const ui=Object.fromEntries(['Screen','Panel','Field','Message','Dialog','Status'].map(key=>[key,simple('section')]));
  Object.assign(ui,{Input:props=>React.createElement('input',props),Button:props=>React.createElement('button',{disabled:props.disabled},props.children),Select:()=>React.createElement('select'),Details:props=>React.createElement('div',null,...props.values.map(([key,value])=>React.createElement('p',{key},value)))});
  const mocks={react:{...React,useState:value=>React.useState(stateIndex++===0?data._id:value)},'@/api/axiosClient':{default:{}},'@/api/facilityReviewApi':{facilityReservationApi:{}},'@/lib/authSession':{useAuthSession:()=>({accessToken:'session',user:{id:'e'.repeat(24),role,assignedFacilityId:data.facilityId}}),getAccessToken:()=> 'session'},'@/lib/useFacilityResource':{default:()=>({data:resourceIndex++===0?[data]:data,loading:false,error:'',reload(){}})},'@/lib/facilityReview':review,'@/lib/facilityAccess':{facilityAccessState,validFacilityPin},'@/lib/facilityLabels':{facilityLabel},'@/components/manager/ManagerUI':ui};
  const module={exports:{}};new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default,{manager:role==='FACILITY_MANAGER'}));
 }
 for(const role of ['FACILITY_STAFF','FACILITY_MANAGER']){
  const pending=render(role);assert.match(pending,/chờ backend cấp PIN/);assert.doesNotMatch(pending,/aria-label="Mã PIN mô phỏng"/);
  const issued=render(role,'654321');assert.match(issued,/aria-label="Mã PIN mô phỏng"/);assert.ok(!issued.includes('654321'));
 }
});
