const { test } = require('node:test');
const assert = require('node:assert/strict');
const { managedVisitSlots } = require('../dist/services/access/managed-visit-schedule');

const schedule={timeZone:'Asia/Ho_Chi_Minh',slotDurationMinutes:60,weeklyHours:[{weekday:3,opensAt:'08:00',closesAt:'11:00'}]};
const start=new Date('2026-11-11T00:00:00+07:00');
const reservationStart=new Date('2026-11-10T00:00:00+07:00');
const reservationEnd=new Date('2026-11-12T00:00:00+07:00');
const make=(now,count=0)=>managedVisitSlots({date:'2026-11-11',schedule,now,reservationStartDate:reservationStart,reservationEndDate:reservationEnd,staffCapacity:1,overlappingVisitCount:()=>count});

test('visit slots use Asia/Ho_Chi_Minh dates and omit time slots already started today',()=>{
 const slots=make(new Date('2026-11-11T01:30:00Z'));
 assert.deepEqual(slots.map(slot=>slot.startsAt),['2026-11-11T02:00:00.000Z','2026-11-11T03:00:00.000Z']);
});

test('visit slots are bounded by reservation dates and available escort capacity',()=>{
 assert.equal(make(new Date('2026-11-10T00:00:00Z'),1).length,0);
 const slots=managedVisitSlots({date:'2026-11-11',schedule,now:new Date('2026-11-10T00:00:00Z'),reservationStartDate:new Date('2026-11-11T02:30:00Z'),reservationEndDate:reservationEnd,staffCapacity:1,overlappingVisitCount:()=>0});
 assert.deepEqual(slots.map(slot=>slot.startsAt),['2026-11-11T03:00:00.000Z']);
});

test('invalid dates fail closed and days without opening hours return no slots',()=>{
 assert.throws(()=>make(new Date(),0).concat(managedVisitSlots({date:'2026-02-30',schedule,now:new Date(),reservationStartDate:reservationStart,reservationEndDate:reservationEnd,staffCapacity:1,overlappingVisitCount:()=>0})),/VISIT_DATE_INVALID/);
 assert.deepEqual(managedVisitSlots({date:'2026-11-12',schedule,now:start,reservationStartDate:reservationStart,reservationEndDate:reservationEnd,staffCapacity:1,overlappingVisitCount:()=>0}),[]);
});
