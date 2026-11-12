const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createHash } = require('node:crypto');
const Visit = require('../dist/models/access/managed-access-visit.model').default;
const Reservation = require('../dist/models/reservations/reservation.model').default;
const Facility = require('../dist/models/facilities/facility.model').default;
const Allocation = require('../dist/models/warehouse-map/cell-allocation.model').default;
const Session = require('../dist/models/access/managed-access-session.model').default;
const User = require('../dist/models/users/user.model').default;
const Contract = require('../dist/models/contracts/contract.model').default;
const Payment = require('../dist/models/payments/reservation-payment.model').default;
const { ManagedAccessService, ManagedAccessError, assertManagedAccessSessionScope } = require('../dist/services/access/managed-access.service');

const oid = n => new mongoose.Types.ObjectId(String(n).padStart(24, '0'));
class Query { constructor(value){this.value=value;} select(){return this;} session(){return this;} lean(){return this;} sort(){return this;} limit(){return this;} populate(){return this;} async exec(){return this.value;} }
function customer(){return {_id:oid(1),role:'CUSTOMER',assignedFacilityId:null};}
function reservation(){const start=new Date(Date.now()+86400000),end=new Date(Date.now()+20*86400000);return {_id:oid(2),customerId:oid(1),facilityId:oid(3),serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'CHECKIN_READY',startDate:start,endDate:end,allocatedCellIds:[oid(4)],};}
function payload(r=reservation()){return {reservationId:String(r._id),purpose:'INBOUND',startsAt:new Date(Date.now()+2*86400000).toISOString(),endsAt:new Date(Date.now()+2*86400000+3600000).toISOString(),note:'Giao hàng'};}

