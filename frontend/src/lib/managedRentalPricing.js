// Read-only interpretation of the confirmed Managed quote/reservation snapshots.
// A scheduled depositCredit in a pricing snapshot is not a successful payment.
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
function breakdown(value,depositRequired,currency){
  if(!value||![value.totalDue,value.depositCredit,value.balanceDue,depositRequired].every(amount)||typeof currency!=='string'||!currency.trim()||value.depositCredit!==depositRequired||value.depositCredit>value.totalDue||value.balanceDue!==Math.max(0,value.totalDue-value.depositCredit))throw Error('Managed V2 pricing is unavailable or inconsistent. Refresh the confirmed snapshot.');
  return {totalRentPayable:value.totalDue,advanceDepositRequired:value.depositCredit,balanceAfterDeposit:value.balanceDue,currency};
}
export function managedQuoteFinancials(quote){
  if(quote?.bookingFlowVersion!==2)throw Error('A confirmed Managed V2 quote is required.');
  if(![quote.pricing?.estimatedRent,quote.taxAmount,quote.deposit?.amount].every(amount))throw Error('Managed V2 quote amounts are unavailable or inconsistent.');
  const result=breakdown(quote.paymentBreakdown,quote.deposit.amount,quote.pricing.currency);
  // publicQuote returns rent and tax; its confirmed implementation applies no quote discount.
  // Refuse unexplained differences instead of inventing a discount or repricing the snapshot.
  if(result.totalRentPayable!==quote.pricing.estimatedRent+quote.taxAmount)throw Error('Managed V2 quote totals do not match the confirmed rent and tax.');
  return result;
}
export function managedReservationFinancials(reservation){
  if(reservation?.serviceType!=='MANAGED_INVENTORY'||reservation.bookingFlowVersion!==2)throw Error('A confirmed Managed V2 reservation is required.');
  const snapshot=reservation.managedPricingSnapshot,b=snapshot?.amountBreakdown;
  if(!b||![b.estimatedRent,b.depositAmount,b.taxAmount,b.discountAmount].every(amount)||b.totalDue!==b.estimatedRent+b.taxAmount-b.discountAmount)throw Error('Managed V2 reservation pricing is unavailable or inconsistent.');
  const result=breakdown(b,b.depositAmount,snapshot.pricingRule?.currency);
  for(const [key,value] of Object.entries({estimatedRent:b.estimatedRent,depositAmount:b.depositAmount,taxAmount:b.taxAmount,discountAmount:b.discountAmount}))if(reservation[key]!==undefined&&reservation[key]!==value)throw Error('Managed V2 reservation amounts differ from the immutable snapshot.');
  const depositConfirmed=['DEPOSIT_PAID','CHECKIN_READY','ACTIVE'].includes(reservation.status),rentSettled=['CHECKIN_READY','ACTIVE'].includes(reservation.status);
  return {...result,confirmedDepositCredit:depositConfirmed?result.advanceDepositRequired:reservation.status==='RESERVED'?0:null,remainingRentDue:rentSettled?0:depositConfirmed?result.balanceAfterDeposit:reservation.status==='RESERVED'?result.totalRentPayable:null};
}
export function managedFinancialRows(result,formatAmount=(value,currency)=>`${value} ${currency}`){return [['Total rent payable',formatAmount(result.totalRentPayable,result.currency)],['Scheduled advance-rent deposit',formatAmount(result.advanceDepositRequired,result.currency)],['Balance after required deposit (plan)',formatAmount(result.balanceAfterDeposit,result.currency)],...(Object.hasOwn(result,'confirmedDepositCredit')?[['Confirmed advance-rent credit',result.confirmedDepositCredit===null?'Unavailable from this lifecycle state':formatAmount(result.confirmedDepositCredit,result.currency)],['Remaining rent due',result.remainingRentDue===null?'Unavailable from this lifecycle state':formatAmount(result.remainingRentDue,result.currency)]]:[])];}
