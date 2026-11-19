import {fireEvent,render,screen} from '@testing-library/react-native';
import type {ReservationDto} from '../src/api/contracts/customer';
import {RentalCard} from '../src/screens/LiveRental';
import {Dashboard,Notifications} from '../src/screens/LiveAccount';
import {mobileRepo} from '../src/api/mobileRepository';

const mockPush=jest.fn();
const mockRentals:ReservationDto[]=[];
const mockUnread=2;
const mockNotificationId='999999999999999999999999';
const mockInbox:{items:Array<{_id:string;type:string;title:string;content:string;isRead:boolean;createdAt:string;destination:null}>;unread:number}={items:[],unread:0};
let mockResourceError:string|undefined;
let mockResourceHttpStatus:number|undefined;
let mockResourceLoading=false;
const mockReload=jest.fn();

jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush})}));
jest.mock('../src/screens/ManagedDashboard',()=>({InventoryOverview:()=>null}),{virtual:true});
jest.mock('../src/state/useLiveSession',()=>({
  useLiveSession:(select:(state:{user:{_id:string;displayName:string}})=>unknown)=>select({user:{_id:'111111111111111111111111',displayName:'Linh Nguyen'}}),
}));
jest.mock('../src/components/liveUI',()=>({
  ...jest.requireActual('../src/components/liveUI'),
  useResource:(key:string)=>key.startsWith('rentals:')
    ?{data:mockRentals,loading:false,error:undefined,reload:mockReload}
    :{data:mockResourceLoading?undefined:mockInbox,loading:mockResourceLoading,error:mockResourceError,httpStatus:mockResourceHttpStatus,reload:mockReload},
}));

const rental=(input:Partial<ReservationDto>):ReservationDto=>({
  _id:'222222222222222222222222',reservationCode:'BKG-TEST-001',customerId:'111111111111111111111111',
  facilityId:{_id:'333333333333333333333333',name:'Cơ sở Quận 7'},storageUnitId:null,
  serviceType:'SELF_STORAGE',status:'ACTIVE',startDate:'2026-11-01T00:00:00.000Z',endDate:'2027-05-01T00:00:00.000Z',
  estimatedRent:12000000,...input,
});

test('Self Storage card shows available unit facts and a clear detail action',async()=>{
  const row=rental({storageUnitId:{_id:'444444444444444444444444',unitCode:'A-102',size:'SMALL',volumeM3:10}});
  await render(<RentalCard r={row}/>);
  expect(screen.getByText('Kho tự quản')).toBeTruthy();
  expect(screen.getByText('Cơ sở Quận 7')).toBeTruthy();
  expect(screen.getByText('A-102')).toBeTruthy();
  expect(screen.getByText('Kích thước Nhỏ')).toBeTruthy();
  expect(screen.getByText('Thể tích 10 m³')).toBeTruthy();
  expect(screen.getByText(/Tổng tiền thuê/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'Xem chi tiết'}));
  expect(mockPush).toHaveBeenCalledWith({pathname:'/preview/[kind]/[id]',params:{kind:'rental',id:row._id}});
  expect(screen.queryByRole('button',{name:/PIN/i})).toBeNull();
});

test('Managed Inventory card shows allocated cell count without inferring hidden capacity',async()=>{
  const row=rental({serviceType:'MANAGED_INVENTORY',storageUnitId:null,allocatedCellIds:['555555555555555555555555','666666666666666666666666']});
  await render(<RentalCard r={row}/>);
  expect(screen.getByText('Kho ký gửi')).toBeTruthy();
  expect(screen.getByText('2')).toBeTruthy();
  expect(screen.getByText('Số ô được phân bổ')).toBeTruthy();
  expect(screen.queryByText(/Dung tích|Đã sử dụng/)).toBeNull();
});

test('paid Self Storage card shows verified facility and Backend deadline with a live countdown',async()=>{
  const deadline=new Date(Date.now()+2*24*60*60*1000).toISOString();
  const row=rental({status:'PAID',rentalPaymentFlow:'FULL_UPFRONT_V1',signingDeadline:deadline});
  await render(<RentalCard r={row}/>);
  expect(screen.getByText('Cần đến cơ sở ký hợp đồng')).toBeTruthy();
  expect(screen.getByText('Cơ sở: Cơ sở Quận 7')).toBeTruthy();
  expect(screen.getByText(/Hạn chót ký:/)).toBeTruthy();
  expect(screen.getByText(/Còn/)).toBeTruthy();
});