test('Customer can create a CHECKIN_READY visit idempotently using owned V3 reservation and reserved Cells',async t=>{
 const r=reservation(), actor=customer(), created=[];
 const previousNodeEnv=process.env.NODE_ENV;process.env.NODE_ENV='production';
 t.mock.method(Visit,'findOne',()=>new Query(created[0]||null));
 t.mock.method(Reservation,'findOne',()=>new Query(r));
 t.mock.method(Facility,'findOne',()=>new Query({_id:r.facilityId}));
 t.mock.method(Allocation,'find',()=>new Query([{cellId:oid(4)}]));
 t.mock.method(Visit,'create',async input=>{const row={_id:oid(5),status:'SCHEDULED',...input};created.push(row);return row;});
 try{const body=payload(r),first=await ManagedAccessService.createVisit(body,actor,'customer-visit-key-001');
 const replay=await ManagedAccessService.createVisit(body,actor,'customer-visit-key-001');
 assert.equal(first._id,replay._id);assert.equal(created.length,1);assert.equal(first.status,'SCHEDULED');}finally{if(previousNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previousNodeEnv;}
});

test('Cell allocations remain eligible after transition to OCCUPIED and released allocations are excluded',async t=>{
 const r=reservation(),actor=customer();let allocationFilter;
 t.mock.method(Visit,'findOne',()=>new Query(null));t.mock.method(Reservation,'findOne',()=>new Query(r));t.mock.method(Facility,'findOne',()=>new Query({_id:r.facilityId}));
 t.mock.method(Allocation,'find',filter=>{allocationFilter=filter;return new Query([{cellId:oid(4)}]);});
 t.mock.method(Visit,'create',async input=>({_id:oid(40),status:'SCHEDULED',...input}));
 await ManagedAccessService.createVisit(payload(r),actor,'customer-visit-key-occupied');
 assert.deepEqual(allocationFilter.status.$in,['RESERVED','OCCUPIED']);
});

test('Visit idempotency key cannot be replayed with a different request',async t=>{
 const r=reservation(),actor=customer(),existing={requestHash:'a'.repeat(64)};
 t.mock.method(Visit,'findOne',()=>new Query(existing));
 await assert.rejects(ManagedAccessService.createVisit(payload(r),actor,'customer-visit-key-002'),error=>error instanceof ManagedAccessError&&error.status===409&&error.code==='IDEMPOTENCY_CONFLICT');
});

test('Customer cannot create a visit for another Customer reservation',async t=>{
 const actor=customer();
 t.mock.method(Visit,'findOne',()=>new Query(null));
 t.mock.method(Reservation,'findOne',()=>new Query(null));
 await assert.rejects(ManagedAccessService.createVisit(payload(),actor,'customer-visit-key-003'),error=>error instanceof ManagedAccessError&&error.status===404&&error.code==='RESERVATION_NOT_FOUND');
});

test('Only Customers can create visits and managers cannot inspect another Facility',async t=>{
 const r=reservation(),manager={_id:oid(8),role:'FACILITY_MANAGER',assignedFacilityId:oid(9)};
 await assert.rejects(ManagedAccessService.createVisit(payload(r),manager,'manager-key-001'),error=>error.status===403&&error.code==='ROLE_DENIED');
 const visit={_id:oid(10),facilityId:r.facilityId};t.mock.method(Visit,'findById',()=>new Query(visit));
 await assert.rejects(ManagedAccessService.visitDetail(String(visit._id),manager),error=>error.status===403&&error.code==='FACILITY_SCOPE_DENIED');
});

test('CHECKIN_READY visit creation is preparatory and does not create an Access Session',async t=>{
 const r=reservation(),actor=customer(),created=[];
 t.mock.method(Visit,'findOne',()=>new Query(null));t.mock.method(Reservation,'findOne',()=>new Query(r));t.mock.method(Facility,'findOne',()=>new Query({_id:r.facilityId}));t.mock.method(Allocation,'find',()=>new Query([{cellId:oid(4)}]));
 t.mock.method(Visit,'create',async input=>{const row={_id:oid(6),...input,status:'SCHEDULED'};created.push(row);return row;});
 const result=await ManagedAccessService.createVisit(payload(r),actor,'customer-visit-key-004');
 assert.equal(result.status,'SCHEDULED');assert.equal(Object.hasOwn(result,'startedAt'),false);assert.equal(Object.hasOwn(result,'accessSession'),false);
});

test('Customer cancellation uses ownership and expected revision',async t=>{
 const row={_id:oid(11),customerId:oid(1),status:'SCHEDULED',revision:2,audit:[],save:async function(){return this;}};
 t.mock.method(Visit,'findOne',()=>new Query(row));
 const result=await ManagedAccessService.cancelVisit(String(row._id),customer(),2);
 assert.equal(result.status,'CANCELLED');assert.equal(result.revision,3);assert.equal(result.audit.at(-1).action,'VISIT_CANCELLED');
 await assert.rejects(ManagedAccessService.cancelVisit(String(row._id),customer(),2),error=>error.status===412);
});

test('Manager assignment is facility-scoped and rejects an overlapping assigned Staff schedule',async t=>{
 const facilityId=oid(3),visit={_id:oid(12),facilityId,status:'SCHEDULED',revision:1,startsAt:new Date(Date.now()+86400000),endsAt:new Date(Date.now()+86400000+3600000)};
 const actor={_id:oid(13),role:'FACILITY_MANAGER',assignedFacilityId:facilityId},staffId=oid(14);let fenceArgs,assignmentArgs;
 t.mock.method(Visit,'findById',()=>new Query(visit));
 t.mock.method(mongoose,'startSession',async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}}));
 t.mock.method(User,'findOneAndUpdate',(filter,update,options)=>{fenceArgs={filter,update,options};return new Query({_id:staffId});});
 t.mock.method(Visit,'findOne',()=>new Query(null));
 t.mock.method(Visit,'findOneAndUpdate',(filter,update,options)=>{assignmentArgs={filter,update,options};return new Query({...visit,assignedStaffId:staffId,revision:2});});
 const result=await ManagedAccessService.assignStaff(String(visit._id),{staffId:String(staffId),reason:'Escort shift'},actor,1);
 assert.equal(String(fenceArgs.filter.assignedFacilityId),String(facilityId));assert.equal(result.revision,2);assert.equal(String(assignmentArgs.filter.facilityId),String(facilityId));
});

