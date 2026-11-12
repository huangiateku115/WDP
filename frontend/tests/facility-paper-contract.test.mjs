import test from 'node:test';
import assert from 'node:assert/strict';
import {paperEvidence,canHandover,checkoutMessage} from '../src/lib/facilityPaperContract.js';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import * as paperHelpers from '../src/lib/facilityPaperContract.js';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const now=Date.parse('2026-11-12T10:00:00Z');
const fixture=()=>({reservation:{status:'PAID',rentalPaymentFlow:'FULL_UPFRONT_V1',startDate:'2026-11-12T00:00:00Z',endDate:'2026-12-12T00:00:00Z',signingDeadline:'2026-11-15T00:00:00Z'},contract:{status:'DRAFT',currentContentVersion:2,contentVersions:[{version:2,contentHash:'verified-document-hash',createdAt:'2026-11-12T08:00:00Z'}]}});
const input={customerSignedAt:'2026-11-12T09:00:00Z',facilitySignedAt:'2026-11-12T09:10:00Z',customerIdentityVerified:true};
test('full payment paper evidence includes actual timestamps and current document identity',()=>{
 assert.deepEqual(paperEvidence(fixture(),input,now),{...input,documentVersion:2,documentHash:'verified-document-hash',customerSignedAt:'2026-11-12T09:00:00.000Z',facilitySignedAt:'2026-11-12T09:10:00.000Z'});
});
test('paper evidence rejects missing identity, empty, future and pre-document timestamps',()=>{
 for(const override of [{customerIdentityVerified:false},{customerSignedAt:''},{facilitySignedAt:'2026-11-13T00:00:00Z'},{customerSignedAt:'2026-11-12T07:00:00Z'}]) assert.throws(()=>paperEvidence(fixture(),{...input,...override},now));
});
test('expired signing window, unpaid reservation and stale document cannot be verified',()=>{
 const expired=fixture();expired.reservation.signingDeadline='2026-11-12T09:00:00Z';assert.throws(()=>paperEvidence(expired,input,now));
 const unpaid=fixture();unpaid.reservation.status='CONTRACTED';assert.throws(()=>paperEvidence(unpaid,input,now));
 const changed=fixture();changed.contract.currentContentVersion=3;assert.throws(()=>paperEvidence(changed,input,now));
});
test('full-upfront handover accepts only verified CHECKIN_READY inside rental period',()=>{
 const data=fixture();Object.assign(data.contract,{status:'SIGNED',signedProofUrl:'https://example.invalid/proof',verifiedAt:'2026-11-12T09:30:00Z'});
 assert.equal(canHandover(data,now),false);data.reservation.status='CHECKIN_READY';assert.equal(canHandover(data,now),true);
 data.reservation.startDate='2026-11-13T00:00:00Z';assert.equal(canHandover(data,now),false);
 data.reservation.startDate='2026-11-11T00:00:00Z';data.reservation.endDate='2026-11-12T10:00:00Z';assert.equal(canHandover(data,now),false);
 data.reservation.endDate='2026-12-12T00:00:00Z';data.contract.verifiedAt=null;assert.equal(canHandover(data,now),false);
});
test('legacy balance/handover behavior remains separate from full-upfront verification',()=>{
 const data=fixture();delete data.reservation.rentalPaymentFlow;assert.equal(paperEvidence(data,{},now),undefined);
 Object.assign(data.contract,{status:'SIGNED',signedProofUrl:'https://example.invalid/proof'});assert.equal(canHandover(data,now),true);
 data.reservation.status='CHECKIN_READY';assert.equal(canHandover(data,now),false);
});
test('checkout maintenance message never promises bookable unit and requires matching reads',()=>{
 const result={isEarly:true,unitStatus:'MAINTENANCE'},reservation={status:'CHECKED_OUT',checkoutRequest:{status:'COMPLETED'}},contract={status:'TERMINATED'},unit={status:'MAINTENANCE'};
 assert.match(checkoutMessage(result,reservation,contract,unit),/chuyển sang bảo trì, chưa thể cho thuê/);
 assert.throws(()=>checkoutMessage(result,reservation,contract,{status:'AVAILABLE'}));
 assert.throws(()=>checkoutMessage(result,{status:'ACTIVE'},contract,unit));
 assert.throws(()=>checkoutMessage(result,reservation,{status:'SIGNED'},unit));
});
test('normal checkout confirms availability only from authoritative matching result',()=>{
 assert.match(checkoutMessage({isEarly:false,unitStatus:'AVAILABLE'},{status:'CHECKED_OUT',checkoutRequest:{status:'COMPLETED'}},{status:'EXPIRED'},{status:'AVAILABLE'}),/sẵn sàng cho thuê tiếp/);
});
test('multipart request sends all paper evidence fields and handover sends explicit identity',async()=>{
 const require=createRequire(import.meta.url),{transformSync}=require('esbuild');let sent;
 const module={exports:{}};
 const code=transformSync(readFileSync(new URL('../src/api/facilityHandoverApi.js',import.meta.url),'utf8'),{format:'cjs'}).code;
 new Function('require','module','exports',code)(()=>({__esModule:true,default:{post:async(url,body)=>{sent={url,body};return {data:{success:true}};}}}),module,module.exports);
 const api=module.exports.default,evidence=paperEvidence(fixture(),input,now);
 await api.confirmPaper('test-id',new Blob(['proof'],{type:'application/pdf'}),'PAPER-TEST',evidence);
 for(const [key,value] of Object.entries(evidence))assert.equal(sent.body.get(key),String(value));
 assert.equal(sent.body.get('paperContractNumber'),'PAPER-TEST');assert.equal(sent.body.get('proofFile').size,5);
 await api.handover('test-id',{customerIdentityVerified:true,storageCondition:'GOOD'});
 assert.deepEqual(sent.body,{customerIdentityVerified:true,storageCondition:'GOOD'});
});
test('actual Staff panel renders full-payment handover and preserves legacy balance guidance',()=>{
 const require=createRequire(import.meta.url),{transformSync}=require('esbuild');
 const source=readFileSync(new URL('../src/components/staff/FacilityHandoverPanel.jsx',import.meta.url),'utf8');
 const code=transformSync(source,{loader:'jsx',jsx:'automatic',format:'cjs'}).code;
 const simple=tag=>props=>React.createElement(tag,null,props.title,props.children);
 const ui=Object.fromEntries(['Panel','Details','Status','Field','Message','Dialog'].map(name=>[name,simple('section')]));
 Object.assign(ui,{Button:props=>React.createElement('button',{disabled:props.disabled},props.children),Input:props=>React.createElement('input',props),Textarea:simple('textarea'),money:String});
 const render=data=>{
  const mocks={
   '@/api/facilityHandoverApi':{default:{}},'@/api/facilityReviewApi':{facilityReservationApi:{}},'@/api/storageApi':{default:{}},
   '@/lib/authSession':{getAccessToken:()=> 'session',useAuthSession:()=>({accessToken:'session',user:{role:'FACILITY_STAFF',assignedFacilityId:'b'.repeat(24)}})},
   '@/lib/facilityPaperContract':paperHelpers,
   '@/lib/useFacilityResource':{default:()=>({data,error:'',loading:false,reload(){}}),announceReviewChange(){}},
   '@/lib/facilityReview':{apiRecord:r=>r.data.data,recordId:r=>typeof r==='object'?r?._id:r,objectId:r=>/^[a-f\d]{24}$/.test(r||''),reviewError:String},
   '@/components/manager/ManagerUI':ui,
  };
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default,{reservationId:'a'.repeat(24)}));
 };
 const data=fixture();data.reservation.startDate='2020-01-01T00:00:00Z';data.reservation.endDate='2100-01-01T00:00:00Z';
 let html=render(data);assert.match(html,/Thời điểm khách hàng ký/);assert.match(html,/Thời điểm đại diện cơ sở ký/);
 Object.assign(data.contract,{status:'SIGNED',verifiedAt:'2026-11-12T09:30:00Z',signedProofUrl:'https://example.invalid/proof'});data.reservation.status='CHECKIN_READY';
 html=render(data);assert.match(html,/>Hoàn tất bàn giao<\/button>/);assert.doesNotMatch(html,/Chờ khách thanh toán phần còn lại/);assert.match(html,/Điều kiện kho khi bàn giao/);
 delete data.reservation.rentalPaymentFlow;html=render(data);assert.match(html,/Chờ khách thanh toán phần còn lại/);assert.doesNotMatch(html,/>Hoàn tất bàn giao<\/button>/);
});
