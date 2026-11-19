import {managedInboundPreview,buildUnifiedInboundRequest,eligibleInboundCells} from '../src/api/managedInboundPreview';
import {wire} from '../src/api/client';

jest.mock('../src/api/client',()=>({wire:jest.fn(),MobileInputError:class MobileInputError extends Error{}}));
const mockWire=wire as jest.MockedFunction<typeof wire>;
const owner='1'.repeat(24),skuId='2'.repeat(24),reservationId='3'.repeat(24),facilityId='4'.repeat(24),sessionId='5'.repeat(24),
  specId='6'.repeat(24),secondSpecId='7'.repeat(24),cellId='8'.repeat(24),secondCellId='9'.repeat(24);
const item={_id:skuId,customerId:owner,inventorySchemaVersion:3,status:'ACTIVE',managedReservationId:reservationId,facilityId} as never;
const reservation={_id:reservationId,customerId:owner,facilityId,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',
  startDate:'2026-01-01T00:00:00Z',endDate:'2027-01-01T00:00:00Z',allocatedCellIds:[cellId,secondCellId]} as never;
const cell={cellId,quantityOnHand:2,quantityHeld:0,quantityAvailable:2,weightKg:2,volumeM3:.01};
const stock={skuId,reservationId,facilityId,totalQuantity:2,totalWeightKg:2,totalVolumeM3:.01,reconciliationStatus:'VERIFIED',
  itemSpecifications:[{itemSpecId:specId,code:'BOX',name:'Hộp',quantityUnit:'cái',quantityOnHand:2,quantityHeld:0,quantityAvailable:2,totalWeightKg:2,totalVolumeM3:.01,byCell:[cell]}],byCell:[cell]};
const movement={_id:'a'.repeat(24),itemId:skuId,managedReservationId:reservationId,customerId:owner,facilityId,schemaVersion:4,operationId:'op-inbound-1',
  idempotencyKey:'wdp-mobile-12345678-1234-4234-8234-123456789abc',performedAt:'2026-11-18T10:00:00.000Z',quantity:2,quantityUnit:'cái',
  stockEffect:{action:'ADD',operationId:'op-inbound-1',ledgerRevision:2,destination:[{itemSpecId:specId,cellId,quantity:2}]}};

beforeEach(()=>mockWire.mockReset());

it('builds a validated multi-specification request with cell allocations',()=>{
  const request=buildUnifiedInboundRequest({accessSessionId:sessionId,sessionRevision:4,skuRevision:9,lines:[
    {lineId:'line-a',itemSpecId:specId,itemSpecRevision:2,quantity:2,measurementMode:'SPECIFICATION',cellAllocations:[{cellId,quantity:2}]},
    {lineId:'line-b',itemSpecId:secondSpecId,itemSpecRevision:1,quantity:1,measurementMode:'SPECIFICATION',cellAllocations:[{cellId:secondCellId,quantity:1}]},
  ]});
  expect(request.lines).toHaveLength(2);
  expect(request.lines.map(line=>line.cellAllocations[0]?.quantity)).toEqual([2,1]);
  expect(()=>buildUnifiedInboundRequest({accessSessionId:sessionId,sessionRevision:4,skuRevision:9,lines:[
    {lineId:'bad',itemSpecId:specId,itemSpecRevision:2,quantity:2,measurementMode:'SPECIFICATION',cellAllocations:[{cellId,quantity:1}]},
  ]})).toThrow();
});

it('accepts the Backend inbound context shape with populated quantity unit and omitted flattened convenience fields',async()=>{
  mockWire.mockResolvedValueOnce({success:true,data:{skuId,reservationId,facilityId,skuRevision:11,apiVersion:3,allocatedCellIds:[cellId,secondCellId],
    specifications:[{_id:specId,skuId,code:'BOX-PAPER',name:'Paper box',quantityUnitId:{_id:'a'.repeat(24),code:'PCS',name:'piece'},
      dimensionsM:{widthM:.2,depthM:.2,heightM:.2},unitWeightKg:20,unitVolumeM3:.008,revision:5,status:'ACTIVE'}]}});
  await expect(managedInboundPreview.context(item,reservation,owner)).resolves.toMatchObject({skuRevision:11,specifications:[{
    _id:specId,itemSpecId:specId,skuId,code:'BOX-PAPER',quantityUnitId:'a'.repeat(24),quantityUnit:'piece',quantityUnitCode:'PCS',revision:5,
  }]});
  expect(mockWire).toHaveBeenCalledWith('GET',`/inventory-items/${skuId}/v3/inbound/context`,expect.objectContaining({}));
});

