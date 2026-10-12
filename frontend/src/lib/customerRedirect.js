// Restore only this explicitly supported Customer destination. No external URLs or role routes.
export function customerWarehouseDestination(role, target) {
  return role === 'CUSTOMER' && typeof target === 'string' && !/\s/.test(target) && /^\/portal\/warehouse-map(?:\/[a-f\d]{24}(?:\/racks\/[a-f\d]{24})?)?$/i.test(target) ? target : '/portal';
}
