import {calendarDays,canStartOn,rentalEndDate,shiftMonth,unitSelection} from '../src/domain/liveBooking';
import {optionalAddress} from '../src/api/contracts/profile';

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
test('calendar respects verified half-open UTC intervals and disables today',()=>{
  const calendar={availabilityState:'VERIFIED',intervals:[{startDate:'2028-02-28T00:00:00Z',endDate:'2028-02-29T00:00:00Z'}]};
  const today='2028-02-27';
  expect(calendarDays('2028-02').at(-1)).toBe('2028-02-29');
  expect(shiftMonth('2027-12',1)).toBe('2028-01');
  expect(canStartOn(today,calendar,today)).toBe(false);
  expect(canStartOn('2028-02-28',calendar,today)).toBe(false);
  expect(canStartOn('2028-02-29',calendar,today)).toBe(true);
  expect(canStartOn('2028-02-29',{...calendar,availabilityState:'UNKNOWN'},today)).toBe(false);
  expect(canStartOn('2028-02-29',undefined,today)).toBe(false);
});
test.each([undefined,null,'','ư','�'])('optional address %s displays as missing',value=>{
  expect(optionalAddress(value)).toBe('');
});
