import test from 'node:test';
import assert from 'node:assert/strict';
import { cellStockDiagnosticError, cellStockDiagnosticState, validateCellStockResponse } from '../src/lib/managerCellStockDiagnostic.js';

const cellId = 'a'.repeat(24), facilityId = 'b'.repeat(24);
const data = {
  cellId, facilityId, reconciliationStatus: 'MISMATCH',
  diagnostics: { evidenceStatus: 'COMPLETE', ledger: { status: 'VERIFIED' }, projection: { status: 'MISMATCH' }, counter: { weightKg: 4, volumeM3: 0.01 } },
};

test('diagnostic dialog distinguishes loading, HTTP errors, mismatch and unknown evidence', () => {
  assert.equal(cellStockDiagnosticState({ loading: true }), 'LOADING');
  assert.equal(cellStockDiagnosticState({ error: 'Không có quyền' }), 'ERROR');
  assert.equal(cellStockDiagnosticState({ data }), 'MISMATCH');
  assert.equal(cellStockDiagnosticState({ data: { ...data, reconciliationStatus: 'UNKNOWN', diagnostics: { ...data.diagnostics, evidenceStatus: 'UNKNOWN' } } }), 'UNKNOWN');
  assert.equal(cellStockDiagnosticState({ data: { ...data, diagnostics: { ...data.diagnostics, counter: { weightKg: null, volumeM3: null } } } }), 'UNKNOWN');
});

test('diagnostic response is bound to the requested Cell and assigned Facility', () => {
  const response = { data: { success: true, data } };
  assert.equal(validateCellStockResponse(response, cellId, facilityId), data);
  assert.throws(() => validateCellStockResponse(response, cellId, 'c'.repeat(24)), /ngoài phạm vi Facility/);
  assert.throws(() => validateCellStockResponse(response, 'd'.repeat(24), facilityId), /ngoài phạm vi Facility/);
});

test('403 and 404 responses produce scoped Vietnamese messages', () => {
  assert.match(cellStockDiagnosticError({ response: { status: 403 } }), /không có quyền/);
  assert.match(cellStockDiagnosticError({ response: { status: 404 } }), /Facility được phân công/);
});
