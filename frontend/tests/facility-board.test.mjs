import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFacilityBoard,boardDayRows,boardAttention,facilityDay} from '../src/lib/facilityBoard.js';
import {assertConfirmedRequest} from '../src/api/confirmedContract.js';
const id='a'.repeat(24), user={id:'staff',role:'FACILITY_MANAGER',assignedFacilityId:'facility'};
test('paper contract API remains allowed after shared API merge; unknown mutations remain blocked',()=>{
 for(const [method,url] of [['get',`/contracts/${id}/print`],['post',`/contracts/${id}/confirm-signed-paper`],['post',`/reservations/${id}/handover`]]) assert.doesNotThrow(()=>assertConfirmedRequest({method,url}));
 for(const [method,url] of [['delete',`/contracts/${id}/print`],['post',`/contracts/${id}/reset`],['post','/refunds']])assert.throws(()=>assertConfirmedRequest({method,url}));
});
test('board excludes foreign facilities and closed work; inspector is not an assignee',()=>{
 const reservations=[{_id:'r',facilityId:'facility',serviceType:'SELF_STORAGE',status:'ACTIVE',endDate:'2026-10-25T17:00:00Z'}, {_id:'foreign',facilityId:'other',serviceType:'SELF_STORAGE',status:'PAID'}];
 const rows=buildFacilityBoard({reservations,inspections:[{_id:'i',facilityId:'facility',reservationId:'r',status:'DRAFT',type:'CHECK_OUT',inspectedBy:'staff'}],maintenance:[{_id:'m',facilityId:'facility',status:'OPEN',priority:'HIGH'},{_id:'closed',facilityId:'facility',status:'CLOSED'},{_id:'foreign-ticket',facilityId:'other',status:'OPEN'}]},user,'manager');
 assert.equal(rows.length,3);assert.equal(rows[0].date,'2026-10-26');assert.equal(rows[1].assignee,'');assert.equal(rows[1].assignable,false);
 assert.equal(boardAttention(rows[2],'2026-10-26'),'High priority, unassigned');
 assert.equal(boardDayRows(rows,'2026-10-25').some(r=>r.type==='CHECK_OUT'),false);
 assert.deepEqual(boardDayRows(rows,'2026-10-26','','unassigned').map(r=>r.id),['maintenance:m']);
});
test('Staff sees only own assigned tickets, including support explicitly assigned without a facility',()=>{
 const rows=buildFacilityBoard({support:[{_id:'own',assignedTo:'staff',status:'ASSIGNED'},{_id:'other',assignedTo:'someone',status:'ASSIGNED'},{_id:'cross',facilityId:'other',assignedTo:'staff',status:'ASSIGNED'}]}, {...user,role:'FACILITY_STAFF'},'staff');
 assert.deepEqual(rows.map(r=>r.id),['support:own']);
});
test('date grouping uses Vietnam time; missing dates and aged tickets do not invent SLA breaches',()=>{
 assert.equal(facilityDay('2026-10-25T18:00:00Z'),'2026-10-26');assert.equal(facilityDay('invalid'),'');
 assert.equal(boardAttention({type:'support',date:'2026-10-24',assignee:'a',assignable:true},'2026-10-26'),'Open from a previous day');
});
