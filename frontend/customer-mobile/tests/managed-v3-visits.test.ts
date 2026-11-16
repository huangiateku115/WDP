const mockVisitVault=new Map<string,string>();
jest.mock('expo-secure-store',()=>({getItemAsync:async(key:string)=>mockVisitVault.get(key)??null,
  setItemAsync:async(key:string,value:string)=>{mockVisitVault.set(key,value);},deleteItemAsync:async(key:string)=>{mockVisitVault.delete(key);}}));
import {apiClient,configureApiSession} from '../src/api/client';
import axios from 'axios';
import {managedReservationReads} from '../src/api/managedReservationReads';
import {journal} from '../src/state/attemptJournal';

const [owner,facilityId,reservationId,visitId]=['1','2','3','4'].map(value=>value.repeat(24)) as [string,string,string,string];
const r={_id:reservationId,customerId:owner,facilityId,reservationCode:'MIR-FIXTURE',serviceType:'MANAGED_INVENTORY' as const,
  status:'ACTIVE' as const,bookingFlowVersion:3 as const,startDate:'2025-01-01T00:00:00.000Z',endDate:'2099-12-31T00:00:00.000Z'};
const startsAt='2099-07-02T02:00:00.000Z',endsAt='2099-07-02T02:30:00.000Z';
const visit={_id:visitId,reservationId,customerId:owner,facilityId,purpose:'INBOUND' as const,startsAt,endsAt,note:'Nhập hàng',revision:7,status:'SCHEDULED' as const};
const adapter=apiClient.defaults.adapter;
beforeEach(async()=>{mockVisitVault.clear();configureApiSession('fixture-token');await (await journal('managed-v3-visit-create',owner,reservationId)).clear();await (await journal('managed-v3-visit-amend',owner,visitId)).clear();});
afterEach(()=>{apiClient.defaults.adapter=adapter;configureApiSession();});

test('availability uses the confirmed read endpoint and Backend-provided Asia/Ho_Chi_Minh slots',async()=>{
  apiClient.defaults.adapter=async config=>{
    expect(config.method).toBe('get');
    expect(config.url).toBe('/access/managed-v3/visits/availability');
    expect(config.params).toEqual({reservationId,date:'2099-07-02'});
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{timeZone:'Asia/Ho_Chi_Minh',slotDurationMinutes:30,
      capacityBasis:'FACILITY_STAFF',staffAssignmentRequired:true,slots:[{startsAt,endsAt}]}}};
  };
  await expect(managedReservationReads.visitAvailability(r,owner,'2099-07-02')).resolves.toMatchObject({timeZone:'Asia/Ho_Chi_Minh',slots:[{startsAt,endsAt}]});
  await expect(managedReservationReads.visitAvailability(r,visitId,'2099-07-02')).rejects.toThrow();
  await expect(managedReservationReads.visitAvailability({...r,status:'CANCELLED'},owner,'2099-07-02')).rejects.toThrow();
});

test('visit create sends the exact selected slot with a stable idempotency key and validates owner scope',async()=>{
  let calls=0;
  apiClient.defaults.adapter=async config=>{
    calls++;
    expect(config.method).toBe('post');
    expect(config.url).toBe('/access/managed-v3/visits');
    expect(config.headers.get('Idempotency-Key')).toBe('fixture-visit-create-key');
    expect(JSON.parse(config.data)).toEqual({reservationId,purpose:'INBOUND',startsAt,endsAt,note:'Nhập hàng'});
    return {config,status:201,statusText:'Created',headers:{},data:{success:true,data:{...visit,customerId:calls===1?owner:visitId}}};
  };
  const body={reservationId,purpose:'INBOUND' as const,startsAt,endsAt,note:'Nhập hàng'};
  await expect(managedReservationReads.createVisit(r,owner,body,'fixture-visit-create-key')).resolves.toMatchObject({_id:visitId,status:'SCHEDULED'});
  await expect(managedReservationReads.createVisit(r,owner,body,'fixture-visit-create-key')).rejects.toThrow();
  expect(calls).toBe(2);
});

test('amend uses If-Match revision plus idempotency key; conflict remains visible to caller',async()=>{
  let conflict=false;
  apiClient.defaults.adapter=async config=>{
    expect(config.method).toBe('patch');
    expect(config.url).toBe('/access/managed-v3/visits/'+visitId);
    expect(config.headers.get('If-Match')).toBe('7');
    expect(config.headers.get('Idempotency-Key')).toBe('fixture-visit-amend-key');
    expect(JSON.parse(config.data)).toEqual({startsAt,endsAt,purpose:'INBOUND',note:'Đã xác nhận'});
    if(conflict)throw new axios.AxiosError('Revision conflict','ERR_BAD_REQUEST',config,undefined,
      {config,status:409,statusText:'Conflict',headers:{},data:{success:false,code:'REVISION_CONFLICT'}});
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{...visit,note:'Đã xác nhận',revision:8}}};
  };
  await expect(managedReservationReads.amendVisit(r,owner,visit,{startsAt,endsAt,purpose:'INBOUND',note:'Đã xác nhận'},'fixture-visit-amend-key'))
    .resolves.toMatchObject({revision:8,note:'Đã xác nhận'});
  conflict=true;
  await expect(managedReservationReads.amendVisit(r,owner,visit,{startsAt,endsAt,purpose:'INBOUND',note:'Đã xác nhận'},'fixture-visit-amend-key')).rejects.toMatchObject({response:{status:409}});
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
