import {fireEvent,render,screen} from '@testing-library/react-native';
import {Login,Register} from '../src/screens/LiveAccount';

const mockLogin=jest.fn(),mockRestore=jest.fn();
let mockRestoreFailed=false;
jest.mock('expo-router',()=>({useRouter:()=>({}),useLocalSearchParams:()=>({})}));
jest.mock('../src/state/useLiveSession',()=>({
  useLiveSession:(select:(state:unknown)=>unknown)=>select({
    login:mockLogin,restore:mockRestore,restoreFailed:mockRestoreFailed,
  }),
}));
jest.mock('../src/components/liveUI',()=>{
  const React=jest.requireActual<typeof import('react')>('react');
  const {View}=jest.requireActual<typeof import('react-native')>('react-native');
  return {LiveScreen:({children}:import('react').PropsWithChildren)=>{
    React.Children.forEach(children,child=>{
      expect(['string','number']).not.toContain(typeof child);
    });
    return React.createElement(View,null,children);
  }};
});

test('Login mounts and remounts without raw text and still displays login errors',async()=>{
  mockLogin.mockRejectedValueOnce(new Error('Fixture login failure'));
  const view=await render(<Login/>);
  expect(screen.queryByText('Đăng nhập chưa thành công')).toBeNull();
  await fireEvent.press(screen.getByRole('button',{name:'Đăng nhập'}));
  expect(await screen.findByText('Đăng nhập chưa thành công')).toBeTruthy();
  await view.unmount();
  await render(<Login/>);
  expect(screen.queryByText('Đăng nhập chưa thành công')).toBeNull();
});

test('Login can retry session restoration without emitting raw text',async()=>{
  mockRestoreFailed=true;
  try{
    await render(<Login/>);
    expect(screen.getByText('Chưa xác minh được phiên đã lưu')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button',{name:'Thử lại'}));
    expect(mockRestore).toHaveBeenCalledTimes(1);
  }finally{
    mockRestoreFailed=false;
  }
});

test('Register has no raw text before validation and still displays a validation error',async()=>{
  await render(<Register/>);
  expect(screen.queryByText('Chưa thể tạo tài khoản')).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Mật khẩu'),'Fixture123!');
  await fireEvent.press(screen.getByRole('button',{name:'Tạo tài khoản'}));
  expect(await screen.findByText('Chưa thể tạo tài khoản')).toBeTruthy();
});
