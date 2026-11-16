import {eligibleInboundCells,managedInboundPreview} from '../src/api/managedInboundPreview';
import {managedReservationReads,mapManagedAccessRows} from '../src/api/managedReservationReads';
import {managedSkuEligible,saveManagedSku} from '../src/api/managedSkuV3';
import {apiClient,configureApiSession} from '../src/api/client';
import {createManagedBooking,managedBookingPolicy,managedCreationPriceReview,managedPriceNeedsAcceptance,sameManagedQuote} from '../src/api/managedBookingV3';
import {managedCheckoutAction,managedPayment,managedPaymentApplied} from '../src/api/managedPaymentV3';
import {mapManagedQuote} from '../src/api/contracts/booking';

const [owner,facilityId,cellId,id,paymentId]=['1','2','3','4','5'].map(value=>value.repeat(24)) as [string,string,string,string,string];
const startDate='2099-01-01T00:00:00.000Z',endDate='2099-02-01T00:00:00.000Z';
const range={startDate,endDate};
const body={facilityId,startDate,term:{unit:'MONTH' as const,value:1},cellIds:[cellId],allocatedCapacityM3:1,
  termsAccepted:true as const,termsVersionId:'FIXTURE@1'};
const rental={...range,_id:id,customerId:owner,facilityId,reservationCode:'FIXTURE',serviceType:'MANAGED_INVENTORY' as const,
  status:'RESERVED' as const,bookingFlowVersion:3 as const,rentalPaymentFlow:'FULL_UPFRONT_V1' as const,allocatedCapacity:1,
  allocatedCellIds:[cellId],expiresAt:'2098-12-31T00:00:00.000Z'};
const payment={id:paymentId,reservationId:id,purpose:'FULL_RENT' as const,amount:1000,currency:'VND' as const,provider:'PAYOS' as const,
  providerSettlementStatus:'NOT_VERIFIED' as const,applicationStatus:'NOT_APPLIED' as const,status:'PENDING' as const,
  checkoutStatus:'UNKNOWN' as const,checkoutUrl:null,qrCode:null,reconciliationRequired:false,succeededAt:null};
const adapter=apiClient.defaults.adapter;
beforeEach(()=>configureApiSession('fixture'));
afterEach(()=>{apiClient.defaults.adapter=adapter;configureApiSession();});

test('reads published Managed Terms, never Self Storage Terms',async()=>{
  apiClient.defaults.adapter=async config=>{
    expect(config.params).toEqual({serviceType:'MANAGED_INVENTORY'});
    expect(config.url).toBe('/public/terms/current');
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{
      version:'1',versionId:'FIXTURE@1',status:'PUBLISHED',services:['MANAGED_INVENTORY'],
      groups:[{id:'P01',title:'Fixture',appliesTo:['MANAGED_INVENTORY'],sections:{MANAGED_INVENTORY:['Điều khoản fixture']}}],
    }}};
  };
  await expect(managedBookingPolicy()).resolves.toMatchObject({versionId:'FIXTURE@1'});
});

test('replays the exact booking payload with the same key and verifies allocated Cells',async()=>{
  let calls=0;
  apiClient.defaults.adapter=async config=>{
    calls++;
    expect(config.url).toBe('/reservations/managed');
    expect(config.headers.get('Idempotency-Key')).toBe('fixture-booking-key');
    expect(JSON.parse(config.data)).toEqual(body);
    const reservation=calls<3?rental:{...rental,allocatedCellIds:[paymentId]};
    return {config,status:201,statusText:'OK',headers:{},data:{success:true,data:{reservation,idempotent:calls>1}}};
  };
  await expect(createManagedBooking(body,range,'fixture-booking-key',owner)).resolves.toMatchObject({_id:id});
  await expect(createManagedBooking(body,range,'fixture-booking-key',owner)).resolves.toMatchObject({_id:id});
  await expect(createManagedBooking(body,range,'fixture-booking-key',owner)).rejects.toThrow();
});

test('reconfirmation rejects a changed V3 price or pricing version',()=>{
  const value={...range,facilityId,term:body.term,cellIds:[cellId],allocatedCapacityM3:1,availableCapacityM3:2,
    bookingFlowVersion:3,taxAmount:0,payment:{purpose:'FULL_RENT',amount:1000,currency:'VND'},
    pricing:{ruleId:paymentId,version:1,billingBasis:'PER_M3',ratePerM3:1000,currency:'VND',estimatedRent:1000}};
  const reviewed=mapManagedQuote({success:true,data:value});
  if(reviewed.bookingFlowVersion!==3)throw Error('Fixture is not V3');
  expect(sameManagedQuote(reviewed,reviewed)).toBe(true);
  expect(sameManagedQuote(reviewed,{...reviewed,pricing:{...reviewed.pricing,version:2}})).toBe(false);
  expect(sameManagedQuote(reviewed,{...reviewed,payment:{...reviewed.payment,amount:1200}})).toBe(false);
});

