import {managedSessionDiagnostic,sessionFetchDiagnostic} from '../src/domain/managedSessionDiagnostics';

test('maps filtering reasons to internal diagnostics without customer-facing strings',()=>{
  expect(managedSessionDiagnostic('EXPIRED')).toBe('SESSION_EXPIRED');
  expect(managedSessionDiagnostic('PURPOSE')).toBe('PURPOSE_NOT_ALLOWED');
  expect(managedSessionDiagnostic('FACILITY')).toBe('FACILITY_MISMATCH');
  expect(managedSessionDiagnostic('CELL')).toBe('CELL_SCOPE_MISMATCH');
  expect(managedSessionDiagnostic('REVISION')).toBe('REVISION_STALE');
  expect(managedSessionDiagnostic('STATUS',{status:'REVOKED'})).toBe('SESSION_REVOKED');
  expect(managedSessionDiagnostic('RESERVATION',{primaryOnly:true,primaryReservationId:'a',reservationId:'b',scopedReservationIds:['a','b']})).toBe('SOURCE_RESERVATION_NOT_PRIMARY');
  expect(managedSessionDiagnostic('RESERVATION',{primaryOnly:true,primaryReservationId:'a',reservationId:'b',scopedReservationIds:['a']})).toBe('RESERVATION_SCOPE_MISMATCH');
});

test('captures Session list or detail read failures without request payloads',()=>{
  expect(sessionFetchDiagnostic('detail',503,'SESSION_SERVICE_UNAVAILABLE')).toEqual({
    code:'SESSION_FETCH_FAILED',source:'detail',httpStatus:503,backendCode:'SESSION_SERVICE_UNAVAILABLE',
  });
});
