import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

const source = readFileSync(new URL('../src/lib/useFacilityResource.js', import.meta.url), 'utf8');
function focusSubscription(options) {
  const listeners = new Map();
  const effects = [];
  const react = {
    useState: value => [value, () => {}],
    useCallback: callback => callback,
    useEffect: callback => effects.push(callback),
  };
  const window = {
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: event => listeners.delete(event),
  };
  const module = {exports: {}};
  const code = transformSync(source, {format: 'cjs'}).code;
  new Function('require', 'module', 'exports', 'window', code)(
    name => name === 'react' ? react : {reviewError: String}, module, module.exports, window,
  );
  module.exports.default(() => null, false, options);
  const cleanup = effects[0]();
  return {listeners, cleanup};
}

test('file-picker focus does not reload a resource when disabled', () => {
  const {listeners, cleanup} = focusSubscription({refreshOnFocus: false});
  assert.equal(listeners.has('focus'), false);
  assert.equal(listeners.has('storage'), true);
  assert.equal(listeners.has('facility-review-changed'), true);
  cleanup();
  assert.equal(listeners.size, 0);
});

test('other resource screens retain automatic focus refresh', () => {
  const {listeners, cleanup} = focusSubscription();
  assert.equal(listeners.has('focus'), true);
  cleanup();
  assert.equal(listeners.size, 0);
});

test('both reservation parent and handover panel protect file selection', () => {
  const parent = readFileSync(new URL('../src/pages/manager/ReservationApiView.jsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/components/staff/FacilityHandoverPanel.jsx', import.meta.url), 'utf8');
  assert.match(parent, /refreshOnFocus:!id/);
  assert.match(panel, /refreshOnFocus:false/);
});
