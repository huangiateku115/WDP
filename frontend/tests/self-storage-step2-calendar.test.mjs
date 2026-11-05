import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import * as availabilityHelpers from '../src/lib/selfStorageAvailability.js';
import { availabilityMatches, buildAvailabilityDays, monthKey, utcToday } from '../src/lib/selfStorageAvailability.js';
import * as rentalPeriodHelpers from '../src/lib/rentalPeriod.js';
import { rentalEndDate } from '../src/lib/rentalPeriod.js';

const facilityId = '507f1f77bcf86cd799439011';
const unitId = '507f1f77bcf86cd799439012';
const pricingId = '507f1f77bcf86cd799439014';
const require = createRequire(import.meta.url);
const term1 = { value: 1, unit: 'MONTH' };
const term3 = { value: 3, unit: 'MONTH' };
const priceRule = { _id: pricingId, facilityId, serviceType: 'SELF_STORAGE', unitSize: 'SMALL', isActive: true, term: term1, price: 1000, currency: 'VND', effectiveFrom: '2020-01-01T00:00:00.000Z' };
const priceRule3 = { ...priceRule, _id: '507f1f77bcf86cd799439015', term: term3 };

function addDays(date, amount) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function compileComponent() {
  const source = readFileSync(new URL('../src/components/customer/RentalPeriodIntegration.jsx', import.meta.url), 'utf8');
  const code = transformSync(source, { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;
  let state = [], cursor = 0, resourceIndex = 0, currentRangeState = 'AVAILABLE', currentMonthState = 'VERIFIED', intervals = [], lastLoads = [], bookingDraft = null, navigateTo = null;
  const useState = initial => {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
  };
  const Box = ({ children, ...props }) => React.createElement('div', props, children);
  const Button = ({ children, ...props }) => React.createElement('button', props, children);
  const Select = ({ children, value, onValueChange, disabled }) => React.createElement('select', { 'aria-label': 'Select commitment duration', value, disabled, onChange: event => onValueChange(event.target.value) }, children);
  const SelectItem = ({ children, ...props }) => React.createElement('option', props, children);
  const Details = ({ values }) => React.createElement('dl', null, values.map(([label, value]) => React.createElement('div', { key: label }, React.createElement('dt', null, label), React.createElement('dd', null, value))));
  const responseRecord = response => response?.data?.data;
  const apiCalls = [];
  const storageApi = { availability: (id, options) => {
    apiCalls.push({ id, ...options });
    const result = { storageUnitId: id, month: options.month, intervals, availabilityState: currentMonthState, rangeAvailability: options.startDate ? currentRangeState : null,
      ...(options.startDate ? { requestedRange: { startDate: `${options.startDate}T00:00:00.000Z`, endDate: `${options.endDate}T00:00:00.000Z` } } : {}) };
    return Promise.resolve({ data: { success: true, data: result } });
  } };
  const mockedUseBackend = (loader, dependencies = []) => {
    const position = resourceIndex++;
    lastLoads[position] = { loader, dependencies };
    const start = state[0] || '';
    const selected = state[1] || '';
    const term = [term1, term3].find(item => `${item.unit}:${item.value}` === selected) || term1;
    const end = rentalEndDate(start, term);
    const month = position === 4 ? dependencies[2] : monthKey(start);
    const data = position === 0 ? [priceRule, priceRule3]
      : position === 1 ? priceRule
      : position === 2 ? { estimatedRent: 1000, depositAmount: 100, taxAmount: 0, basePrice: 1000, durationDays: 30 }
      : position === 3 ? { policyId: 'fixture' }
      : position === 4 ? (currentMonthState === 'ERROR' || currentMonthState === 'LOADING' ? null : { storageUnitId: unitId, month, intervals, availabilityState: currentMonthState })
      : (currentMonthState === 'ERROR' || currentMonthState === 'LOADING' || !dependencies[4] ? null : { storageUnitId: unitId, month, intervals, availabilityState: currentMonthState, rangeAvailability: currentRangeState, requestedRange: { startDate: `${start}T00:00:00.000Z`, endDate: `${end}T00:00:00.000Z` } });
    return { data, loading: position === 4 && currentMonthState === 'LOADING', error: position === 4 && currentMonthState === 'ERROR' ? 'fixture error' : '', retry: () => {} };
  };
  const mocks = {
    react: { useState, useEffect: () => {} },
    '@/api/reservationApi': { default: { estimateReal: async () => undefined } },
    '@/api/storageApi': { default: storageApi },
    '@/lib/selfStorageReservation': { selfStorageEstimate: value => value?.data?.data },
    '@/lib/selfStorageAvailability': availabilityHelpers,
    'react-router-dom': { useNavigate: () => path => { navigateTo = path; } },
    '@/api/customerRentalApi': { pricingApi: { list: async () => undefined, resolve: async () => undefined, resolvePolicy: async () => undefined } },
    '@/contexts/ReservationContext': { useReservation: () => ({ rentalDraft: { facility: { _id: facilityId, name: 'Test Facility', serviceTypes: ['SELF_STORAGE'], status: 'ACTIVE' }, unit: { _id: unitId, facilityId, size: 'SMALL', status: 'AVAILABLE', unitCode: 'A-01', volumeM3: 2 }, startDate: initialStart, term: term1 }, updateRentalDraft: value => { bookingDraft = value; } }) },
    '@/lib/booking': { formatMoney: value => String(value) },
    '@/lib/rentalPeriod': rentalPeriodHelpers,
    '@/components/ui/select': { Select, SelectTrigger: Box, SelectValue: Box, SelectContent: Box, SelectItem },
    '@/components/common/Steps': { default: () => null },
    './RentalBackendUI': { BackendScreen: Box, Card: Box, CardContent: Box, Button, Details, Link: Box, LoadState: () => null, Message: ({ error }) => error ? React.createElement('p', null, error) : null, useBackend: mockedUseBackend,
      rows: value => value, record: responseRecord, recordId: value => typeof value === 'string' ? value : value?._id || value?.id, validId: value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => name in mocks ? { __esModule: true, ...mocks[name] } : require(name), module, module.exports);
  const initialStart = addDays(utcToday(), 2);
  function render() {
    cursor = 0; resourceIndex = 0; lastLoads = [];
    const outer = module.exports.default({});
    return outer.type(outer.props);
  }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    if (typeof node.type === 'function') return find(node.type(node.props), predicate);
    for (const child of React.Children.toArray(node.props?.children)) { const result = find(child, predicate); if (result) return result; }
    return null;
  }
  return { render, find, state, apiCalls, lastLoads: () => lastLoads, setMonthState: value => { currentMonthState = value; if (value === 'UNIT_UNAVAILABLE') currentRangeState = value; }, setRangeState: value => { currentRangeState = value; }, setIntervals: value => { intervals = value; }, get draft() { return bookingDraft; }, get route() { return navigateTo; }, startDate: initialStart, addDays };
}

test('November 2026 starts Sunday and the rendered calendar uses seven aligned equal columns', () => {
  const firstOfNovember = new Date('2026-11-01T00:00:00.000Z');
  assert.equal(firstOfNovember.getUTCDay(), 0);
  const novemberDays = buildAvailabilityDays('2026-11', [], '2026-10-01');
  assert.equal(novemberDays.findIndex(day => day?.date === '2026-11-01') % 7, 0);
  const harness = compileComponent();
  const tree = harness.render();
  const grid = harness.find(tree, node => node.props?.role === 'grid');
  assert.match(grid.props.className, /grid-cols-7/);
  assert.match(grid.props.className, /min-w-0/);
  assert.match(grid.props.className, /gap-1\.5/);
  const layout = harness.find(tree, node => /lg:grid-cols-\[minmax\(0,1\.6fr\)_minmax\(18rem,0\.9fr\)\]/.test(node.props?.className || ''));
  assert(layout, 'the calendar and summary reflow to a single column below the desktop breakpoint');
  const headers = React.Children.toArray(grid.props.children).filter(node => node.props?.role === 'columnheader');
  assert.deepEqual(headers.map(node => node.props.children), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  assert(headers.every(node => /min-w-0/.test(node.props.className)));
  const cells = React.Children.toArray(grid.props.children);
  const firstDateCell = cells.findIndex((cell, index) => index >= 7 && harness.find(cell, node => node.type === 'button' && node.props.children?.[0]?.props?.children === 1));
  const monthFirst = new Date(`${monthKey(harness.startDate)}-01T00:00:00.000Z`);
  assert.equal((firstDateCell - 7) % 7, monthFirst.getUTCDay());
  const firstDate = harness.find(cells[firstDateCell], node => node.type === 'button');
  assert.match(firstDate.props.className, /w-full/);
  assert.match(firstDate.props.className, /h-11/);
});

test('clicking an available future day updates the selected move-in date and blue styling', () => {
  const harness = compileComponent();
  let tree = harness.render();
  const selectedDate = harness.addDays(harness.startDate, 1);
  const labelDate = new Date(`${selectedDate}T12:00:00.000Z`).toLocaleDateString('en', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const available = harness.find(tree, node => node.type === 'button' && node.props['aria-label']?.endsWith(': available'));
  assert(available);
  assert.match(available.props.className, /bg-emerald-50/, 'empty VERIFIED intervals render future days as available');
  let button = harness.find(tree, node => node.type === 'button' && node.props['aria-label']?.startsWith(labelDate));
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  tree = harness.render();
  button = harness.find(tree, node => node.type === 'button' && node.props['aria-label']?.startsWith(labelDate));
  assert.equal(button.props['aria-pressed'], true);
  assert.match(button.props.className, /bg-blue-600/);
  assert.match(renderToStaticMarkup(tree), new RegExp(`<dd>${selectedDate}</dd>`), 'the selected date appears in the rental summary');
  const review = harness.find(tree, node => node.type === 'button' && node.props.children === 'Review Reservation');
  assert.equal(review.props.disabled, false, 'verified available range and valid estimate enable review');
});

test('changing commitment duration recomputes the end date and sends a new full-range validation', async () => {
  const harness = compileComponent();
  let tree = harness.render();
  const duration = harness.find(tree, node => node.type === 'select');
  duration.props.onChange({ target: { value: 'MONTH:3' } });
  tree = harness.render();
  const expectedEnd = rentalEndDate(harness.startDate, term3);
  assert(harness.find(tree, node => node.type === 'dd' && node.props.children === expectedEnd));
  const loads = harness.lastLoads();
  assert.deepEqual(loads[4].dependencies, [facilityId, unitId, monthKey(harness.startDate), true]);
  assert(loads[5].dependencies.includes(expectedEnd));
  assert.deepEqual((await loads[4].loader({ signal: new AbortController().signal })).month, monthKey(harness.startDate));
  const range = await loads[5].loader({ signal: new AbortController().signal });
  assert.deepEqual(range.requestedRange, { startDate: `${harness.startDate}T00:00:00.000Z`, endDate: `${expectedEnd}T00:00:00.000Z` });
  assert.equal(harness.apiCalls[0].startDate, undefined, 'monthly calendar fetch is independent of range validation');
  assert.equal(harness.apiCalls[1].startDate, harness.startDate);
});

test('booked dates are red and disabled; the exclusive checkout boundary remains selectable', () => {
  const harness = compileComponent();
  const bookedStart = harness.addDays(harness.startDate, 3), bookedEnd = harness.addDays(bookedStart, 3);
  harness.setIntervals([{ startDate: `${bookedStart}T00:00:00.000Z`, endDate: `${bookedEnd}T00:00:00.000Z` }]);
  const tree = harness.render();
  const bookedLabel = new Date(`${bookedStart}T12:00:00.000Z`).toLocaleDateString('en', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const booked = harness.find(tree, node => node.type === 'button' && node.props['aria-label']?.startsWith(bookedLabel));
  assert.equal(booked.props.disabled, true);
  assert.match(booked.props.className, /bg-red-100/);
  const boundaryDate = new Date(`${bookedEnd}T12:00:00.000Z`).toLocaleDateString('en', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const boundary = harness.find(tree, node => node.type === 'button' && node.props['aria-label']?.startsWith(boundaryDate));
  assert.equal(boundary.props.disabled, false);
  assert.match(boundary.props.className, /bg-blue-600/, 'the available checkout boundary may still be blue as part of the selected rental interval');
});

test('unverified, loading, error and unavailable calendar states never paint dates green or permit selection', () => {
  for (const state of ['UNKNOWN', 'LOADING', 'ERROR', 'UNIT_UNAVAILABLE']) {
    const harness = compileComponent();
    harness.setMonthState(state);
    const tree = harness.render();
    const date = harness.find(tree, node => node.type === 'button' && node.props['aria-label']?.includes('availability unverified') || node.type === 'button' && node.props['aria-label']?.includes('unit unavailable'));
    assert(date, `${state} should render a neutral date button`);
    assert.equal(date.props.disabled, true, state);
    assert.doesNotMatch(date.props.className, /bg-emerald/);
    const review = harness.find(tree, node => node.type === 'button' && node.props.children === 'Review Reservation');
    assert.equal(review.props.disabled, true, state);
  }
});

test('range conflicts block Review while the verified monthly calendar stays interactive', () => {
  const harness = compileComponent();
  harness.setRangeState('CONFLICT');
  const tree = harness.render();
  const review = harness.find(tree, node => node.type === 'button' && node.props.children === 'Review Reservation');
  assert.equal(review.props.disabled, true);
  const date = harness.find(tree, node => node.type === 'button' && node.props['aria-label']?.endsWith(': available'));
  assert.equal(date.props.disabled, false);
});

test('availability responses from another Unit or month cannot be reused', () => {
  const response = { storageUnitId: unitId, month: '2026-11', availabilityState: 'VERIFIED', intervals: [] };
  assert.equal(availabilityMatches(response, { unitId, month: '2026-11' }), true);
  assert.equal(availabilityMatches(response, { unitId: facilityId, month: '2026-11' }), false);
  assert.equal(availabilityMatches(response, { unitId, month: '2026-12' }), false);
  assert.equal(availabilityMatches({ ...response, intervals: [{ startDate: 'bad', endDate: 'bad' }] }, { unitId, month: '2026-11' }), false);
});
