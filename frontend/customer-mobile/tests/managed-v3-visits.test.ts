const mockVisitVault=new Map<string,string>();
jest.mock('expo-secure-store',()=>({getItemAsync:async(key:string)=>mockVisitVault.get(key)??null,
  setItemAsync:async(key:string,value:string)=>{mockVisitVault.set(key,value);},deleteItemAsync:async(key:string)=>{mockVisitVault.delete(key);}}));
import fs from 'node:fs';
import path from 'node:path';
import {apiClient,configureApiSession} from '../src/api/client';
import axios from 'axios';
import {canReadManagedVisitEligibility,managedReservationReads} from '../src/api/managedReservationReads';
import {mapManagedAccessRows} from '../src/api/managedReservationReads';
import {journal} from '../src/state/attemptJournal';
import {managedSessionEligibility} from '../src/domain/managedAccessSessionEligibility';

const [owner,facilityId,reservationId,visitId]=['1','2','3','4'].map(value=>value.repeat(24)) as [string,string,string,string];
const r={_id:reservationId,customerId:owner,facilityId,reservationCode:'MIR-FIXTURE',serviceType:'MANAGED_INVENTORY' as const,
  status:'ACTIVE' as const,bookingFlowVersion:3 as const,startDate:'2025-01-01T00:00:00.000Z',endDate:'2099-12-31T00:00:00.000Z'};
const startsAt='2099-07-02T02:00:00.000Z',endsAt='2099-07-02T02:30:00.000Z';
const visit={_id:visitId,reservationId,customerId:owner,facilityId,purpose:'WAREHOUSE_VISIT' as const,startsAt,endsAt,note:'Nhập hàng',revision:7,status:'SCHEDULED' as const};
const adapter=apiClient.defaults.adapter;
beforeEach(async()=>{mockVisitVault.clear();configureApiSession('fixture-token');await (await journal('managed-v3-visit-create',owner,reservationId)).clear();await (await journal('managed-v3-visit-amend',owner,visitId)).clear();});
afterEach(()=>{apiClient.defaults.adapter=adapter;configureApiSession();});

test('availability uses the confirmed read endpoint and Backend-provided Asia/Ho_Chi_Minh slots',async()=>{
  apiClient.defaults.adapter=async config=>{
    expect(config.method).toBe('get');
    expect(config.url).toBe('/access/managed-v3/visits/availability');
    expect(config.params).toEqual({date:'2099-07-02',facilityId});
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{timeZone:'Asia/Ho_Chi_Minh',slotDurationMinutes:null,
      capacityBasis:'ACTIVE_STAFF_ACCOUNTS_MINUS_OVERLAPPING_VISITS',staffAssignmentRequired:true,reservationScopeAvailable:true,
      reservationScopePolicy:'ACTIVE_SAME_FACILITY_WITH_MORE_THAN_7_DAYS_REMAINING_AT_VISIT',slots:[{startsAt,endsAt,facilityId,facilityName:'Kho kiểm thử'}]}}};
  };
  await expect(managedReservationReads.visitAvailability(r,owner,'2099-07-02')).resolves.toMatchObject({timeZone:'Asia/Ho_Chi_Minh',slotDurationMinutes:null,reservationScopeAvailable:true,slots:[{startsAt,endsAt,facilityId}]});
  await expect(managedReservationReads.visitAvailability(r,visitId,'2099-07-02')).rejects.toThrow();
  await expect(managedReservationReads.visitAvailability({...r,status:'CANCELLED'},owner,'2099-07-02')).rejects.toThrow();
});

test('visit eligibility is confirmed by Backend with the Reservation ObjectId',async()=>{
  apiClient.defaults.adapter=async config=>{
    expect(config.method).toBe('get');
    expect(config.url).toBe('/access/managed-v3/visits/availability');
    expect(config.params).toEqual({reservationId,date:'2026-11-17'});
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{timeZone:'Asia/Ho_Chi_Minh',slotDurationMinutes:30,
      capacityBasis:'FACILITY_STAFF',staffAssignmentRequired:true,slots:[]}}};
  };
  await expect(managedReservationReads.visitEligibility(r,owner,'2026-11-17')).resolves.toMatchObject({slots:[]});
});

test('visit eligibility skips Reservation states Backend rejects as not ready',()=>{
  const now=Date.parse('2026-11-17T00:00:00Z');
  expect(canReadManagedVisitEligibility({...r,status:'RESERVED'},now)).toBe(false);
  expect(canReadManagedVisitEligibility({...r,status:'PAID'},now)).toBe(false);
  expect(canReadManagedVisitEligibility({...r,status:'CANCELLED'},now)).toBe(false);
  expect(canReadManagedVisitEligibility({...r,endDate:'2026-11-16T00:00:00.000Z'},now)).toBe(false);
  expect(canReadManagedVisitEligibility(r,now)).toBe(true);
});

