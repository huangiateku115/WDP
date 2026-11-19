import {fireEvent,render,screen} from '@testing-library/react-native';
import {ManagedSkuStockPanel} from '../src/components/ManagedSkuStockPanel';
import {useResource} from '../src/components/liveUI';

jest.mock('expo-router',()=>({useRouter:()=>({push:jest.fn()})}));
jest.mock('../src/components/liveUI',()=>({
  useResource:(key:string)=>{
    if(key.includes('stock-reservation'))return {data:{_id:'3'.repeat(24),bookingFlowVersion:3},reload:jest.fn()};
    if(key.includes('sku-stock'))return {data:{kind:'V3',stock:mockStock},reload:jest.fn()};
    if(key.includes('sku-cell-stock'))return {data:mockCellStock,reload:jest.fn()};
    if(key.includes('sku-cell-labels'))return {data:{},reload:jest.fn()};
    return {data:null,reload:jest.fn()};
  },ResourceState:()=>null,
}));

const owner='1'.repeat(24),skuId='2'.repeat(24),reservationId='3'.repeat(24),facilityId='4'.repeat(24),specId='5'.repeat(24),cellId='6'.repeat(24);
const item={_id:skuId,customerId:owner,facilityId,managedReservationId:reservationId,inventorySchemaVersion:3,status:'ACTIVE'} as never;
let mockStock:any,mockCellStock:any;

beforeEach(()=>{
  mockStock={skuId,reservationId,facilityId,totalQuantity:1,totalWeightKg:20,totalVolumeM3:.008,reconciliationStatus:'CHECKING',
    itemSpecifications:[{itemSpecId:specId,code:'HKT01',name:'Hộp giấy',quantityUnit:'kiện',quantityOnHand:1,quantityHeld:0,quantityAvailable:1,
      totalWeightKg:20,totalVolumeM3:.008,byCell:[{cellId,quantityOnHand:1,quantityHeld:0,quantityAvailable:1,weightKg:20,volumeM3:.008}]}],
    byCell:[{cellId,quantityOnHand:1,quantityHeld:0,quantityAvailable:1,weightKg:20,volumeM3:.008}]};
  mockCellStock={...mockStock};
});

it('does not render CHECKING totals or placements as verified stock',async()=>{
  await render(<ManagedSkuStockPanel item={item} owner={owner} reservation={{_id:reservationId,bookingFlowVersion:3} as never}/>);
  expect(screen.getByText('Thông tin tồn kho đang được kiểm tra; số lượng chưa được xác minh.')).toBeTruthy();
  expect(screen.queryByText(/20 kg|0\.008 m³/)).toBeNull();
  await fireEvent.press(screen.getByRole('button',{name:'Xem tồn theo loại hàng và vị trí'}));
  expect(screen.getByText('Số liệu theo loại hàng và vị trí chưa được xác minh.')).toBeTruthy();
  expect(screen.queryByText(/HKT01|kiện|20 kg|0\.008 m³/)).toBeNull();
});

it('uses a known Cell ID while its human-readable location label is unavailable',async()=>{
  mockStock={...mockStock,reconciliationStatus:'VERIFIED'};
  mockCellStock={...mockCellStock,reconciliationStatus:'VERIFIED'};
  await render(<ManagedSkuStockPanel item={item} owner={owner} reservation={{_id:reservationId,bookingFlowVersion:3} as never}/>);
  await fireEvent.press(screen.getByRole('button',{name:'Xem tồn theo loại hàng và vị trí'}));
  expect(screen.getAllByText(`Ô ${cellId.slice(-6)}`,{exact:false}).length).toBeGreaterThan(0);
  expect(screen.queryByText('Vị trí chưa xác định')).toBeNull();
});
