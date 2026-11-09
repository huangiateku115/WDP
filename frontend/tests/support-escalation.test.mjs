import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
const source=readFileSync(new URL('../src/lib/serviceDeskReview.js',import.meta.url),'utf8');
const module={exports:{}};
const objectId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
new Function('require','module','exports',transformSync(source,{format:'cjs'}).code)(()=>({objectId,recordId:value=>typeof value==='object'?value?._id:value}),module,module.exports);
const {canEscalateDesk}=module.exports;
const facility='a'.repeat(24),user={id:'b'.repeat(24),role:'FACILITY_MANAGER',assignedFacilityId:facility};
test('support escalation requires scoped Manager and an unresolved request',()=>{
 for(const status of ['OPEN','ASSIGNED','IN_PROGRESS'])assert.equal(canEscalateDesk({facility,status},user,'support'),true);
 for(const status of ['RESOLVED','CLOSED'])assert.equal(canEscalateDesk({facility,status},user,'support'),false);
 assert.equal(canEscalateDesk({facility,status:'OPEN',escalatedAt:'2026-11-09'},user,'support'),false);
 assert.equal(canEscalateDesk({facility:'c'.repeat(24),status:'OPEN'},user,'support'),false);
 assert.equal(canEscalateDesk({status:'OPEN'},user,'support'),false);
 assert.equal(canEscalateDesk({facility,status:'OPEN'},user,'maintenance'),false);
 assert.equal(canEscalateDesk({facility,status:'OPEN',assignee:user.id},{...user,role:'FACILITY_STAFF'},'support'),false);
});