test('expired signing deadline warns without claiming cancellation',async()=>{
  const row=rental({status:'PAID',rentalPaymentFlow:'FULL_UPFRONT_V1',signingDeadline:'2020-01-01T00:00:00.000Z'});
  await render(<RentalCard r={row}/>);
  expect(screen.getByText(/Hạn chót ký đã qua/)).toBeTruthy();
  expect(screen.queryByText(/đơn thuê đã hủy/i)).toBeNull();
});

test('Live home shows rental overview, unread badge, recent rentals and view all navigation',async()=>{
  mockInbox.items=[];mockInbox.unread=mockUnread;mockResourceError=undefined;mockResourceHttpStatus=undefined;
  mockResourceLoading=false;
  mockRentals.splice(0,mockRentals.length,
    rental({}),
    rental({_id:'777777777777777777777777',reservationCode:'MIR-TEST-002',serviceType:'MANAGED_INVENTORY',storageUnitId:null,
      allocatedCellIds:['888888888888888888888888'],endDate:'2026-12-01T00:00:00.000Z'}),
  );
  await render(<Dashboard/>);
  expect(screen.getByText('Xin chào, Linh')).toBeTruthy();
  expect(screen.getByText('Tổng quan thuê kho')).toBeTruthy();
  expect(screen.getByText('Đơn thuê của bạn')).toBeTruthy();
  expect(screen.getByText('BKG-TEST-001')).toBeTruthy();
  expect(screen.getByText('MIR-TEST-002')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Mở thông báo, 2 chưa đọc'})).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'Xem tất cả'}));
  expect(mockPush).toHaveBeenCalledWith('/(tabs)/rentals');
});

test('Notifications distinguishes an actual empty response from an API error',async()=>{
  mockInbox.items=[];mockResourceError=undefined;mockResourceHttpStatus=undefined;mockResourceLoading=false;
  await render(<Notifications/>);
  expect(screen.getByText('Chưa có thông báo')).toBeTruthy();
  expect(screen.queryByText('Chưa thể tải thông báo')).toBeNull();
});

test('Notifications shows an authorization error instead of an empty state',async()=>{
  mockInbox.items=[];mockResourceError='Tài khoản không có quyền thực hiện thao tác này.';mockResourceHttpStatus=403;mockResourceLoading=false;
  await render(<Notifications/>);
  expect(screen.getByText('Bạn không có quyền xem thông báo này')).toBeTruthy();
  expect(screen.queryByText('Chưa có thông báo')).toBeNull();
  mockResourceError=undefined;mockResourceHttpStatus=undefined;
});

test('Notifications distinguishes loading and network failure from a real empty inbox',async()=>{
  mockInbox.items=[];mockResourceError=undefined;mockResourceHttpStatus=undefined;mockResourceLoading=true;
  const view=await render(<Notifications/>);
  expect(screen.getByText('Đang tải thông báo')).toBeTruthy();
  expect(screen.queryByText('Chưa có thông báo')).toBeNull();
  await view.unmount();
  mockResourceLoading=false;mockResourceError='Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.';
  await render(<Notifications/>);
  expect(screen.getByText('Không thể kết nối')).toBeTruthy();
  expect(screen.queryByText('Chưa có thông báo')).toBeNull();
  mockResourceError=undefined;
});

test('Notifications renders unread payment event and marks it read through the owner-scoped service',async()=>{
  mockResourceError=undefined;mockResourceHttpStatus=undefined;mockReload.mockClear();
  mockInbox.items=[{_id:mockNotificationId,type:'PAYMENT_CONFIRMED',title:'Đã xác nhận thanh toán',
    content:'Khoản thanh toán cho đơn BKG-TEST-001 đã được xác nhận.',isRead:false,createdAt:'2026-11-19T00:00:00.000Z',destination:null}];
  mockInbox.unread=1;
  const read=jest.spyOn(mobileRepo,'readNotification').mockResolvedValue({_id:mockNotificationId,isRead:true});
  await render(<Notifications/>);
  expect(screen.getByText('Đã xác nhận thanh toán')).toBeTruthy();
  expect(screen.getByText(/BKG-TEST-001/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button',{name:'Đánh dấu đã đọc'}));
  expect(read).toHaveBeenCalledWith(mockNotificationId,'111111111111111111111111');
  expect(mockReload).toHaveBeenCalled();
  read.mockRestore();mockInbox.items=[];mockInbox.unread=0;
});
