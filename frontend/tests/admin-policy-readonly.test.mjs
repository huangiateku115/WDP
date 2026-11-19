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
  assert.match(mapper,/export function pricingUpdateBody\(form[,)]/);
  assert.match(mapper,/price:\s*Number\(form\.rate\)/);
  assert.match(mapper,/currency:\s*form\.currency\s*\|\|\s*BOM_CURRENCY/);
  assert.match(mapper,/effectiveFrom:\s*toInstant\(form\.effectiveFrom\)/);
  assert.match(editor,/const body = isEdit \? pricingUpdateBody\(form\) : config\.body\(form\)/);
  assert.doesNotMatch(mapper,/pricingUpdateBody[\s\S]{0,400}facilityId:/);
});

test('Pricing Rule create sends the PER_M3 basis required by Managed Inventory',()=>{
  const mapper=readFileSync(new URL('../src/lib/bomMappers.js',import.meta.url),'utf8');
  const createBody=mapper.slice(mapper.indexOf('export function pricingBody'),mapper.indexOf('export function pricingUpdateBody'));
  assert.match(createBody,/if \(form\.service === "SELF_STORAGE"\) body\.unitSize = form\.unitSize;/);
  assert.match(createBody,/if \(form\.service === "MANAGED_INVENTORY"\) body\.billingBasis = "PER_M3";/);
});

test('Admin and BOM keep only the read-only item-category policy screen',()=>{
  const adminRoutes=readFileSync(new URL('../src/routes/AdminRoutes.jsx',import.meta.url),'utf8');
  const bomRoutes=readFileSync(new URL('../src/routes/BomRoutes.jsx',import.meta.url),'utf8');
  for(const routes of [adminRoutes,bomRoutes]){
    assert.match(routes,/path="pricing\/new"/);
    assert.match(routes,/path="pricing\/:id\/edit"/);
    assert.match(routes,/path="policies\/item-categories"/);
    assert.match(routes,/path="policies\/item-categories\/:id"/);
    // Business policies and discounts left the console: no engine reads their config.
    assert.doesNotMatch(routes,/path="policies"/);
    assert.doesNotMatch(routes,/path="policies\/new"/);
    assert.doesNotMatch(routes,/path="policies\/:id"/);
    assert.doesNotMatch(routes,/path="policies\/discounts/);
    assert.doesNotMatch(routes,/path="policies\/item-categories\/:id\/edit"/);
  }
  const generic=readFileSync(new URL('../src/pages/bom/RecordPage.jsx',import.meta.url),'utf8');
  const policyPages=readFileSync(new URL('../src/pages/bom/PolicyRecordsPage.jsx',import.meta.url),'utf8');
  assert.match(generic,/Quy tắc giá đã lên lịch/);
  assert.match(generic,/new Date\(record\.effectiveFrom\) > new Date\(\)/);
  assert.match(generic,/Bắt đầu áp dụng từ \{record\.effectiveFrom\}/);
  // RecordPage is the pricing console only: no policy branch and no inert write control remains.
  assert.doesNotMatch(generic,/kind === "policy"/);
  assert.doesNotMatch(generic,/bomCapability|policyWrite|POLICY_WRITE_REASON|PendingAction/);
  // An effective rule cannot be toggled: the status button is only rendered for future rules.
  assert.match(generic,/const effectiveRule = isEffectiveRecord\(record\)/);
  assert.match(generic,/!effectiveRule && <div className="mt-5">/);
  assert.doesNotMatch(policyPages,/bomPolicyApi\.(create|update|setActive|close)/);
  assert.doesNotMatch(policyPages,/discountFromDto|discountValueLabel|BOM_DISCOUNT|valueType/);
});
