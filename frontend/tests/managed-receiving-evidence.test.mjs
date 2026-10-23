import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertConfirmedRequest} from '../src/api/confirmedContract.js';

const staffPage=fileURLToPath(new URL('../src/pages/staff/ManagedReceivingQueue.jsx',import.meta.url));
const picker=fileURLToPath(new URL('../src/components/staff/ReceivingEvidencePicker.jsx',import.meta.url));
const gallery=fileURLToPath(new URL('../src/components/staff/ReceivingEvidenceGallery.jsx',import.meta.url));
const item='507f1f77bcf86cd799439015';

test('confirmed API allows only the Managed receiving context, upload and decision routes',()=>{
 assert.doesNotThrow(()=>assertConfirmedRequest({method:'get',url:`/inventory-items/${item}/receiving-inspection/context`}));
 assert.doesNotThrow(()=>assertConfirmedRequest({method:'post',url:`/inventory-items/${item}/receiving-inspection/image-uploads`}));
 assert.doesNotThrow(()=>assertConfirmedRequest({method:'post',url:`/inventory-items/${item}/receiving-inspection`}));
 assert.throws(()=>assertConfirmedRequest({method:'post',url:`/inventory-items/${item}/receiving-inspection/context`}));
 assert.throws(()=>assertConfirmedRequest({method:'get',url:`/inventory-items/${item}/receiving-inspection/image-uploads`}));
});

test('Staff Receiving Queue uses Facility-scoped backend context and actual evidence/inspection APIs',async()=>{
 const source=await readFile(staffPage,'utf8');
 assert.match(source,/managedIntakeApi\.receivingContext/);
 assert.match(source,/managedIntakeApi\.inspectItem/);
 assert.match(source,/assigned Facility/);
 assert.match(source,/ReceivingEvidencePicker/);
 assert.match(source,/ReceivingEvidenceGallery/);
 assert.doesNotMatch(source,/BLOCKED|demo record/);
});

test('evidence picker supports limits, progress, cancellation, retry, remove and reorder',async()=>{
 const source=await readFile(picker,'utf8');
 for(const expected of [/MAX_IMAGES=10/,/onUploadProgress/,/AbortController/,/Retry/,/Move up/,/Move down/,/Remove/,/image\/jpeg,image\/png,image\/webp/])assert.match(source,expected);
});

test('gallery renders snapshots by attempt and opens original high-resolution evidence',async()=>{
 const source=await readFile(gallery,'utf8');
 assert.match(source,/entry\.attempt/);
 assert.match(source,/entry\.images/);
 assert.match(source,/loading="lazy"/);
 assert.match(source,/Full size receiving evidence/);
});
