import {calendarDays,canStartOn,rentalEndDate,shiftMonth,unitSelection} from '../src/domain/liveBooking';
import {optionalAddress} from '../src/api/contracts/profile';
import {isTodayOrFutureVietnamDate,vietnamDateKey} from '../src/domain/vietnamDate';
import {selfBookingTermsAcceptanceKey} from '../src/domain/bookingTermsAcceptance';

test.each(['MAINTENANCE','INACTIVE','BLOCKED','FUTURE_STATE',undefined,null])('unit %s cannot start booking from the list',status=>{
  expect(unitSelection(status).selectable).toBe(false);
});
test('physical occupancy permits checking other dates while interval availability still gates booking',()=>{
  expect(unitSelection('AVAILABLE').selectable).toBe(true);
  expect(unitSelection('OCCUPIED')).toEqual({label:'Đang có người thuê · kiểm tra kỳ khác',selectable:true});
  expect(unitSelection('HELD').selectable).toBe(true);
});
test.each([
  ['2027-01-31',1,'MONTH','2027-02-28'],
  ['2028-01-31',1,'MONTH','2028-02-29'],
  ['2028-02-29',1,'YEAR','2029-02-28'],
  ['2027-12-31',1,'DAY','2028-01-01'],
  ['2028-02-30',1,'MONTH',undefined],
  ['2028-02-29',0,'DAY',undefined],
] as const)('%s plus %i %s resolves to %s',(date,value,unit,end)=>{
  expect(rentalEndDate(date,{value,unit})).toBe(end);
});
test('Self Storage Terms acceptance is invalidated by a new version, rental selection or quote',()=>{
  const context={facilityId:'facility-a',unitId:'unit-a',start:'2026-11-16',termKey:'MONTH:1',quote:{body:{startDate:'2026-11-16'},estimate:{estimatedRent:2000}}};
  const accepted=selfBookingTermsAcceptanceKey('terms-v1',context);
  expect(accepted).not.toBe('');
  expect(selfBookingTermsAcceptanceKey('terms-v1',context)).toBe(accepted);
  for(const changed of [
    {version:'terms-v2'},
    {facilityId:'facility-b'},
    {unitId:'unit-b'},
    {start:'2026-11-17'},
    {termKey:'MONTH:3'},
    {quote:{body:{startDate:'2026-11-16'},estimate:{estimatedRent:3000}}},
  ]){
    const {version,...patch}=changed as {version?:string;facilityId?:string;unitId?:string;start?:string;termKey?:string;quote?:typeof context.quote};
    expect(selfBookingTermsAcceptanceKey(version??'terms-v1',{...context,...patch})).not.toBe(accepted);
  }
  expect(selfBookingTermsAcceptanceKey('terms-v1',{...context,quote:null})).toBe('');
});
test('calendar respects verified half-open UTC intervals and allows today without weakening availability',()=>{
  const calendar={availabilityState:'VERIFIED',intervals:[{startDate:'2028-02-28T00:00:00Z',endDate:'2028-02-29T00:00:00Z'}]};
  const today='2028-02-27';
  expect(calendarDays('2028-02').at(-1)).toBe('2028-02-29');
  expect(shiftMonth('2027-12',1)).toBe('2028-01');
  expect(canStartOn('2028-02-26',calendar,today)).toBe(false);
  expect(canStartOn(today,calendar,today)).toBe(true);
  expect(canStartOn('2028-02-28',calendar,today)).toBe(false);
  expect(canStartOn('2028-02-29',calendar,today)).toBe(true);
  expect(canStartOn('2028-02-29',{...calendar,availabilityState:'UNKNOWN'},today)).toBe(false);
  expect(canStartOn('2028-02-29',undefined,today)).toBe(false);
});
test.each([
  ['2026-11-14T17:05:00.000Z','2026-11-15'],
  ['2026-11-15T05:00:00.000Z','2026-11-15'],
  ['2026-11-15T16:55:00.000Z','2026-11-15'],
] as const)('Vietnam date key is correct at UTC boundary %s', (instant,today)=>{
  expect(vietnamDateKey(new Date(instant))).toBe(today);
  expect(isTodayOrFutureVietnamDate(today,new Date(instant))).toBe(true);
  expect(isTodayOrFutureVietnamDate('2026-11-14',new Date(instant))).toBe(false);
  expect(isTodayOrFutureVietnamDate('2026-11-16',new Date(instant))).toBe(true);
});
test.each([undefined,null,'','ư','�'])('optional address %s displays as missing',value=>{
  expect(optionalAddress(value)).toBe('');
});
