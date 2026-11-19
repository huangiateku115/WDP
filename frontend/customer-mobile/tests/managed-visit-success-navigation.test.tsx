import React from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import axios from 'axios';
import {afterEach} from '@jest/globals';
import {ManagedVisitForm} from '../src/screens/ManagedVisitForm';
import {ManagedVisitActivityScreen} from '../src/screens/ManagedVisitActivityScreen';
import {dismissVisitSuccessFeedback,getVisitSuccessFeedback} from '../src/state/visitSuccessFeedback';
import {dismissToast,getToast} from '../src/state/toastStore';

const mockOwner='1'.repeat(24),mockReservationId='3'.repeat(24),mockFacilityId='2'.repeat(24),mockVisitId='4'.repeat(24);
const mockReplace=jest.fn(),mockBack=jest.fn(),mockPush=jest.fn(),mockCreate=jest.fn(),mockListVisits=jest.fn();
const mockSlot={startsAt:'2099-07-02T02:00:00.000Z',endsAt:'2099-07-02T03:00:00.000Z'};
const mockReservation={_id:mockReservationId,customerId:mockOwner,facilityId:mockFacilityId,reservationCode:'MIR-TEST',serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',startDate:'2025-01-01T00:00:00.000Z',endDate:'2099-12-31T00:00:00.000Z'};
const mockFacility={_id:mockFacilityId,name:'Kho kiểm thử'};
const mockCreatedVisit={_id:mockVisitId,reservationId:mockReservationId,customerId:mockOwner,facilityId:mockFacilityId,purpose:'WAREHOUSE_VISIT',...mockSlot,note:'',revision:1,status:'SCHEDULED'};
let mockRows:typeof mockCreatedVisit[]=[];
let mockAttempt:unknown=null;
let mockResolveCreate:((value:typeof mockCreatedVisit)=>void)|undefined;

jest.mock('expo-router',()=>({useLocalSearchParams:()=>({reservationId:mockReservationId}),useRouter:()=>({replace:mockReplace,back:mockBack,push:mockPush})}));
jest.mock('../src/state/useLiveSession',()=>{
  const current=()=>({user:{_id:mockOwner}});
  const hook=(selector:(value:ReturnType<typeof current>)=>unknown)=>selector(current());
  return {useLiveSession:Object.assign(hook,{getState:current})};
});
jest.mock('../src/components/liveUI',()=>({useScreenActive:()=>true,useResource:(key:string)=>({
  data:key===mockOwner+':'+mockReservationId?mockReservation:key===mockFacilityId?mockFacility:key.includes(':visit-create-attempt')?mockAttempt:
    key.includes(':availability:')?{timeZone:'Asia/Ho_Chi_Minh',slotDurationMinutes:60,capacityBasis:'STAFF',staffAssignmentRequired:true,reservationScopeAvailable:true,slots:[mockSlot]}:
    key.includes(':activity-visits:')?mockRows:key.includes(':activity-sessions:')?[]:null,
  loading:false,error:undefined,httpStatus:undefined,reload:jest.fn(),
}),ResourceState:()=>null}));
jest.mock('../src/api/managedReservationReads',()=>({
  managedReservationReads:{createVisit:(...args:unknown[])=>mockCreate(...args),visits:(...args:unknown[])=>mockListVisits(...args),
    visitAvailability:jest.fn(),amendVisit:jest.fn(),cancelVisit:jest.fn()},
}));
jest.mock('../src/state/attemptJournal',()=>({
  journal:async()=>({read:async()=>mockAttempt,claim:async(value:unknown)=>{if(mockAttempt)return false;mockAttempt=value;return true;},clear:async()=>{mockAttempt=null;}}),
  newAttempt:()=>({key:'wdp-mobile-12345678-1234-4abc-9abc-123456789abc'}),
}));

beforeEach(()=>{
  cleanup();
  mockRows=[];mockAttempt=null;mockResolveCreate=undefined;mockReplace.mockClear();mockBack.mockClear();mockPush.mockClear();mockCreate.mockReset();mockListVisits.mockReset();mockListVisits.mockImplementation(async()=>mockRows);
  dismissVisitSuccessFeedback(mockReservationId);
});
afterEach(()=>cleanup());

async function selectSlotAndSubmit(){
  await render(<ManagedVisitForm/>);
  await fireEvent.press(screen.getByRole('button',{name:/09:00/}));
  await fireEvent.press(screen.getByRole('button',{name:'Xác nhận đặt lịch'}));
}

it('confirmed create replaces the form, publishes a success toast and does not claim the list synced before it is read',async()=>{
  mockCreate.mockImplementation(async()=>mockCreatedVisit);mockRows=[];
  await selectSlotAndSubmit();
  await waitFor(()=>expect(mockReplace).toHaveBeenCalledWith(`/managed/reservations/${mockReservationId}/visits`));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(getVisitSuccessFeedback()).toEqual({reservationId:mockReservationId,visitId:mockVisitId});
  expect(getToast()?.message).toBe('Đặt lịch đến kho thành công');
  const activity=await render(<ManagedVisitActivityScreen/>);
  expect(screen.getByText('Danh sách chưa hiển thị lịch vừa đặt. Bạn có thể tải lại để kiểm tra.')).toBeTruthy();
  expect(screen.queryByText(/đồng bộ từ Backend/)).toBeNull();
  expect(screen.queryByText('Chưa có lịch đến kho')).toBeNull();
  mockRows=[mockCreatedVisit];
  await activity.rerender(<ManagedVisitActivityScreen/>);
  expect(screen.queryByText('Danh sách chưa hiển thị lịch vừa đặt. Bạn có thể tải lại để kiểm tra.')).toBeNull();
  expect(screen.queryByText(/đồng bộ từ Backend/)).toBeNull();
  if(getToast())dismissToast(getToast()!.id);
});

it('blocks a rapid double press and displays an in-progress label',async()=>{
  mockCreate.mockImplementation(()=>new Promise(resolve=>{mockResolveCreate=resolve;}));
  await render(<ManagedVisitForm/>);
  await fireEvent.press(screen.getByRole('button',{name:/09:00/}));
  const submit=screen.getByRole('button',{name:'Xác nhận đặt lịch'});
  await fireEvent.press(submit);await fireEvent.press(submit);
  await waitFor(()=>expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Đang đặt lịch...')).toBeTruthy();
  mockResolveCreate?.(mockCreatedVisit);
  await waitFor(()=>expect(mockReplace).toHaveBeenCalledTimes(1));
});

it('known API validation/conflict failure stays on the form and never announces success',async()=>{
  mockCreate.mockImplementation(async()=>{
    const config={url:'/access/managed-v3/visits',method:'post' as const,headers:new axios.AxiosHeaders()};
    throw new axios.AxiosError('Conflict','ERR_BAD_REQUEST',config,undefined,{status:409,statusText:'Conflict',headers:new axios.AxiosHeaders(),config,data:{code:'VISIT_SLOT_UNAVAILABLE'}});
  });
  await selectSlotAndSubmit();
  expect(await screen.findByText('Khung giờ vừa hết hoặc đã có xung đột. Hãy tải lại và chọn khung giờ khác.')).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(getVisitSuccessFeedback()).toBeNull();
  expect(screen.getByRole('button',{name:'Xác nhận đặt lịch'}).props.accessibilityState.disabled).toBe(false);
});

it('403 access failure is explicit, stays on the form and re-enables confirmation',async()=>{
  mockCreate.mockImplementation(async()=>{
    const config={url:'/access/managed-v3/visits',method:'post' as const,headers:new axios.AxiosHeaders()};
    throw new axios.AxiosError('Forbidden','ERR_BAD_REQUEST',config,undefined,{status:403,statusText:'Forbidden',headers:new axios.AxiosHeaders(),config,data:{code:'ROLE_DENIED'}});
  });
  await selectSlotAndSubmit();
  expect(await screen.findByText('Tài khoản không có quyền đặt lịch cho Reservation này.')).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(getVisitSuccessFeedback()).toBeNull();
  expect(screen.getByRole('button',{name:'Xác nhận đặt lịch'}).props.accessibilityState.disabled).toBe(false);
});

it('timeout checks the Backend list first and does not automatically submit a second time',async()=>{
  mockCreate.mockImplementation(async()=>{throw new axios.AxiosError('timeout','ECONNABORTED');});
  mockRows=[];
  await selectSlotAndSubmit();
  await waitFor(()=>expect(mockListVisits).toHaveBeenCalledTimes(1));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Chưa tìm thấy lịch khớp\. Yêu cầu cũ vẫn được giữ nguyên/)).toBeTruthy();
  expect(screen.getByRole('button',{name:'Gửi lại đúng yêu cầu đã lưu'})).toBeTruthy();
  expect(getVisitSuccessFeedback()).toBeNull();
});

it('timeout followed by an exact Backend Visit match navigates as confirmed without another POST',async()=>{
  mockCreate.mockImplementation(async()=>{throw new axios.AxiosError('timeout','ECONNABORTED');});
  mockRows=[mockCreatedVisit];
  await selectSlotAndSubmit();
  await waitFor(()=>expect(mockReplace).toHaveBeenCalledWith(`/managed/reservations/${mockReservationId}/visits`));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(getVisitSuccessFeedback()).toEqual({reservationId:mockReservationId,visitId:mockVisitId});
});
