import {z} from 'zod';
import {assertOwner,idRef,instant,nonnegative,objectId,readData,refId,whole} from './core';
import {itemDto} from './inventory';

type Sku=z.infer<typeof itemDto>;
const placement=z.object({cellId:objectId,quantity:whole});
const stockDto=z.object({
  skuId:objectId,reservationId:objectId,customerId:objectId,facilityId:objectId,
  onHandQuantity:whole,heldQuantity:whole,availableQuantity:whole,
  totalWeightKg:nonnegative,totalVolumeM3:nonnegative,ledgerRevision:whole,
  reconciliationStatus:z.enum(['RECONCILED','RECONCILIATION_REQUIRED']),
  byCell:z.array(placement.extend({physicalUnitCount:whole})),
  byBatch:z.array(placement.extend({batchId:z.string().min(1),quantityUnit:z.string().min(1)})),
  byPhysicalUnit:z.array(z.object({physicalUnitId:objectId,cellIds:z.array(objectId)})),
});
const movementDto=z.object({
  _id:objectId,itemId:idRef,managedReservationId:idRef,customerId:idRef,facilityId:idRef,
  schemaVersion:z.literal(3),operationId:z.string().min(1),performedAt:instant,quantity:whole,quantityUnit:z.string().min(1),
  v3Effect:z.object({action:z.enum(['ADD','MOVE','REMOVE']),itemKind:z.enum(['A1_PHYSICAL_UNIT','A2_BATCH']),
    source:z.array(placement).optional(),destination:z.array(placement).optional()}),
});

function assertScope(sku:Sku,owner:string,row:{customerId:z.infer<typeof idRef>;facilityId:z.infer<typeof idRef>;reservationId:z.infer<typeof idRef>},skuId:string){
  assertOwner(sku,owner);
  assertOwner(row,owner);
  if(skuId!==sku._id||refId(row.reservationId)!==refId(sku.managedReservationId)||refId(row.facilityId)!==refId(sku.facilityId)){
    throw Error('Managed V3 ledger scope mismatch');
  }
}

export function mapV3Stock(response:unknown,sku:Sku,owner:string){
  const stock=readData(stockDto,response);
  assertScope(sku,owner,stock,stock.skuId);
  return stock;
}

export function mapV3Movements(response:unknown,sku:Sku,owner:string){
  const rows=readData(z.array(movementDto),response);
  for(const row of rows)assertScope(sku,owner,{...row,reservationId:row.managedReservationId},refId(row.itemId));
  return rows;
}
