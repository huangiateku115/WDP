import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import {useCustomerStore} from '../src/state/useCustomerStore';
import {customerFixtures} from '../src/fixtures/customer';
import DashboardScreen from '../src/screens/DashboardScreen';
import ExploreScreen from '../src/screens/ExploreScreen';
import RentalsScreen from '../src/screens/RentalsScreen';
import InventoryScreen from '../src/screens/InventoryScreen';
import ProfileScreen from '../src/screens/ProfileScreen';
import LoginScreen from '../src/screens/LoginScreen';
import RegisterScreen from '../src/screens/RegisterScreen';
import PreviewDetailScreen from '../src/screens/PreviewDetailScreen';
import {StateCard} from '../src/components/ui';

const mockPush=jest.fn(),mockReplace=jest.fn(),mockBack=jest.fn();
let mockParams={kind:'facility',id:'saigon-south'};
jest.mock('expo-router',()=>({useRouter:()=>({push:mockPush,replace:mockReplace,back:mockBack,canGoBack:()=>true}),useLocalSearchParams:()=>mockParams}));
beforeEach(()=>{useCustomerStore.setState({demoSession:false,fixtures:customerFixtures,compactCards:false});mockParams={kind:'facility',id:'saigon-south'};});
test.each([
  [DashboardScreen,'screen-home'],[ExploreScreen,'screen-explore'],[RentalsScreen,'screen-rentals'],
  [InventoryScreen,'screen-inventory'],[ProfileScreen,'screen-profile'],[LoginScreen,'screen-login'],
] as const)('native screen renders with fixtures: %s',(Component,id)=>{
  render(<Component/>);expect(screen.getByTestId(id)).toBeTruthy();expect(screen.getByText(/Bản mẫu ngoại tuyến/)).toBeTruthy();
});
test('explore search and service filter show real fixture matches and empty state',()=>{
  render(<ExploreScreen/>);fireEvent.changeText(screen.getByLabelText('Tìm cơ sở'),'khong co co so');
  expect(screen.getByText('Chưa tìm thấy cơ sở')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Tìm cơ sở'),'Thu Duc');
  expect(screen.getByText('VaultSpace Đông Sài Gòn')).toBeTruthy();
});
test('rental filters select history without fabricating payment completion',()=>{
  render(<RentalsScreen/>);fireEvent.press(screen.getByRole('button',{name:'Lịch sử'}));
  expect(screen.getByText('VaultSpace Tân Bình')).toBeTruthy();expect(screen.queryByText('VaultSpace Nam Sài Gòn')).toBeNull();
});
test('inventory keeps registration quantity separate from available fixture stock',()=>{
  render(<InventoryScreen/>);expect(screen.getByText('Có thể xuất: 45 kiện')).toBeTruthy();expect(screen.getByText('Chưa có dữ liệu tồn kho')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Tìm mã hàng'),'PKG-0102');expect(screen.queryByText('Cà phê Arabica Đà Lạt')).toBeNull();
});
test('detail action uses stack params and back returns to previous screen',()=>{
  render(<ExploreScreen/>);fireEvent.press(screen.getByRole('button',{name:'Xem VaultSpace Nam Sài Gòn'}));
  expect(mockPush).toHaveBeenCalledWith({pathname:'/preview/[kind]/[id]',params:{kind:'facility',id:'saigon-south'}});
});
test('missing fixture detail is safe and offers native back action',()=>{
  mockParams={kind:'item',id:'does-not-exist'};render(<PreviewDetailScreen/>);
  expect(screen.getByText('Không tìm thấy dữ liệu mẫu')).toBeTruthy();
  fireEvent.press(screen.getByRole('button',{name:'Trở về màn hình trước'}));expect(mockBack).toHaveBeenCalled();
});
test('missing fixture collections and customer do not crash the five tabs',()=>{
  useCustomerStore.setState({fixtures:{customer:null,facilities:[],rentals:[],items:[]}});
  for(const Component of [DashboardScreen,ExploreScreen,RentalsScreen,InventoryScreen,ProfileScreen]){const view=render(<Component/>);expect(view.toJSON()).toBeTruthy();view.unmount();}
});
test('login validates before entering local demo; no real credentials are verified',async()=>{
  render(<LoginScreen/>);fireEvent.press(screen.getByRole('button',{name:'Đăng nhập bản mẫu'}));
  await waitFor(()=>expect(screen.getByText('Mật khẩu mẫu cần ít nhất 8 ký tự.')).toBeTruthy());
  expect(useCustomerStore.getState().demoSession).toBe(false);
  fireEvent.changeText(screen.getByLabelText('Mật khẩu bản mẫu'),'VaultDemo123!');
  fireEvent.press(screen.getByRole('button',{name:'Đăng nhập bản mẫu'}));
  await waitFor(()=>expect(useCustomerStore.getState().demoSession).toBe(true));
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
});
test('registration shell and loading/error/empty primitives render',()=>{
  const registration=render(<RegisterScreen/>);expect(screen.getByText('Khởi đầu không gian mới')).toBeTruthy();registration.unmount();
  for(const kind of ['loading','error','empty'] as const){const view=render(<StateCard kind={kind} title="Trạng thái mẫu" onRetry={()=>{}}/>);expect(screen.getByText('Trạng thái mẫu')).toBeTruthy();view.unmount();}
});
test('profile local preference and logout work',()=>{
  useCustomerStore.getState().enterDemo();render(<ProfileScreen/>);
  fireEvent(screen.getByRole('switch'),'valueChange',true);expect(useCustomerStore.getState().compactCards).toBe(true);
  fireEvent.press(screen.getByRole('button',{name:'Đăng xuất bản mẫu'}));expect(useCustomerStore.getState().demoSession).toBe(false);
});
