import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceKey,canMockConfirmBalance,confirmedMockBalanceResult} from '../src/lib/customerBalance.js';
import {assertConfirmedRequest} from '../src/api/confirmedContract.js';

const rid='2'.repeat(24),fid='1'.repeat(24),cid='3'.repeat(24),owner='4'.repeat(24),cell='6'.repeat(24),hash='a'.repeat(64),pid='8'.repeat(24);
const user={id:owner,role:'CUSTOMER'};
const amounts={totalDue:36000,depositCredit:7200,balanceDue:28800};
const reservation=()=>({_id:rid,customerId:owner,facilityId:fid,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:'DEPOSIT_PAID',managedPricingSnapshot:{pricingRule:{currency:'VND'},amountBreakdown:amounts}});
const contract=()=>({_id:cid,customerId:owner,reservationId:rid,status:'SIGNED',currentContentVersion:1,contentVersions:[{version:1,contentHash:hash,content:{reservation:{id:rid,facilityId:fid,cellIds:[cell]},pricing:amounts,handover:[]}}],signatures:['CUSTOMER','FACILITY_STAFF'].map(role=>({version:1,contentHash:hash,signerId:role==='CUSTOMER'?owner:'5'.repeat(24),signerRole:role,signedAt:'2026-11-02T00:00:00Z'}))});
const payment=()=>({_id:pid,reservationId:rid,customerId:owner,facilityId:fid,serviceType:'MANAGED_INVENTORY',purpose:'BALANCE',provider:'MOCK',status:'PENDING',amount:28800,currency:'VND',idempotencyKey:balanceKey(rid)});

test('Balance mock requires a matching PENDING receipt and current signatures',()=>{
 assert(canMockConfirmBalance(reservation(),contract(),user,payment()));
 for(const changed of [{amount:36000},{purpose:'DEPOSIT'},{customerId:'7'.repeat(24)},{status:'SUCCEEDED'},{idempotencyKey:'different'}])assert(!canMockConfirmBalance(reservation(),contract(),user,{...payment(),...changed}));
 assert(!canMockConfirmBalance(reservation(),{...contract(),status:'DRAFT'},user,payment()));
 assert(!canMockConfirmBalance({...reservation(),status:'CHECKIN_READY'},contract(),user,payment()));
 assert(!canMockConfirmBalance(reservation(),contract(),{...user,id:'7'.repeat(24)},payment()));
});

test('Balance mock success binds the same ledger and CHECKIN_READY reservation',()=>{
 const result={reservation:{...reservation(),status:'CHECKIN_READY',balanceSettledAt:'2026-11-02T00:00:00Z'},payment:{...payment(),status:'SUCCEEDED'}};
 assert.equal(confirmedMockBalanceResult(result,reservation(),user,payment()),'SUCCEEDED');
 for(const changed of [{amount:36000},{purpose:'DEPOSIT'},{reservationId:'7'.repeat(24)},{customerId:'7'.repeat(24)},{idempotencyKey:'different'}])assert.throws(()=>confirmedMockBalanceResult({...result,payment:{...result.payment,...changed}},reservation(),user,payment()));
 assert.throws(()=>confirmedMockBalanceResult({...result,reservation:reservation()},reservation(),user,payment()));
 assert.throws(()=>confirmedMockBalanceResult({...result,payment:{...result.payment,status:'PENDING'}},reservation(),user,payment()));
});

test('Production allowlist does not expose Balance mock confirmation',()=>{
 assert.doesNotThrow(()=>assertConfirmedRequest({method:'post',url:`/reservations/managed/${rid}/balance`}));
 assert.throws(()=>assertConfirmedRequest({method:'post',url:`/reservations/managed/${rid}/balance/mock-confirm`}));
});
