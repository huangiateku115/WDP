// Temporary API-only navigation for the two facility roles. Other roles are unaffected.
export const facilityApiPages = {
  staff: [
    "tasks",
    "access",
    "customers",
    "reservations",
    "check-ins",
    "handovers",
    "inspections",
    "checkouts",
    "inventory/inbound",
    "inventory/outbound",
    "inventory/relocation",
    "inventory/history",
    "inventory/stock",
    "warehouse-map",
    "maintenance",
    "support",
  ],
  manager: [
    "warehouse-map",
    "operations",
    "tasks",
    "access",
    "customers",
    "reservations",
    "work/CHECK_IN",
    "work/HANDOVER",
    "work/INSPECTION",
    "work/CHECKOUT",
    "maintenance",
    "support",
  ],
};
export const facilityHome = (role) => `/${role}/reservations`;
export function facilityPageVisible(role, path = "") {
  if (role === 'staff' && /^inventory\/items\/[a-f\d]{24}\/history$/i.test(path)) return true;
  return (
    !facilityApiPages[role] ||
    facilityApiPages[role].some(
      (page) => path === page || path.startsWith(page + "/"),
    )
  );
}
