import {fireEvent,render,screen} from '@testing-library/react-native';
import React from 'react';
import {ManagedReservationOperations} from '../src/components/ManagedReservationOperations';
import {ManagedSkuEditor} from '../src/components/ManagedSkuEditor';

const mockRouterPush=jest.fn();
let mockVisitEligibilityDenied=false;
jest.mock('expo-router',()=>({useRouter:()=>({push:mockRouterPush})}));
jest.mock('../src/components/liveUI',()=>({useResource:(key:string)=>({
  data:key.includes('managed-sku-categories')?[{categoryId:'a'.repeat(24),id:'a'.repeat(24),code:'BOX',name:'Thùng hàng',sortOrder:1},{categoryId:'b'.repeat(24),id:'b'.repeat(24),code:'TEST',name:'Integration fixtures',sortOrder:2}]:key.includes('visit-eligibility')?(mockVisitEligibilityDenied?null:{timeZone:'Asia/Ho_Chi_Minh',slotDurationMinutes:30,capacityBasis:'FACILITY_STAFF',staffAssignmentRequired:true,slots:[]}):null,
  error:key==='1'.repeat(24)+':'+'3'.repeat(24)?'Read failed':key.includes('visit-eligibility')&&mockVisitEligibilityDenied?'Reservation not ready':undefined,
  httpStatus:key==='1'.repeat(24)+':'+'3'.repeat(24)?503:key.includes('visit-eligibility')&&mockVisitEligibilityDenied?409:undefined,loading:false,reload:jest.fn(),
}),ResourceState:()=>null}));
jest.mock('../src/state/useLiveSession',()=>{
  const hook=(selector:(value:{user:{_id:string}})=>unknown)=>selector({user:{_id:'1'.repeat(24)}});
  return {useLiveSession:Object.assign(hook,{getState:()=>({user:{_id:'1'.repeat(24)}})})};
});

const owner='1'.repeat(24),facilityId='2'.repeat(24),reservationId='3'.repeat(24);
const rental={_id:reservationId,customerId:owner,facilityId,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',startDate:new Date(Date.now()-86400000).toISOString(),endDate:new Date(Date.now()+86400000).toISOString(),reservationCode:'MIR-TEST'} as never;

it('Reservation Detail displays both visit actions and routes with the ObjectId',async()=>{
  mockVisitEligibilityDenied=false;
  mockRouterPush.mockClear();
  const view=await render(<ManagedReservationOperations r={rental} owner={owner}/>);
  expect(screen.getByRole('button',{name:'Đặt lịch đến kho'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Đặt lịch đến kho'}).props.accessibilityState.disabled).toBe(false);
  expect(screen.getByRole('button',{name:'Xem lịch và phiên truy cập'})).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'Đặt lịch đến kho'}));
  expect(mockRouterPush).toHaveBeenLastCalledWith({pathname:'/managed/reservations/[reservationId]/visits/new',params:{reservationId}});
  await fireEvent.press(screen.getByRole('button',{name:'Xem lịch và phiên truy cập'}));
  expect(mockRouterPush).toHaveBeenLastCalledWith(`/managed/reservations/${reservationId}/visits`);
  expect(screen.queryByText('Xem đánh giá kết thúc thuê')).toBeNull();
  view.unmount();
});

it('keeps booking visible but disabled with Backend reason when Reservation is ineligible',async()=>{
  mockVisitEligibilityDenied=true;
  const view=await render(<ManagedReservationOperations r={rental} owner={owner}/>);
  expect(screen.getByRole('button',{name:'Đặt lịch đến kho'}).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByText('Đơn thuê hiện chưa đủ điều kiện đặt lịch.')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Xem lịch và phiên truy cập'})).toBeTruthy();
  view.unmount();mockVisitEligibilityDenied=false;
});

it('SKU category picker filters API categories and preserves form values after selection',async()=>{
  const onSaved=jest.fn();
  await render(<ManagedSkuEditor r={rental} onSaved={onSaved}/>);
  await fireEvent.changeText(screen.getByLabelText('Mã SKU'),'BOX-01');
  await fireEvent.changeText(screen.getByLabelText('Tên SKU'),'Thùng giấy');
  await fireEvent.press(screen.getByRole('button',{name:'Chọn danh mục SKU'}));
  await fireEvent.changeText(screen.getByLabelText('Tìm danh mục'),'Thùng');
  expect(screen.getByText('Thùng hàng')).toBeTruthy();
  expect(screen.queryByText('Integration fixtures')).toBeNull();
  await fireEvent.press(screen.getByRole('button',{name:'Chọn Thùng hàng'}));
  expect(screen.getByText('Thùng hàng')).toBeTruthy();
  expect(screen.getByLabelText('Mã SKU').props.value).toBe('BOX-01');
  expect(screen.getByLabelText('Tên SKU').props.value).toBe('Thùng giấy');
  expect(screen.queryByText('Chọn danh mục')).toBeNull();
});

it('SKU form reports contract validation before any save request',async()=>{
  await render(<ManagedSkuEditor r={rental} onSaved={jest.fn()}/>);
  await fireEvent.press(screen.getByRole('button',{name:'Lưu SKU'}));
  expect(screen.getByText('Mã SKU bắt buộc, tối đa 48 ký tự; chỉ dùng chữ, số, dấu gạch ngang hoặc gạch dưới.')).toBeTruthy();
});
