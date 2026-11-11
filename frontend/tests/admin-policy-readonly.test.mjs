import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertConfirmedRequest} from '../src/api/confirmedContract.js';

const id='a'.repeat(24);
test('Policy reads remain allowlisted while normal Policy writes are blocked',()=>{
  for(const [method,url] of [['GET','/policies'],['GET','/policies/resolve'],['GET',`/policies/${id}`]])
    assert.doesNotThrow(()=>assertConfirmedRequest({method,url}));
  for(const [method,url] of [['POST','/policies'],['PATCH',`/policies/${id}`],['PATCH',`/policies/${id}/status`]])
    assert.throws(()=>assertConfirmedRequest({method,url}),/not confirmed/);
});

test('Pricing Rule CRUD remains allowlisted',()=>{
  for(const [method,url] of [['GET','/pricing-rules'],['GET','/pricing-rules/resolve'],['GET',`/pricing-rules/${id}`],['POST','/pricing-rules'],['PATCH',`/pricing-rules/${id}`],['PATCH',`/pricing-rules/${id}/status`]])
    assert.doesNotThrow(()=>assertConfirmedRequest({method,url}));
});

test('Pricing Rule edit sends only mutable fields and keeps the selected effective date',()=>{
  const mapper=readFileSync(new URL('../src/lib/bomMappers.js',import.meta.url),'utf8');
  const editor=readFileSync(new URL('../src/pages/bom/RecordPage.jsx',import.meta.url),'utf8');
  assert.match(mapper,/export function pricingUpdateBody\(form\)/);
  assert.match(mapper,/price:\s*Number\(form\.rate\)/);
  assert.match(mapper,/currency:\s*form\.currency\s*\|\|\s*BOM_CURRENCY/);
  assert.match(mapper,/effectiveFrom:\s*toInstant\(form\.effectiveFrom\)/);
  assert.match(editor,/const body = isEdit \? pricingUpdateBody\(form\) : config\.body\(form\)/);
  assert.doesNotMatch(mapper,/pricingUpdateBody[\s\S]{0,400}facilityId:/);
});

test('Admin and BOM Policy pages expose read-only routes and omit mutation controls',()=>{
  const adminRoutes=readFileSync(new URL('../src/routes/AdminRoutes.jsx',import.meta.url),'utf8');
  const bomRoutes=readFileSync(new URL('../src/routes/BomRoutes.jsx',import.meta.url),'utf8');
  for(const routes of [adminRoutes,bomRoutes]){
    assert.match(routes,/path="policies"/);
    assert.match(routes,/path="policies\/:id"/);
    assert.match(routes,/path="policies\/discounts"/);
    assert.match(routes,/path="policies\/item-categories"/);
    assert.doesNotMatch(routes,/path="policies(?:\/discounts|\/item-categories)?\/new"/);
    assert.doesNotMatch(routes,/path="policies(?:\/discounts|\/item-categories)?\/:id\/edit"/);
    assert.match(routes,/path="pricing\/new"/);
    assert.match(routes,/path="pricing\/:id\/edit"/);
  }
  const generic=readFileSync(new URL('../src/pages/bom/RecordPage.jsx',import.meta.url),'utf8');
  const policyPages=readFileSync(new URL('../src/pages/bom/PolicyRecordsPage.jsx',import.meta.url),'utf8');
  assert.match(generic,/Scheduled Pricing Rule/);
  assert.match(generic,/new Date\(record\.effectiveFrom\) > new Date\(\)/);
  assert.match(generic,/current effective price remains in force until then/);
  assert.match(generic,/kind === "policy" && \["new", "edit"\]/);
  assert.match(generic,/kind === "pricing" \? <Button/);
  assert.doesNotMatch(policyPages,/bomPolicyApi\.(create|update|setActive)/);
  assert.doesNotMatch(policyPages,/>\s*(Create|Edit|Activate|Deactivate)/);
});