test('visit create sends the exact selected slot with a stable idempotency key and validates owner scope',async()=>{
  let calls=0;
  apiClient.defaults.adapter=async config=>{
    calls++;
    expect(config.method).toBe('post');
    expect(config.url).toBe('/access/managed-v3/visits');
    expect(config.headers.get('Idempotency-Key')).toBe('fixture-visit-create-key');
    expect(JSON.parse(config.data)).toEqual({facilityId,startsAt,endsAt,note:'Nhập hàng'});
    return {config,status:201,statusText:'Created',headers:{},data:{success:true,data:{...visit,customerId:calls===1?owner:visitId}}};
  };
  const body={facilityId,startsAt,endsAt,note:'Nhập hàng'};
  await expect(managedReservationReads.createVisit(r,owner,body,'fixture-visit-create-key')).resolves.toMatchObject({_id:visitId,status:'SCHEDULED'});
  await expect(managedReservationReads.createVisit(r,owner,body,'fixture-visit-create-key')).rejects.toThrow();
  expect(calls).toBe(2);
});

test('new Visit creation rejects a Facility outside the selected Reservation scope before POST',async()=>{
  let calls=0;apiClient.defaults.adapter=async config=>{calls++;return {config,status:500,statusText:'Unexpected',headers:{},data:{}};};
  await expect(managedReservationReads.createVisit(r,owner,{facilityId:'5'.repeat(24),startsAt,endsAt},'fixture-visit-create-key')).rejects.toThrow('Cơ sở của lịch không khớp');
  expect(calls).toBe(0);
});

test('amend uses If-Match revision plus idempotency key; conflict remains visible to caller',async()=>{
  let conflict=false;
  apiClient.defaults.adapter=async config=>{
    expect(config.method).toBe('patch');
    expect(config.url).toBe('/access/managed-v3/visits/'+visitId);
    expect(config.headers.get('If-Match')).toBe('7');
    expect(config.headers.get('Idempotency-Key')).toBe('fixture-visit-amend-key');
    expect(JSON.parse(config.data)).toEqual({startsAt,endsAt,note:'Đã xác nhận'});
    if(conflict)throw new axios.AxiosError('Revision conflict','ERR_BAD_REQUEST',config,undefined,
      {config,status:409,statusText:'Conflict',headers:{},data:{success:false,code:'REVISION_CONFLICT'}});
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{...visit,note:'Đã xác nhận',revision:8}}};
  };
  await expect(managedReservationReads.amendVisit(r,owner,visit,{startsAt,endsAt,note:'Đã xác nhận'},'fixture-visit-amend-key'))
    .resolves.toMatchObject({revision:8,note:'Đã xác nhận'});
  conflict=true;
  await expect(managedReservationReads.amendVisit(r,owner,visit,{startsAt,endsAt,note:'Đã xác nhận'},'fixture-visit-amend-key')).rejects.toMatchObject({response:{status:409}});
  await expect(managedReservationReads.amendVisit(r,visitId,visit,{note:'x'},'fixture-visit-amend-key')).rejects.toThrow();
});

test('pending Visit request survives app-facing journal reads with the original key and body',async()=>{
  const store=await journal('managed-v3-visit-create',owner,reservationId);
  const saved={key:'wdp-mobile-12345678-1234-4abc-9abc-123456789abc',visitBody:{reservationId,purpose:'INBOUND' as const,startsAt,endsAt,note:'Nhập hàng'}};
  expect(await store.claim(saved)).toBe(true);
  const restored=await (await journal('managed-v3-visit-create',owner,reservationId)).read();
  expect(restored).toEqual(saved);
  expect(await store.claim({...saved,key:'wdp-mobile-22345678-1234-4abc-9abc-123456789abc'})).toBe(false);
  expect((await store.read())?.key).toBe(saved.key);
});

test('Visit list accepts Backend MISSED status and populated assigned staff',async()=>{
  apiClient.defaults.adapter=async config=>({config,status:200,statusText:'OK',headers:{},data:{success:true,data:[{
    ...visit,status:'MISSED',assignedStaffId:{_id:'5'.repeat(24),displayName:'Nhân viên kho'},
  }]}});
  await expect(managedReservationReads.visits(r,owner)).resolves.toMatchObject([
    {status:'MISSED',assignedStaffId:{displayName:'Nhân viên kho'}},
  ]);
});

