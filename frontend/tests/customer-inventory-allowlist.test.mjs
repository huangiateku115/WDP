import test from 'node:test';
import assert from 'node:assert/strict';
import {assertConfirmedRequest} from '../src/api/confirmedContract.js';

const id='a'.repeat(24);
const routes=[
 ['POST',`inventory-items/${id}/inbound-requests`],['GET',`inventory-items/${id}/inbound-requests`],
 ['GET',`inbound-requests/${id}`],['PATCH',`inbound-requests/${id}`],['POST',`inbound-requests/${id}/cancel`],
 ['GET',`inventory-items/${id}/stock-balance`],
 ['POST',`inventory-items/${id}/outbound-requests`],['GET',`inventory-items/${id}/outbound-requests`],
 ['GET',`outbound-requests/${id}`],['POST',`outbound-requests/${id}/cancel`],
];

test('all ten confirmed Customer inventory method/path combinations pass',()=>{
 for(const [method,path] of routes)assert.doesNotThrow(()=>assertConfirmedRequest({method,url:'/'+path}));
});
test('incorrect methods remain blocked on every added path',()=>{
 for(const path of new Set(routes.map(([,path])=>path)))for(const method of ['GET','POST','PUT','PATCH','DELETE']){
  if(!routes.some(([m,p])=>m===method&&p===path))assert.throws(()=>assertConfirmedRequest({method,url:'/'+path}),/not confirmed/);
 }
});
test('invalid IDs, suffixes and unconfirmed operation variants are not permitted',()=>{
 for(const [method,path] of routes){
  for(const url of ['/'+path.replace(id,'not-an-id'),'/'+path+'/extra'])assert.throws(()=>assertConfirmedRequest({method,url}),/not confirmed/);
 }
 for(const url of [`/inbound-requests/${id}/confirm/extra`,`/outbound-requests/${id}/confirm/extra`,`/inventory-items/${id}/relocate-canonical/extra`])assert.throws(()=>assertConfirmedRequest({method:'POST',url}),/not confirmed/);
});
test('existing Customer confirmed API entries remain allowed',()=>{
 for(const [method,url] of [['POST','/auth/login'],['GET','/users/me/'],['GET','/reservations/me'],['POST','/reservations'],['GET','/warehouse-map'],['GET',`/racks/${id}/detail-map`],['POST','/inventory-items/image-uploads'],['GET',`/inventory-items/${id}/movements`],['POST',`/inventory-items/${id}/outbound-request`],['PATCH',`/contracts/${id}/sign`]])assert.doesNotThrow(()=>assertConfirmedRequest({method,url}));
 assert.throws(()=>assertConfirmedRequest({method:'POST',url:`/inventory-items/${id}/inbound-request`}),/not confirmed/);
});
test('Managed V3 Access Visit and Session paths are exact and preserve methods',()=>{
 const rows=[['POST','access/managed-v3/visits'],['GET','access/managed-v3/visits/me'],['GET','access/managed-v3/visits/facility'],['GET','access/managed-v3/visits/facility/staff'],['GET',`access/managed-v3/visits/${id}`],['PATCH',`access/managed-v3/visits/${id}`],['POST',`access/managed-v3/visits/${id}/cancel`],['PUT',`access/managed-v3/visits/${id}/assignment`],['POST',`access/managed-v3/visits/${id}/check-in`],['GET','access/managed-v3/sessions/me'],['GET','access/managed-v3/sessions/facility'],['GET',`access/managed-v3/sessions/${id}`],['POST',`access/managed-v3/sessions/${id}/check-out`],['POST',`access/managed-v3/sessions/${id}/revoke`]];
 for(const [method,path] of rows)assert.doesNotThrow(()=>assertConfirmedRequest({method,url:`/${path}`}));
 for(const [method,path] of rows)assert.throws(()=>assertConfirmedRequest({method,url:`/${path}/extra`}),/not confirmed/);
 assert.throws(()=>assertConfirmedRequest({method:'DELETE',url:`/access/managed-v3/sessions/${id}`}),/not confirmed/);
});
test('allowlist leaves operation/concurrency headers intact',()=>{
 const headers={'Idempotency-Key':'fixture-key','If-Match':'"3"'};
 const config={method:'PATCH',url:`/inbound-requests/${id}`,headers,data:{requestedQuantity:2}};
 assertConfirmedRequest(config);assert.deepEqual(config.headers,headers);assert.deepEqual(config.data,{requestedQuantity:2});
});
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
test('inventory helpers preserve Idempotency-Key and If-Match for request mutations',()=>{
 const requests=[];const client=Object.fromEntries(['get','post','patch','delete'].map(method=>[method,(...args)=>requests.push({method,args})]));
 const module={exports:{}};const code=transformSync(readFileSync(new URL('../src/api/inventoryApi.js',import.meta.url),'utf8'),{loader:'js',format:'cjs',define:{'import.meta.env':'{}'}}).code;
 new Function('require','module','exports',code)(()=>({__esModule:true,default:client}),module,module.exports);
 const api=module.exports.inventoryApi,body={requestedQuantity:2},key='fixture-operation-key';
 api.createRepeatedInbound(id,body,key);api.amendRepeatedInbound(id,body,3,key);api.cancelRepeatedInbound(id,3,key);api.createCanonicalOutbound(id,body,key);api.cancelCanonicalOutbound(id,3,key);
 for(const {args} of requests){assert.equal(args[2].headers['Idempotency-Key'],key);assertConfirmedRequest({method:args[0].includes('/inbound-requests')&&args[0]===`/inbound-requests/${id}`?'PATCH':'POST',url:args[0]});}
 for(const index of [1,2,4])assert.equal(requests[index].args[2].headers['If-Match'],'"3"');
 assert.equal(requests[0].args[1],body);assert.equal(requests[3].args[1],body);
});
