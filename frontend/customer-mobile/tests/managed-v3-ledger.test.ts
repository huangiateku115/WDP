import {itemDto} from '../src/api/contracts/inventory';
import {mapV3Movements,mapV3Stock} from '../src/api/contracts/managedV3Ledger';
import {mapManagedQuote} from '../src/api/contracts/booking';

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

test('V3 movements require an owned canonical event and preserve the operation',()=>{
  const row={_id:ruleId,itemId:skuId,managedReservationId:reservationId,customerId,facilityId,
    schemaVersion:3,operationId:'MI-V3:fixture',performedAt:'2026-11-13T00:00:00.000Z',quantity:1,quantityUnit:'kiện',
    v3Effect:{action:'ADD',itemKind:'A1_PHYSICAL_UNIT',destination:[{cellId,quantity:1}]}};
  expect(mapV3Movements(envelope([row]),sku,customerId)[0]).toMatchObject(row);
  expect(()=>mapV3Movements(envelope([{...row,schemaVersion:2}]),sku,customerId)).toThrow();
  expect(()=>mapV3Movements(envelope([{...row,managedReservationId:cellId}]),sku,customerId)).toThrow();
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
