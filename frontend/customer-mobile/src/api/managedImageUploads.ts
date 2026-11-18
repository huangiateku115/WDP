import {randomUUID} from 'expo-crypto';
import {z} from 'zod';
import {wire,MobileInputError} from './client';
import {instant,objectId,readData} from './contracts/core';
export type InventoryImageAsset={uri:string;fileName?:string|null;mimeType?:string|null;fileSize?:number|null;width:number;height:number;file?:Blob|null};
const uploadDto=z.object({uploadId:objectId,publicId:z.string().min(1),secureUrl:z.string().url().refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}}),format:z.enum(['jpg','png','webp']),width:z.number().int().positive().max(6000),height:z.number().int().positive().max(6000),expiresAt:z.string().datetime({offset:true})}).passthrough();
export type UploadedInventoryImage=z.infer<typeof uploadDto>;
const MAX_BYTES=8*1024*1024;
const MIME_TYPES=['image/jpeg','image/png','image/webp'];
export function validateInventoryImageAsset(asset:InventoryImageAsset){
  if(!MIME_TYPES.includes(asset.mimeType??''))throw new MobileInputError('Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.');
  if(asset.fileSize!==undefined&&asset.fileSize!==null&&(!asset.fileSize||asset.fileSize>MAX_BYTES))throw new MobileInputError('Ảnh phải nhỏ hơn hoặc bằng 8 MiB.');
  if(!Number.isInteger(asset.width)||!Number.isInteger(asset.height)||asset.width<1||asset.height<1||asset.width>6000||asset.height>6000||asset.width*asset.height>24_000_000)throw new MobileInputError('Ảnh vượt quá kích thước cho phép.');
}
export const managedImageUploads={
  async upload(reservationId:string,asset:InventoryImageAsset){
    objectId.parse(reservationId);validateInventoryImageAsset(asset);
    const body=new FormData();
    if(asset.file)body.append('file',asset.file,asset.fileName||'item-image');
    else body.append('file',{uri:asset.uri,name:asset.fileName||'item-image',type:asset.mimeType} as unknown as Blob);
    body.append('managedReservationId',reservationId);
    const response=await wire('POST','/inventory-items/image-uploads',{body,key:'wdp-mobile-image-'+randomUUID()});
    const uploaded=readData(uploadDto,response);
    if(Date.parse(uploaded.expiresAt)<=Date.now())throw new MobileInputError('Ảnh tải lên đã hết hạn. Hãy chọn lại ảnh.');
    return uploaded;
  },
  async remove(uploadId:string){
    const response=await wire('DELETE',`/inventory-items/image-uploads/${objectId.parse(uploadId)}`);
    return readData(z.object({deleted:z.boolean(),scheduledFor:instant.optional()}).passthrough(),response);
  },
};