it('accepts a valid empty inbound context and rejects malformed or cross-SKU context data',async()=>{
  const valid={skuId,reservationId,facilityId,skuRevision:0,apiVersion:3,allocatedCellIds:[cellId,secondCellId],specifications:[]};
  mockWire.mockResolvedValueOnce({success:true,data:valid});
  await expect(managedInboundPreview.context(item,reservation,owner)).resolves.toMatchObject({specifications:[]});
  mockWire.mockResolvedValueOnce({success:true,data:{...valid,allocatedCellIds:undefined}});
  await expect(managedInboundPreview.context(item,reservation,owner)).rejects.toThrow();
  mockWire.mockResolvedValueOnce({success:true,data:{...valid,skuId:secondCellId}});
  await expect(managedInboundPreview.context(item,reservation,owner)).rejects.toThrow();
  mockWire.mockResolvedValueOnce({success:true,data:{...valid,reservationId:secondCellId}});
  await expect(managedInboundPreview.context(item,reservation,owner)).rejects.toThrow();
});

it('keeps Context read errors separate from a dependent Stock read failure',async()=>{
  mockWire.mockResolvedValueOnce({success:true,data:{skuId,reservationId,facilityId,skuRevision:0,apiVersion:3,allocatedCellIds:[cellId,secondCellId],specifications:[]}})
    .mockRejectedValueOnce(new Error('stock read unavailable'));
  await expect(managedInboundPreview.context(item,reservation,owner)).resolves.toMatchObject({skuId});
  await expect(managedInboundPreview.stockReadback(item,reservation,owner)).rejects.toThrow('stock read unavailable');
  expect(mockWire.mock.calls.map(call=>call[1])).toEqual([`/inventory-items/${skuId}/v3/inbound/context`,`/inventory-items/${skuId}/v3/stock`]);
});

it('filters expired, absent-purpose, and wrong-scope sessions without altering valid Context',async()=>{
  const now=Date.now(),active:Parameters<typeof eligibleInboundCells>[1]={_id:sessionId,visitId:reservationId,reservationId,customerId:owner,facilityId,assignedStaffId:owner,
    allowedCellIds:[cellId],allowedPurposes:['INBOUND'],status:'ACTIVE',revision:3,startedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};
  expect(eligibleInboundCells(reservation,active)).toEqual([cellId]);
  expect(eligibleInboundCells(reservation,{...active,expiresAt:new Date(now-1000).toISOString()})).toEqual([]);
  expect(eligibleInboundCells(reservation,{...active,allowedPurposes:[]})).toEqual([]);
  expect(eligibleInboundCells(reservation,{...active,customerId:secondCellId})).toEqual([]);
});

it('reads SKU and Cell Stock through the customer-safe V3 DTO and keeps each read scoped',async()=>{
  mockWire.mockResolvedValueOnce({success:true,data:stock}).mockResolvedValueOnce({success:true,data:stock})
    .mockResolvedValueOnce({success:true,data:{skuId,itemSpecId:specId,reconciliationStatus:'VERIFIED',quantityOnHand:2,quantityHeld:0,quantityAvailable:2,
      totalWeightKg:2,totalVolumeM3:.01,byCell:[cell]}});
  await expect(managedInboundPreview.stockReadback(item,reservation,owner)).resolves.toMatchObject({skuId,reconciliationStatus:'VERIFIED'});
  await expect(managedInboundPreview.cellStockReadback(item,reservation,owner)).resolves.toMatchObject({byCell:[cell]});
  await expect(managedInboundPreview.specificationStockReadback(item,reservation,owner,specId)).resolves.toMatchObject({itemSpecId:specId,quantityOnHand:2});
  expect(mockWire.mock.calls.map(call=>call[1])).toEqual([
    `/inventory-items/${skuId}/v3/stock`,`/inventory-items/${skuId}/v3/cell-stock`,`/inventory-items/${skuId}/v3/specifications/${specId}/cell-stock`,
  ]);
});