test('Staff check-in creates one server-timed Session bounded by Rental and Visit inside transaction',async t=>{
 const now=Date.now(),facilityId=oid(3),staffId=oid(15),customerId=oid(1),reservationId=oid(2),cellId=oid(4),visitId=oid(16),key='staff-checkin-key-001';
 const visit={_id:visitId,customerId,facilityId,reservationId,purpose:'INBOUND',startsAt:new Date(now-60000),endsAt:new Date(now+3600000),status:'SCHEDULED',revision:0,assignedStaffId:staffId,audit:[],save:async function(){return this;}};
 const reservation={_id:reservationId,customerId,facilityId,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',startDate:new Date(now-86400000),endDate:new Date(now+86400000),handoverAt:new Date(now-60000),handoverByStaffId:staffId,rentalPaymentFlow:'FULL_UPFRONT_V1',fullPaymentId:oid(17),allocatedCellIds:[cellId]};
 const content={reservationId:String(reservationId)},contentHash=createHash('sha256').update(JSON.stringify(content)).digest('hex');
 const contract={signedProofPublicId:'proof',verifiedAt:new Date(now-60000),currentContentVersion:1,contentVersions:[{version:1,content,contentHash}],signatures:[{version:1,contentHash,signerRole:'CUSTOMER'},{version:1,contentHash,signerRole:'FACILITY_STAFF'}]};let createdSession;
 t.mock.method(Visit,'findById',()=>new Query(visit));t.mock.method(Visit,'findOne',()=>new Query(visit));
 t.mock.method(Reservation,'findOne',()=>new Query(reservation));t.mock.method(Reservation,'findOneAndUpdate',()=>new Query(reservation));t.mock.method(Reservation,'findById',()=>new Query(reservation));
 t.mock.method(Payment,'findOne',()=>new Query({_id:reservation.fullPaymentId}));t.mock.method(Payment,'updateOne',()=>new Query({matchedCount:1}));
 t.mock.method(Contract,'findOne',()=>new Query(contract));t.mock.method(Contract,'updateOne',()=>new Query({matchedCount:1}));
 t.mock.method(Facility,'updateOne',()=>new Query({matchedCount:1}));t.mock.method(User,'findOneAndUpdate',()=>new Query({_id:staffId}));
 t.mock.method(Allocation,'find',()=>new Query([{cellId}]));t.mock.method(Allocation,'updateMany',()=>new Query({matchedCount:1}));
 t.mock.method(Session,'find',()=>new Query([]));t.mock.method(Session,'findOne',()=>new Query(null));t.mock.method(Session,'updateMany',()=>new Query({modifiedCount:0}));
 t.mock.method(mongoose,'startSession',async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}}));
 t.mock.method(Session,'create',async([input])=>{createdSession={_id:oid(18),...input};return [createdSession];});
 const actor={_id:staffId,role:'FACILITY_STAFF',assignedFacilityId:facilityId};
 const result=await ManagedAccessService.checkIn(String(visitId),{identityVerified:true,customerPresent:true,safetyReviewed:true,safetyNotes:'ID and safety checked'},actor,key);
 assert.ok(result.session.expiresAt.getTime()-result.session.startedAt.getTime()<=60*60*1000);assert.ok(result.session.expiresAt<=visit.endsAt);assert.ok(result.session.expiresAt<=reservation.endDate);assert.deepEqual(result.session.allowedCellIds,[cellId]);assert.equal(result.visit.status,'CHECKED_IN');assert.equal(createdSession.audit[0].action,'SESSION_ACTIVATED');
});

