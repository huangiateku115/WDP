import {wire,MobileInputError} from './client';
import {assertOwner,refId} from './contracts/core';
import {createItemBody,mapItem,updateItemBody} from './contracts/inventory';
import type {ReservationDto} from './contracts/customer';
import {managedInventory} from './managedInventory';
import {mobileRepo} from './mobileRepository';

type Item=Awaited<ReturnType<typeof mobileRepo.item>>;

export function managedSkuEligible(r:ReservationDto,now=Date.now()){
  return r.serviceType==='MANAGED_INVENTORY'&&r.bookingFlowVersion===3&&!r.activeClosureRequestId&&
    Date.parse(r.endDate)>now&&(r.status==='CHECKIN_READY'||(r.status==='ACTIVE'&&Date.parse(r.startDate)<=now));
}

function scopedItem(item:Item,r:ReservationDto){
  if(item.inventorySchemaVersion!==3||refId(item.facilityId)!==refId(r.facilityId)||refId(item.managedReservationId)!==r._id||
    item.status!=='REGISTERED'||item.currentCellId!=null){
    throw new MobileInputError('Máy chủ chưa xác nhận SKU V3 đã đăng ký và chưa có vị trí lưu kho.');
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
  const dto=item?updateItemBody.parse(input):createItemBody.parse(input);
  if('managedReservationId' in dto&&dto.managedReservationId!==fresh._id)throw new MobileInputError('SKU không thuộc đơn thuê.');
  const row=scopedItem(mapItem(await wire(item?'PATCH':'POST',item?'/inventory-items/'+item._id:'/inventory-items',{body:dto}),owner),fresh);
  if(item?row._id!==item._id:'itemCode' in dto&&row.itemCode!==dto.itemCode)throw new MobileInputError('Chưa xác minh được SKU đã lưu.');
  return row;
}
