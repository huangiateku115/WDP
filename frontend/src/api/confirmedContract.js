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
    (method === "GET" && /^storage-units\/[a-f\d]{24}\/availability$/i.test(path)) ||
    (method === "PUT" && path === "customers/me/profile") ||
    (method === "POST" &&
      (path === "reservations" ||
        path === "reservations/estimate" ||
        /^reservations\/[a-f\d]{24}\/payments\/payos$/i.test(path) ||
        path === "support-requests" ||
        /^support-requests\/[^/]+\/messages$/.test(path) ||
        path === "access/simulate-unlock"));
  const customerPayosStatus =
    method === "GET" &&
    /^reservations\/[a-f\d]{24}\/payments\/[a-f\d]{24}$/i.test(path);
  const customerPayosReconcile = method === "POST" &&
    /^reservations\/[a-f\d]{24}\/payments\/[a-f\d]{24}\/reconcile$/i.test(path);
  const customerPayosHistory =
    method === "GET" &&
    /^reservations\/[a-f\d]{24}\/payments\/payos(?:\?[^#]*)?$/i.test(path);
  const managedCustomerPayos =
    (method === "POST" && /^reservations\/managed\/[a-f\d]{24}\/payments\/payos$/i.test(path)) ||
    (method === "GET" && /^reservations\/managed\/[a-f\d]{24}\/payments\/(?:payos(?:\?[^#]*)?|[a-f\d]{24})$/i.test(path)) ||
    (method === "POST" && /^reservations\/managed\/[a-f\d]{24}\/payments\/[a-f\d]{24}\/reconcile$/i.test(path));
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
      /^reservations\/managed\/[a-f\d]{24}\/cancel$/i.test(path));
  const contractDetail =
    method === "GET" && /^contracts\/[a-f\d]{24}$/i.test(path);
  const contractByReservation =
    method === "GET" && /^contracts\/reservation\/[a-f\d]{24}$/i.test(path);
  const userFacilityAssignment =
    (method === "PATCH" || method === "DELETE") &&
    /^users\/[a-f\d]{24}\/facility-assignment$/i.test(path);
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
    (method === "GET" &&
      /^inventory-items\/[a-f\d]{24}\/receiving-inspection\/context$/i.test(
        path,
      )) ||
    (method === "POST" &&
      /^inventory-items\/[a-f\d]{24}\/receiving-inspection(\/image-uploads)?$/i.test(
        path,
      )) ||
    (method === "POST" &&
      /^inventory-items\/[a-f\d]{24}\/confirm-inbound$/i.test(path)) ||
    (method === "POST" &&
      /^reservations\/managed\/[a-f\d]{24}\/contract$/i.test(path)) ||
    (method === "PATCH" &&
      /^contracts\/[a-f\d]{24}\/sign\/facility$/i.test(path));
  const selfStoragePayment =
    method === "POST" &&
    (/^reservations\/[a-f\d]{24}\/(deposit|balance)$/i.test(path) ||
      // Fail closed: these Backend callbacks have no verified environment gate.
      (false &&
        /^reservations\/[a-f\d]{24}\/(deposit|balance)\/mock-confirm$/i.test(
          path,
        )));
  const customerBalance =
    method === "POST" &&
    /^reservations\/managed\/[a-f\d]{24}\/balance$/i.test(path);
  const balanceMock =
    import.meta.env?.DEV === true &&
    import.meta.env?.VITE_ENABLE_MANAGED_BALANCE_MOCK === "true" &&
    method === "POST" &&
    /^reservations\/managed\/[a-f\d]{24}\/balance\/mock-confirm$/i.test(path);
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
  // Customer MI-06 routes verified in BE-REF. Backend retains role, ownership,
  // feature-gate, Idempotency-Key and If-Match enforcement.
  const customerInventoryRequests =
    (["GET", "POST"].includes(method) &&
      /^inventory-items\/[a-f\d]{24}\/(inbound-requests|outbound-requests)$/i.test(
        path,
      )) ||
    (method === "GET" &&
      /^inventory-items\/[a-f\d]{24}\/stock-balance$/i.test(path)) ||
    (["GET", "PATCH"].includes(method) &&
      /^inbound-requests\/[a-f\d]{24}$/i.test(path)) ||
    (method === "POST" &&
      /^inbound-requests\/[a-f\d]{24}\/cancel$/i.test(path)) ||
    (method === "GET" && /^outbound-requests\/[a-f\d]{24}$/i.test(path)) ||
    (method === "POST" &&
      /^outbound-requests\/[a-f\d]{24}\/cancel$/i.test(path));
  const bomAdminResource =
    (method === "GET" &&
      (/^facilities(\/[^/]+)?$/.test(path) ||
        /^pricing-rules(\/[^/]+)?$/.test(path) ||
        /^policies(\/[^/]+)?$/.test(path) ||
        /^inventory-items$/.test(path) ||
        /^warehouse-zones(\/[^/]+)?$/.test(path) ||
        /^racks(\/[^/]+)?$/.test(path) ||
        /^rack-cells(\/[^/]+)?$/.test(path) ||
        /^reservations\/managed\/capacity\/[^/]+$/.test(path) ||
        /^audit\/(admin|bom)\/(login-history|audit-logs)\/[^/]+$/.test(
          path,
        ))) ||
    (method === "POST" &&
      (/^facilities$/.test(path) ||
        /^facilities\/[^/]+\/(restore|storage-units)$/.test(path) ||
        /^pricing-rules$/.test(path) ||
        /^policies$/.test(path) ||
        /^storage-units\/[^/]+\/restore$/.test(path) ||
        /^users$/.test(path) ||
        /^(maintenance-tickets|support-requests)\/[^/]+\/(assign|unassign|escalate)$/.test(
          path,
        ))) ||
    (method === "PUT" &&
      (/^users\/(?!me$)[^/]+$/.test(path) ||
        /^reservations\/managed\/capacity\/[^/]+$/.test(path))) ||
    (method === "PATCH" &&
      (/^facilities\/[^/]+(\/status)?$/.test(path) ||
        /^pricing-rules\/[^/]+(\/status)?$/.test(path) ||
        /^policies\/[^/]+(\/status)?$/.test(path) ||
        /^storage-units\/[^/]+(\/status)?$/.test(path) ||
        /^users\/[^/]+\/reactivate$/.test(path) ||
        /^(maintenance-tickets|support-requests)\/[^/]+\/status$/.test(
          path,
        ))) ||
    (method === "DELETE" &&
      (/^facilities\/[^/]+$/.test(path) ||
        /^storage-units\/[^/]+$/.test(path)));
  const bomStorageUnitWrite =
    (method === "POST" &&
      (/^facilities\/[^/]+\/storage-units$/.test(path) ||
        /^storage-units\/[^/]+\/restore$/.test(path))) ||
    (method === "PATCH" && /^storage-units\/[^/]+(\/status)?$/.test(path)) ||
    (method === "DELETE" && /^storage-units\/[^/]+$/.test(path));
  const bomWarehouseWrite =
    (method === "POST" &&
      (/^warehouse-zones$/.test(path) ||
        /^warehouse-zones\/[^/]+\/restore$/.test(path) ||
        /^racks$/.test(path) ||
        /^racks\/[^/]+\/restore$/.test(path))) ||
    (method === "PATCH" &&
      (/^warehouse-zones\/[^/]+$/.test(path) ||
        /^racks\/[^/]+$/.test(path) ||
        /^rack-cells\/[^/]+$/.test(path))) ||
    (method === "DELETE" &&
      (/^warehouse-zones\/[^/]+$/.test(path) || /^racks\/[^/]+$/.test(path)));
  const bomCapacityAdmin =
    (method === "PUT" &&
      /^reservations\/managed\/capacity\/[^/]+$/i.test(path)) ||
    (method === "GET" &&
      /^reservations\/managed\/capacity\/[^/]+$/i.test(path));
  const bomReservationAdmin =
    (method === "GET" &&
      (/^reservations\/[^/]+$/.test(path) ||
        /^reservations\/managed\/[^/]+$/.test(path))) ||
    (method === "PATCH" &&
      (/^reservations\/[^/]+\/(approve|reject)$/.test(path) ||
        /^reservations\/managed\/[^/]+\/(approve|reject|activate)$/.test(
          path,
        ))) ||
    (method === "POST" &&
      (/^reservations\/[^/]+\/mock-pay$/.test(path) ||
        /^reservations\/managed\/[^/]+\/mock-pay$/.test(path)));
  const bomInventoryRead =
    method === "GET" &&
    (/^inventory-items\/[^/]+$/.test(path) ||
      /^inventory-items\/[^/]+\/movements$/.test(path));
  const facilityHandover =
    (method === "GET" && /^contracts\/[a-f\d]{24}\/print$/i.test(path)) ||
    (method === "POST" &&
      /^(contracts\/[a-f\d]{24}\/confirm-signed-paper|reservations\/[a-f\d]{24}\/handover|reservations\/managed\/[a-f\d]{24}\/handover)$/i.test(
        path,
      ));
  const allowed =
    customerInventoryRequests ||
    facilityHandover ||
    customerPayosHistory ||
    customerPayosStatus ||
    customerPayosReconcile ||
    managedCustomerPayos ||
    bomInventoryRead ||
    bomReservationAdmin ||
    bomStorageUnitWrite ||
    bomWarehouseWrite ||
    bomCapacityAdmin ||
    bomAdminResource ||
    (method === "POST" && path === "inventory-items/image-uploads") ||
    (method === "DELETE" &&
      /^inventory-items\/image-uploads\/[a-f\d]{24}$/i.test(path)) ||
    movementHistory ||
    depositMock ||
    balanceMock ||
    customerDeposit ||
    customerBalance ||
    selfStoragePayment ||
    managedIntake ||
    deskAllowed ||
    inspectionAllowed ||
    facilityReviewAllowed ||
    inventoryCustomer ||
    managedCustomer ||
    contractDetail ||
    contractByReservation ||
    userFacilityAssignment ||
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
