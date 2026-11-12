import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import * as review from '../src/lib/facilityReview.js';
import * as access from '../src/lib/managedAccessFacility.js';
import {managedOverview} from '../src/lib/managedInventoryMonitor.js';
import {facilityPageVisible} from '../src/lib/facilityWorkspace.js';
const require=createRequire(import.meta.url),{transformSync}=require('esbuild');
const id=letter=>letter.repeat(24),visitId=id('a'),sessionId=id('b'),facilityId=id('c'),reservationId=id('d'),customerId=id('e'),staffId=id('f'),managerId=id('1'),cellId=id('2');
const response=data=>({data:{success:true,data}});
function fixture(){const now=Date.now();const visit={_id:visitId,facilityId,reservationId,customerId,assignedStaffId:staffId,revision:0,status:'SCHEDULED',purpose:'INBOUND',startsAt:new Date(now-60000).toISOString(),endsAt:new Date(now+3600000).toISOString()};const session={_id:sessionId,facilityId,reservationId,customerId,assignedStaffId:staffId,visitId,revision:0,status:'ACTIVE',startedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1800000).toISOString(),allowedCellIds:[cellId]};return {visits:[visit],sessions:[],staff:[{_id:staffId,displayName:'Nhân viên thử nghiệm'}],session};}
const actor=role=>({id:role==='staff'?staffId:managerId,role:role==='staff'?'FACILITY_STAFF':'FACILITY_MANAGER',assignedFacilityId:facilityId});
test('access lists reject foreign facility, staff assignment, duplicate and malformed revisions',()=>{
 const data=fixture(),user=actor('staff');assert.equal(access.accessRows(response(data.visits),'visit',user).length,1);
 for(const override of [{facilityId:cellId},{assignedStaffId:customerId},{revision:-1},{status:'UNKNOWN'}])assert.throws(()=>access.accessRows(response([{...data.visits[0],...override}]),'visit',user));
 assert.throws(()=>access.accessRows(response([data.visits[0],data.visits[0]]),'visit',user));
});
test('visit window, effective session expiry and stale revisions prevent outdated actions',()=>{
 const data=fixture(),now=Date.now();assert.equal(access.visitInWindow(data.visits[0],now),true);
 assert.equal(access.visitInWindow({...data.visits[0],endsAt:new Date(now).toISOString()},now),false);
 assert.equal(access.sessionStatus({...data.session,expiresAt:new Date(now).toISOString()},now),'EXPIRED');
 assert.throws(()=>access.currentRevision(data.visits[0],{...data.visits[0],revision:1}));
 assert.throws(()=>access.attestation({identityVerified:true,customerPresent:false,safetyReviewed:true,safetyNotes:'Đã kiểm tra'}));
});
test('both role routes are enabled without enabling legacy stock writers',()=>{
 for(const role of ['staff','manager'])for(const route of ['managed-access','managed-inventory-v3'])assert.equal(facilityPageVisible(role,route),true);
 const staffRoutes=readFileSync(new URL('../src/routes/StaffRoutes.jsx',import.meta.url),'utf8'),managerRoutes=readFileSync(new URL('../src/routes/ManagerRoutes.jsx',import.meta.url),'utf8');
 assert.match(staffRoutes,/path="managed-access" element=\{<ManagedAccessOperationsPage/);assert.match(managerRoutes,/path="managed-access" element=\{<ManagedAccessOversightPage/);
 assert.equal(facilityPageVisible('staff','inventory/inbound'),false);
});
test('monitor rejects falsely reconciled stock and cross-facility movements',()=>{
 const item={_id:id('3'),facilityId,managedReservationId:reservationId};
 const entry={item,projection:null,recentMovements:[],reconciliationStatus:'UNKNOWN'};
 assert.equal(managedOverview(response({facilityId,rows:[entry],readOnly:true}),facilityId).rows.length,1);
 assert.throws(()=>managedOverview(response({facilityId,rows:[{...entry,reconciliationStatus:'RECONCILED'}],readOnly:true}),facilityId));
 assert.throws(()=>managedOverview(response({facilityId:customerId,rows:[],readOnly:true}),facilityId));
 assert.throws(()=>managedOverview(response({facilityId,rows:[{...entry,recentMovements:[{schemaVersion:3,itemId:item._id,facilityId:customerId}]}],readOnly:true}),facilityId));
});

function harness(role,data,{stale=false,uncertain=false}={}){
 const slots=[];let cursor=0,pending=null;const calls=[];
 const hooks={useCallback:fn=>fn,useEffect(){},useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];}};
 const api={facilityVisits:async()=>response(data.visits),facilitySessions:async()=>response(data.sessions),staff:async()=>response(data.staff),visit:async()=>response(stale?{...data.visits[0],revision:99}:data.visits[0]),session:async()=>response(data.sessions[0]),pendingCheckIn:()=>pending,clearPendingCheckInKey(){pending=null;},assign:async(_id,staff,reason,revision)=>{calls.push({kind:'assign',staff,reason,revision});Object.assign(data.visits[0],{assignedStaffId:staff,revision:revision+1});return response(data.visits[0]);},checkIn:async(_id,payload)=>{pending={payload,key:'same-check-in-key'};calls.push({kind:'checkIn',payload});if(uncertain)throw Error('Kết quả không xác định');data.sessions=[data.session];data.visits[0].status='CHECKED_IN';pending=null;return response({visit:data.visits[0],session:data.session});},checkOut:async(_id,revision)=>{calls.push({kind:'checkOut',revision});data.sessions[0].status='CHECKED_OUT';data.visits[0].status='COMPLETED';return response(data.sessions[0]);},revoke:async(_id,revision,reason)=>{calls.push({kind:'revoke',revision,reason});data.sessions[0].status='REVOKED';data.visits[0].status='COMPLETED';return response(data.sessions[0]);}};
 const ui=Object.fromEntries(['Screen','Panel','Button','Field','Input','Select','Textarea','Message','Details','Table','Dialog','OpenLink'].map(name=>[name,name]));
 const mocks={react:{...React,...hooks},'@/api/managedAccessApi':{managedAccessApi:api},'@/lib/authSession':{getAccessToken:()=> 'session',useAuthSession:()=>({user:actor(role),accessToken:'session'})},'@/lib/useFacilityResource':{default:()=>({data,error:'',loading:false,reload(){}}),announceReviewChange(){}},'@/lib/facilityReview':review,'@/lib/managedAccessFacility':access,'@/components/manager/ManagerUI':ui};
 const code=transformSync(readFileSync(new URL('../src/components/facility/ManagedAccessFacilityPage.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsx:'automatic'}).code;
 const module={exports:{}};new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:require(name),module,module.exports);
 const render=()=>{cursor=0;const wrapper=module.exports.default({role});return wrapper.type(wrapper.props);};
 function nodes(value,predicate){if(Array.isArray(value))return value.flatMap(child=>nodes(child,predicate));if(!value||typeof value!=='object')return [];return [...(predicate(value)?[value]:[]),...nodes(value.props?.children,predicate)];}
 const find=predicate=>nodes(render(),predicate)[0],findAll=predicate=>nodes(render(),predicate);
 return {calls,render,find,findAll,button:text=>find(node=>node.type==='Button'&&node.props.children===text),submit:async()=>{await find(node=>node.type==='form').props.onSubmit({preventDefault(){}});}};
}
test('Manager assigns and verifies staff using current revision; stale visit never mutates',async()=>{
 for(const stale of [false,true]){const data=fixture(),ui=harness('manager',data,{stale});ui.button('Phân công hộ tống').props.onClick();ui.find(node=>node.type==='Textarea'&&node.props['aria-label']==='Lý do phân công').props.onChange({target:{value:'Phân công nhân viên cùng cơ sở'}});await ui.submit();assert.equal(ui.calls.length,stale?0:1);if(!stale)assert.equal(ui.calls[0].revision,0);}
});
test('Staff check-in requires direct attestation and verifies session plus visit after write',async()=>{
 const data=fixture(),ui=harness('staff',data);ui.button('Xác minh khách đến').props.onClick();
 for(const checkbox of ui.findAll(node=>node.type==='input'&&node.props.type==='checkbox'))checkbox.props.onChange({target:{checked:true}});
 ui.find(node=>node.type==='Textarea').props.onChange({target:{value:'Khách có mặt và đã hướng dẫn an toàn'}});await ui.submit();
 assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].kind,'checkIn');assert.equal(data.visits[0].status,'CHECKED_IN');
});
test('uncertain check-in retries exact original attestation instead of edited input',async()=>{
 const data=fixture(),ui=harness('staff',data,{uncertain:true});ui.button('Xác minh khách đến').props.onClick();for(const checkbox of ui.findAll(node=>node.type==='input'&&node.props.type==='checkbox'))checkbox.props.onChange({target:{checked:true}});
 ui.find(node=>node.type==='Textarea').props.onChange({target:{value:'Ghi chú gốc chưa đối chiếu'}});await ui.submit();
 ui.find(node=>node.type==='Textarea').props.onChange({target:{value:'Nội dung khác'}});await ui.submit();
 assert.equal(ui.calls.length,2);assert.deepEqual(ui.calls[0].payload,ui.calls[1].payload);
});
test('Staff ends a visit session while Manager can only revoke with a reason',async()=>{
 for(const role of ['staff','manager']){const data=fixture();data.visits[0].status='CHECKED_IN';data.sessions=[data.session];const ui=harness(role,data);
 if(role==='staff'){ui.button('Xác nhận khách rời kho').props.onClick();await ui.submit();assert.equal(ui.calls[0].kind,'checkOut');}
 else{assert.equal(ui.button('Xác nhận khách rời kho'),undefined);ui.button('Thu hồi vì an toàn').props.onClick();ui.find(node=>node.type==='Textarea').props.onChange({target:{value:'Thu hồi do phát hiện rủi ro an toàn'}});await ui.submit();assert.equal(ui.calls[0].kind,'revoke');}
 assert.equal(data.visits[0].status,'COMPLETED');}
});
test('expired sessions never expose finish/revoke actions',()=>{
 const data=fixture();data.session.expiresAt=new Date(Date.now()-1).toISOString();data.sessions=[data.session];const ui=harness('staff',data);
 assert.equal(ui.button('Xác nhận khách rời kho'),undefined);assert.equal(ui.button('Thu hồi vì an toàn'),undefined);
});
test('pending check-in keys and attestations are isolated by Staff account',async()=>{
 const saved=new Map(),previous=globalThis.sessionStorage;
 globalThis.sessionStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
 try{
  const requests=[],module={exports:{}};
  const code=transformSync(readFileSync(new URL('../src/api/managedAccessApi.js',import.meta.url),'utf8'),{format:'cjs'}).code;
  new Function('require','module','exports',code)(()=>({__esModule:true,default:{post:async(url,body,config)=>{requests.push({url,body,key:config.headers['Idempotency-Key']});throw Error('Không rõ kết quả');}}}),module,module.exports);
  const api=module.exports.managedAccessApi,payload={identityVerified:true,customerPresent:true,safetyReviewed:true,safetyNotes:'Đã xác minh trực tiếp'};
  await assert.rejects(api.checkIn(visitId,payload,staffId));
  const first=api.pendingCheckInKey(visitId,staffId);assert.ok(first);assert.equal(api.pendingCheckIn(visitId,managerId),null);
  await assert.rejects(api.checkIn(visitId,payload,staffId));assert.equal(requests[1].key,first);
  await assert.rejects(api.checkIn(visitId,{...payload,safetyNotes:'Đã thay đổi'},staffId),error=>error.code==='IDEMPOTENCY_PAYLOAD_MISMATCH');
  assert.equal(requests.length,2);
  await assert.rejects(api.checkIn(visitId,payload,managerId));assert.notEqual(requests[2].key,first);
 }finally{if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous;}
});
