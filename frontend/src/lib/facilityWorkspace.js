// Temporary API-only navigation for the two facility roles. Other roles are unaffected.
export const facilityApiPages = {
  staff: [
    "managed",
    "tasks",
    "access",
    "managed-access",
    "managed-inventory-v3",
    "customers",
    "reservations",
    "check-ins",
    "handovers",
    "inspections",
    "checkouts",
    "inventory/history",
    "inventory/stock",
    "warehouse-map",
    "maintenance",
    "support",
  ],
  manager: [
    "managed",
    "warehouse-settings",
    "inventory/stock",
    "inventory/history",
    "warehouse-map",
    "operations",
    "tasks",
    "access",
    "managed-access",
    "managed-inventory-v3",
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
  if (['staff', 'manager'].includes(role) && /^inventory\/items\/[a-f\d]{24}\/history$/i.test(path)) return true;
  return (
    !facilityApiPages[role] ||
    facilityApiPages[role].some(
      (page) => path === page || path.startsWith(page + "/"),
    )
  );
}
