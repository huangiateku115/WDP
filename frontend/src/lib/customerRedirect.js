// Restore only this explicitly supported Customer destination. No external URLs or role routes.
export function customerWarehouseDestination(role, target) {
  return role === 'CUSTOMER' && typeof target === 'string' && !/\s/.test(target) && /^\/portal\/warehouse-map(?:\/[a-f\d]{24}(?:\/racks\/[a-f\d]{24})?)?$/i.test(target) ? target : '/portal';
}

// Only use this after the role has been returned by Backend authentication/profile APIs.
export function authenticatedDestination(role,target){
  const routes={FACILITY_MANAGER:'/manager/dashboard',FACILITY_STAFF:'/staff/dashboard',BOM:'/bom/dashboard',ADMIN:'/admin/dashboard'};
  if(role==='CUSTOMER'){
    if(typeof target==='string'&&!/\s/.test(target)){
      try{
        const url=new URL(target,'https://vaultspace.invalid'),reservationId=url.searchParams.get('reservationId'),paymentId=url.searchParams.get('paymentId'),service=url.searchParams.get('serviceType');
        if(url.origin==='https://vaultspace.invalid'&&url.pathname==='/portal/payments/return'&&!url.hash&&/^[a-f\d]{24}$/i.test(reservationId||'')&&/^[a-f\d]{24}$/i.test(paymentId||'')&&['SELF_STORAGE','MANAGED_INVENTORY'].includes(service)){
          const cancel=url.searchParams.get('cancel')==='true';return `/portal/payments/return?reservationId=${reservationId}&paymentId=${paymentId}&serviceType=${service}${cancel?'&cancel=true':''}`;
        }
      }catch{}
    }
    return customerWarehouseDestination(role,target);
  }
  if(routes[role])return routes[role];
  throw Error('Your account role is not supported. Please contact support.');
}
