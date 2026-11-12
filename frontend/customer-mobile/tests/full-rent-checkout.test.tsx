import {act,fireEvent,render,screen} from '@testing-library/react-native';
import {AppState,Linking,type AppStateStatus} from 'react-native';
import {FullRentCheckout} from '../src/components/FullRentCheckout';
import {paymentDto} from '../src/api/contracts/documents';

const checkoutUrl='https://pay.payos.vn/web/fixture';
const payment=paymentDto.parse({
  id:'1'.repeat(24),reservationId:'2'.repeat(24),purpose:'FULL_RENT',amount:50000,currency:'VND',provider:'PAYOS',
  providerSettlementStatus:'NOT_VERIFIED',status:'PENDING',applicationStatus:'NOT_APPLIED',checkoutStatus:'READY',
  checkoutUrl,qrCode:'00020101021229370016A0000006770101110113006688123456785204581253037045802VN6304ABCD',
  transferDetails:{bin:'970436',accountNumber:'00001234',accountName:'Fixture',description:'FIXTURE'},
  succeededAt:null,reconciliationRequired:false
});

afterEach(()=>jest.restoreAllMocks());

test('VietQR and the hosted action render for the same intent and suppress a double tap',async()=>{
  let release!: ()=>void;
  const open=jest.spyOn(Linking,'openURL').mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));
  await render(<FullRentCheckout payment={payment} url={checkoutUrl}/>);
  expect(screen.getByLabelText('Mã VietQR do PayOS cung cấp')).toBeTruthy();
  expect(screen.getByText('Số tài khoản: 00001234')).toBeTruthy();
  const button=screen.getByRole('button',{name:'Mở trang PayOS'});
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(checkoutUrl);
  await act(async()=>release());
});

test('unverified checkout URL cannot open',async()=>{
  const open=jest.spyOn(Linking,'openURL').mockResolvedValue(undefined);
  const url='https://pay.payos.vn.evil.invalid/web/fixture';
  await render(<FullRentCheckout payment={{...payment,checkoutUrl:url}} url={url}/>);
  expect(screen.queryByRole('button',{name:'Mở trang PayOS'})).toBeNull();
  expect(open).not.toHaveBeenCalled();
});

test('foreground reconciliation reuses the outstanding intent and limits duplicate checks',async()=>{
  const reservation={_id:payment.reservationId,customerId:'3'.repeat(24),status:'CONTRACTED',
    rentalPaymentFlow:'FULL_UPFRONT_V1',reservationCode:'FIXTURE',serviceType:'SELF_STORAGE'};
  const reload=jest.fn(), reconcilePayment=jest.fn().mockResolvedValue({...payment,status:'CANCELLED',checkoutStatus:'CANCELLED'});
  let foreground: ((status: AppStateStatus)=>void)|undefined;
  const remove=jest.fn();
  jest.spyOn(AppState,'addEventListener').mockImplementation((_name, listener)=>{foreground=listener;return {remove};});
  const replace=jest.fn();
  jest.doMock('expo-router',()=>({useRouter:()=>({replace}),useLocalSearchParams:()=>({id:payment.reservationId})}));
  jest.doMock('../src/state/useLiveSession',()=>{
    const state={user:{_id:reservation.customerId}};
    return {useLiveSession:Object.assign((selector:(state:unknown)=>unknown)=>selector(state),{getState:()=>state})};
  });
  jest.doMock('../src/api/mobileRepository',()=>({mobileRepo:{reconcilePayment}}));
  jest.doMock('../src/api/selfStoragePayment',()=>({}));
  jest.doMock('../src/components/liveUI',()=>({
    ...jest.requireActual('../src/components/liveUI'),
    LiveScreen:({children}:React.PropsWithChildren)=>children,
    useResource:()=>({reload,data:{reservation,payments:[payment],contract:null,decision:{kind:'INELIGIBLE'},
      balanceDecision:{kind:'INELIGIBLE'},fullRentDecision:{kind:'READY',payment,url:checkoutUrl}}}),
  }));
  const {Payment}=require('../src/screens/LiveRental') as typeof import('../src/screens/LiveRental');
  const view=await render(<Payment/>);
  expect(foreground).toBeDefined();
  await act(async()=>{foreground?.('background'); foreground?.('active'); foreground?.('active');});
  expect(reconcilePayment).toHaveBeenCalledTimes(1);
  expect(reconcilePayment).toHaveBeenCalledWith(reservation,payment.id,reservation.customerId);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button',{name:'Mở trang PayOS'})).toBeNull();
  expect(replace).not.toHaveBeenCalled();
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});
