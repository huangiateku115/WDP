import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eligibleInventoryRegistration,editableInventory} from '../src/lib/inventoryRegistration.js';

const id='a'.repeat(24),facility='b'.repeat(24),now=Date.now();
const reservation={_id:id,facilityId:facility,serviceType:'MANAGED_INVENTORY',bookingFlowVersion:3,status:'CHECKIN_READY',allocatedCapacity:3,endDate:new Date(now+3600000).toISOString(),startDate:new Date(now+1000).toISOString()};
const item={_id:'c'.repeat(24),facilityId:facility,managedReservationId:id,inventorySchemaVersion:3,status:'REGISTERED',currentCellId:null};

test('V3 SKU metadata is editable in CHECKIN_READY and in-term ACTIVE, never for legacy booking',()=>{
 assert.equal(eligibleInventoryRegistration(reservation),true);assert.equal(editableInventory(item,reservation),true);
 assert.equal(editableInventory(item,{...reservation,bookingFlowVersion:2}),false);
 assert.equal(editableInventory({...item,inventorySchemaVersion:2},reservation),false);
 assert.equal(eligibleInventoryRegistration({...reservation,status:'ACTIVE',startDate:new Date(now-1000).toISOString()}),true);
 assert.equal(eligibleInventoryRegistration({...reservation,status:'ACTIVE',startDate:new Date(now+3600000).toISOString()}),false);
 assert.equal(eligibleInventoryRegistration({...reservation,status:'CHECKIN_READY',endDate:new Date(now-1).toISOString()}),false);
});

test('preferred Cell lookup fails closed unless reservation is V3',()=>{
 const context=readFileSync(new URL('../src/components/customer/inventory/managedInventoryContext.js',import.meta.url),'utf8');
 assert.match(context,/bookingFlowVersion!==3\|\|rental\?\.serviceType!=='MANAGED_INVENTORY'/);
});

test('Customer inbound route is read-only unavailable and cannot call the legacy request API',()=>{
 const component=readFileSync(new URL('../src/components/customer/inventory/ManagedInboundRequest.jsx',import.meta.url),'utf8');
 assert.match(component,/Tự nhập V3|Managed V3/i);assert(!/requestInbound\(/.test(component));assert(!/inventoryApi/.test(component));
 const allowlist=readFileSync(new URL('../src/api/confirmedContract.js',import.meta.url),'utf8');
 assert.doesNotMatch(allowlist,/inbound-request\|outbound-request/);
});
