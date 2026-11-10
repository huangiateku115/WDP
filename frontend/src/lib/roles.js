// Canonical role values, mirrored from the backend enum `UserRole`
// (backend/src/types/user.type.ts). Backend guards remain authoritative; this module only
// keeps frontend guards, layouts and shared pages reading the same vocabulary.
export const ROLES = Object.freeze({
  CUSTOMER: "CUSTOMER",
  FACILITY_STAFF: "FACILITY_STAFF",
  FACILITY_MANAGER: "FACILITY_MANAGER",
  BOM: "BOM",
  ADMIN: "ADMIN",
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.CUSTOMER]: "Customer",
  [ROLES.FACILITY_STAFF]: "Facility Staff",
  [ROLES.FACILITY_MANAGER]: "Facility Manager",
  [ROLES.BOM]: "Business Operations Manager",
  [ROLES.ADMIN]: "Administrator",
});

// Workspace entry point per role. Same destinations as
// `authenticatedDestination` in lib/customerRedirect.
export const ROLE_HOME = Object.freeze({
  [ROLES.CUSTOMER]: "/portal",
  [ROLES.FACILITY_STAFF]: "/staff/dashboard",
  [ROLES.FACILITY_MANAGER]: "/manager/dashboard",
  [ROLES.BOM]: "/bom/dashboard",
  [ROLES.ADMIN]: "/admin/dashboard",
});

export const isAdmin = (role) => role === ROLES.ADMIN;
export const isBom = (role) => role === ROLES.BOM;
export const isCustomer = (role) => role === ROLES.CUSTOMER;
export const isFacilityStaff = (role) => role === ROLES.FACILITY_STAFF;
export const isFacilityManager = (role) => role === ROLES.FACILITY_MANAGER;

// Roles allowed to review reservations / mock-pay, matching the backend route table
// (backend/src/routes/reservation.routes.ts).
export const canReviewReservations = (role) => isAdmin(role);
export const canMockPayReservations = (role) => isAdmin(role) || isBom(role);

export const knownRole = (role) => Object.values(ROLES).includes(role);