test('Visit and Session scope mapping includes a secondary Reservation and ignores independent scope',()=>{
  const otherReservation='6'.repeat(24),current={...r,_id:reservationId};
  const row={customerId:owner,facilityId,reservationId:otherReservation,scopedReservationIds:[otherReservation,reservationId]};
  const independent={...row,scopedReservationIds:[otherReservation]};
  expect(mapManagedAccessRows([row,independent],current,owner)).toEqual([row]);
});

test('Visit list preserves forbidden API errors instead of treating them as an empty list',async()=>{
  apiClient.defaults.adapter=async config=>{throw new axios.AxiosError('Forbidden','ERR_BAD_REQUEST',config,undefined,
    {config,status:403,statusText:'Forbidden',headers:{},data:{success:false,code:'FORBIDDEN'}});};
  await expect(managedReservationReads.visits(r,owner)).rejects.toMatchObject({response:{status:403}});
});

test('Session list is owner scoped and Session detail can confirm a revoked state',async()=>{
  const sessionId='7'.repeat(24),visitRef='8'.repeat(24),staffId='9'.repeat(24),cellId='a'.repeat(24);
  const session={_id:sessionId,reservationId,customerId:owner,facilityId,revision:4,visitId:visitRef,assignedStaffId:staffId,
    allowedCellIds:[cellId],allowedPurposes:['INBOUND','OUTBOUND','RELOCATION'],startedAt:startsAt,expiresAt:endsAt,status:'ACTIVE'};
  apiClient.defaults.adapter=async config=>{
    if(config.url==='/access/managed-v3/sessions/me')return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:[session]}};
    expect(config.url).toBe('/access/managed-v3/sessions/'+sessionId);
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{...session,status:'REVOKED',revision:5}}};
  };
  await expect(managedReservationReads.sessions(r,owner)).resolves.toMatchObject([{_id:sessionId,status:'ACTIVE',allowedPurposes:['INBOUND','OUTBOUND','RELOCATION']}]);
  await expect(managedReservationReads.session(r,owner,sessionId)).resolves.toMatchObject({_id:sessionId,status:'REVOKED',revision:5});
  await expect(managedReservationReads.session(r,visitId,sessionId)).rejects.toThrow();
});

test('a valid Session detail remains usable when the customer Session list omits it and Outbound accepts scoped Reservations',async()=>{
  const sessionId='5'.repeat(24),visitRef='6'.repeat(24),staffId='7'.repeat(24),cellId='8'.repeat(24),secondaryId='9'.repeat(24);
  const session={_id:sessionId,reservationId,scopedReservationIds:[secondaryId],customerId:owner,facilityId,revision:3,visitId:visitRef,assignedStaffId:staffId,
    allowedCellIds:[cellId],allowedPurposes:['INBOUND','OUTBOUND','RELOCATION'],startedAt:'2026-11-19T09:00:00.000Z',expiresAt:'2026-11-19T11:00:00.000Z',status:'ACTIVE'};
  apiClient.defaults.adapter=async config=>config.url==='/access/managed-v3/sessions/me'
    ?{config,status:200,statusText:'OK',headers:{},data:{success:true,data:[]}}
    :{config,status:200,statusText:'OK',headers:{},data:{success:true,data:session}};
  const list=await managedReservationReads.sessions(r,owner),detail=await managedReservationReads.session(r,owner,sessionId);
  expect(list).toEqual([]);
  expect(managedSessionEligibility(detail,{customerId:owner,facilityId,reservationId:secondaryId,purpose:'OUTBOUND',cellIds:[cellId],now:Date.parse('2026-11-19T10:00:00.000Z')})).toEqual({eligible:true});
  expect(managedSessionEligibility(detail,{customerId:owner,facilityId,reservationId:secondaryId,purpose:'RELOCATION',cellIds:[cellId],now:Date.parse('2026-11-19T10:00:00.000Z')}).reason).toBe('RESERVATION');
});

test('Relocation flow loads the Activity Session detail even when the customer Session list omits it',()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../src/screens/ManagedRelocationFlow.tsx'),'utf8');
  expect(source).toContain("managedReservationReads.session(rental.data,owner,requestedSession,signal)");
  expect(source).toContain('...(requestedSessionDetail.data?[requestedSessionDetail.data]:[])');
  expect(source).toContain('managedReservationReads.session(rental.data,owner,previewSession._id)');
  expect(source).toContain('managedReservationReads.session(rental.data,owner,confirmSession._id)');
});
