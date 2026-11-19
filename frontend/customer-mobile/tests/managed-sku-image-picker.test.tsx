import React from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import {ManagedSkuEditor} from '../src/components/ManagedSkuEditor';

const mockLaunchLibrary=jest.fn(),mockLaunchCamera=jest.fn(),mockUpload=jest.fn();
jest.mock('expo-image-picker',()=>({requestMediaLibraryPermissionsAsync:jest.fn(async()=>({granted:true})),requestCameraPermissionsAsync:jest.fn(async()=>({granted:true})),launchImageLibraryAsync:(...args:unknown[])=>mockLaunchLibrary(...args),launchCameraAsync:(...args:unknown[])=>mockLaunchCamera(...args)}));
jest.mock('../src/api/managedImageUploads',()=>({managedImageUploads:{upload:(...args:unknown[])=>mockUpload(...args),remove:jest.fn()},validateInventoryImageAsset:jest.fn()}));
jest.mock('../src/components/liveUI',()=>({
  useResource:(key:string)=>({data:key.includes('managed-sku-categories')?[{categoryId:'a'.repeat(24),id:'a'.repeat(24),code:'BOX',name:'Thùng hàng',sortOrder:1}]:null,error:undefined,loading:false,reload:jest.fn()}),
  ResourceState:()=>null,
}));
jest.mock('../src/state/useLiveSession',()=>{
  const current=()=>({user:{_id:'1'.repeat(24)}});const hook=(selector:(value:ReturnType<typeof current>)=>unknown)=>selector(current());
  return {useLiveSession:Object.assign(hook,{getState:current})};
});

const rental={_id:'3'.repeat(24),customerId:'1'.repeat(24),facilityId:'2'.repeat(24),serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',startDate:new Date(Date.now()-86400000).toISOString(),endDate:new Date(Date.now()+86400000).toISOString(),reservationCode:'MIR-IMAGE'} as never;
const asset={uri:'file:///camera/item.jpg',fileName:'item.jpg',mimeType:'image/jpeg',fileSize:512,width:800,height:600};
const uploaded={uploadId:'b'.repeat(24),publicId:'inventory/test',secureUrl:'https://images.example.test/item.jpg',format:'jpg',width:800,height:600,expiresAt:'2099-01-01T00:00:00.000Z'};

beforeEach(()=>{jest.clearAllMocks();mockLaunchLibrary.mockResolvedValue({canceled:false,assets:[asset]});mockUpload.mockResolvedValue(uploaded);});

it('previews the chosen image before upload and preserves SKU fields',async()=>{
  await render(<ManagedSkuEditor r={rental} onSaved={jest.fn()}/>);
  await fireEvent.changeText(screen.getByLabelText('Mã hàng'),'BOX-01');
  await fireEvent.changeText(screen.getByLabelText('Tên hàng hóa'),'Thùng giấy');
  await fireEvent.press(screen.getByRole('button',{name:'Chọn từ thư viện'}));
  await waitFor(()=>expect(screen.getByText('Xem trước ảnh')).toBeTruthy());
  expect(mockUpload).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Mã hàng').props.value).toBe('BOX-01');
  expect(screen.getByLabelText('Tên hàng hóa').props.value).toBe('Thùng giấy');
  await fireEvent.press(screen.getByRole('button',{name:'Tải ảnh lên'}));
  await waitFor(()=>expect(mockUpload).toHaveBeenCalledWith('3'.repeat(24),asset));
  expect(await screen.findByText('Gỡ ảnh')).toBeTruthy();
  expect(screen.queryByText('Xem trước ảnh')).toBeNull();
});

it('keeps the preview and shows a clear error if the upload is rejected',async()=>{
  mockUpload.mockRejectedValue(new Error('Không kết nối được máy chủ.'));
  await render(<ManagedSkuEditor r={rental} onSaved={jest.fn()}/>);
  await fireEvent.press(screen.getByRole('button',{name:'Chọn từ thư viện'}));
  await waitFor(()=>expect(screen.getByText('Xem trước ảnh')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button',{name:'Tải ảnh lên'}));
  expect(await screen.findByText('Không kết nối được máy chủ.')).toBeTruthy();
  expect(screen.getByText('Xem trước ảnh')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Lưu hàng hóa'}).props.accessibilityState.disabled).toBe(true);
});