test('Revoked check-in replay is not reported as success; checkout/revoke are facility and revision scoped',async t=>{
 const visit={_id:oid(20),facilityId:oid(3),assignedStaffId:oid(21)},existing={_id:oid(22),visitId:visit._id,status:'REVOKED',checkInIdempotencyKey:'replay-key-001'};
 t.mock.method(Visit,'findById',()=>new Query(visit));t.mock.method(Visit,'findOne',()=>new Query(visit));t.mock.method(Session,'find',()=>new Query([]));t.mock.method(Session,'findOne',()=>new Query(existing));
 t.mock.method(mongoose,'startSession',async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}}));
 await assert.rejects(ManagedAccessService.checkIn(String(visit._id),{identityVerified:true,customerPresent:true,safetyReviewed:true,safetyNotes:'checked'}, {_id:visit.assignedStaffId,role:'FACILITY_STAFF',assignedFacilityId:visit.facilityId},'replay-key-001'),error=>error instanceof ManagedAccessError&&error.code==='CHECKIN_RESULT_NOT_ACTIVE');
 const active={_id:oid(23),visitId:oid(24),facilityId:oid(3),assignedStaffId:oid(21),revision:4,status:'ACTIVE',expiresAt:new Date(Date.now()+60000)};
 t.mock.method(mongoose,'startSession',async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}}));
 let updateFilter;
 t.mock.method(Session,'findOneAndUpdate',filter=>{updateFilter=filter;return new Query({...active,status:'REVOKED',revision:5});});
 t.mock.method(Visit,'updateOne',()=>new Query({matchedCount:1}));
 const ended=await ManagedAccessService.finishSession(String(active._id),{reason:'Safety concern'}, {_id:active.assignedStaffId,role:'FACILITY_STAFF',assignedFacilityId:active.facilityId},4,true);
 assert.equal(ended.status,'REVOKED');assert.equal(updateFilter.revision,4);assert.equal(String(updateFilter.facilityId),String(active.facilityId));
});

test('Expired Sessions reconcile Visit state and audit atomically using the Session expiry timestamp',async t=>{
 const now=new Date('2026-11-12T12:00:00.000Z'),expiredAt=new Date('2026-11-12T11:00:00.000Z'),row={_id:oid(50),visitId:oid(51),status:'ACTIVE',expiresAt:expiredAt};
 let sessionUpdate,visitUpdate;
 let pageCount=0;t.mock.method(Session,'find',filter=>{pageCount++;return new Query(filter._id?[]:[row]);});
 t.mock.method(Session,'findOneAndUpdate',(filter,update)=>{sessionUpdate={filter,update};return new Query({...row,status:'EXPIRED',endedAt:expiredAt,revision:1});});
 t.mock.method(Visit,'findOneAndUpdate',(filter,update)=>{visitUpdate={filter,update};return new Query({_id:row.visitId,status:'COMPLETED'});});
 t.mock.method(mongoose,'startSession',async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}}));
 assert.equal(await ManagedAccessService.reconcileExpiredSessions(now),1);
 assert.equal(sessionUpdate.filter.status,'ACTIVE');assert.equal(sessionUpdate.filter.expiresAt.$lte,now);
 assert.equal(visitUpdate.filter.status,'CHECKED_IN');assert.equal(visitUpdate.update.$set.checkedOutAt,expiredAt);
 assert.equal(visitUpdate.update.$push.audit.actorRole,'SYSTEM');
 assert.equal(pageCount,2,'global reconciliation advances past the processed page');
});