test('server-created Managed rent difference requires explicit local consent before PayOS can continue',()=>{
  expect(managedCreationPriceReview(1000,{...rental,estimatedRent:1000})).toBeUndefined();
  const review=managedCreationPriceReview(1000,{...rental,estimatedRent:1200});
  expect(review).toEqual({quotedAmount:1000,authoritativeAmount:1200,accepted:false});
  expect(managedPriceNeedsAcceptance(review)).toBe(true);
  expect(managedPriceNeedsAcceptance({...review!,accepted:true})).toBe(false);
});

test('Managed checkout uses FULL_RENT with the Web callback default and verifies settlement',async()=>{
  apiClient.defaults.adapter=async config=>{
    expect(config.url).toBe('/reservations/managed/'+id+'/payments/payos');
    expect(config.headers.get('X-WDP-Payment-Client')).toBeUndefined();
    expect(config.headers.get('Idempotency-Key')).toBe('fixture-payment-key');
    expect(JSON.parse(config.data)).toEqual({purpose:'FULL_RENT'});
    return {config,status:201,statusText:'OK',headers:{},data:{success:true,outcome:'CREATED',data:payment}};
  };
  const row=await managedPayment.checkout(rental,owner,'fixture-payment-key');
  expect(row.checkoutStatus).toBe('UNKNOWN');
  expect(managedPaymentApplied(row)).toBe(false);
  expect(managedPaymentApplied({...row,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED'})).toBe(true);
  await expect(managedPayment.checkout(rental,cellId,'fixture-payment-key')).rejects.toThrow();
  await expect(managedPayment.checkout({...rental,bookingFlowVersion:2},owner,'fixture-payment-key')).rejects.toThrow();
});

test('unknown payment blocks new keys while an unbound attempt can replay the same key',()=>{
  expect(managedCheckoutAction([payment],{})).toBe('BLOCKED');
  expect(managedCheckoutAction([],{})).toBe('RECOVER');
  expect(managedCheckoutAction([],{resourceId:paymentId})).toBe('BLOCKED');
  expect(managedCheckoutAction([{...payment,status:'FAILED',checkoutStatus:'FAILED',retryAllowed:true}],{resourceId:paymentId})).toBe('RETRY');
});

test('access records reject foreign owners or facilities and closure is read-only',async()=>{
  const row={customerId:owner,reservationId:id,facilityId};
  expect(mapManagedAccessRows([row,{...row,reservationId:cellId}],rental,owner)).toEqual([row]);
  expect(()=>mapManagedAccessRows([{...row,customerId:cellId}],rental,owner)).toThrow();
  expect(()=>mapManagedAccessRows([{...row,facilityId:cellId}],rental,owner)).toThrow();
  apiClient.defaults.adapter=async config=>{
    expect(config.method).toBe('get');
    expect(config.url).toBe('/reservations/managed/'+id+'/closure-readiness');
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{
      reservationId:id,serviceType:'MANAGED_INVENTORY',readonly:true,overallReadiness:'BLOCKED',
      blockers:[{code:'STOCK_REMAINING',scope:'reservation',message:'Fixture'}],
    }}};
  };
  await expect(managedReservationReads.readiness(rental,owner)).resolves.toMatchObject({readonly:true,overallReadiness:'BLOCKED'});
});

test('SKU registration sends only metadata after verifying eligible V3 reservation',async()=>{
  const latest={...rental,status:'CHECKIN_READY'};
  const input={managedReservationId:id,itemCode:'SKU-1',name:'Box',category:'Boxes',quantity:2,quantityUnit:'box',
    unitWeightKg:1,unitDimensionsM:{widthM:1,depthM:1,heightM:1}};
  const paths:string[]=[];
  apiClient.defaults.adapter=async config=>{
    paths.push(config.method+' '+config.url);
    if(config.method==='post')expect(JSON.parse(config.data)).toEqual(input);
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:config.method==='get'?latest:{
      ...input,_id:cellId,customerId:owner,facilityId,inventorySchemaVersion:3,status:'REGISTERED',currentCellId:null,
    }}};
  };
  expect(managedSkuEligible(rental)).toBe(false);
  await expect(saveManagedSku(rental,owner,input,()=>false)).rejects.toThrow();
  await expect(saveManagedSku(rental,owner,input,()=>true)).resolves.toMatchObject({itemCode:'SKU-1',status:'REGISTERED',currentCellId:null});
  expect(paths).toEqual(['get /reservations/managed/'+id,'get /reservations/managed/'+id,'post /inventory-items']);
});

