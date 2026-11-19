import {fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import type {ReactNode} from 'react';
import {Rentals} from '../src/screens/LiveRental';

const mockPush=jest.fn();
const mockRows=[
 {_id:'aaaaaaaaaaaaaaaaaaaaaaaa',reservationCode:'BKG-HCM-001',customerId:'customer',facilityId:{_id:'bbbbbbbbbbbbbbbbbbbbbbbb',name:'Cơ sở Hồ Chí Minh'},storageUnitId:{_id:'cccccccccccccccccccccccc',unitCode:'HCM3-U01'},serviceType:'SELF_STORAGE',status:'ACTIVE',startDate:'2026-01-01T00:00:00Z',endDate:'2027-01-01T00:00:00Z',createdAt:'2026-01-01T00:00:00Z'},
 {_id:'dddddddddddddddddddddddd',reservationCode:'BKG-DN-002',customerId:'customer',facilityId:{_id:'eeeeeeeeeeeeeeeeeeeeeeee',name:'Cơ sở Đà Nẵng'},storageUnitId:null,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'PAID',startDate:'2026-02-01T00:00:00Z',endDate:'2027-02-01T00:00:00Z',createdAt:'2026-02-01T00:00:00Z'},
];
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush})}));
jest.mock('../src/state/useLiveSession',()=>({useLiveSession:(select:(state:{user:{_id:string}})=>unknown)=>select({user:{_id:'customer'}})}));
jest.mock('../src/components/liveUI',()=>({
 ...jest.requireActual('../src/components/liveUI'),
 LiveScreen:({children}:{children:ReactNode})=><>{children}</>,
 useResource:()=>({data:mockRows,loading:false,refreshing:false,error:undefined,reload:jest.fn()}),
}));

test('search is accent-insensitive and clear restores list; quick service filter applies immediately',async()=>{
 await render(<Rentals/>);
 expect(screen.getByText('BKG-HCM-001')).toBeTruthy();expect(screen.getByText('BKG-DN-002')).toBeTruthy();
 fireEvent.changeText(screen.getByLabelText('Tìm mã đơn, cơ sở, mã kho'),'co so da nang');
 await waitFor(()=>expect(screen.queryByText('BKG-HCM-001')).toBeNull());expect(screen.getByText('BKG-DN-002')).toBeTruthy();
 fireEvent.press(screen.getByLabelText('Xóa tìm kiếm'));
 await waitFor(()=>expect(screen.getByText('BKG-HCM-001')).toBeTruthy());
 fireEvent.press(screen.getByRole('button',{name:'Kho ký gửi'}));
 await waitFor(()=>expect(screen.queryByText('BKG-HCM-001')).toBeNull());expect(screen.getByText('BKG-DN-002')).toBeTruthy();
});

