import {render,screen} from '@testing-library/react-native';
import PayosPaymentReturn from '../src/screens/PayosPaymentReturn';

const mockReplace = jest.fn();
const mockReservationId = '1'.repeat(24);
const mockPaymentId = '2'.repeat(24);
jest.mock('expo-router',()=>({
  useRouter:()=>({replace:mockReplace}),
  useLocalSearchParams:()=>({reservationId:mockReservationId,paymentId:mockPaymentId,serviceType:'SELF_STORAGE',cancel:'true'}),
}));
jest.mock('../src/state/useLiveSession',()=>({
  useLiveSession:(select:(state:{user:null;restoring:boolean})=>unknown)=>select({user:null,restoring:false}),
}));
jest.mock('../src/components/liveUI',()=>({
  LiveScreen:({children}:React.PropsWithChildren)=>children,
  money:(amount:number)=>String(amount),
}));
jest.mock('../src/api/mobileRepository',()=>({mobileRepo:{}}));

test('native callback announces status without passing the invalid RCTText status role',async()=>{
  await render(<PayosPaymentReturn/>);
  const status=screen.getByText(/Chưa xác minh được trạng thái hủy/);
  expect(status.props.accessibilityLiveRegion).toBe('polite');
  expect(status.props.accessibilityRole).toBeUndefined();
  expect(mockReplace).toHaveBeenCalledWith({
    pathname:'/(auth)/login',
    params:{returnTo:'/payments/return?reservationId='+mockReservationId+'&paymentId='+mockPaymentId+'&serviceType=SELF_STORAGE&cancel=true'},
  });
});
