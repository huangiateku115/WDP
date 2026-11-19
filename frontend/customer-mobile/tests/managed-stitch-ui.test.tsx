import {render,screen} from '@testing-library/react-native';
import {ManagedFacilityVisual} from '../src/components/ManagedFacilityVisual';
import {WarehouseRack2D} from '../src/components/WarehouseRack2D';
import {warehouseRackLayout} from '../src/domain/warehouseRackLayout';
import type {ManagedRackLevel} from '../src/api/managedInventory';

test('Managed facility presentation renders only fields supplied by the facility record',async()=>{
  await render(<ManagedFacilityVisual facility={{_id:'a'.repeat(24),name:'Cơ sở thử nghiệm',
    address:{street:'Đường Kho',district:'Quận 7',city:'TP. Hồ Chí Minh'},
    description:'Thông tin mô tả từ Backend.'}} variant="detail"/>);

  expect(screen.getByText('Cơ sở thử nghiệm')).toBeTruthy();
  expect(screen.getByText('Đường Kho, Quận 7, TP. Hồ Chí Minh')).toBeTruthy();
  expect(screen.getByText('Thông tin mô tả từ Backend.')).toBeTruthy();
  expect(screen.queryByText(/°C|IoT|chứng nhận|bảo hiểm/i)).toBeNull();
});

test('2D cell tile shows Backend capacity/status and omits unsupported telemetry',async()=>{
  const cell={_id:'b'.repeat(24),code:'MI-R1-L1-C1',cellNumber:1,
    dimensions:{widthM:1,depthM:0.8,usableHeightM:1.2},operationalStatus:'AVAILABLE',periodStatus:'AVAILABLE',
    isBookable:true,physicalUsageKnown:true,usedWeightKg:0,usedVolumeM3:0,maxWeightKg:320,maxVolumeM3:1.25};
  const levels=[{levelNumber:1,cells:[cell]}] as ManagedRackLevel[];
  const layout=warehouseRackLayout(levels,1);
  await render(<WarehouseRack2D levels={levels} layout={layout} levelIndex={0} hasPeriod rackAvailable
    inspectedId="" selectedIds={new Set()} onInspect={jest.fn()}/>);

  expect(screen.getByText('MI-R1-L1-C1')).toBeTruthy();
  expect(screen.getByRole('button',{name:'MI-R1-L1-C1, Còn chỗ trong kỳ thuê'})).toBeTruthy();
  expect(screen.getByText('Tối đa 1.25 m³')).toBeTruthy();
  expect(screen.getByText('320 kg')).toBeTruthy();
  expect(screen.queryByText(/°C|IoT|cảm biến/i)).toBeNull();
});

test('redacted Cell capacity does not hide confirmed availability or expose utilization fields',async()=>{
  const cell={_id:'c'.repeat(24),code:'MI-R2-L3-C1',cellNumber:1,
    dimensions:{widthM:1,depthM:0.8,usableHeightM:1.2},operationalStatus:'AVAILABLE',periodStatus:'AVAILABLE',
    isBookable:true,capacityDisclosure:'REDACTED',physicalUsageKnown:true,usedWeightKg:500,usedVolumeM3:7,maxWeightKg:320,maxVolumeM3:1.25};
  const levels=[{levelNumber:3,cells:[cell]}] as ManagedRackLevel[];
  const layout=warehouseRackLayout(levels,1);
  await render(<WarehouseRack2D levels={levels} layout={layout} levelIndex={0} hasPeriod rackAvailable
    inspectedId="" selectedIds={new Set()} onInspect={jest.fn()}/>);

  expect(screen.getByRole('button',{name:'MI-R2-L3-C1, Còn chỗ trong kỳ thuê'})).toBeTruthy();
  expect(screen.queryByText(/Tối đa|kg|Đang dùng/)).toBeNull();
});
