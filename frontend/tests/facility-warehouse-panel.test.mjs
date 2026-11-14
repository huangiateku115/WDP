import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../src/pages/bom/FacilityPage.jsx', import.meta.url), 'utf8');

// A Self Storage-only facility has no warehouse map: the Backend answers 409, so the detail page
// must not fetch the structure and must not render the panel with the "does not apply" notice.
test('the warehouse structure panel is only rendered for Managed Inventory facilities', () => {
  assert.match(source, /supportsManagedInventory = Boolean\(state\.data\?\.serviceTypes\?\.includes\("MANAGED_INVENTORY"\)\)/);
  assert.match(source, /supportsManagedInventory\s*\?\s*loadWarehouseStructure/);
  assert.match(source, /\{supportsManagedInventory && \(\s*<AsyncBoundary state=\{warehouse\}/);
});
