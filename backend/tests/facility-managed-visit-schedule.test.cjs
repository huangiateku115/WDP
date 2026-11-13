const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFacility, FacilityError } = require('../dist/services/facilities/facility.validation');

const input={code:'VST',name:'Visit Test Facility',address:{line1:'1 Test',city:'HCMC',country:'VN'},serviceTypes:['MANAGED_INVENTORY']};
const schedule={timeZone:'Asia/Ho_Chi_Minh',slotDurationMinutes:60,weeklyHours:[{weekday:1,opensAt:'08:00',closesAt:'18:00'},{weekday:2,opensAt:'09:00',closesAt:'17:00'}]};

test('legacy Facility payload remains valid without a structured Visit schedule',()=>{
 assert.equal('managedVisitSchedule' in parseFacility(input),false);
});

test('Facility CRUD validates timezone, slot bounds, weekdays and clock range for Managed V3 availability',()=>{
 assert.deepEqual(parseFacility({...input,managedVisitSchedule:schedule}).managedVisitSchedule,schedule);
 for(const invalid of [
  {...schedule,timeZone:'UTC'},
  {...schedule,slotDurationMinutes:17},
  {...schedule,weeklyHours:[schedule.weeklyHours[0],schedule.weeklyHours[0]]},
  {...schedule,weeklyHours:[{weekday:1,opensAt:'18:00',closesAt:'08:00'}]},
 ])assert.throws(()=>parseFacility({...input,managedVisitSchedule:invalid}),FacilityError);
 assert.equal(parseFacility({...input,managedVisitSchedule:null},true).managedVisitSchedule,null);
});
