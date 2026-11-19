import {itemDto} from '../src/api/contracts/inventory';
import {mapV3CustomerStock,mapV3Movements,mapV3Stock} from '../src/api/contracts/managedV3Ledger';
import {mapManagedQuote} from '../src/api/contracts/booking';
import {movementAction,movementCellIds,movementPlacements} from '../src/domain/managedV3Movements';

const [skuId,reservationId,customerId,facilityId,cellId,ruleId]=['1'.repeat(24),'2'.repeat(24),'3'.repeat(24),'4'.repeat(24),'5'.repeat(24),'6'.repeat(24)] as const;
const sku=itemDto.parse({_id:skuId,managedReservationId:reservationId,customerId,facilityId,itemCode:'SKU',
  name:'Fixture',category:'Hộp',quantity:9,quantityUnit:'kiện',unitWeightKg:1,
  unitDimensionsM:{widthM:1,depthM:1,heightM:1},status:'REGISTERED'});
const envelope=(data:unknown)=>({success:true,data});

test('V3 stock trusts scoped ledger reconciliation, not declared SKU quantity',()=>{
  const result={skuId,reservationId,customerId,facilityId,onHandQuantity:0,heldQuantity:0,availableQuantity:0,
    totalWeightKg:0,totalVolumeM3:0,ledgerRevision:0,reconciliationStatus:'RECONCILIATION_REQUIRED',
    byCell:[],byBatch:[],byPhysicalUnit:[]};
  expect(mapV3Stock(envelope(result),sku,customerId)).toMatchObject({onHandQuantity:0,reconciliationStatus:'RECONCILIATION_REQUIRED'});
  expect(()=>mapV3Stock(envelope({...result,facilityId:cellId}),sku,customerId)).toThrow();
  expect(()=>mapV3Stock(envelope(result),sku,cellId)).toThrow();
});

test('customer stock maps the current Backend-safe SKU, Specification, Cell, and capacity summary',()=>{
  const cell={cellId,quantityOnHand:4,quantityHeld:1,quantityAvailable:3,weightKg:8,volumeM3:.4};
  const result={skuId,reservationId,facilityId,totalQuantity:4,totalWeightKg:8,totalVolumeM3:.4,reconciliationStatus:'VERIFIED',
    itemSpecifications:[{itemSpecId:ruleId,code:'BOX-S',name:'Hộp nhỏ',quantityUnit:'cái',quantityOnHand:4,quantityHeld:1,quantityAvailable:3,
      totalWeightKg:8,totalVolumeM3:.4,byCell:[cell]}],byCell:[cell],byReservation:[{reservationId,reservationCode:'R-01',quantityOnHand:4,totalWeightKg:8,totalVolumeM3:.4}]};
  expect(mapV3CustomerStock(envelope(result),sku,customerId)).toMatchObject({totalQuantity:4,reconciliationStatus:'VERIFIED',itemSpecifications:[{code:'BOX-S',byCell:[cell]}]});
  expect(()=>mapV3CustomerStock(envelope({...result,reservationId:cellId}),sku,customerId)).toThrow();
  expect(()=>mapV3CustomerStock(envelope({...result,reconciliationStatus:'RECONCILED'}),sku,customerId)).toThrow();
});

test('V3 movements require an owned canonical event and preserve the operation',()=>{
  const row={_id:ruleId,itemId:skuId,managedReservationId:reservationId,customerId,facilityId,
    schemaVersion:3,operationId:'MI-V3:fixture',performedAt:'2026-11-13T00:00:00.000Z',quantity:1,quantityUnit:'kiện',
    v3Effect:{action:'ADD',itemKind:'A1_PHYSICAL_UNIT',destination:[{cellId,quantity:1}]}};
  expect(mapV3Movements(envelope([row]),sku,customerId)[0]).toMatchObject(row);
  expect(()=>mapV3Movements(envelope([{...row,schemaVersion:2}]),sku,customerId)).toThrow();
  expect(mapV3Movements(envelope([{...row,managedReservationId:cellId}]),sku,customerId)).toHaveLength(1);
  expect(()=>mapV3Movements(envelope([{...row,facilityId:cellId}]),sku,customerId)).toThrow();
  expect(()=>mapV3Movements(envelope([{...row,customerId:cellId}]),sku,customerId)).toThrow();
});

