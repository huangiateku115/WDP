import type {ManagedSessionEligibilityReason} from './managedAccessSessionEligibility';

export type ManagedSessionDiagnosticCode='SESSION_NOT_FOUND'|'SESSION_FETCH_FAILED'|'SESSION_EXPIRED'|'SESSION_REVOKED'|
  'PURPOSE_NOT_ALLOWED'|'FACILITY_MISMATCH'|'RESERVATION_SCOPE_MISMATCH'|'SOURCE_RESERVATION_NOT_PRIMARY'|
  'CELL_SCOPE_MISMATCH'|'REVISION_STALE'|'SESSION_DTO_INVALID'|'SESSION_NOT_STARTED';
export type ManagedSessionDiagnostic={code:ManagedSessionDiagnosticCode;source?:'list'|'detail';httpStatus?:number;backendCode?:string};

export function managedSessionDiagnostic(reason:ManagedSessionEligibilityReason,input?:{status?:string;primaryOnly?:boolean;primaryReservationId?:string;
  reservationId?:string;scopedReservationIds?:string[]}):ManagedSessionDiagnosticCode{
  switch(reason){
    case 'MISSING':return 'SESSION_NOT_FOUND';
    case 'FACILITY':return 'FACILITY_MISMATCH';
    case 'RESERVATION':return input?.primaryOnly&&input.primaryReservationId!==input.reservationId&&input?.scopedReservationIds?.includes(input.reservationId??'')
      ?'SOURCE_RESERVATION_NOT_PRIMARY':'RESERVATION_SCOPE_MISMATCH';
    case 'STATUS':return input?.status==='REVOKED'?'SESSION_REVOKED':input?.status==='EXPIRED'?'SESSION_EXPIRED':'SESSION_DTO_INVALID';
    case 'NOT_STARTED':return 'SESSION_NOT_STARTED';
    case 'EXPIRED':return 'SESSION_EXPIRED';
    case 'PURPOSE':return 'PURPOSE_NOT_ALLOWED';
    case 'CELL':return 'CELL_SCOPE_MISMATCH';
    case 'REVISION':return 'REVISION_STALE';
    case 'OWNER':case 'STAFF_EVIDENCE':return 'SESSION_DTO_INVALID';
  }
}

export function sessionFetchDiagnostic(source:'list'|'detail',httpStatus?:number,backendCode?:string):ManagedSessionDiagnostic{
  return {code:'SESSION_FETCH_FAILED',source,...(httpStatus?{httpStatus}:{}),...(backendCode?{backendCode}:{})};
}
