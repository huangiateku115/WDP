import {render,screen} from '@testing-library/react-native';
import type {ReactNode} from 'react';
import {RentalDetail} from '../src/screens/LiveRental';

jest.mock('expo-router',()=>({useRouter:()=>({push:jest.fn()})}));
jest.mock('../src/state/useLiveSession',()=>({
  useLiveSession:(select:(state:{user:{_id:string}})=>unknown)=>select({user:{_id:'customer'}}),
}));
jest.mock('../src/components/liveUI',()=>({
  ...jest.requireActual('../src/components/liveUI'),
  LiveScreen:({children}:{children:ReactNode})=><>{children}</>,
  useResource:(key:string)=>({reload:jest.fn(),data:{
    _id:key.split(':')[1],customerId:'customer',reservationCode:key,
    facilityId:'facility',serviceType:'SELF_STORAGE',status:'ACTIVE',
    startDate:'2026-11-12T00:00:00Z',endDate:'2026-12-12T00:00:00Z',
    groups:[],decision:{kind:'INELIGIBLE'},payments:[],contract:null,
  }}),
}));

test('checkout and progress keep distinct sibling keys across refresh and rental switches',async()=>{
  const consoleError=jest.spyOn(console,'error');
  try {
    const view=await render(<RentalDetail id="first"/>);
    expect(screen.getByText('customer:first')).toBeTruthy();
    await view.rerender(<RentalDetail id="first"/>);
    await view.rerender(<RentalDetail id="second"/>);
    expect(screen.getByText('customer:second')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Yêu cầu trả kho'})).toBeTruthy();
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key/i);
  } finally {
    consoleError.mockRestore();
  }
});

