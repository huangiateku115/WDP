import {managedStockOperations} from '../src/api/managedStockOperations';
import {wire} from '../src/api/client';

jest.mock('../src/api/client',()=>({wire:jest.fn(),MobileInputError:class MobileInputError extends Error{}}));
const mockWire=wire as jest.MockedFunction<typeof wire>;
const [owner,skuId,primaryReservation,sourceReservation,destinationReservation,facilityId,sessionId,specId,sourceCell,destinationCell,movementId]=
  ['1'.repeat(24),'2'.repeat(24),'3'.repeat(24),'4'.repeat(24),'5'.repeat(24),'6'.repeat(24),'7'.repeat(24),'8'.repeat(24),'9'.repeat(24),'a'.repeat(24),'b'.repeat(24)] as const;
const item={_id:skuId,customerId:owner,inventorySchemaVersion:3,status:'ACTIVE',managedReservationId:primaryReservation,facilityId} as never;
const reservation={_id:primaryReservation,customerId:owner,facilityId,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',startDate:'2026-01-01T00:00:00.000Z',endDate:'2027-01-01T00:00:00.000Z'} as never;
const session={_id:sessionId,revision:3,status:'ACTIVE',facilityId,scopedReservationIds:[primaryReservation,sourceReservation,destinationReservation],reservationId:primaryReservation,
  allowedPurposes:['RELOCATION'],allowedCellIds:[sourceCell,destinationCell]} as never;
const body={accessSessionId:sessionId,sessionRevision:3,skuRevision:9,lines:[{lineId:'line-1',itemSpecId:specId,itemSpecRevision:2,sourceCellId:sourceCell,destinationCellId:destinationCell,
  sourceReservationId:sourceReservation,destinationReservationId:destinationReservation,quantity:2}]};
const key='wdp-mobile-12345678-1234-4234-8234-123456789abc';
const movement={_id:movementId,itemId:skuId,managedReservationId:sourceReservation,facilityId,customerId:owner,type:'RELOCATION',schemaVersion:4,idempotencyKey:key,
  operationId:'MI-MOVE:fixture',movementCode:'MI-MOVE-001',performedAt:'2026-11-18T10:00:00.000Z',quantity:2,quantityUnit:'cái',stockEffect:{action:'MOVE',source:[
    {lineId:'line-1',itemSpecId:specId,reservationId:sourceReservation,cellId:sourceCell,receiptId:'receipt-1',quantity:2,allocatedWeightKg:2,allocatedVolumeM3:.2}],destination:[
    {lineId:'line-1',itemSpecId:specId,reservationId:destinationReservation,cellId:destinationCell,receiptId:'receipt-1',quantity:2,allocatedWeightKg:2,allocatedVolumeM3:.2}]}};
const committed={success:true,data:{status:'COMMITTED',movement}};
const context={success:true,data:{sku:{id:skuId,itemCode:'SKU',name:'Fixture',revision:9},reservation:{id:primaryReservation,reservationCode:'R0',facilityId,status:'ACTIVE'},minimumDestinationRemainingDays:7,
  reservations:[sourceReservation,destinationReservation,primaryReservation].map((id,index)=>({id,reservationCode:`R${index}`,facilityId,status:'ACTIVE',endDate:'2027-01-01T00:00:00.000Z',canReceiveRelocation:true})),
  cells:[{id:sourceCell,code:'SRC',reservationId:sourceReservation,reservationCode:'R0',reservationEndDate:'2027-01-01T00:00:00.000Z',canReceiveRelocation:true,destinationBlockedReason:null,rackId:'c'.repeat(24),levelNumber:1,
    operationalStatus:'AVAILABLE',maxWeightKg:100,usedWeightKg:10,maxVolumeM3:10,usedVolumeM3:1,managedInventoryRevision:4},
    {id:destinationCell,code:'DST',reservationId:destinationReservation,reservationCode:'R1',reservationEndDate:'2027-01-01T00:00:00.000Z',canReceiveRelocation:true,destinationBlockedReason:null,rackId:'d'.repeat(24),levelNumber:1,
      operationalStatus:'AVAILABLE',maxWeightKg:100,usedWeightKg:0,maxVolumeM3:10,usedVolumeM3:0,managedInventoryRevision:2}],
  itemSpecifications:[{itemSpecId:specId,code:'BOX',name:'Box',revision:2,quantityUnit:'cái',availableQuantity:2,receipts:[{receiptId:'receipt-1',reservationId:sourceReservation,reservationCode:'R1',cellId:sourceCell,cellCode:'SRC',quantityOnHand:2,quantityHeld:0,quantityAvailable:2,unitWeightKg:1,unitVolumeM3:.1}],instances:[]}],ledgerRevision:8}};
const preview={success:true,data:{status:'READY',canConfirm:true,skuId,reservationId:primaryReservation,accessSession:{sessionId,purpose:'RELOCATION',revision:3,expiresAt:'2026-11-18T12:00:00.000Z'},
  lines:[{lineId:'line-1',itemSpecId:specId,itemSpecCode:'BOX',itemSpecName:'Box',quantity:2,sourceCellIds:[sourceCell],destinationCellIds:[destinationCell],weightKg:2,volumeM3:.2,
    source:[{lineId:'line-1',itemSpecId:specId,reservationId:sourceReservation,receiptId:'receipt-1',cellId:sourceCell,quantity:2,quantityBefore:2,quantityAfter:0,allocatedWeightKg:2,allocatedVolumeM3:.2}],
    destination:[{lineId:'line-1',itemSpecId:specId,reservationId:destinationReservation,receiptId:'receipt-1',cellId:destinationCell,quantity:2,quantityBefore:0,quantityAfter:2,allocatedWeightKg:2,allocatedVolumeM3:.2}]}],
  totalQuantity:2,totalWeightKg:2,totalVolumeM3:.2,capacity:[],levelCapacity:[{rackId:'c'.repeat(24),levelNumber:1,usedWeightBeforeKg:10,usedWeightAfterKg:8,usedVolumeBeforeM3:1,usedVolumeAfterM3:.8,maxWeightKg:100,maxVolumeM3:10}],skuRevision:9,ledgerRevision:8,warnings:[]}};

beforeEach(()=>mockWire.mockReset());

it('maps customer-owned source and destination Reservations plus their Cell/spec scopes',async()=>{
  mockWire.mockResolvedValue(context);
  const result=await managedStockOperations.relocationContext(item,owner);
  expect(result.cells.map(row=>row.id)).toEqual([sourceCell,destinationCell]);
  expect(mockWire).toHaveBeenCalledWith('GET',`/inventory-items/${skuId}/v3/relocation/context`,{signal:undefined});
});

it('previews multi-Reservation relocation only when the session covers every source and destination',async()=>{
  mockWire.mockResolvedValue(preview);
  await expect(managedStockOperations.relocationPreviewForScope(item,owner,session,body)).resolves.toMatchObject({status:'READY',lines:[{sourceCellIds:[sourceCell],destinationCellIds:[destinationCell]}]});
  expect(mockWire).toHaveBeenCalledWith('POST',`/inventory-items/${skuId}/v3/relocation/preview`,{body});
  await expect(managedStockOperations.relocationPreviewForScope(item,owner,{_id:sessionId,revision:3,status:'ACTIVE',facilityId,scopedReservationIds:[primaryReservation,sourceReservation,destinationReservation],reservationId:primaryReservation,
    allowedPurposes:['RELOCATION'],allowedCellIds:[sourceCell]} as never,body)).rejects.toThrow();
});

it('confirms with quoted If-Match and verifies the exact committed source, destination, type, owner and stable key',async()=>{
  mockWire.mockResolvedValue(committed);
  await expect(managedStockOperations.relocationConfirm(item,reservation,owner,{...body,customerAttestation:'CONFIRMED'},key)).resolves.toMatchObject({status:'COMMITTED',movement:{type:'RELOCATION',stockEffect:{action:'MOVE'}}});
  expect(mockWire).toHaveBeenCalledWith('POST',`/inventory-items/${skuId}/v3/relocation`,{body:{...body,customerAttestation:'CONFIRMED'},key,ifMatch:'"9"'});
  mockWire.mockResolvedValueOnce({success:true,data:{status:'COMMITTED',movement:{...movement,stockEffect:{...movement.stockEffect,destination:[{...movement.stockEffect.destination[0],cellId:sourceCell}]}}}});
  await expect(managedStockOperations.relocationConfirm(item,reservation,owner,{...body,customerAttestation:'CONFIRMED'},key)).rejects.toThrow();
});

it('queries the exact operation key and treats not-found as a lookup result without sending Confirm',async()=>{
  mockWire.mockResolvedValue(committed);
  await expect(managedStockOperations.relocationOperation(item,reservation,owner,key,body)).resolves.toMatchObject({movement:{type:'RELOCATION'}});
  expect(mockWire).toHaveBeenCalledWith('GET',`/inventory-items/${skuId}/v3/relocation/operations`,{params:{key}});
  mockWire.mockRejectedValueOnce({response:{status:404,data:{code:'RELOCATION_OPERATION_NOT_FOUND'}}});
  await expect(managedStockOperations.relocationOperation(item,reservation,owner,key,body)).rejects.toMatchObject({response:{status:404}});
  expect(mockWire).toHaveBeenCalledTimes(2);
  expect(mockWire.mock.calls.every(([method])=>method==='GET')).toBe(true);
});

it('rejects session under-scope, wrong customer/facility, and malformed backend movement identity',async()=>{
  await expect(managedStockOperations.relocationPreviewForScope(item,owner,{_id:sessionId,revision:3,status:'ACTIVE',facilityId,scopedReservationIds:[primaryReservation],reservationId:primaryReservation,
    allowedPurposes:['RELOCATION'],allowedCellIds:[sourceCell,destinationCell]} as never,body)).rejects.toThrow();
  mockWire.mockResolvedValueOnce({success:true,data:{...context.data,cells:context.data.cells.map((row,index)=>index?row:{...row,reservationId:destinationReservation})}});
  await expect(managedStockOperations.relocationContext(item,owner)).rejects.toThrow();
  mockWire.mockResolvedValueOnce({success:true,data:{status:'COMMITTED',movement:{...movement,customerId:facilityId}}});
  await expect(managedStockOperations.relocationConfirm(item,reservation,owner,{...body,customerAttestation:'CONFIRMED'},key)).rejects.toThrow();
});
