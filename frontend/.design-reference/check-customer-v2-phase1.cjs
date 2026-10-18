const {test}=require('node:test');
const assert=require('node:assert/strict');
const service=()=>import('../src/lib/customerReservationService.js');
const cells=()=>import('../src/lib/managedCellBooking.js');
const cellRow=n=>({cell:{_id:n.toString(16).padStart(24,'0'),isBookable:true,physicalUsageKnown:true,operationalStatus:'AVAILABLE',bookingStatus:'AVAILABLE',displayStatus:'AVAILABLE',periodStatus:'AVAILABLE',usedWeightKg:0,usedVolumeM3:0,dimensions:{widthM:.5,depthM:.6,usableHeightM:.4}},rack:{_id:(n%2?'2':'3').repeat(24),zoneId:(n%2?'4':'5').repeat(24),facilityId:'1'.repeat(24),operationalStatus:'AVAILABLE'},level:{levelNumber:1}});
test('CV2-009: explicit eligibility flags are required even with numeric zero counters',async()=>{
 const b=await cells(),range=b.bookingInterval('2030-01-31',{value:1,unit:'MONTH'}),x=cellRow(1);assert.equal(b.cellBookingReason(x.cell,x.rack,range),'');
 for(const key of ['isBookable','physicalUsageKnown'])for(const value of [false,null,undefined,0,'true']){const cell={...x.cell,[key]:value,isMine:true};assert(b.cellBookingReason(cell,x.rack,range));assert.throws(()=>b.selectedPayload('1'.repeat(24),[{...x,cell}],range,{value:1,unit:'MONTH'}));}
 assert(b.cellBookingReason(x.cell,{...x.rack,operationalStatus:'BLOCKED'},range));assert(b.cellBookingReason(x.cell,x.rack,{...range,endDate:'invalid'}));
});
test('CV2-009: cross-Rack/Zone, unique limits, scope and no physical writes',async()=>{
 const b=await cells(),term={value:1,unit:'MONTH'},range=b.bookingInterval('2030-01-31',term),rows=Array.from({length:100},(_,i)=>cellRow(i+1)),before=structuredClone(rows);
 assert.equal(b.selectedPayload('1'.repeat(24),rows,range,term).cellIds.length,100);assert.equal(b.selectedPayload('1'.repeat(24),rows.slice(0,2),range,term).allocatedCapacityM3,.24);assert.deepEqual(rows,before);
 assert.throws(()=>b.selectedPayload('1'.repeat(24),[...rows,cellRow(101)],range,term));assert.throws(()=>b.selectedPayload('1'.repeat(24),[rows[0],rows[0]],range,term));assert.throws(()=>b.selectedPayload('a'.repeat(24),[rows[0]],range,term));
 const stale={...rows[0],cell:{...rows[0].cell,isBookable:false}};assert.throws(()=>b.selectedPayload('1'.repeat(24),[stale],range,term));
 assert.throws(()=>b.selectedPayload('1'.repeat(24),[rows[0]],{...range,endDate:'2030-03-31T00:00:00.000Z'},term));
});
const money=()=>import('../src/lib/managedRentalPricing.js');
const quote=(deposit=20)=>({bookingFlowVersion:2,pricing:{estimatedRent:100,currency:'VND'},taxAmount:0,deposit:{amount:deposit},paymentBreakdown:{totalDue:100,depositCredit:deposit,balanceDue:100-deposit}});
test('CV2-003: authoritative advance credit, full advance and immutable quote',async()=>{
 const m=await money(),q=quote(),copy=structuredClone(q);assert.deepEqual(m.managedQuoteFinancials(q),{totalRentPayable:100,advanceDepositRequired:20,balanceAfterDeposit:80,currency:'VND'});assert.equal(m.managedQuoteFinancials(quote(100)).balanceAfterDeposit,0);assert.deepEqual(q,copy);
});
test('CV2-003: invalid, negative, nonfinite and missing financial fields are rejected',async()=>{
 const m=await money();for(const deposit of [101,-1,NaN,Infinity])assert.throws(()=>m.managedQuoteFinancials(quote(deposit)));
 for(const patch of [{paymentBreakdown:undefined},{paymentBreakdown:{totalDue:100,depositCredit:20}},{paymentBreakdown:{totalDue:100,depositCredit:20,balanceDue:100}},{paymentBreakdown:{totalDue:99,depositCredit:20,balanceDue:79}},{paymentBreakdown:{totalDue:Infinity,depositCredit:20,balanceDue:80}},{pricing:{estimatedRent:100}},{taxAmount:undefined},{taxAmount:-1},{bookingFlowVersion:undefined}])assert.throws(()=>m.managedQuoteFinancials({...quote(),...patch}));
});
test('CV2-003: scheduled snapshot credit is not a confirmed payment',async()=>{
 const m=await money(),r={serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:'RESERVED',managedPricingSnapshot:{pricingRule:{currency:'VND'},amountBreakdown:{estimatedRent:100,depositAmount:20,taxAmount:0,discountAmount:0,totalDue:100,depositCredit:20,balanceDue:80}}};
 assert.equal(m.managedReservationFinancials(r).confirmedDepositCredit,0);assert.equal(m.managedReservationFinancials(r).remainingRentDue,100);assert.equal(m.managedReservationFinancials({...r,status:'DEPOSIT_PAID'}).remainingRentDue,80);assert.equal(m.managedReservationFinancials({...r,status:'CHECKIN_READY'}).remainingRentDue,0);assert.equal(m.managedReservationFinancials({...r,status:'CANCELLED'}).confirmedDepositCredit,null);assert.throws(()=>m.managedReservationFinancials({...r,depositAmount:30}));assert.throws(()=>m.managedReservationFinancials({...r,managedPricingSnapshot:undefined}));
});
test('CV2-002: explicit service and numeric version only',async()=>{
 const s=await service(),r={serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:'RESERVED'};
 assert(s.isManagedV2(r));for(const patch of [{bookingFlowVersion:undefined},{bookingFlowVersion:null},{bookingFlowVersion:1},{bookingFlowVersion:'2'},{bookingFlowVersion:3},{serviceType:'SELF_STORAGE'},{serviceType:undefined}])assert(!s.isManagedV2({...r,...patch}));
 assert.equal(s.reservationLifecycle({serviceType:'MANAGED_INVENTORY',status:'DEPOSIT_PAID'}).flow,'MANAGED_LEGACY');assert.equal(s.reservationLifecycle({...r,bookingFlowVersion:3}).flow,'UNKNOWN');
});
test('CV2-002: V2 states cannot reach legacy sign/pay actions',async()=>{
 const s=await service(),base={serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,expiresAt:'2030-02-01T00:00:00Z'},now=Date.parse('2030-01-01T00:00:00Z');
 for(const status of ['RESERVED','DEPOSIT_PAID','CHECKIN_READY','ACTIVE','CONTRACTED','PAID']){const r={...base,status};assert(!s.canSign({status:'DRAFT'},r,now));assert(!s.canMockPay(r,{status:'SIGNED',signedByCustomerAt:'2030-01-01'},true,now));assert.equal(s.canCancel(r),status==='RESERVED');}
 assert.match(s.reservationLifecycle({...base,status:'RESERVED'}).description,/No routine Manager approval/);assert.match(s.reservationLifecycle({...base,status:'DEPOSIT_PAID'}).description,/preparation/);assert.match(s.reservationLifecycle({...base,status:'CHECKIN_READY'}).description,/not ACTIVE/);assert.match(s.reservationLifecycle({...base,status:'ACTIVE'}).description,/confirmed first physical inbound/);
});
test('CV2-002: legacy and Self Storage behavior remains',async()=>{
 const s=await service(),r={serviceType:'MANAGED_INVENTORY',status:'CONTRACTED',expiresAt:'2030-02-01T00:00:00Z'},now=Date.parse('2030-01-01T00:00:00Z');
 assert(s.canSign({status:'DRAFT'},r,now));assert(s.canMockPay(r,{status:'SIGNED',signedByCustomerAt:'2030-01-01'},true,now));assert(!s.canSign({status:'DRAFT'},{...r,bookingFlowVersion:3},now));assert(s.canSign({status:'DRAFT'},{serviceType:'SELF_STORAGE',status:'CONTRACTED'},now));assert.match(s.reservationLifecycle({...r,status:'PAID'}).description,/management must activate/);assert.match(s.reservationLifecycle({serviceType:'SELF_STORAGE',status:'RESERVED'}).description,/Waiting for Facility Manager approval/);
});
