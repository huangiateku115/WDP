import test from 'node:test';
import assert from 'node:assert/strict';
import { minimumBookingStartDate, bookingStartDateError, bookingInterval, cellBookingReason } from '../src/lib/managedCellBooking.js';
import { managedRequest, managedQuoteRequest, managedCreateRequest, managedVietnamDate, managedBookingDateAllowed } from '../src/lib/customerReservationService.js';

const instant = (date, time) => new Date(`${date}T${time}:00.000Z`).getTime();
const facilityId='507f1f77bcf86cd799439011';

test('Customer date picker uses Vietnam today for current time and midnight rollover',()=>{
  for(const now of [instant('2026-11-11','17:15'),instant('2026-11-11','23:59'),instant('2026-11-12','00:01'),instant('2026-11-12','05:00'),instant('2026-11-12','16:59')]) {
    assert.equal(minimumBookingStartDate(now),'2026-11-12');
    assert.equal(bookingStartDateError('2026-11-12',now),'');
    assert.match(bookingStartDateError('2026-11-11',now),/today or a future/i);
  }
  const rollover=instant('2026-11-12','17:00');
  assert.equal(minimumBookingStartDate(rollover),'2026-11-13');
  assert.match(bookingStartDateError('2026-11-12',rollover),/today or a future/i);
});

test('quote and create date payload validation accepts today and future but rejects past Vietnam dates',()=>{
  const now=instant('2026-11-12','00:01'); // 07:01 Vietnam
  assert.equal(managedVietnamDate(now),'2026-11-12');
  assert.equal(managedBookingDateAllowed('2026-11-12T00:00:00.000Z',now),true);
  assert.throws(()=>managedRequest({facilityId,allocatedCapacityM3:1,startDate:'2026-11-11T00:00:00.000Z',term:{value:1,unit:'DAY'},now}),/today or a future/i);
  const cellIds=['507f1f77bcf86cd799439021'];
  const request=managedRequest({facilityId,allocatedCapacityM3:1,startDate:'2026-11-12T00:00:00.000Z',term:{value:1,unit:'DAY'},cellIds,now});
  assert.equal(request.startDate,'2026-11-12T00:00:00.000Z');
  const quote=managedQuoteRequest({...request,now});
  const create=managedCreateRequest({...request,now,termsAccepted:true,termsVersionId:'VS-POLICY-002@2.1'});
  assert.equal(quote.startDate,request.startDate);
  assert.equal(create.startDate,request.startDate);
  assert.equal(create.termsAccepted,true);
  assert.equal(bookingInterval('2026-11-12',{value:1,unit:'DAY'}).endDate,'2026-11-13T00:00:00.000Z');
});

test('same-day Cell selection remains available while yesterday is rejected',()=>{
  const now=instant('2026-11-12','00:01');
  const range=bookingInterval('2026-11-12',{value:1,unit:'MONTH'});
  const cell={_id:'507f1f77bcf86cd799439021',facilityId,operationalStatus:'AVAILABLE',bookingStatus:'AVAILABLE',displayStatus:'AVAILABLE',physicalUsageKnown:true,isBookable:true,periodStatus:'AVAILABLE',usedWeightKg:0,usedVolumeM3:0,dimensions:{widthM:1,depthM:1,usableHeightM:1}};
  const rack={_id:'507f1f77bcf86cd799439031',facilityId,operationalStatus:'AVAILABLE'};
  assert.equal(cellBookingReason(cell,rack,range,now),'');
  assert.match(cellBookingReason(cell,rack,{...range,startDate:'2026-11-11T00:00:00.000Z'},now),/today or a future/i);
});
