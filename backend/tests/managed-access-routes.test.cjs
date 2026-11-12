const { test } = require('node:test');
const assert = require('node:assert/strict');
const router = require('../dist/routes/access.routes').default;
const { requireRole } = require('../dist/middlewares/auth/requireRole');

const routes=router.stack.filter(layer=>layer.route).map(layer=>({path:layer.route.path,methods:Object.keys(layer.route.methods).map(x=>x.toUpperCase())}));
test('Managed V3 visit/session API contract is mounted under the existing access router',()=>{
 const expected=[
  ['POST','/managed-v3/visits'],['GET','/managed-v3/visits/me'],['GET','/managed-v3/visits/facility'],['GET','/managed-v3/visits/facility/staff'],
  ['GET','/managed-v3/visits/:visitId'],['PATCH','/managed-v3/visits/:visitId'],['POST','/managed-v3/visits/:visitId/cancel'],['PUT','/managed-v3/visits/:visitId/assignment'],['POST','/managed-v3/visits/:visitId/check-in'],
  ['GET','/managed-v3/sessions/me'],['GET','/managed-v3/sessions/facility'],['GET','/managed-v3/sessions/:sessionId'],['POST','/managed-v3/sessions/:sessionId/check-out'],['POST','/managed-v3/sessions/:sessionId/revoke'],
 ];
 for(const [method,path] of expected)assert.ok(routes.some(route=>route.path===path&&route.methods.includes(method)),`${method} ${path}`);
});
test('role middleware rejects non-allowed roles and missing authenticated users',()=>{
 for(const user of [undefined,{role:'CUSTOMER'}]){let status=0,continued=false;const req={user};const res={status(code){status=code;return this;},json(){return this;}};requireRole(['FACILITY_MANAGER'])(req,res,()=>{continued=true;});assert.equal(continued,false);assert.equal(status,user?403:401);}
 let continued=false;requireRole(['FACILITY_MANAGER'])({user:{role:'FACILITY_MANAGER'}},{status(){return this;},json(){return this;}},()=>{continued=true;});assert.equal(continued,true);
});
