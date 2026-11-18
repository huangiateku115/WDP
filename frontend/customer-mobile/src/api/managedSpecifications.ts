import {z} from 'zod';
import {wire,MobileInputError} from './client';
import {assertOwner,objectId,positive,readData,refId,whole} from './contracts/core';
import type {mobileRepo} from './mobileRepository';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
// Customer catalog DTO is { quantityUnitId, id, code, name, ... }, not a Mongoose {_id} row.
const unit=z.object({quantityUnitId:objectId,id:objectId,code:z.string(),name:z.string()}).passthrough()
  .transform(row=>({_id:row.quantityUnitId,code:row.code,name:row.name,isActive:true as const}));
const spec=z.object({_id:objectId,itemSpecId:objectId,skuId:objectId,code:z.string(),name:z.string(),description:z.string().optional(),
  quantityUnitId:objectId,quantityUnit:z.string(),quantityUnitCode:z.string(),dimensionsM:z.object({widthM:positive,depthM:positive,heightM:positive}),
  unitWeightKg:positive,unitVolumeM3:positive,revision:whole,status:z.enum(['ACTIVE','INACTIVE','DELETED'])}).passthrough();
export type ManagedSpecification=z.infer<typeof spec>;
const form=z.object({code:z.string().trim().min(1).max(48).transform(v=>v.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]*$/)),
  name:z.string().trim().min(1).max(160),description:z.string().trim().max(2000).optional(),quantityUnitId:objectId,
  dimensionsM:z.object({widthM:positive,depthM:positive,heightM:positive}),unitWeightKg:positive}).strict();

function path(item:Item,owner:string){
  assertOwner(item,owner);
  if(item.inventorySchemaVersion!==3||item.status!=='ACTIVE')throw new MobileInputError('Chỉ SKU V3 đang hoạt động hỗ trợ Item Specification.');
  return `/inventory-items/${objectId.parse(item._id)}/specifications`;
}
export const managedSpecifications={
  async list(item:Item,owner:string,signal?:AbortSignal){
    const rows=readData(z.array(spec),await wire('GET',path(item,owner),{signal}));
    if(rows.some(row=>row.skuId!==item._id))throw new MobileInputError('Item Specification không thuộc SKU hiện tại.');
    return rows;
  },
  async units(signal?:AbortSignal){
    const response=await wire('GET','/managed-inventory-catalog/quantity-units/active',{params:{page:1,limit:100},signal});
    const rows=readData(z.array(unit),response);
    if(rows.length>=100)throw new MobileInputError('Danh sách đơn vị tính chưa được tải đầy đủ.');
    return rows;
  },
  async save(item:Item,owner:string,input:unknown,current:()=>boolean,existing?:ManagedSpecification){
    const endpoint=path(item,owner),payload=form.parse(input);
    if(!current())throw new MobileInputError('Phiên đăng nhập đã thay đổi.');
    const result=readData(spec,await wire(existing?'PATCH':'POST',existing?`${endpoint}/${objectId.parse(existing._id)}`:endpoint,
      {body:payload,...(existing?{ifMatch:existing.revision}:{})}));
    if(result.skuId!==item._id||result.code!==payload.code||result.quantityUnitId!==payload.quantityUnitId||
      result.dimensionsM.widthM!==payload.dimensionsM.widthM||result.dimensionsM.depthM!==payload.dimensionsM.depthM||
      result.dimensionsM.heightM!==payload.dimensionsM.heightM||result.unitWeightKg!==payload.unitWeightKg||
      existing&&result._id!==existing._id)throw new MobileInputError('Chưa xác minh được Item Specification đã lưu.');
    return result;
  },
  async remove(item:Item,owner:string,row:ManagedSpecification){
    const response=await wire('DELETE',`${path(item,owner)}/${objectId.parse(row._id)}`,{ifMatch:row.revision});
    const saved=readData(spec,response);
    if(saved._id!==row._id||saved.skuId!==item._id||saved.status!=='DELETED'||saved.revision<=row.revision)
      throw new MobileInputError('Chưa xác minh được Item Specification đã xóa mềm.');
  },
};
