import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inventoryLifecycleContext} from '../src/components/customer/inventory/customerInventoryPolicy.js';
import {selfStorageAlternatives} from '../src/components/customer/selfStorageSuggestions.js';
import {reservationLifecycle} from '../src/lib/customerReservationService.js';

const id='a'.repeat(24),rental={serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'ACTIVE',inventoryVersion:3,startDate:new Date(Date.now()-1000).toISOString(),endDate:new Date(Date.now()+86400000).toISOString()};
test('Customer closure policy rejects writes, carries real version and does not globally block outbound/cleanup',()=>{
 const context=inventoryLifecycleContext({...rental,activeClosureRequestId:id});assert.equal(context.mayAddOrEdit,false);assert.equal(context.inventoryVersion,3);assert.equal(context.status,'ACTIVE');assert.match(context.reason,/cancellation remain available/);assert.equal(inventoryLifecycleContext(null).known,false);assert.equal(inventoryLifecycleContext({...rental,inventoryVersion:'3'}).known,false);assert.equal(inventoryLifecycleContext(rental).mayAddOrEdit,true);
});
test('409 suggestions bounded, exact shape, no text parsing or selected Unit fallback',()=>{
 const unit={_id:id,unitCode:'A01',size:'SMALL',sameSize:true};const response={response:{status:409,data:{suggestedUnits:[unit]}}};assert.deepEqual(selfStorageAlternatives(response,'b'.repeat(24)),[unit]);assert.deepEqual(selfStorageAlternatives(response,id),[]);
 for(const input of [{response:{status:503,data:response.response.data}},{response:{status:409,data:{message:'Book A01'}}},{response:{status:409,data:{suggestedUnits:[{...unit,_id:'DEMO'}]}}},{response:{status:409,data:{suggestedUnits:[{...unit,size:'HUGE'}]}}},{response:{status:409,data:{suggestedUnits:Array(6).fill(unit)}}}])assert.deepEqual(selfStorageAlternatives(input),[]);
});
test('Self lifecycle distinguishes current CONTRACTED / deposit / balance / active and retains legacy wording',()=>{
 const view=status=>reservationLifecycle({serviceType:'SELF_STORAGE',status});assert.match(view('CONTRACTED').description,/DRAFT/);assert.match(view('CONTRACTED').description,/approval is not required/);assert.match(view('RESERVED').description,/Legacy/);assert.match(view('DEPOSIT_PAID').description,/not active/);assert.match(view('CHECKIN_READY').description,/Balance/);assert.match(view('PAID').description,/handover/);assert.notEqual(view('CHECKIN_READY').description,reservationLifecycle({serviceType:'MANAGED_INVENTORY',bookingFlowVersion:2,status:'CHECKIN_READY'}).description);
});
test('Customer support keeps text-only payload and filters internal messages',()=>{
 const s=readFileSync(new URL('../src/components/customer/CustomerSupportIntegration.jsx',import.meta.url),'utf8');assert.match(s,/createReal\(\{category,subject:subject\.trim\(\),description:description\.trim\(\)\}\)/);assert(!/relatedEntity\s*:/.test(s));assert.match(s,/m\.isInternal===false/);
});
test('Customer signing is contained while Facility view condition remains separate',()=>{
 const s=readFileSync(new URL('../src/components/customer/inventory/ManagedContractReview.jsx',import.meta.url),'utf8');assert.match(s,/customerSigningBlocked=customerView\|\|user\?\.role==='CUSTOMER'/);assert.match(s,/if\(busy\.current\|\|!canSign/);assert.match(s,/Backend enforces the exact reviewed contract version/);assert.match(s,/disabled onClick=\{sign\}/);assert(!/expectedVersion:|reviewedHash:/.test(s));
});
