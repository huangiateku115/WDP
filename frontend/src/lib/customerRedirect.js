// Restore only this explicitly supported Customer destination. No external URLs or role routes.
export function customerWarehouseDestination(role, target) {
  return role === 'CUSTOMER' && typeof target === 'string' && !/\s/.test(target) && /^\/portal\/warehouse-map(?:\/[a-f\d]{24}(?:\/racks\/[a-f\d]{24})?)?$/i.test(target) ? target : '/portal';
}

// Only use this after the role has been returned by Backend authentication/profile APIs.
export function authenticatedDestination(role,target){
  const routes={FACILITY_MANAGER:'/manager/dashboard',FACILITY_STAFF:'/staff/dashboard',BOM:'/bom/dashboard',ADMIN:'/admin/dashboard'};
  if(role==='CUSTOMER')return customerWarehouseDestination(role,target);
  if(routes[role])return routes[role];
  throw Error('Your account role is not supported. Please contact support.');
}
