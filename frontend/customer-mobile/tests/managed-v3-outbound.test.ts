import {managedStockOperations} from '../src/api/managedStockOperations';
import {wire} from '../src/api/client';

jest.mock('../src/api/client',()=>({wire:jest.fn(),MobileInputError:class MobileInputError extends Error{}}));
const mockWire=wire as jest.MockedFunction<typeof wire>;
const [owner,skuId,reservationId,facilityId,sessionId,specId,cellId,movementId]=[
  '1'.repeat(24),'2'.repeat(24),'3'.repeat(24),'4'.repeat(24),'5'.repeat(24),'6'.repeat(24),'7'.repeat(24),'8'.repeat(24),
] as const;
const item={_id:skuId,customerId:owner,inventorySchemaVersion:3,status:'ACTIVE',managedReservationId:reservationId,facilityId} as never;
const reservation={_id:reservationId,customerId:owner,facilityId,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',
  startDate:'2026-01-01T00:00:00.000Z',endDate:'2027-01-01T00:00:00.000Z'} as never;
const session={_id:sessionId,revision:4,allowedPurposes:['OUTBOUND']} as never;
const body={accessSessionId:sessionId,sessionRevision:4,skuRevision:12,reservationId,lines:[{lineId:'line-1',itemSpecId:specId,itemSpecRevision:2,quantity:3}],
  physicalRemovalConfirmed:true,customerAttestation:'CUSTOMER_CONFIRMED_PHYSICAL_REMOVAL'};
const key='wdp-mobile-12345678-1234-4234-8234-123456789abc';
const movement={_id:movementId,itemId:skuId,managedReservationId:reservationId,facilityId,customerId:owner,type:'OUTBOUND',schemaVersion:4,
  idempotencyKey:key,operationId:'MI-OUT:fixture',movementCode:'MI-OUT-001',performedAt:'2026-11-18T10:00:00.000Z',quantity:3,quantityUnit:'cái',
  stockEffect:{action:'REMOVE',source:[{itemSpecId:specId,cellId,receiptId:'receipt-older',quantity:3}]}};
const committed={success:true,data:{status:'COMMITTED',movement}};

beforeEach(()=>mockWire.mockReset());

it('sends a backend-planned FIFO preview without choosing receipt or Cell allocations on Mobile',async()=>{
  const preview={status:'READY',skuId,reservationId,facilityId,accessSession:{sessionId,purpose:'OUTBOUND',revision:4,expiresAt:'2026-11-18T12:00:00.000Z'},
    lines:[{itemSpecId:specId,quantityBefore:10,quantityOut:3,quantityAfter:7,quantityUnit:'cái',sources:[{receiptId:'receipt-older',cellId,quantity:3}]}],totalQuantity:3,totalWeightKg:1,totalVolumeM3:.1};
  mockWire.mockResolvedValue({success:true,data:preview});
  await expect(managedStockOperations.outboundPreview(item,reservation,owner,session,body)).resolves.toMatchObject(preview);
  expect(mockWire).toHaveBeenCalledWith('POST',`/inventory-items/${skuId}/v3/outbound/preview`,{body});
  expect(body.lines[0]).not.toHaveProperty('cellAllocations');
});

it('confirms with the stable key and quoted If-Match revision, then verifies the committed outbound scope',async()=>{
  mockWire.mockResolvedValue(committed);
  await expect(managedStockOperations.outboundConfirm(item,reservation,owner,body,key)).resolves.toMatchObject({status:'COMMITTED',movement:{type:'OUTBOUND',stockEffect:{action:'REMOVE'}}});
  expect(mockWire).toHaveBeenCalledWith('POST',`/inventory-items/${skuId}/v3/outbound`,{body,key,ifMatch:'"12"'});
});

it('rejects a committed response with a different Reservation, customer, or action',async()=>{
  mockWire.mockResolvedValueOnce({success:true,data:{status:'COMMITTED',movement:{...movement,managedReservationId:facilityId}}});
  await expect(managedStockOperations.outboundConfirm(item,reservation,owner,body,key)).rejects.toThrow();
  mockWire.mockResolvedValueOnce({success:true,data:{status:'COMMITTED',movement:{...movement,stockEffect:{...movement.stockEffect,action:'ADD'}}}});
  await expect(managedStockOperations.outboundOperation(item,reservation,owner,key)).rejects.toThrow();
});

it('uses operation lookup only; a not-found response never triggers a second Confirm',async()=>{
  mockWire.mockRejectedValue({response:{status:404,data:{code:'OUTBOUND_OPERATION_NOT_FOUND'}}});
  await expect(managedStockOperations.outboundOperation(item,reservation,owner,key)).rejects.toMatchObject({response:{status:404}});
  expect(mockWire).toHaveBeenCalledTimes(1);
  expect(mockWire).toHaveBeenCalledWith('GET',`/inventory-items/${skuId}/v3/outbound/operations`,{params:{key}});
});

it('rejects preview when the selected session does not grant OUTBOUND purpose',async()=>{
  await expect(managedStockOperations.outboundPreview(item,reservation,owner,{_id:sessionId,revision:4,allowedPurposes:['INBOUND']} as never,body)).rejects.toThrow();
  expect(mockWire).not.toHaveBeenCalled();
});
