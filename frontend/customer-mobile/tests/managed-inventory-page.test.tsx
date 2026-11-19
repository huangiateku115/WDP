import {fireEvent,render,screen} from '@testing-library/react-native';
import {InventoryOverview,ReservationInventoryDetail} from '../src/screens/ManagedDashboard';
import InventoryOverviewRoute from '../app/(tabs)/inventory';
import ReservationInventoryRoute from '../app/(tabs)/inventory/managed/[reservationId]';
import {mobileRepo} from '../src/api/mobileRepository';

const mockOwnerId='1'.repeat(24),mockReservationId='3'.repeat(24),mockFacilityId='2'.repeat(24),mockSkuId='6'.repeat(24);
const mockRouter={push:jest.fn(),back:jest.fn(),replace:jest.fn()};
const mockParams:{reservationId?:string;facilityId?:string}={};
const mockText=require('react-native').Text;
const mockReact=require('react');
const mockInventoryData={reservation:{_id:mockReservationId,reservationCode:'MI-001',customerId:mockOwnerId,facilityId:mockFacilityId,
  serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',startDate:'2026-01-01T00:00:00.000Z',endDate:'2027-01-01T00:00:00.000Z'},
  items:[{_id:mockSkuId,customerId:mockOwnerId,managedReservationId:mockReservationId,facilityId:mockFacilityId,
    inventorySchemaVersion:3,itemCode:'BOX-PAPER',name:'Hộp giấy',status:'ACTIVE'}],pagination:{page:1,limit:100,total:1,totalPages:1}};
const mockApi=mobileRepo as jest.Mocked<typeof mobileRepo>;

jest.mock('expo-router',()=>({useRouter:()=>mockRouter,useLocalSearchParams:()=>mockParams}));
jest.mock('../src/state/useLiveSession',()=>({useLiveSession:(selector:(state:unknown)=>unknown)=>selector({user:{_id:mockOwnerId}})}));
jest.mock('../src/api/mobileRepository',()=>({mobileRepo:{rentals:jest.fn(async()=>[]),inventoryForReservation:jest.fn(async()=>({
  reservation:{_id:'3'.repeat(24),reservationCode:'MI-001',customerId:'1'.repeat(24),facilityId:'2'.repeat(24),serviceType:'MANAGED_INVENTORY',
    bookingFlowVersion:3,status:'ACTIVE',startDate:'2026-01-01T00:00:00.000Z',endDate:'2027-01-01T00:00:00.000Z'},
  items:[{_id:'6'.repeat(24),customerId:'1'.repeat(24),managedReservationId:'3'.repeat(24),facilityId:'2'.repeat(24),inventorySchemaVersion:3,itemCode:'BOX-PAPER',name:'Hộp giấy',status:'ACTIVE'}],
  pagination:{page:1,limit:100,total:1,totalPages:1},
})),inventory:jest.fn(),inventoryMovements:jest.fn()}}));
jest.mock('../src/components/ManagedSkuStockPanel',()=>({ManagedSkuStockPanel:jest.fn(()=>null)}));
jest.mock('../src/components/liveUI',()=>({
  dateLabel:(value:string)=>value.slice(0,10),
  LiveScreen:({children,title,backButton}: {children:React.ReactNode;title?:string;backButton?:{onPress:()=>void;disabled?:boolean}})=>mockReact.createElement(mockReact.Fragment,null,
    mockReact.createElement(mockText,null,title),backButton&&mockReact.createElement(require('../src/components/CustomerBackButton').CustomerBackButton,backButton),children),
  ResourceState:()=>null,
  useResource:(key:string,load:(signal:AbortSignal)=>Promise<unknown>)=>{
    if(key.includes('overview-no-inventory')){void load(new AbortController().signal);return {data:null,loading:false,reload:jest.fn()};}
    if(key.includes('managed-inventory-overview')){void load(new AbortController().signal);return {data:[],loading:false,reload:jest.fn()};}
    if(key.includes(':'+mockReservationId)){void load(new AbortController().signal);return {data:mockInventoryData,loading:false,reload:jest.fn()};}
    return {data:null,loading:false,reload:jest.fn()};
  },
}));

beforeEach(()=>{
  jest.clearAllMocks();
  mockParams.reservationId=mockReservationId;mockParams.facilityId=mockFacilityId;
});

it('shows the selected Reservation inventory page, provides a detail return, and skips overview/activity requests',async()=>{
  await render(<ReservationInventoryRoute/>);
  expect(screen.getByText('Danh mục hàng hóa của đơn thuê này')).toBeTruthy();
  expect(screen.getByText(/Mã hàng.*BOX-PAPER/)).toBeTruthy();
  expect(screen.queryByText('Hàng hóa đã đăng ký')).toBeNull();
  expect(screen.queryByText('Hoạt động gần đây')).toBeNull();
  expect(mockApi.inventoryForReservation).toHaveBeenCalledWith(mockOwnerId,mockReservationId,expect.anything(),mockFacilityId);
  expect(mockApi.inventoryForReservation).toHaveBeenCalledTimes(1);
  expect(mockApi.rentals).not.toHaveBeenCalled();
  expect(mockApi.inventoryMovements).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button',{name:'Quay lại'}));
  expect(mockRouter.replace).toHaveBeenCalledWith({pathname:'/managed/[facilityId]/confirmation',params:{facilityId:mockFacilityId,reservationId:mockReservationId}});
});

it('keeps the tab route on a short overview without SKU, stock, or movement requests',async()=>{
  const {ManagedSkuStockPanel}=jest.requireMock('../src/components/ManagedSkuStockPanel') as {ManagedSkuStockPanel:jest.Mock};
  await render(<InventoryOverviewRoute/>);
  expect(screen.getByText('Hàng hóa')).toBeTruthy();
  expect(screen.getByText('Bạn chưa có đơn kho ký gửi nào')).toBeTruthy();
  expect(screen.queryByText('Hàng hóa đã đăng ký')).toBeNull();
  expect(screen.queryByText('Hoạt động gần đây')).toBeNull();
  expect(ManagedSkuStockPanel).not.toHaveBeenCalled();
  expect(mockApi.inventory).not.toHaveBeenCalled();
  expect(mockApi.inventoryForReservation).not.toHaveBeenCalled();
  expect(mockApi.inventoryMovements).not.toHaveBeenCalled();
});

it('opens overview from the tab even when an old Reservation query is present',async()=>{
  mockParams.reservationId=mockReservationId;mockParams.facilityId=mockFacilityId;
  await render(<InventoryOverviewRoute/>);
  expect(screen.getByText('Bạn chưa có đơn kho ký gửi nào')).toBeTruthy();
  expect(screen.queryByText('Danh mục hàng hóa của đơn thuê này')).toBeNull();
  expect(mockApi.inventoryForReservation).not.toHaveBeenCalled();
});

it('returns a deep-linked Reservation page to its exact rental after loading its Facility',async()=>{
  mockParams.reservationId=mockReservationId;mockParams.facilityId=undefined;
  await render(<ReservationInventoryRoute/>);
  expect(mockApi.inventoryForReservation).toHaveBeenCalledWith(mockOwnerId,mockReservationId,expect.anything(),undefined);
  await fireEvent.press(screen.getByRole('button',{name:'Quay lại'}));
  expect(mockRouter.replace).toHaveBeenCalledWith({pathname:'/managed/[facilityId]/confirmation',params:{facilityId:mockFacilityId,reservationId:mockReservationId}});
  expect(mockRouter.back).not.toHaveBeenCalled();
});
