import {refId} from '../api/contracts/core';
import type {managedReservationReads} from '../api/managedReservationReads';

export type ManagedSession=Awaited<ReturnType<typeof managedReservationReads.sessions>>[number];
export type ManagedOperationPurpose='INBOUND'|'OUTBOUND'|'RELOCATION';
export type ManagedSessionEligibilityReason='MISSING'|'OWNER'|'FACILITY'|'RESERVATION'|'STATUS'|'NOT_STARTED'|'EXPIRED'|'PURPOSE'|'CELL'|'REVISION'|'STAFF_EVIDENCE';
export type ManagedSessionEligibility={eligible:boolean;reason?:ManagedSessionEligibilityReason};

export function managedSessionEligibility(session:ManagedSession|null|undefined,input:{customerId:string;facilityId:string;reservationId:string;purpose:ManagedOperationPurpose;
  cellIds?:string[];revision?:number;now?:number;primaryReservationOnly?:boolean}):ManagedSessionEligibility{
  if(!session)return {eligible:false,reason:'MISSING'};
  const now=input.now??Date.now(),scope=[refId(session.reservationId),...(session.scopedReservationIds??[]).map(refId)];
  if(refId(session.customerId)!==input.customerId)return {eligible:false,reason:'OWNER'};
  if(refId(session.facilityId)!==input.facilityId)return {eligible:false,reason:'FACILITY'};
  const primaryOnly=input.primaryReservationOnly??input.purpose==='RELOCATION';
  if(primaryOnly?refId(session.reservationId)!==input.reservationId:!scope.includes(input.reservationId))return {eligible:false,reason:'RESERVATION'};
  if(session.status!=='ACTIVE')return {eligible:false,reason:'STATUS'};
  if(!session.visitId||!session.assignedStaffId)return {eligible:false,reason:'STAFF_EVIDENCE'};
  if(Date.parse(session.startedAt)>now)return {eligible:false,reason:'NOT_STARTED'};
  if(Date.parse(session.expiresAt)<=now)return {eligible:false,reason:'EXPIRED'};
  if(!session.allowedPurposes.includes(input.purpose))return {eligible:false,reason:'PURPOSE'};
  if(input.revision!==undefined&&session.revision!==input.revision)return {eligible:false,reason:'REVISION'};
  const cells=new Set(session.allowedCellIds.map(refId));
  if((input.cellIds??[]).some(cellId=>!cells.has(cellId)))return {eligible:false,reason:'CELL'};
  return {eligible:true};
}
