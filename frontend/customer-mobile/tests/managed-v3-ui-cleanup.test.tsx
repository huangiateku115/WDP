import {fireEvent,render,screen,waitFor} from '@testing-library/react-native';
import {useState} from 'react';
import {ManagedTermsAccordion} from '../src/components/ManagedTermsAccordion';
import {hasManagedTermsAcceptance,managedTermsAcceptanceKey} from '../src/domain/managedTermsAcceptance';
import {managedPaperContractNextStep,managedPaymentLabel,managedPaymentProgress,managedRentalProgress} from '../src/domain/managedV3RentalProgress';

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
  expect(managedPaymentLabel({...row,status:'FAILED'})).toBe('Thanh toán thất bại');
  expect(managedPaymentProgress(undefined)).toBe('NONE');
  const applied={...row,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',applicationStatus:'APPLIED'};
  const needsReview={...row,status:'SUCCEEDED',providerSettlementStatus:'VERIFIED',reconciliationRequired:true};
  expect(managedPaymentProgress([applied,needsReview])).toBe('REVIEW');
});

test('rental progress uses Backend lifecycle and only marks inbound current with an eligible session',()=>{
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

test('paper-contract next step requires both the paid reservation lifecycle and fully applied payment',()=>{
  expect(managedPaperContractNextStep('PAID','APPLIED')).toBe(true);
  expect(managedPaperContractNextStep('PAID','VERIFYING')).toBe(false);
  expect(managedPaperContractNextStep('PAID','REVIEW')).toBe(false);
  expect(managedPaperContractNextStep('RESERVED','APPLIED')).toBe(false);
});
