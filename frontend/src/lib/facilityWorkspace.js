// Temporary API-only navigation for the two facility roles. Other roles are unaffected.
export const facilityApiPages = {
  staff: ['customers', 'reservations', 'check-ins', 'handovers', 'inspections', 'checkouts', 'maintenance', 'support'],
  manager: ['customers', 'reservations', 'work/CHECK_IN', 'work/HANDOVER', 'work/INSPECTION', 'work/CHECKOUT', 'maintenance', 'support'],
};
export const facilityHome = role => `/${role}/reservations`;
export function facilityPageVisible(role, path = '') {
  return !facilityApiPages[role] || facilityApiPages[role].some(page => path === page || path.startsWith(page + '/'));
}
