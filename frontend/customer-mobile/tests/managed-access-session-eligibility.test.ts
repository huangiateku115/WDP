import {managedSessionEligibility,type ManagedSession} from '../src/domain/managedAccessSessionEligibility';

const customerId='1'.repeat(24),facilityId='2'.repeat(24),primaryId='3'.repeat(24),secondaryId='4'.repeat(24),cellId='5'.repeat(24),otherCell='6'.repeat(24);
const session={_id:'7'.repeat(24),customerId,facilityId,reservationId:primaryId,scopedReservationIds:[primaryId,secondaryId],visitId:'8'.repeat(24),assignedStaffId:'9'.repeat(24),
  allowedCellIds:[cellId],allowedPurposes:['INBOUND','OUTBOUND','RELOCATION'],revision:4,startedAt:'2026-11-19T09:00:00.000Z',expiresAt:'2026-11-19T11:00:00.000Z',status:'ACTIVE'} as ManagedSession;
const base={customerId,facilityId,reservationId:primaryId,purpose:'OUTBOUND' as const,now:Date.parse('2026-11-19T10:00:00.000Z')};

it('accepts one fresh staff session across its allowed operations and multi-reservation scope',()=>{
  expect(managedSessionEligibility(session,{...base,cellIds:[cellId]})).toEqual({eligible:true});
  expect(managedSessionEligibility(session,{...base,reservationId:secondaryId,cellIds:[cellId]})).toEqual({eligible:true});
  expect(managedSessionEligibility(session,{...base,purpose:'RELOCATION',cellIds:[cellId]})).toEqual({eligible:true});
  expect(managedSessionEligibility(session,{...base,reservationId:secondaryId,purpose:'RELOCATION',cellIds:[cellId]}).reason).toBe('RESERVATION');
  expect(managedSessionEligibility(session,{...base,purpose:'INBOUND'})).toEqual({eligible:true});
});

it('rejects changed owner, facility, scope, permission, cell, revision, and validity window',()=>{
  expect(managedSessionEligibility(session,{...base,customerId:'a'.repeat(24)}).reason).toBe('OWNER');
  expect(managedSessionEligibility(session,{...base,facilityId:'b'.repeat(24)}).reason).toBe('FACILITY');
  expect(managedSessionEligibility(session,{...base,reservationId:'c'.repeat(24)}).reason).toBe('RESERVATION');
  expect(managedSessionEligibility(session,{...base,purpose:'INSPECTION' as never}).reason).toBe('PURPOSE');
  expect(managedSessionEligibility(session,{...base,cellIds:[otherCell]}).reason).toBe('CELL');
  expect(managedSessionEligibility(session,{...base,revision:3}).reason).toBe('REVISION');
  expect(managedSessionEligibility({...session,status:'REVOKED'},base).reason).toBe('STATUS');
  expect(managedSessionEligibility({...session,expiresAt:'2026-11-19T09:30:00.000Z'},base).reason).toBe('EXPIRED');
  expect(managedSessionEligibility(session,{...base,primaryReservationOnly:true,reservationId:secondaryId}).reason).toBe('RESERVATION');
});