test('V3 history accepts scoped schema-v2 receipts alongside V3 and unified movements',()=>{
  const legacy={_id:ruleId,itemId:skuId,managedReservationId:reservationId,customerId,facilityId,schemaVersion:2,type:'INBOUND',
    movementCode:'MI-OLD',performedAt:'2026-11-13T00:00:00.000Z',quantity:4,quantityUnit:'cái',destinationCellId:cellId,
    batchLines:[{action:'ADD',batchId:'receipt-1',quantity:4,quantityUnit:'cái'}]};
  const rows=mapV3Movements(envelope([legacy]),sku,customerId);
  expect(rows).toHaveLength(1);
  expect(movementAction(rows[0]!)).toBe('INBOUND');
  expect(movementCellIds(rows[0]!)).toEqual([cellId]);
  expect(movementPlacements(rows[0]!,'destination')[0]).toMatchObject({cellId,quantity:4});
});

test('unified Movement detail preserves operation and per-Specification source/destination Cells',()=>{
  const destinationCell='7'.repeat(24),row={_id:ruleId,itemId:skuId,managedReservationId:reservationId,customerId,facilityId,schemaVersion:4,
    idempotencyKey:'wdp-mobile-12345678-1234-4234-8234-123456789abc',operationId:'MI-MOVE:fixture',type:'RELOCATION',performedAt:'2026-11-13T00:00:00.000Z',quantity:2,quantityUnit:'cái',
    stockEffect:{action:'MOVE',operationId:'MI-MOVE:fixture',ledgerRevision:8,source:[{itemSpecId:ruleId,receiptId:'receipt-a',cellId,quantity:2,quantityBefore:5,quantityAfter:3,allocatedWeightKg:4,allocatedVolumeM3:.2}],
      destination:[{itemSpecId:ruleId,receiptId:'receipt-a',cellId:destinationCell,quantity:2,quantityBefore:0,quantityAfter:2,allocatedWeightKg:4,allocatedVolumeM3:.2}]}};
  const movement=mapV3Movements(envelope([row]),sku,customerId)[0]!;
  expect(movementAction(movement)).toBe('RELOCATION');
  expect(movementCellIds(movement)).toEqual([cellId,destinationCell]);
  expect(movementPlacements(movement,'source')[0]).toMatchObject({itemSpecId:ruleId,receiptId:'receipt-a',quantityBefore:5,quantityAfter:3});
});

test('customer history supports cross-Reservation unified Relocation while enforcing SKU and facility scope',()=>{
  const destinationCell='7'.repeat(24),destinationReservation='9'.repeat(24),row={_id:ruleId,itemId:skuId,managedReservationId:reservationId,customerId,facilityId,schemaVersion:4,
    idempotencyKey:'wdp-mobile-12345678-1234-4234-8234-123456789abc',operationId:'MI-MOVE:cross-reservation',performedAt:'2026-11-13T00:00:00.000Z',quantity:2,quantityUnit:'cái',type:'RELOCATION',
    stockEffect:{action:'MOVE',operationId:'MI-MOVE:cross-reservation',ledgerRevision:8,source:[{itemSpecId:ruleId,reservationId,receiptId:'receipt-a',cellId,quantity:2,allocatedWeightKg:4,allocatedVolumeM3:.2}],
      destination:[{itemSpecId:ruleId,reservationId:destinationReservation,receiptId:'receipt-a',cellId:destinationCell,quantity:2,allocatedWeightKg:4,allocatedVolumeM3:.2}]}};
  expect(mapV3Movements(envelope([row]),sku,customerId)[0]).toMatchObject({type:'RELOCATION',managedReservationId:reservationId});
  expect(()=>mapV3Movements(envelope([{...row,facilityId:destinationCell}]),sku,customerId)).toThrow();
  expect(()=>mapV3Movements(envelope([{...row,itemId:destinationReservation}]),sku,customerId)).toThrow();
});

test('V3 quote requires the FULL_RENT contract and explicit Cells',()=>{
  const result={bookingFlowVersion:3,facilityId,cellIds:[cellId],allocatedCapacityM3:1,
    startDate:'2026-11-13T00:00:00.000Z',endDate:'2026-12-13T00:00:00.000Z',term:{unit:'MONTH',value:1},
    availableCapacityM3:2,taxAmount:0,pricing:{ruleId,version:1,billingBasis:'PER_M3',ratePerM3:50000,currency:'VND',estimatedRent:50000},
    payment:{purpose:'FULL_RENT',amount:50000,currency:'VND'}};
  expect(mapManagedQuote(envelope(result))).toMatchObject({bookingFlowVersion:3,payment:result.payment,cellIds:[cellId]});
  expect(()=>mapManagedQuote(envelope({...result,payment:{...result.payment,purpose:'DEPOSIT'}}))).toThrow();
  expect(()=>mapManagedQuote(envelope({...result,cellIds:[]}))).toThrow();
});