it('preserves NO_ACTIVITY and downgrades inconsistent or unknown totals instead of presenting them as reconciled',async()=>{
  const noActivity={skuId,reservationId,facilityId,totalQuantity:0,totalWeightKg:0,totalVolumeM3:0,reconciliationStatus:'NO_ACTIVITY',itemSpecifications:[],byCell:[]};
  mockWire.mockResolvedValueOnce({success:true,data:noActivity});
  await expect(managedInboundPreview.stockReadback(item,reservation,owner)).resolves.toMatchObject({totalQuantity:0,reconciliationStatus:'NO_ACTIVITY'});
  mockWire.mockResolvedValueOnce({success:true,data:{...stock,totalQuantity:1,reconciliationStatus:'VERIFIED',itemSpecifications:[{...stock.itemSpecifications[0]!,quantityOnHand:1,byCell:[]}],byCell:[]}});
  await expect(managedInboundPreview.stockReadback(item,reservation,owner)).resolves.toMatchObject({totalQuantity:1,reconciliationStatus:'CHECKING'});
  mockWire.mockResolvedValueOnce({success:true,data:{...stock,totalQuantity:1,reconciliationStatus:'CHECKING',itemSpecifications:[{...stock.itemSpecifications[0]!,quantityOnHand:1,byCell:[]}],byCell:[]}});
  await expect(managedInboundPreview.cellStockReadback(item,reservation,owner)).resolves.toMatchObject({totalQuantity:1,reconciliationStatus:'CHECKING',byCell:[]});
});

it('keeps committed Movement evidence distinct from pending Stock projection and does not Confirm on an Operation Lookup 404',async()=>{
  mockWire.mockResolvedValueOnce({success:true,data:{status:'COMMITTED',movement}})
    .mockResolvedValueOnce({success:true,data:{...stock,reconciliationStatus:'CHECKING',totalQuantity:1,byCell:[]}})
    .mockRejectedValueOnce({response:{status:404,data:{code:'OPERATION_NOT_FOUND'}}});
  await expect(managedInboundPreview.operation(item,reservation,owner,movement.idempotencyKey)).resolves.toMatchObject({operationId:'op-inbound-1'});
  await expect(managedInboundPreview.stockReadback(item,reservation,owner)).resolves.toMatchObject({reconciliationStatus:'CHECKING',totalQuantity:1});
  await expect(managedInboundPreview.operation(item,reservation,owner,movement.idempotencyKey)).rejects.toMatchObject({response:{status:404}});
  expect(mockWire.mock.calls.map(([method])=>method)).toEqual(['GET','GET','GET']);
  expect(mockWire.mock.calls.every(([method])=>method!=='POST')).toBe(true);
});

it('validates a committed operation lookup against key, customer, reservation, and facility scope',async()=>{
  mockWire.mockResolvedValue({success:true,data:{status:'COMMITTED',movement}});
  await expect(managedInboundPreview.operation(item,reservation,owner,movement.idempotencyKey)).resolves.toMatchObject({operationId:'op-inbound-1',quantity:2});
  const wrongScope={...movement,facilityId:'f'.repeat(24)};
  mockWire.mockResolvedValueOnce({success:true,data:{status:'COMMITTED',movement:wrongScope}});
  await expect(managedInboundPreview.operation(item,reservation,owner,movement.idempotencyKey)).rejects.toThrow();
});

it('validates confirm acknowledgement and reads Movement History from its bounded endpoint',async()=>{
  const body=buildUnifiedInboundRequest({accessSessionId:sessionId,sessionRevision:4,skuRevision:9,lines:[
    {lineId:'line-a',itemSpecId:specId,itemSpecRevision:2,quantity:2,measurementMode:'SPECIFICATION',cellAllocations:[{cellId,quantity:2}]},
  ]});
  mockWire.mockResolvedValueOnce({success:true,data:{status:'COMMITTED',replayed:false,movementId:movement._id,quantity:2}})
    .mockResolvedValueOnce({success:true,data:[movement]});
  await expect(managedInboundPreview.confirm(item,reservation,owner,body,movement.idempotencyKey)).resolves.toMatchObject({status:'COMMITTED'});
  await expect(managedInboundPreview.movementsReadback(item,reservation,owner)).resolves.toHaveLength(1);
  expect(mockWire).toHaveBeenNthCalledWith(1,'POST',`/inventory-items/${skuId}/v3/inbound`,expect.objectContaining({body,key:movement.idempotencyKey}));
  expect(mockWire).toHaveBeenNthCalledWith(2,'GET',`/inventory-items/${skuId}/v3/movements`,expect.objectContaining({}));
});
