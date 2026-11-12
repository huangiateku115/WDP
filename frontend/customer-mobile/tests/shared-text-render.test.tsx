import {render,screen} from '@testing-library/react-native';
import {ScreenHeading} from '../src/components/livePresentation';
import {AppText,Input,Screen,SectionTitle,StateCard} from '../src/components/ui';

jest.mock('react-native/Libraries/Components/View/View',()=>{
  const React=jest.requireActual<typeof import('react')>('react');
  const actual=jest.requireActual('react-native/Libraries/Components/View/View');
  return {...actual,__esModule:true,default:({children,...props}:import('react-native').ViewProps)=>{
    React.Children.forEach(children,child=>{
      if(typeof child==='string'||typeof child==='number')throw new Error('Unexpected text node in View');
    });
    return React.createElement(actual.default,props,children);
  }};
});

test('shared components keep empty optional labels out of View',async()=>{
  await render(<Screen footer=""><ScreenHeading title="VaultSpace" eyebrow="" subtitle=""/>
    <Input label="Email" error=""/>
    <SectionTitle title="Đơn thuê" action="" onPress={jest.fn()}/>
    <StateCard title="Chưa có dữ liệu" description=""/>
  </Screen>);
  expect(screen.getByLabelText('Email')).toBeTruthy();
  expect(screen.getByText('Chưa có dữ liệu')).toBeTruthy();
});

test('shared components keep visible messages, actions and footer text',async()=>{
  await render(<Screen footer="Nội dung cuối trang"><Input label="Email" error="Email không hợp lệ"/>
    <SectionTitle title="Đơn thuê" action="Xem tất cả" onPress={jest.fn()}/>
    <StateCard title="Không tải được" description="Thử lại sau"/>
    <AppText>Nội dung chính</AppText>
  </Screen>);
  expect(screen.getByText('Email không hợp lệ')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Xem tất cả'})).toBeTruthy();
  expect(screen.getByText('Thử lại sau')).toBeTruthy();
  expect(screen.getByText('Nội dung cuối trang')).toBeTruthy();
});

