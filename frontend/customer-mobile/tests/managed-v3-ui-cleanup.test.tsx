import {fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import {useState} from 'react';
import {ManagedTermsAccordion} from '../src/components/ManagedTermsAccordion';
import {ManagedRentalProgress} from '../src/components/ManagedRentalProgress';
import {hasManagedTermsAcceptance,managedTermsAcceptanceKey} from '../src/domain/managedTermsAcceptance';
import {managedPaperContractNextStep,managedPaymentLabel,managedPaymentProgress,managedRentalPaymentProgress,managedRentalProgress} from '../src/domain/managedV3RentalProgress';
import {managedHandoverVerified} from '../src/domain/managedV3RentalProgress';
import {rentalDetailTarget} from '../src/domain/rentalDetailTarget';

const groups=[{id:'terms-1',title:'Quy định thuê',appliesTo:['MANAGED_INVENTORY'],sections:{MANAGED_INVENTORY:['Hàng hóa phải được khai báo.']}}];
const row={status:'PENDING',providerSettlementStatus:'NOT_VERIFIED',applicationStatus:'NOT_APPLIED',checkoutStatus:'READY',reconciliationRequired:false};
function TermsHarness(){
  const [expanded,setExpanded]=useState(false),[accepted,setAccepted]=useState(false);
  return <ManagedTermsAccordion version="2.4" groups={groups} expanded={expanded} onToggleExpanded={()=>setExpanded(value=>!value)}
    accepted={accepted} onToggleAcceptance={()=>setAccepted(value=>!value)}/>;
}

test('Managed rental Terms start collapsed, expand and collapse on demand, and acceptance remains explicit',async()=>{
  await render(<TermsHarness/>);
  expect(screen.getByText('Điều khoản thuê kho ký gửi')).toBeTruthy();
  expect(screen.getByText('Phiên bản 2.4')).toBeTruthy();
  expect(screen.queryByText('Hàng hóa phải được khai báo.')).toBeNull();
  await fireEvent.press(screen.getByRole('button',{name:'Xem điều khoản'}));
  await waitFor(()=>expect(screen.getByText('Hàng hóa phải được khai báo.')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button',{name:'Thu gọn điều khoản'}));
  await waitFor(()=>expect(screen.queryByText('Hàng hóa phải được khai báo.')).toBeNull());
  await fireEvent.press(screen.getByRole('button',{name:'Tôi chấp nhận điều khoản kho ký gửi'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Tôi chấp nhận điều khoản kho ký gửi'}).props.accessibilityState.selected).toBe(true));
});

test('My Rentals sends Managed Inventory to the live reservation detail and preserves Self Storage routing',()=>{
  const reservationId='1'.repeat(24),facilityId='2'.repeat(24);
  expect(rentalDetailTarget({_id:reservationId,facilityId,serviceType:'MANAGED_INVENTORY'})).toEqual({
    pathname:'/managed/[facilityId]/confirmation',params:{facilityId,reservationId},
  });
  expect(rentalDetailTarget({_id:reservationId,facilityId,serviceType:'SELF_STORAGE'})).toEqual({
    pathname:'/preview/[kind]/[id]',params:{kind:'rental',id:reservationId},
  });
});

test('handover completion requires an ACTIVE Backend reservation and valid staff evidence',()=>{
  const staffId='3'.repeat(24),handoverAt='2026-11-18T10:00:00.000Z';
  expect(managedHandoverVerified({status:'ACTIVE',handoverAt,handoverByStaffId:staffId})).toBe(true);
  expect(managedHandoverVerified({status:'ACTIVE',handoverAt})).toBe(false);
  expect(managedHandoverVerified({status:'ACTIVE',handoverAt:'bad-date',handoverByStaffId:staffId})).toBe(false);
  expect(managedHandoverVerified({status:'CHECKIN_READY',handoverAt,handoverByStaffId:staffId})).toBe(false);
  expect(managedRentalProgress({reservationStatus:'ACTIVE',payment:'APPLIED',handoverComplete:false}).find(step=>step.key==='handover')?.state).toBe('PENDING');
});

test('Managed Terms acceptance is scoped to the current facility and policy version',()=>{
  const accepted=managedTermsAcceptanceKey('facility-a:quote-1','terms-2');
  expect(hasManagedTermsAcceptance(accepted,'facility-a:quote-1','terms-2')).toBe(true);
  expect(hasManagedTermsAcceptance(accepted,'facility-a:quote-1','terms-3')).toBe(false);
  expect(hasManagedTermsAcceptance(accepted,'facility-b:quote-1','terms-2')).toBe(false);
  expect(hasManagedTermsAcceptance(accepted,'facility-a:quote-1',undefined)).toBe(false);
});

test('payment history translates mixed settlement, reconciliation and terminal states safely',()=>{
  expect(managedPaymentLabel(row)).toBe('Đang chờ thanh toán');
  expect(managedPaymentLabel({...row,status:'SUCCEEDED'})).toBe('Đang xác minh');
  expect(managedPaymentLabel({...row,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED'})).toBe('Đã thanh toán');
  expect(managedPaymentLabel({...row,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',reconciliationRequired:true})).toBe('Cần đối soát');
  expect(managedPaymentLabel({...row,checkoutStatus:'UNKNOWN'})).toBe('Đang xác minh');
  expect(managedPaymentLabel({...row,checkoutStatus:'CREATING'})).toBe('Đang xác minh');
  expect(managedPaymentLabel({...row,status:'FAILED'})).toBe('Thanh toán thất bại');
  expect(managedPaymentProgress(undefined)).toBe('NONE');
  const applied={...row,id:'4'.repeat(24),status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED'};
  const needsReview={...row,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',reconciliationRequired:true};
  expect(managedPaymentProgress([applied,needsReview])).toBe('APPLIED');
});

test('Managed payment progress follows verified payment evidence across reservation states',()=>{
  const applied={...row,id:'4'.repeat(24),status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED'};
  const staleJournalState={...row,status:'RECONCILIATION_REQUIRED',reconciliationRequired:true};
  expect(managedRentalPaymentProgress('RESERVED',[])).toBe('NONE');
  expect(managedRentalPaymentProgress('RESERVED',[row])).toBe('PENDING');
  expect(managedRentalPaymentProgress('PAID',[applied])).toBe('APPLIED');
  expect(managedRentalPaymentProgress('ACTIVE',[applied],applied.id)).toBe('APPLIED');
  expect(managedRentalPaymentProgress('ACTIVE',[applied])).toBe('UNSYNCED');
  expect(managedRentalPaymentProgress('ACTIVE',[row],applied.id)).toBe('UNSYNCED');
  expect(managedPaymentLabel({...row,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED'})).toBe('Đã thanh toán');
  expect(managedPaymentProgress([applied,staleJournalState])).toBe('APPLIED');
});

test('Payment History read failure is not classified as an interrupted payment',()=>{
  // Failed History reads provide no rows. An ACTIVE reservation is visibly
  // unsynchronized and retryable; a RESERVED reservation stays unconfirmed.
  expect(managedRentalPaymentProgress('ACTIVE',undefined)).toBe('UNSYNCED');
  expect(managedRentalPaymentProgress('RESERVED',undefined)).toBe('NONE');
  const step=managedRentalProgress({reservationStatus:'ACTIVE',payment:'UNSYNCED'}).find(item=>item.key==='payment');
  expect(step).toMatchObject({state:'BLOCKED',detail:expect.stringContaining('Chưa thể xác minh khoản thanh toán liên kết')});
});

test('ACTIVE without linked applied FULL_RENT evidence displays the synchronization label',async()=>{
  await render(<ManagedRentalProgress reservation={{status:'ACTIVE'} as never} payment="UNSYNCED"/>);
  expect(screen.getByText('Chưa xác minh thanh toán')).toBeTruthy();
  expect(screen.getByText(/Chưa thể xác minh khoản thanh toán liên kết/)).toBeTruthy();
});

test('rental progress follows the rental status and only marks inbound current with an eligible session',()=>{
  const paid=managedRentalProgress({reservationStatus:'PAID',payment:'APPLIED'});
  expect(paid.find(step=>step.key==='contract')?.state).toBe('CURRENT');
  expect(paid.find(step=>step.key==='handover')?.state).toBe('PENDING');
  const ready=managedRentalProgress({reservationStatus:'CHECKIN_READY',payment:'APPLIED'});
  expect(ready.find(step=>step.key==='contract')?.state).toBe('COMPLETED');
  expect(ready.find(step=>step.key==='handover')?.state).toBe('CURRENT');
  const active=managedRentalProgress({reservationStatus:'ACTIVE',payment:'APPLIED'});
  expect(active.find(step=>step.key==='handover')?.state).toBe('COMPLETED');
  expect(active.find(step=>step.key==='inbound')?.state).toBe('PENDING');
  const withSession=managedRentalProgress({reservationStatus:'ACTIVE',payment:'APPLIED',hasInboundSession:true});
  expect(withSession.find(step=>step.key==='inbound')?.state).toBe('CURRENT');
  expect(managedRentalProgress({reservationStatus:'ACTIVE',payment:'APPLIED',hasStoredItems:true}).find(step=>step.key==='inbound')?.state).toBe('COMPLETED');
});

test('payment that needs reconciliation blocks the next workflow steps',()=>{
  const steps=managedRentalProgress({reservationStatus:'PAID',payment:'REVIEW'});
  expect(steps.find(step=>step.key==='payment')?.state).toBe('BLOCKED');
  expect(steps.find(step=>step.key==='contract')?.state).toBe('BLOCKED');
});

test('ACTIVE reservation does not turn an uncertain PayOS checkout into a reconciliation requirement',()=>{
  const payment={...row,checkoutStatus:'UNKNOWN' as const};
  const progress=managedPaymentProgress([payment]);
  expect(progress).toBe('VERIFYING');
  expect(managedPaymentLabel(payment)).toBe('Đang xác minh');
  expect(managedRentalProgress({reservationStatus:'ACTIVE',payment:progress}).find(step=>step.key==='payment')?.state).toBe('CURRENT');
  expect(managedPaymentProgress([{...payment,checkoutStatus:'CREATING'}])).toBe('VERIFYING');
  expect(managedPaymentProgress([{...payment,reconciliationRequired:true}])).toBe('REVIEW');
  expect(managedPaymentProgress([{...payment,status:'RECONCILIATION_REQUIRED'}])).toBe('REVIEW');
});

test('paper-contract next step requires both the paid reservation lifecycle and fully applied payment',()=>{
  expect(managedPaperContractNextStep('PAID','APPLIED')).toBe(true);
  expect(managedPaperContractNextStep('PAID','VERIFYING')).toBe(false);
  expect(managedPaperContractNextStep('PAID','REVIEW')).toBe(false);
  expect(managedPaperContractNextStep('RESERVED','APPLIED')).toBe(false);
});
