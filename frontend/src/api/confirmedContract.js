// Contract source: backend team's WDP.postman_collection.json.
// Password recovery additionally confirmed by the supplied Auth controller contract.
// Customer read/write additions follow WDP Postman V2 and docs_rental_workflow.
// Signing/cancellation/support additions confirmed against local backend routes and services.
// This list constrains network integration; it is not an authorization guard.
export function apiBaseURL(value) {
  const base = value.replace(/\/+$/, "");
  if (base.endsWith("/api/v1")) return base;
  if (base.endsWith("/api")) return `${base}/v1`;
  return `${base}/api/v1`;
}
export function assertConfirmedRequest(config) {
  const method = (config.method || "get").toUpperCase();
  const path = String(config.url || "")
    .replace(/^\//, "")
    .replace(/\/$/, "");
  const confirmed = {
    POST: [
      "auth/login",
      "auth/forgot-password",
      "auth/reset-password",
      "auth/logout",
      "users/register",
      "users",
    ],
    GET: ["users/me", "users"],
    PUT: ["users/me/profile", "users/me/password"],
  };
  const customerAllowed =
    (method === "GET" &&
      /^(public\/facilities(\/[^/]+(\/(storage-options|pricing))?)?|facilities\/[^/]+\/storage-units|storage-units\/[^/]+|pricing-rules(\/resolve)?|policies(\/resolve)?|reservations\/(me|[^/]+)|contracts\/me|support-requests(\/[^/]+(\/messages)?)?)$/.test(
        path,
      )) ||
    (method === "PUT" && path === "customers/me/profile") ||
    (method === "POST" &&
      (path === "reservations" ||
        path === "reservations/estimate" ||
        path === "support-requests" ||
        /^support-requests\/[^/]+\/messages$/.test(path) ||
        path === "access/simulate-unlock" ||
        /^reservations\/[^/]+\/mock-pay$/.test(path)));
  const warehouseRead =
    method === "GET" &&
    (path === "warehouse-map" ||
      /^racks\/[a-f\d]{24}\/detail-map$/i.test(path));
  const managedCustomer =
    (method === "POST" &&
      ["reservations/managed", "reservations/managed/quote"].includes(path)) ||
    (method === "GET" &&
      /^reservations\/managed\/(capacity\/)?[a-f\d]{24}$/i.test(path)) ||
    (method === "PATCH" &&
      /^reservations\/managed\/[a-f\d]{24}\/cancel$/i.test(path)) ||
    (method === "POST" &&
      /^reservations\/managed\/[a-f\d]{24}\/mock-pay$/i.test(path));
  const contractDetail =
    method === "GET" && /^contracts\/[a-f\d]{24}$/i.test(path);
  const inventoryCustomer =
    (method === "POST" &&
      (path === "inventory-items" ||
        /^inventory-items\/[a-f\d]{24}\/(inbound-request|outbound-request)$/i.test(
          path,
        ))) ||
    (method === "GET" &&
      (path === "inventory-items/me" ||
        /^inventory-items\/[a-f\d]{24}(\/placement-preview)?$/i.test(path))) ||
    (method === "PATCH" && /^inventory-items\/[a-f\d]{24}$/i.test(path));
  const facilityReviewAllowed =
    (method === "GET" &&
      /^(customers(\/[^/]+)?|reservations\/facility\/[^/]+|reservations\/managed\/[a-fA-F0-9]{24})$/.test(
        path,
      )) ||
    (method === "PATCH" &&
      /^(customers\/[^/]+\/verify|reservations\/(managed\/)?[^/]+\/(approve|reject))$/.test(
        path,
      ));
  const inspectionAllowed =
    (method === "GET" &&
      (path === "inspections" || /^contracts\/[^/]+$/.test(path))) ||
    (method === "POST" && path === "inspections") ||
    (method === "PATCH" && /^inspections\/[^/]+\/complete$/.test(path));
  const deskAllowed =
    (method === "GET" && /^maintenance-tickets(\/[^/]+)?$/.test(path)) ||
    (method === "POST" &&
      /^(maintenance-tickets|support-requests)(\/[^/]+\/(assign|unassign))?$/.test(
        path,
      )) ||
    (method === "POST" && /^support-requests\/[^/]+\/messages$/.test(path)) ||
    (method === "PATCH" &&
      /^(maintenance-tickets|support-requests)\/[^/]+(\/status)?$/.test(path));
  const managedIntake =
    (method === "GET" && path === "inventory-items") ||
    (method === "POST" &&
      /^reservations\/managed\/[a-f\d]{24}\/contract$/i.test(path)) ||
    (method === "PATCH" &&
      /^contracts\/[a-f\d]{24}\/sign\/facility$/i.test(path));
  const customerBalance =
    method === "POST" &&
    /^reservations\/managed\/[a-f\d]{24}\/balance$/i.test(path);
  const customerDeposit =
    method === "POST" &&
    /^reservations\/managed\/[a-f\d]{24}\/deposit$/i.test(path);
  const depositMock =
    import.meta.env?.DEV === true &&
    import.meta.env?.VITE_ENABLE_MANAGED_DEPOSIT_MOCK === "true" &&
    method === "POST" &&
    /^reservations\/managed\/[a-f\d]{24}\/deposit\/mock-confirm$/i.test(path);
  const movementHistory =
    method === "GET" && /^inventory-items\/[a-f\d]{24}\/movements$/i.test(path);
  const allowed =
    movementHistory ||
    depositMock ||
    customerDeposit ||
    customerBalance ||
    managedIntake ||
    deskAllowed ||
    inspectionAllowed ||
    facilityReviewAllowed ||
    inventoryCustomer ||
    managedCustomer ||
    contractDetail ||
    warehouseRead ||
    customerAllowed ||
    (method === "GET" &&
      ["customers/me/profile", "notifications/me", "access/me"].includes(
        path,
      )) ||
    (method === "PATCH" && /^notifications\/[^/]+\/read$/.test(path)) ||
    (method === "PATCH" &&
      /^(contracts\/[^/]+\/sign|reservations\/[^/]+\/cancel)$/.test(path)) ||
    confirmed[method]?.includes(path) ||
    (method === "PATCH" && /^users\/[^/]+\/role$/.test(path)) ||
    (method === "DELETE" && /^users\/[^/]+$/.test(path));
  if (!allowed)
    throw Error(
      "This business API is not confirmed by the backend collection. Use the available demo workspace until its API is provided.",
    );
}