test('Concurrent duplicate Staff check-ins create at most one Session',async t=>{
 const now=Date.now(),facilityId=oid(3),staffId=oid(25),customerId=oid(1),reservationId=oid(2),cellId=oid(4),visitId=oid(26),rows=[];
 const visit={_id:visitId,customerId,facilityId,reservationId,purpose:'INBOUND',startsAt:new Date(now-60000),endsAt:new Date(now+3600000),status:'SCHEDULED',revision:0,assignedStaffId:staffId,audit:[],save:async function(){return this;}};
 const reservation={_id:reservationId,customerId,facilityId,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',startDate:new Date(now-86400000),endDate:new Date(now+86400000),handoverAt:new Date(now-60000),handoverByStaffId:staffId,rentalPaymentFlow:'FULL_UPFRONT_V1',fullPaymentId:oid(27),allocatedCellIds:[cellId]};
 const contract={signedProofPublicId:'proof',verifiedAt:new Date(now-60000),currentContentVersion:1,signatures:[{version:1,signerRole:'CUSTOMER'},{version:1,signerRole:'FACILITY_STAFF'}]};let tail=Promise.resolve();
 t.mock.method(Visit,'findById',()=>new Query(visit));t.mock.method(Visit,'findOne',filter=>new Query(visit.status==='SCHEDULED'&&String(visit.assignedStaffId)===String(filter.assignedStaffId)?visit:null));
 const content={reservationId:String(reservationId)},contentHash=createHash('sha256').update(JSON.stringify(content)).digest('hex');contract.contentVersions=[{version:1,content,contentHash}];contract.signatures.forEach(signature=>signature.contentHash=contentHash);
 t.mock.method(Reservation,'findOne',()=>new Query(reservation));t.mock.method(Reservation,'findOneAndUpdate',()=>new Query(reservation));t.mock.method(Reservation,'findById',()=>new Query(reservation));
 t.mock.method(Payment,'findOne',()=>new Query({_id:reservation.fullPaymentId}));t.mock.method(Payment,'updateOne',()=>new Query({matchedCount:1}));
 t.mock.method(Contract,'findOne',()=>new Query(contract));t.mock.method(Contract,'updateOne',()=>new Query({matchedCount:1}));t.mock.method(Facility,'updateOne',()=>new Query({matchedCount:1}));t.mock.method(User,'findOneAndUpdate',()=>new Query({_id:staffId}));
 t.mock.method(Allocation,'find',()=>new Query([{cellId}]));t.mock.method(Allocation,'updateMany',()=>new Query({matchedCount:1}));
 t.mock.method(Session,'find',()=>new Query([]));
 t.mock.method(Session,'findOne',filter=>new Query(rows.find(row=>filter.checkInIdempotencyKey?row.checkInIdempotencyKey===filter.checkInIdempotencyKey:filter.status==='ACTIVE'&&row.status==='ACTIVE')||null));
 t.mock.method(Session,'updateMany',()=>new Query({modifiedCount:0}));t.mock.method(Session,'create',async([input])=>{const row={_id:oid(28+rows.length),...input};rows.push(row);return [row];});
 t.mock.method(mongoose,'startSession',async()=>({withTransaction:async fn=>{const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;try{return await fn();}finally{release();}},endSession:async()=>{}}));
 const actor={_id:staffId,role:'FACILITY_STAFF',assignedFacilityId:facilityId},input={identityVerified:true,customerPresent:true,safetyReviewed:true,safetyNotes:'Checked'};
 const results=await Promise.allSettled([ManagedAccessService.checkIn(String(visitId),input,actor,'concurrent-checkin-key-1'),ManagedAccessService.checkIn(String(visitId),input,actor,'concurrent-checkin-key-2')]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(rows.length,1);
});

test('Concurrent Session revocations are fenced by expected revision',async t=>{
 const facilityId=oid(3),managerId=oid(29),session={_id:oid(30),facilityId,assignedStaffId:oid(31),visitId:oid(32),status:'ACTIVE',revision:5,expiresAt:new Date(Date.now()+60000)};let tail=Promise.resolve();
 t.mock.method(mongoose,'startSession',async()=>({withTransaction:async fn=>{const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;try{return await fn();}finally{release();}},endSession:async()=>{}}));
 t.mock.method(Session,'findOneAndUpdate',(filter,update)=>{if(session.status!=='ACTIVE'||session.revision!==filter.revision)return new Query(null);session.status='REVOKED';session.revision+=1;return new Query({...session});});
 t.mock.method(Visit,'updateOne',()=>new Query({matchedCount:1}));
 const actor={_id:managerId,role:'FACILITY_MANAGER',assignedFacilityId:facilityId};
 const results=await Promise.allSettled([ManagedAccessService.finishSession(String(session._id),{reason:'Unsafe condition'},actor,5,true),ManagedAccessService.finishSession(String(session._id),{reason:'Unsafe condition'},actor,5,true)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
});

test('D3/D4 session guard fences the complete multi-Cell scope and revalidates lifecycle and allocations in transaction',async t=>{
 const customerId=oid(41),reservationId=oid(42),facilityId=oid(43),visitId=oid(44),sessionId=oid(45),cells=[oid(46),oid(47)],staffId=oid(48),now=new Date();
 const session={_id:sessionId,visitId,reservationId,customerId,facilityId,status:'ACTIVE',startedAt:new Date(now-60000),expiresAt:new Date(now.getTime()+60000),revision:8,
  allowedPurposes:['RELOCATION'],allowedCellIds:cells};
 const r={_id:reservationId,customerId,facilityId,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',startDate:new Date(now-86400000),endDate:new Date(now.getTime()+86400000),
  handoverAt:new Date(now-3600000),handoverByStaffId:staffId,rentalPaymentFlow:'FULL_UPFRONT_V1',fullPaymentId:oid(49),allocatedCellIds:cells};
 const content={contract:'signed'},contentHash=createHash('sha256').update(JSON.stringify(content)).digest('hex');
 const contract={signedProofPublicId:'proof',verifiedAt:new Date(now-3600000),currentContentVersion:1,contentVersions:[{version:1,content,contentHash}],
  signatures:[{version:1,contentHash,signerRole:'CUSTOMER'},{version:1,contentHash,signerRole:'FACILITY_MANAGER'}]};
 let sessionFilter,allocationFilter;
 t.mock.method(Session,'findOneAndUpdate',(filter,update)=>{sessionFilter=filter;return new Query({...session,revision:9});});
 t.mock.method(Reservation,'findOneAndUpdate',()=>new Query(r));t.mock.method(Reservation,'findById',()=>new Query(r));
 t.mock.method(Visit,'findOne',()=>new Query({purpose:'RELOCATION',status:'CHECKED_IN'}));
 t.mock.method(Facility,'updateOne',()=>new Query({matchedCount:1}));t.mock.method(Payment,'updateOne',()=>new Query({matchedCount:1}));
 t.mock.method(Contract,'updateOne',()=>new Query({matchedCount:1}));t.mock.method(Contract,'findOne',()=>new Query(contract));
 t.mock.method(Allocation,'updateMany',(filter)=>{allocationFilter=filter;return new Query({matchedCount:2});});
 t.mock.method(Allocation,'find',()=>new Query(cells.map(cellId=>({cellId}))));
 const result=await assertManagedAccessSessionScope({sessionId,customerId,reservationId,facilityId,purpose:'RELOCATION',cellIds:cells,expectedRevision:8,now,dbSession:{}});
 assert.equal(result.revision,9);assert.equal(sessionFilter.allowedCellIds.$all.length,2);assert.deepEqual(allocationFilter.status.$in,['RESERVED','OCCUPIED']);
 assert.equal(allocationFilter.cellId.$in.length,2);
 await assert.rejects(assertManagedAccessSessionScope({sessionId,customerId,reservationId,facilityId,purpose:'RELOCATION',cellIds:cells,expectedRevision:8,now}),error=>error.code==='TRANSACTION_REQUIRED');
});
