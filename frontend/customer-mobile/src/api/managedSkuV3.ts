import {z} from 'zod';
import {wire,MobileInputError} from './client';
import {assertOwner,refId} from './contracts/core';
import {mapItem,managedV3SkuDto} from './contracts/inventory';
import type {ReservationDto} from './contracts/customer';
import {managedInventory} from './managedInventory';
import {mobileRepo} from './mobileRepository';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;
const categoryDto=z.object({categoryId:z.string().regex(/^[a-f\d]{24}$/i),id:z.string().regex(/^[a-f\d]{24}$/i),
  code:z.string(),name:z.string(),description:z.string().optional(),sortOrder:z.number().int().nonnegative()}).passthrough();
const skuCreateBody=z.object({managedReservationId:z.string().regex(/^[a-f\d]{24}$/i),itemCode:z.string().trim().min(1).max(48)
  .transform(value=>value.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]*$/)),name:z.string().trim().min(1).max(160),
  categoryId:z.string().regex(/^[a-f\d]{24}$/i),description:z.string().trim().max(2000).optional(),images:z.array(z.string().url()).max(10).optional()}).strict();
const skuUpdateBody=z.object({name:z.string().trim().min(1).max(160).optional(),categoryId:z.string().regex(/^[a-f\d]{24}$/i).optional(),
  description:z.string().trim().max(2000).optional(),images:z.array(z.string().url()).max(10).optional()}).strict().refine(value=>Object.keys(value).length>0);

export function managedSkuEligible(r:ReservationDto,now=Date.now()){
  return r.serviceType==='MANAGED_INVENTORY'&&r.bookingFlowVersion===3&&!r.activeClosureRequestId&&
    Date.parse(r.endDate)>now&&(r.status==='CHECKIN_READY'||(r.status==='ACTIVE'&&Date.parse(r.startDate)<=now));
}

export async function managedSkuCategories(signal?:AbortSignal){
  const response=await wire('GET','/managed-inventory-catalog/categories/active',{params:{page:1,limit:100},signal});
  const page=z.object({success:z.literal(true),data:z.array(categoryDto),pagination:z.object({page:z.number().int(),limit:z.number().int(),
    total:z.number().int(),totalPages:z.number().int()})}).passthrough().parse(response);
  if(page.pagination.totalPages>1||page.data.some(row=>row.id!==row.categoryId))throw new MobileInputError('Không thể xác minh đầy đủ danh mục SKU.');
  return page.data;
}

function scopedItem(item:Item,r:ReservationDto){
  if(item.inventorySchemaVersion!==3||item.status!=='ACTIVE'||refId(item.facilityId)!==refId(r.facilityId)||refId(item.managedReservationId)!==r._id||item.currentCellId!=null){
    throw new MobileInputError('Máy chủ chưa xác nhận SKU V3 đang hoạt động và chưa có vị trí lưu kho.');
  }
  return item;
}

export async function saveManagedSku(r:ReservationDto,owner:string,input:unknown,current:()=>boolean,item?:Item){
  assertOwner(r,owner);
  if(item){assertOwner(item,owner);scopedItem(item,r);}
  const fresh=await managedInventory.rental(r._id,owner,refId(r.facilityId));
  if(!managedSkuEligible(fresh))throw new MobileInputError('Đơn thuê chưa đủ điều kiện đăng ký hoặc sửa SKU.');
  if(item)scopedItem(await mobileRepo.item(item._id,owner),fresh);
  if(!current())throw new MobileInputError('Phiên đăng nhập đã thay đổi.');
  const dto=item?skuUpdateBody.parse(input):skuCreateBody.parse(input);
  if('managedReservationId' in dto&&dto.managedReservationId!==fresh._id)throw new MobileInputError('SKU không thuộc đơn thuê.');
  let row:Item;
  if(item){
    const latest=await mobileRepo.item(item._id,owner);
    scopedItem(latest,fresh);
    if(!current())throw new MobileInputError('Phiên đăng nhập đã thay đổi.');
    row=scopedItem(mapItem(await wire('PATCH','/inventory-items/'+item._id,{body:dto,ifMatch:latest.revision}),owner),fresh);
  }else row=scopedItem(mapItem(await wire('POST','/inventory-items',{body:dto}),owner),fresh);
  if(item?row._id!==item._id:'itemCode' in dto&&(row.itemCode!==dto.itemCode||refId(row.categoryId!)!==dto.categoryId))throw new MobileInputError('Chưa xác minh được SKU đã lưu.');
  return row;
}
