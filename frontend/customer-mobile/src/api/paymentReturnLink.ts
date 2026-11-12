const objectIdPattern=/^[a-f\d]{24}$/i;

export function nativePaymentReturnPath(reservationId:unknown,paymentId:unknown,serviceType:unknown,cancel=false){
  if(typeof reservationId!=='string'||!objectIdPattern.test(reservationId)||
     typeof paymentId!=='string'||!objectIdPattern.test(paymentId)||serviceType!=='SELF_STORAGE')return null;
  const params=new URLSearchParams({reservationId,paymentId,serviceType});
  if(cancel)params.set('cancel','true');
  return `/payments/return?${params.toString()}` as const;
}

// Only restore the fixed payment callback path after sign-in; discard all other params.
export function restoreNativePaymentReturnPath(value:unknown){
  if(typeof value!=='string'||!value.startsWith('/'))return null;
  try{
    const url=new URL(value,'https://vaultspace.invalid');
    if(url.origin!=='https://vaultspace.invalid'||url.pathname!=='/payments/return'||url.hash)return null;
    return nativePaymentReturnPath(url.searchParams.get('reservationId'),url.searchParams.get('paymentId'),
      url.searchParams.get('serviceType'),url.searchParams.get('cancel')==='true');
  }catch{return null;}
}