test('A1 and A2 preview omit confirm-only fields and validate scoped, current proof',async()=>{
  const r={...rental,status:'ACTIVE' as const,startDate:'2025-01-01T00:00:00.000Z'};
  const item={_id:cellId,managedReservationId:id,facilityId,customerId:owner,inventorySchemaVersion:3,
    itemCode:'BOX',name:'Box',category:'Boxes',quantity:2,quantityUnit:'box',unitWeightKg:1,
    unitDimensionsM:{widthM:1,depthM:1,heightM:1},status:'REGISTERED' as const};
  const session={_id:paymentId,visitId:id,reservationId:id,customerId:owner,facilityId,assignedStaffId:owner,
    allowedCellIds:[cellId],allowedPurposes:['INBOUND' as const],status:'ACTIVE' as const,revision:2,
    startedAt:r.startDate,expiresAt:endDate};
  const a1={accessSessionId:session._id,itemKind:'A1_PHYSICAL_UNIT',physicalUnitId:owner,cellIds:[cellId],
    pose:{xStartM:0,yStartM:0,rotationDeg:90}};
  const a2={accessSessionId:session._id,itemKind:'A2_BATCH',cellIds:[cellId],
    quantity:2,quantityUnit:'box',actualUnitWeightKg:1,dimensionsM:item.unitDimensionsM,placements:[{cellId,quantity:2}]};
  let calls=0;
  apiClient.defaults.adapter=async config=>{
    calls++;
    expect(config.url).toBe('/inventory-items/'+cellId+'/v3/inbound/preview');
    const body=JSON.parse(config.data);
    expect(body).not.toHaveProperty('sessionRevision');
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{
      status:'READY',skuId:cellId,reservationId:id,accessSessionId:session._id,itemKind:body.itemKind,cellIds:[cellId],
      sessionRevision:2,previewRevision:0,expiresAt:endDate,quantity:calls===1?1:2,weightKg:2,volumeM3:2,
      physicalUnitId:owner,topologyCertificationId:paymentId,topologyRevision:1,
      topologyCertificationIds:[paymentId],topologyRevisions:[1],
    }}};
  };
  expect(eligibleInboundCells(r,{...session,status:'EXPIRED'})).toEqual([]);
  expect(eligibleInboundCells(r,{...session,allowedPurposes:['OUTBOUND']})).toEqual([]);
  expect(eligibleInboundCells(r,{...session,reservationId:facilityId})).toEqual([]);
  expect(eligibleInboundCells(r,{...session,facilityId:paymentId})).toEqual([]);
  expect(eligibleInboundCells({...r,endDate:'2025-01-02T00:00:00.000Z'},session)).toEqual([]);
  await expect(managedInboundPreview.preview(item,r,owner,session,{...a1,cellIds:[cellId,facilityId]})).rejects.toThrow();
  await expect(managedInboundPreview.preview(item,r,owner,session,a1)).resolves.toMatchObject({itemKind:'A1_PHYSICAL_UNIT',quantity:1});
  await expect(managedInboundPreview.preview(item,r,owner,session,a2)).resolves.toMatchObject({itemKind:'A2_BATCH',quantity:2});
  expect(calls).toBe(2);
});

test('visit cancellation sends the server revision and verifies the returned visit',async()=>{
  const visit={_id:paymentId,customerId:owner,reservationId:id,facilityId,purpose:'INBOUND' as const,
    status:'SCHEDULED' as const,revision:2,startsAt:startDate,endsAt:endDate};
  apiClient.defaults.adapter=async config=>{
    expect(config.method).toBe('post');
    expect(config.url).toBe('/access/managed-v3/visits/'+paymentId+'/cancel');
    expect(config.headers.get('If-Match')).toBe('2');
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{...visit,status:'CANCELLED',revision:3}}};
  };
  await expect(managedReservationReads.cancelVisit(rental,owner,visit)).resolves.toMatchObject({status:'CANCELLED',revision:3});
  await expect(managedReservationReads.cancelVisit(rental,cellId,visit)).rejects.toThrow();
});

test('inbound confirm and committed lookup use the same key and reject mismatched operation evidence',async()=>{
  const item={_id:cellId,managedReservationId:id,facilityId,customerId:owner,inventorySchemaVersion:3,
    itemCode:'BOX',name:'Box',category:'Boxes',quantity:2,quantityUnit:'box',unitWeightKg:1,
    unitDimensionsM:{widthM:1,depthM:1,heightM:1},status:'REGISTERED' as const};
  const key='fixture-inbound';
  let returnedKey=key;
  apiClient.defaults.adapter=async config=>{
    if(config.method==='post'){
      expect(config.url).toBe('/inventory-items/'+cellId+'/v3/inbound');
      expect(config.headers.get('Idempotency-Key')).toBe(key);
      return {config,status:201,statusText:'OK',headers:{},data:{success:true}};
    }
    expect(config.params).toEqual({key});
    return {config,status:200,statusText:'OK',headers:{},data:{success:true,data:{status:'COMMITTED',movement:{
      _id:paymentId,itemId:cellId,managedReservationId:id,facilityId,customerId:owner,schemaVersion:3,
      idempotencyKey:returnedKey,operationId:'fixture-op',performedAt:startDate,quantity:1,quantityUnit:'box',
      v3Effect:{action:'ADD',itemKind:'A1_PHYSICAL_UNIT'},
    }}}};
  };
  await managedInboundPreview.confirm(item,rental,owner,{previewRevision:1},key);
  await expect(managedInboundPreview.operation(item,rental,owner,key)).resolves.toMatchObject({operationId:'fixture-op'});
  returnedKey='different';
  await expect(managedInboundPreview.operation(item,rental,owner,key)).rejects.toThrow();
});
