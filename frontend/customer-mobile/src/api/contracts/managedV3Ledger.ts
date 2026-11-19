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
const customerCellStock=z.object({cellId:objectId,quantityOnHand:whole,quantityHeld:whole,quantityAvailable:whole,weightKg:nonnegative,volumeM3:nonnegative,reservationId:idRef.optional()}).passthrough();
const customerStockDto=z.object({skuId:objectId,reservationId:objectId,facilityId:objectId,
  totalQuantity:whole.nullable(),totalWeightKg:nonnegative.nullable(),totalVolumeM3:nonnegative.nullable(),
  reconciliationStatus:z.enum(['NO_ACTIVITY','VERIFIED','CHECKING']),verificationMessage:z.string().nullable().optional(),
  byReservation:z.array(z.object({reservationId:idRef,reservationCode:z.string().nullable(),quantityOnHand:whole.nullable(),totalWeightKg:nonnegative.nullable(),totalVolumeM3:nonnegative.nullable()}).passthrough()).optional(),
  itemSpecifications:z.array(z.object({itemSpecId:objectId,code:z.string(),name:z.string(),quantityUnit:z.string().nullable(),
    quantityOnHand:whole.nullable(),quantityHeld:whole.nullable(),quantityAvailable:whole.nullable(),totalWeightKg:nonnegative.nullable(),totalVolumeM3:nonnegative.nullable(),
    byCell:z.array(customerCellStock)}).passthrough()),byCell:z.array(customerCellStock)}).passthrough();
const legacyMovementDto=z.object({
  _id:objectId,itemId:idRef,managedReservationId:idRef,customerId:idRef,facilityId:idRef,
  schemaVersion:z.union([z.literal(1),z.literal(2)]).optional(),type:z.enum(['INBOUND','OUTBOUND','RELOCATION']),
  operationId:z.string().optional(),movementCode:z.string().optional(),referenceCode:z.string().optional(),
  performedAt:instant,quantity:whole.min(1),quantityUnit:z.string().min(1),sourceCellId:idRef.nullish(),destinationCellId:idRef.nullish(),
  actualUnitWeightKg:nonnegative.optional(),actualTotalWeightKg:nonnegative.optional(),actualTotalVolumeM3:nonnegative.optional(),
  inspectionNote:z.string().optional(),handoverNote:z.string().optional(),relocationNote:z.string().optional(),
  batchLines:z.array(z.unknown()).optional(),arithmeticPolicy:z.string().optional(),
}).passthrough();
const v3MovementDto=z.object({
  _id:objectId,itemId:idRef,managedReservationId:idRef,customerId:idRef,facilityId:idRef,
  schemaVersion:z.literal(3),operationId:z.string().min(1),performedAt:instant,quantity:whole,quantityUnit:z.string().min(1),
  v3Effect:z.object({action:z.enum(['ADD','MOVE','REMOVE']),itemKind:z.enum(['A1_PHYSICAL_UNIT','A2_BATCH']),
    source:z.array(placement).optional(),destination:z.array(placement).optional()}),
});
const unifiedMovementDto=z.object({
  _id:objectId,itemId:idRef,managedReservationId:idRef,customerId:idRef,facilityId:idRef,
  schemaVersion:z.literal(4),operationId:z.string().min(1),idempotencyKey:z.string().min(1),performedAt:instant,
  quantity:whole,quantityUnit:z.string().min(1),
  stockEffect:z.object({action:z.enum(['ADD','MOVE','REMOVE']),operationId:z.string().min(1),ledgerRevision:whole,
    destination:z.array(z.object({cellId:objectId,quantity:whole}).passthrough()).optional(),
    source:z.array(z.object({cellId:objectId,quantity:whole}).passthrough()).optional()}).passthrough(),
}).passthrough();
const movementDto=z.union([legacyMovementDto,v3MovementDto,unifiedMovementDto]);

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

export function mapV3CustomerStock(response:unknown,sku:Sku,owner:string){
  assertOwner(sku,owner);
  const stock=readData(customerStockDto,response);
  if(stock.skuId!==sku._id||refId(stock.reservationId)!==refId(sku.managedReservationId)||refId(stock.facilityId)!==refId(sku.facilityId)){
    throw Error('Managed V3 customer stock scope mismatch');
  }
  return {...stock,byCell:stock.byCell as Array<z.infer<typeof customerCellStock>&{reservationId?:z.infer<typeof idRef>}>} as unknown as z.infer<typeof customerStockDto>;
}

export function mapV3Movements(response:unknown,sku:Sku,owner:string){
  const rows=readData(z.array(movementDto),response);
  for(const row of rows){
    assertOwner(sku,owner);assertOwner(row,owner);
    // Canonical V3 relocation may transfer stock between this Customer's
    // active Reservations at the same Facility. The customer-safe history
    // endpoint is scoped by owned SKU, so the movement Reservation can differ
    // from the SKU's original Reservation while the SKU/facility/owner fence
    // remains mandatory.
      if(refId(row.itemId)!==sku._id||refId(row.facilityId)!==refId(sku.facilityId)||
        (row.schemaVersion===4&&row.stockEffect.action==='MOVE'&&row.type!=='RELOCATION'))
      throw Error('Managed V3 movement is outside the owned SKU/facility scope');
  }
  return rows;
}
