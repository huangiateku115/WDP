import {managedImageUploads,validateInventoryImageAsset} from '../src/api/managedImageUploads';
import {wire} from '../src/api/client';

jest.mock('../src/api/client',()=>({...jest.requireActual('../src/api/client'),wire:jest.fn()}));
const reservationId='a'.repeat(24);
const asset={uri:'file:///item.jpg',fileName:'item.jpg',mimeType:'image/jpeg',fileSize:1024,width:1200,height:900,file:new Blob(['image'],{type:'image/jpeg'})};
const response={success:true,data:{uploadId:'b'.repeat(24),publicId:'inventory/image-1',secureUrl:'https://images.example.test/item.jpg',format:'jpg',width:1200,height:900,expiresAt:'2099-01-01T00:00:00.000Z'}};

beforeEach(()=>{jest.clearAllMocks();(wire as jest.Mock).mockResolvedValue(response);});

it('validates the supported image types, byte limit and dimensions before upload',()=>{
  expect(()=>validateInventoryImageAsset({...asset,mimeType:'image/gif'})).toThrow('Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.');
  expect(()=>validateInventoryImageAsset({...asset,fileSize:8*1024*1024+1})).toThrow('Ảnh phải nhỏ hơn hoặc bằng 8 MiB.');
  expect(()=>validateInventoryImageAsset({...asset,width:6000,height:5000})).toThrow('Ảnh vượt quá kích thước cho phép.');
  expect(wire).not.toHaveBeenCalled();
});

it('uses the customer upload endpoint and accepts only a valid HTTPS upload result',async()=>{
  const uploaded=await managedImageUploads.upload(reservationId,asset);
  expect(wire).toHaveBeenCalledWith('POST','/inventory-items/image-uploads',expect.objectContaining({key:expect.stringMatching(/^wdp-mobile-image-/),body:expect.any(FormData)}));
  expect(uploaded).toMatchObject({uploadId:'b'.repeat(24),secureUrl:response.data.secureUrl,format:'jpg'});
});

it('rejects malformed and expired server upload results',async()=>{
  (wire as jest.Mock).mockResolvedValueOnce({success:true,data:{...response.data,secureUrl:'http://images.example.test/item.jpg'}});
  await expect(managedImageUploads.upload(reservationId,asset)).rejects.toThrow();
  (wire as jest.Mock).mockResolvedValueOnce({success:true,data:{...response.data,expiresAt:'2000-01-01T00:00:00.000Z'}});
  await expect(managedImageUploads.upload(reservationId,asset)).rejects.toThrow('Ảnh tải lên đã hết hạn. Hãy chọn lại ảnh.');
});

it('does not turn a production upload refusal into a success result',async()=>{
  (wire as jest.Mock).mockRejectedValueOnce(new Error('503 Service Unavailable'));
  await expect(managedImageUploads.upload(reservationId,asset)).rejects.toThrow('503 Service Unavailable');
});
