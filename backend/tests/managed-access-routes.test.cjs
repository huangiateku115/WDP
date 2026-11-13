const { test } = require('node:test');
const assert = require('node:assert/strict');
const router = require('../dist/routes/access.routes').default;
const { requireRole } = require('../dist/middlewares/auth/requireRole');
const controller = require('../dist/controllers/access/managed-access.controller');
const { ManagedAccessService } = require('../dist/services/access/managed-access.service');

const routes=router.stack.filter(layer=>layer.route).map(layer=>({path:layer.route.path,methods:Object.keys(layer.route.methods).map(x=>x.toUpperCase())}));
test('Managed V3 visit/session API contract is mounted under the existing access router',()=>{
 const expected=[
  ['POST','/managed-v3/visits'],['GET','/managed-v3/visits/me'],['GET','/managed-v3/visits/facility'],['GET','/managed-v3/visits/facility/staff'],
  ['GET','/managed-v3/visits/availability'],['GET','/managed-v3/visits/:visitId'],['PATCH','/managed-v3/visits/:visitId'],['POST','/managed-v3/visits/:visitId/cancel'],['PUT','/managed-v3/visits/:visitId/assignment'],['POST','/managed-v3/visits/:visitId/check-in'],
  ['GET','/managed-v3/sessions/me'],['GET','/managed-v3/sessions/facility'],['GET','/managed-v3/sessions/:sessionId'],['POST','/managed-v3/sessions/:sessionId/check-out'],['POST','/managed-v3/sessions/:sessionId/revoke'],
 ];
 for(const [method,path] of expected)assert.ok(routes.some(route=>route.path===path&&route.methods.includes(method)),`${method} ${path}`);
});
test('role middleware rejects non-allowed roles and missing authenticated users',()=>{
 for(const user of [undefined,{role:'CUSTOMER'}]){let status=0,continued=false;const req={user};const res={status(code){status=code;return this;},json(){return this;}};requireRole(['FACILITY_MANAGER'])(req,res,()=>{continued=true;});assert.equal(continued,false);assert.equal(status,user?403:401);}
 let continued=false;requireRole(['FACILITY_MANAGER'])({user:{role:'FACILITY_MANAGER'}},{status(){return this;},json(){return this;}},()=>{continued=true;});assert.equal(continued,true);
});
test('amend controller forwards If-Match revision and Idempotency-Key to the service',async()=>{
 const original=ManagedAccessService.amendVisit;let args;
 ManagedAccessService.amendVisit=(...values)=>{args=values;return Promise.resolve({revision:4});};
 const response={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
 try{
  await controller.amendVisit({params:{visitId:'visit-1'},body:{purpose:'INBOUND'},user:{_id:'customer'},header:name=>name==='If-Match'?'"3"':name==='Idempotency-Key'?'visit-amend-key-001':undefined},response);
  assert.equal(args[0],'visit-1');assert.deepEqual(args[1],{purpose:'INBOUND'});assert.equal(args[2]._id,'customer');assert.equal(args[3],3);assert.equal(args[4],'visit-amend-key-001');assert.equal(response.body.success,true);
 }finally{ManagedAccessService.amendVisit=original;}
});
