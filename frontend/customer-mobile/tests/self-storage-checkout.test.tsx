import {fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import type {ReservationDto} from '../src/api/contracts/customer';
import {SelfStorageCheckoutRequest,selfStorageCheckoutReason} from '../src/components/SelfStorageCheckoutRequest';

jest.mock('../src/components/ui',()=>{
  const actual=jest.requireActual('../src/components/ui');
  const React=jest.requireActual<typeof import('react')>('react');
  return {...actual,Card:(props:import('react').ComponentProps<typeof actual.Card>)=>{
    for(const child of React.Children.toArray(props.children)){
      expect(['string','number']).not.toContain(typeof child);
    }
    return React.createElement(actual.Card,props);
  }};
});

const mockOwner='1'.repeat(24),id='2'.repeat(24);
const mockRental=jest.fn(),mockRequest=jest.fn();
jest.mock('../src/api/mobileRepository',()=>({mobileRepo:{rental:(...args:unknown[])=>mockRental(...args),requestSelfStorageCheckout:(...args:unknown[])=>mockRequest(...args)}}));
jest.mock('../src/state/useLiveSession',()=>({useLiveSession:{getState:()=>({user:{_id:mockOwner}})}}));
jest.mock('../src/components/liveUI',()=>({
  dateLabel:(date:string)=>date,ResourceState:()=>null,
  useResource:()=>({data:{version:'2.1',groups:[{id:'P07',sections:{SELF_STORAGE:['Chính sách fixture']}}]}}),
}));
const r:ReservationDto={_id:id,customerId:mockOwner,facilityId:'3'.repeat(24),reservationCode:'TEST',
  serviceType:'SELF_STORAGE',status:'ACTIVE',startDate:'2099-01-01T00:00:00Z',endDate:'2099-02-01T00:00:00Z'};
const checkoutRequest={status:'PENDING' as const,requestedAt:'2099-01-10T00:00:00Z'};

test('checkout confirmation sends one request and waits for authoritative completion',async()=>{
  const reload=jest.fn();
  mockRental.mockResolvedValue(r);
  mockRequest.mockResolvedValue({...r,checkoutRequest});
  const view=await render(<SelfStorageCheckoutRequest rental={r} owner={mockOwner} id={id} reload={reload}/>);
  await fireEvent.press(screen.getByRole('button',{name:'Yêu cầu trả kho'}));
  expect(screen.getByText('Chính sách fixture')).toBeTruthy();
  expect(mockRequest).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Ghi chú cho nhân viên'),'Kiểm tra kho');
  await fireEvent.press(screen.getByRole('button',{name:'Gửi yêu cầu trả kho'}));
  await waitFor(()=>expect(mockRequest).toHaveBeenCalledTimes(1));
  expect(mockRequest).toHaveBeenCalledWith(r,'Kiểm tra kho',mockOwner);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Đã trả kho')).toBeNull();
  await view.rerender(<SelfStorageCheckoutRequest rental={{...r,checkoutRequest}} owner={mockOwner} id={id} reload={reload}/>);
  expect(screen.getByText(/Chờ nhân viên nghiệm thu/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Yêu cầu trả kho'})).toBeNull();
  await view.rerender(<SelfStorageCheckoutRequest rental={{...r,status:'CHECKED_OUT'}} owner={mockOwner} id={id} reload={reload}/>);
  expect(screen.getByText('Đã trả kho')).toBeTruthy();
});

test('reject reason is only taken from Backend history after the current request',()=>{
  const row={...r,checkoutRequest:{...checkoutRequest,status:'CANCELLED' as const}};
  const reason='Staff từ chối yêu cầu trả kho: Cần dọn kho';
  expect(selfStorageCheckoutReason({...row,statusHistory:[{status:'ACTIVE',reason,createdAt:'2099-01-09T00:00:00Z'}]})).toBeUndefined();
  expect(selfStorageCheckoutReason({...row,statusHistory:[{status:'ACTIVE',reason,createdAt:'2099-01-11T00:00:00Z'}]})).toBe('Cần dọn kho');
});

test.each(['CONTRACTED','ACTIVE','OVERDUE','PENDING','CANCELLED','CHECKED_OUT'] as const)(
  'checkout renders without raw View text in %s',async state=>{
    const rental:ReservationDto=state==='PENDING'||state==='CANCELLED'
      ? {...r,checkoutRequest:{...checkoutRequest,status:state}}
      : {...r,status:state};
    const view=await render(<SelfStorageCheckoutRequest rental={rental} owner={mockOwner} id={id} reload={jest.fn()}/>);
    await view.rerender(<SelfStorageCheckoutRequest rental={{...rental}} owner={mockOwner} id={id} reload={jest.fn()}/>);
    if(state==='ACTIVE'||state==='OVERDUE'){
      mockRental.mockResolvedValueOnce(rental);
      mockRequest.mockRejectedValueOnce(new Error('Fixture failure'));
      await fireEvent.press(screen.getByRole('button',{name:'Yêu cầu trả kho'}));
      await fireEvent.press(screen.getByRole('button',{name:'Gửi yêu cầu trả kho'}));
      await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy());
    }
  },
);
