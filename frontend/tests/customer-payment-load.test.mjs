import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  eligiblePayosPurpose,
  normalizePayosReferenceId,
  payosContractMatchesIdentity,
} from "../src/lib/selfStoragePayos.js";
import * as selfStorageSuggestions from "../src/components/customer/selfStorageSuggestions.js";
import {
  readOrCreateSelfStorageBookingAttempt,
  writeSelfStorageBookingAttempt,
} from "../src/lib/selfStorageReservation.js";

const require = createRequire(import.meta.url);
const reservationId = "507f1f77bcf86cd799439011";
const customerId = "507f1f77bcf86cd799439012";
const contractId = "507f1f77bcf86cd799439013";
const facilityId = "507f1f77bcf86cd799439014";
const unitId = "507f1f77bcf86cd799439015";
const reservation = {
  _id: reservationId,
  customerId,
  serviceType: "SELF_STORAGE",
  status: "CONTRACTED",
  reservationCode: "BKG-TEST-01",
  facilityId,
  storageUnitId: unitId,
  startDate: "2026-12-01T00:00:00.000Z",
  endDate: "2027-01-01T00:00:00.000Z",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  estimatedRent: 3000000,
  depositAmount: 1000000,
  taxAmount: 0,
  discountAmount: 0,
};
const draftContract = {
  _id: contractId,
  reservationId,
  customerId,
  status: "DRAFT",
};
const element = (type, props = {}, children = props.children) =>
  React.createElement(type, props, children);
const box = ({ children, ...props }) => element("div", props, children);
const button = ({ children, asChild, ...props }) =>
  element("button", props, children);
const message = ({ error, success, children }) =>
  error || success || children
    ? element(
        "p",
        { role: error ? "alert" : "status" },
        error || success || children,
      )
    : null;
const details = ({ values = [] }) =>
  React.createElement(
    "dl",
    null,
    values.map(([label, value]) =>
      React.createElement(
        "div",
        { key: label },
        React.createElement("dt", null, label),
        React.createElement("dd", null, value),
      ),
    ),
  );
const screen = ({ title, children }) =>
  React.createElement(
    "main",
    null,
    React.createElement("h1", null, title),
    children,
  );
const summary = ({ item }) =>
  element(
    "section",
    { "data-testid": "reservation-summary" },
    item.reservationCode || item._id,
  );
const record = (response) => {
  const value = response?.data?.data;
  if (!value || typeof value !== "object")
    throw Error("Invalid fixture response");
  return value;
};
const recordId = (value) =>
  typeof value === "string" ? value : value?._id || value?.id;
const validId = (value) =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

function compile(relativePath, mocks) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const code = transformSync(source, {
    loader: "jsx",
    format: "cjs",
    jsx: "automatic",
  }).code;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name) => {
      if (name in mocks) return { __esModule: true, ...mocks[name] };
      return require(name);
    },
    module,
    module.exports,
  );
  return module.exports;
}

function lifecycleModule({ routeResource, contractResponse } = {}) {
  const calls = { byReservation: [], detail: 0 };
  let checkoutProps = null;
  const SelfStoragePayosCheckout = (props) => {
    checkoutProps = props;
    return element(
      "div",
      { "data-testid": "payos-checkout" },
      normalizePayosReferenceId(props.initialReservation),
    );
  };
  const mocks = {
    "./CustomerResourceState": {
      default: ({ resource }) =>
        resource.loading
          ? element("p", { role: "status" }, "Loading backend data…")
          : null,
    },
    "./CustomerPortalUI": {
      PortalSummaryCards: box,
      PortalEmptyState: box,
      PortalTextLink: box,
    },
    "@/components/common/CustomerScreen": { CustomerScreen: screen },
    "./ContractPrintAction": { default: () => null },
    "./inventory/ManagedContractReview": { default: () => null },
    "./CustomerBalancePayment": { default: () => null },
    "./CustomerDepositPayment": { default: () => null },
    "@/lib/managedCellBooking": { volumeText: () => "" },
    "@/lib/inventoryRegistration": {
      eligibleInventoryRegistration: () => false,
    },
    "./SelfStoragePayosCheckout": { default: SelfStoragePayosCheckout },
    "./CustomerPaymentNavigation": { SelfPaymentNavigation: () => null },
    "@/lib/selfStoragePayos": {
      eligiblePayosPurpose,
      normalizePayosReferenceId,
    },
    "./warehouse/ManagedCellSummary": { default: () => null },
    "./warehouse/ManagedCellBooking": { clearMapAvailability: () => {} },
    "@/lib/customerReservationService": {
      SELF_STORAGE: "SELF_STORAGE",
      MANAGED_INVENTORY: "MANAGED_INVENTORY",
      serviceType: (item) => item?.serviceType,
      serviceLabel: () => "",
      liveHold: () => false,
      canCancel: () => false,
      canSign: () => false,
      contractAmounts: () => ({}),
      isManagedV2: (item) =>
        item?.serviceType === "MANAGED_INVENTORY" &&
        item?.bookingFlowVersion === 2,
      isLegacyManaged: (item) =>
        item?.serviceType === "MANAGED_INVENTORY" &&
        item?.bookingFlowVersion !== 2,
      hasLegacyRentalFlow: () => false,
      reservationLifecycle: () => ({ label: "" }),
    },
    react: {
      useState: (initial) => [initial, () => {}],
      useEffect: () => {},
      useRef: (initial) => ({ current: initial }),
    },
    "react-router-dom": {
      useParams: () => ({ reservationId }),
      useLocation: () => ({ state: null }),
      useNavigate: () => () => {},
    },
    "@/lib/customerReservationDisplay": { reservationDateOnly: value => String(value || ""), reservationAmount: value => String(value) },
    "@/api/reservationApi": {
      default: {
        detailForCustomer: async (...args) => {
          calls.detail++;
          return {
            data: { success: true, data: routeResource?.data || reservation },
          };
        },
      },
    },
    "@/api/managedReservationApi": { default: {} },
    "@/api/contractApi": {
      default: {
        byReservationReal: async (...args) => {
          calls.byReservation.push(args);
          if (contractResponse instanceof Error) throw contractResponse;
          return (
            contractResponse || {
              data: {
                success: true,
                data: {
                  ...draftContract,
                  reservationId: { _id: reservationId },
                  customerId: { _id: customerId },
                },
              },
            }
          );
        },
        mineReal: async () => ({ data: { success: true, data: [] } }),
        detailReal: async () => undefined,
      },
    },
    "@/api/facilityApi": { default: { publicDetail: async () => undefined } },
    "@/api/storageApi": { default: { unitDetail: async () => undefined } },
    "@/api/customerRentalApi": { accessApi: {} },
    "@/components/ui/input": { Input: box },
    "@/components/ui/dialog": { Dialog: ({ children }) => children },
    "@/lib/authSession": {
      useAuthSession: () => ({
        accessToken: "token",
        user: { id: customerId },
      }),
      getAccessToken: () => "token",
    },
    "./RentalBackendUI": {
      BackendScreen: screen,
      Card: box,
      CardContent: box,
      Button: button,
      Link: box,
      Details: details,
      Message: message,
      RentalSummary: summary,
      ManagedFinancialSummary: box,
      RentalStatus: ({ status }) => element("span", null, status),
      statusLabels: {},
      useBackend: (() => {
        let index = 0;
        return () =>
          index++ === 0
            ? routeResource || {
                data: reservation,
                loading: false,
                error: "",
                retry: () => {},
              }
            : { data: [], loading: false, error: "", retry: () => {} };
      })(),
      rows: (response) => response?.data?.data,
      record,
      recordId,
      validId,
      rentalError: (error) => error.message,
      ConfirmAction: box,
    },
  };
  return {
    component: compile(
      "../src/components/customer/RentalLifecycleIntegration.jsx",
      mocks,
    ).PaymentIntegration,
    calls,
    get checkoutProps() {
      return checkoutProps;
    },
  };
}

function checkoutModule({
  contract = draftContract,
  contractLoading = false,
  contractError = "",
  overview = {
    facility: { name: "Test Facility" },
    unit: { unitCode: "A-01", size: "SMALL", volumeM3: 2 },
  },
  historyError = false,
  historyPayments = [],
  paymentApi = {},
  reservation: checkoutReservation = reservation,
  loadContract = async () => contract,
  showQr = false,
  safeCheckout = false,
  qrDataUrl = null,
  onNavigate = () => {},
  routerState = null,
} = {}) {
  const slots = [],
    pendingEffects = [];
  let cursor = 0;
  let contractLoader = null;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          slots[index] =
            typeof value === "function" ? value(slots[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(callback) {
      cursor++;
      pendingEffects.push(callback);
    },
  };
  let resourceIndex = 0;
  const useBackend = (loader) => {
    const index = resourceIndex++;
    if (index === 0) contractLoader = loader;
    return index === 0
      ? {
          data: contract,
          loading: contractLoading,
          error: contractError,
          retry: () => {},
        }
      : { data: overview, loading: false, error: "", retry: () => {} };
  };
  const mocks = {
    react: hooks,
    "react-router-dom": {
      Link: box,
      useNavigate: () => onNavigate,
      useLocation: () => ({ state: routerState }),
    },
    "@/components/common/CustomerScreen": { CustomerScreen: screen },
    "@/components/ui/card": { Card: box, CardContent: box },
    "@/components/ui/button": { Button: button },
    "@/components/ui/badge": { Badge: box },
    "@/components/ui/dialog": { Dialog: ({ children }) => children },
    "@/api/paymentApi": {
      default: {
        listPayosPaymentsForReservation:
          paymentApi.listPayosPaymentsForReservation ||
          (async () => {
            if (historyError) throw Error("fixture history failure");
            return { items: historyPayments, nextCursor: null };
          }),
        getPayosPaymentStatus:
          paymentApi.getPayosPaymentStatus ||
          (async () => {
            throw Error("unexpected status call");
          }),
        createPayosCheckout:
          paymentApi.createPayosCheckout ||
          (async () => {
            throw Error("unexpected checkout POST");
          }),
      },
    },
    "@/lib/authSession": {
      useAuthSession: () => ({
        accessToken: "token",
        user: { id: customerId },
      }),
      getAccessToken: () => "token",
    },
    "@/lib/booking": { formatMoney: (value) => String(value) },
    "@/lib/selfStoragePayos": { ...require("../src/lib/selfStoragePayos.js") },
    "@/lib/customerReservationDisplay": { reservationDateOnly: value => String(value || ""), reservationAmount: value => String(value) },
    "@/api/payosPaymentClient": {
      canOpenPayosCheckout: (payment) =>
        safeCheckout &&
        require("../src/api/payosPaymentClient.js").canOpenPayosCheckout(
          payment,
        ),
      canShowPayosQr: (payment) =>
        showQr &&
        require("../src/api/payosPaymentClient.js").canShowPayosQr(payment),
    },
    "@/lib/selfStoragePayosQr": { createPayosQrDataUrl: async () => qrDataUrl },
    "@/lib/selfStoragePayosPolling": {
      isPayosPaymentPollable: () => false,
      pollPayosPaymentStatuses: async () => {},
    },
    "./RentalBackendUI": {
      Details: details,
      LoadState: ({ resource }) =>
        resource.loading
          ? element("p", { role: "status" }, "Loading contract…")
          : resource.error
            ? element(
                "div",
                null,
                message({ error: resource.error }),
                button({ children: "Retry", onClick: resource.retry }),
              )
            : null,
      Message: message,
      RentalSummary: summary,
      RentalStatus: ({ status }) => element("span", null, status),
      useBackend,
      recordId,
      Card: box,
      CardContent: box,
      Button: button,
      Link: box,
    },
  };
  const component = compile(
    "../src/components/customer/SelfStoragePayosCheckout.jsx",
    mocks,
  ).default;
  function render() {
    cursor = 0;
    resourceIndex = 0;
    pendingEffects.length = 0;
    const tree = component({
      reservationId,
      initialReservation: checkoutReservation,
      loadContext: async () => ({
        reservation: checkoutReservation,
        contract,
        rentalOverview: overview,
      }),
      loadContract,
      loadOverview: async () => overview,
    });
    return tree;
  }
  async function flushEffects() {
    const effects = [...pendingEffects];
    pendingEffects.length = 0;
    for (const effect of effects) effect();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }
  return {
    render,
    flushEffects,
    get contractLoader() {
      return contractLoader;
    },
  };
}

test("Payment route renders a real loading state instead of Simulated Payment before Reservation data arrives", () => {
  const { component } = lifecycleModule({
    routeResource: { data: null, loading: true, error: "", retry: () => {} },
  });
  const html = renderToStaticMarkup(component());
  assert.match(html, /Loading payment details/);
  assert.match(html, /Loading backend data/);
  assert.doesNotMatch(html, /Simulated Payment/);
});

test("Review submits one Reservation and hands off a saved booking without calling PayOS", async (t) => {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const payload = {
    facilityId,
    storageUnitId: unitId,
    startDate: "2026-12-01",
    endDate: "2027-01-01",
    pricingPolicyId: "507f1f77bcf86cd799439099",
  };
  const facility = { _id: facilityId, name: "Test Facility" };
  const unit = { _id: unitId, facilityId, unitCode: "A-01", size: "SMALL" };
  const reviewData = {
    facility,
    unit,
    profile: { verificationStatus: "VERIFIED" },
    price: { currency: "VND" },
    terms: { documentCode: "VS-POLICY-002", version: "2.0", versionId: "VS-POLICY-002@2.0" },
    payload,
    estimate: {
      estimatedRent: 3000000,
      depositAmount: 1000000,
      taxAmount: 0,
      durationDays: 31,
    },
  };
  const states = [],
    effects = [];
  let cursor = 0,
    destination = null,
    clearedDraft = null,
    createCalls = 0,
    bookingKey = null,
    createdStatus = null;
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in states)) states[i] = initial;
      return [
        states[i],
        (value) => {
          states[i] = typeof value === "function" ? value(states[i]) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in states)) states[i] = { current: initial };
      return states[i];
    },
    useEffect() {
      cursor++;
    },
  };
  const response = (data) => ({ data: { success: true, data } });
  const mocks = {
    react: hooks,
    "react-router-dom": {
      useNavigate:
        () =>
        (...args) => {
          destination = args;
        },
      useLocation: () => ({ state: null }),
    },
    "./selfStorageSuggestions": selfStorageSuggestions,
    "@/contexts/ReservationContext": {
      useReservation: () => ({
        rentalDraft: {
          facility,
          unit,
          startDate: payload.startDate,
          endDate: payload.endDate,
          term: { value: 1, unit: "MONTH" },
        },
        updateRentalDraft: (value) => {
          clearedDraft = value;
        },
      }),
    },
    "@/lib/authSession": {
      useAuthSession: () => ({
        accessToken: "token",
        user: { id: customerId },
      }),
      getAccessToken: () => "token",
    },
    "@/lib/selfStoragePayos": { ...require("../src/lib/selfStoragePayos.js") },
    "@/lib/selfStorageReservation": {
      selfStorageRequest: () => payload,
      selfStorageEstimate: (value) => value.data.data,
      selfStorageCreation: (value) => {
        createdStatus = value.data.data.status;
        return value.data.data;
      },
      sameEstimate: () => true,
      readOrCreateSelfStorageBookingAttempt,
      writeSelfStorageBookingAttempt,
    },
    "@/lib/customerReservationDisplay": { reservationDateOnly: value => String(value || ""), reservationAmount: value => String(value) },
    "@/api/reservationApi": {
      default: {
        estimateReal: async () => response(reviewData.estimate),
        createReal: async (request, config) => {
          createCalls++;
          bookingKey = config?.headers?.["Idempotency-Key"];
          assert.equal(request.facilityId, facilityId);
          assert.equal(request.termsAccepted, true);
          assert.equal(request.termsVersionId, reviewData.terms.versionId);
          return { ...response({
            _id: reservationId,
            status: "CONTRACTED",
            serviceType: "SELF_STORAGE",
            customerId,
            reservationCode: "BKG-TEST-01",
          }), status: 201 };
        },
      },
    },
    "@/api/facilityApi": {
      default: { publicDetail: async () => response(facility) },
    },
    "@/api/storageApi": { default: { unitDetail: async () => response(unit) } },
    "@/api/customerRentalApi": {
      pricingApi: { resolve: async () => response(reviewData.price) },
      customerProfileApi: { get: async () => response(reviewData.profile) },
    },
    "@/api/termsApi": { termsApi: { current: async () => response(reviewData.terms) } },
    "@/components/ui/checkbox": {
      Checkbox: (props) => element("input", { type: "checkbox", ...props }),
    },
    "@/components/customer/terms/TermsModal": {
      default: ({ open, onClose }) => open ? element("div", { "data-testid": "terms-modal" }, element("button", { onClick: onClose }, "Đóng Terms")) : null,
    },
    "@/components/common/Steps": { default: () => null },
    "./RentalBackendUI": {
      BackendScreen: screen,
      Card: box,
      CardContent: box,
      Button: button,
      Details: details,
      Message: message,
      Link: box,
      useBackend: () => ({
        data: reviewData,
        loading: false,
        error: "",
        retry: () => {},
      }),
      LoadState: () => null,
      record,
      recordId,
      addressText: () => "Test address",
      rentalError: (error) => error.message,
    },
  };
  const component = compile(
    "../src/components/customer/SelfStorageReservationReview.jsx",
    mocks,
  ).default;
  const draft = component();
  const Review = draft.type;
  function render() {
    cursor = 0;
    effects.length = 0;
    return Review(draft.props);
  }
  function find(node, predicate) {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    if (typeof node.type === "function") {
      const found = find(node.type(node.props), predicate);
      if (found) return found;
    }
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  let tree = render();
  const checkbox = find(
    tree,
    (node) =>
      node.type === "input" &&
      node.props["aria-label"] === "Xác nhận thông tin đặt thuê chính xác",
  );
  assert(checkbox);
  checkbox.props.onCheckedChange(true);
  tree = render();
  const uncheckedTerms = find(tree, node => node.type === "input" && node.props["aria-label"] === `Chấp nhận điều khoản phiên bản ${reviewData.terms.version}`);
  assert(uncheckedTerms);
  assert.equal(uncheckedTerms.props.checked, false);
  const blockedCreate = find(tree, node => node.type === "button" && node.props.children === "Xác nhận đặt thuê");
  assert(blockedCreate?.props.disabled, "unchecked Terms must disable reservation submit");
  await blockedCreate.props.onClick();
  assert.equal(createCalls, 0, "direct handler invocation must also reject unchecked Terms");
  const viewTerms = find(tree, node => node.type === "button" && node.props.children === "Xem điều khoản & chính sách");
  assert(viewTerms);
  viewTerms.props.onClick();
  tree = render();
  assert(find(tree, node => node.props?.["data-testid"] === "terms-modal"));
  const termsCheckbox = find(tree, node => node.type === "input" && node.props["aria-label"] === `Chấp nhận điều khoản phiên bản ${reviewData.terms.version}`);
  assert(termsCheckbox);
  assert.equal(termsCheckbox.props.checked, false, "viewing Terms must not accept them");
  const closeTerms = find(tree, node => node.type === "button" && node.props.children === "Đóng Terms");
  assert(closeTerms);
  closeTerms.props.onClick();
  tree = render();
  const afterCloseTerms = find(tree, node => node.type === "input" && node.props["aria-label"] === `Chấp nhận điều khoản phiên bản ${reviewData.terms.version}`);
  assert.equal(afterCloseTerms.props.checked, false, "closing Terms must not accept them");
  const stillConfirmed = find(tree, node => node.type === "input" && node.props["aria-label"] === "Xác nhận thông tin đặt thuê chính xác");
  assert.equal(stillConfirmed.props.checked, true, "opening Terms must preserve the booking review state");
  termsCheckbox.props.onCheckedChange(true);
  tree = render();
  const create = find(
    tree,
    (node) =>
      node.type === "button" &&
      node.props.children === "Xác nhận đặt thuê",
  );
  assert(create && !create.props.disabled);
  await Promise.all([create.props.onClick(), create.props.onClick()]);
  assert.equal(createCalls, 1);
  assert.match(bookingKey, /^wdp-booking-/);
  const saved = readOrCreateSelfStorageBookingAttempt(window.sessionStorage, customerId, payload);
  assert.equal(saved.reservationId, reservationId);
  assert.equal(saved.idempotencyKey, bookingKey);
  assert.equal(createdStatus, "CONTRACTED");
  assert.deepEqual(destination, ["/portal/payments/" + reservationId, {
    state: { selfStorageCreated: true, startFullRentAfterBooking: true },
  }]);
  assert.equal(clearedDraft.facility, null);
  assert.equal(reservationId.length, 24);
});

test("Reservation retrieval failure and missing records fail closed with retry, never the mock-payment screen", () => {
  for (const routeResource of [
    { data: null, loading: false, error: "not found", retry: () => {} },
    { data: null, loading: false, error: "", retry: () => {} },
  ]) {
    const { component } = lifecycleModule({ routeResource });
    const html = renderToStaticMarkup(component());
    assert.match(html, /Payment unavailable/);
    assert.match(html, /Không tải được thông tin đơn thuê/);
    assert.match(html, /Retry reservation/);
    assert.doesNotMatch(html, /Simulated Payment/);
  }
});

test("Owned Self-Storage Reservation routes to PayOS and loads its exact owner-scoped contract endpoint", async () => {
  const module = lifecycleModule();
  const html = renderToStaticMarkup(module.component());
  assert.match(html, /payos-checkout/);
  assert.doesNotMatch(html, /Simulated Payment/);
  assert.equal(
    module.calls.detail,
    0,
    "the already verified parent Reservation is passed through; no duplicate reservation request is made",
  );
  const loaded = await module.checkoutProps.loadContract(
    reservationId,
    customerId,
    { signal: "fixture" },
  );
  assert.equal(loaded._id, contractId);
  assert.deepEqual(module.calls.byReservation, [
    [reservationId, { signal: "fixture" }],
  ]);

  const mismatched = lifecycleModule({
    contractResponse: {
      data: {
        success: true,
        data: {
          ...draftContract,
          reservationId: { _id: facilityId },
          customerId: { _id: customerId },
        },
      },
    },
  });
  renderToStaticMarkup(mismatched.component());
  await assert.rejects(
    mismatched.checkoutProps.loadContract(reservationId, customerId),
    /does not match this Reservation/,
  );

  const objectId = (hex) => ({ _bsontype: "ObjectId", toHexString: () => hex });
  const populated = lifecycleModule({
    routeResource: {
      data: {
        ...reservation,
        _id: objectId(reservationId),
        customerId: objectId(customerId),
      },
      loading: false,
      error: "",
      retry: () => {},
    },
    contractResponse: {
      data: {
        success: true,
        data: {
          ...draftContract,
          _id: objectId(contractId),
          reservationId: { _id: objectId(reservationId) },
          customerId: { _id: objectId(customerId) },
        },
      },
    },
  });
  renderToStaticMarkup(populated.component());
  const loadedPopulated = await populated.checkoutProps.loadContract(
    reservationId,
    customerId,
  );
  assert.equal(
    payosContractMatchesIdentity(loadedPopulated, reservationId, customerId),
    true,
  );
  assert.equal(
    normalizePayosReferenceId(loadedPopulated.reservationId),
    reservationId,
  );

  const apiFailure = lifecycleModule({
    contractResponse: Error("network error"),
  });
  renderToStaticMarkup(apiFailure.component());
  await assert.rejects(
    apiFailure.checkoutProps.loadContract(reservationId, customerId),
    /contract could not be loaded/,
  );
});

test("New full-rent Self-Storage booking still requires its existing DRAFT Contract", async () => {
  const fullRentReservation = { ...reservation, rentalPaymentFlow: "FULL_UPFRONT_V1" };
  const missingContract = checkoutModule({ reservation: fullRentReservation, contract: null });
  const html = renderToStaticMarkup(missingContract.render());
  const missingVisibleText = html.replace(/<[^>]*>/g, "");
  assert.doesNotMatch(
    missingVisibleText,
    /BKG-TEST-01|507f1f77bcf86cd799439011|Reservation ID|Contract status|Payment status/,
  );
  assert.match(html, /Chưa tìm thấy hợp đồng gắn với đơn thuê/);
  assert.doesNotMatch(html, /Tạo mã QR thanh toán/);

  const failedContract = checkoutModule({
    reservation: fullRentReservation,
    contract: null,
    contractError:
      "The reservation is saved, but its contract could not be loaded. Retry here; you do not need to book again.",
  });
  const failedHtml = renderToStaticMarkup(failedContract.render());
  assert.doesNotMatch(
    failedHtml.replace(/<[^>]*>/g, ""),
    /BKG-TEST-01|Reservation ID|Payment status/,
  );

  const overviewFailure = checkoutModule({
    reservation: fullRentReservation,
    overview: {
      error:
        "Facility or StorageUnit details could not be loaded. The verified reservation and payment status remain available.",
    },
  });
  const overviewHtml = renderToStaticMarkup(overviewFailure.render());
  assert.doesNotMatch(
    overviewHtml.replace(/<[^>]*>/g, ""),
    /BKG-TEST-01|3000000 VND|Facility or StorageUnit/,
  );
  assert.match(overviewHtml, /Thanh toán 100% tiền thuê/);

  assert.equal(eligiblePayosPurpose(fullRentReservation, draftContract), "FULL_RENT");
});

test("Existing READY Deposit offers its Hosted Checkout on load without another checkout request", async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    sessionStorage: { getItem: () => null, setItem: () => {} },
    location: { search: "" },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const readyPayment = {
    id: "507f1f77bcf86cd799439016",
    reservationId,
    purpose: "DEPOSIT",
    amount: 1500000,
    currency: "VND",
    provider: "PAYOS",
    status: "PENDING",
    applicationStatus: "NOT_APPLIED",
    providerSettlementStatus: "NOT_VERIFIED",
    checkoutStatus: "READY",
    checkoutUrl: "https://pay.payos.vn/web/example",
    qrCode:
      "00020101021229370016A0000006770101110113006688123456785204581253037045802VN6304ABCD",
    reconciliationRequired: false,
    createdAt: new Date().toISOString(),
  };
  let checkoutPosts = 0;
  const module = checkoutModule({
    historyPayments: [readyPayment],
    showQr: true,
    safeCheckout: true,
    qrDataUrl: "data:image/png;base64,fixture",
    paymentApi: {
      createPayosCheckout: async () => {
        checkoutPosts++;
        throw Error("should not create on mount");
      },
    },
  });
  module.render();
  await module.flushEffects();
  renderToStaticMarkup(module.render());
  await module.flushEffects();
  const html = renderToStaticMarkup(module.render());
  const visibleText = html.replace(/<[^>]*>/g, "");
  assert.doesNotMatch(
    html,
    /aria-label="Mã QR PayOS"|data:image\/png;base64,fixture/,
  );
  assert.match(visibleText, /1\.500\.000 ₫/);
  assert.match(visibleText, /Tiếp tục thanh toán qua PayOS/);
  assert.doesNotMatch(
    visibleText,
    /507f1f77bcf86cd799439011|507f1f77bcf86cd799439016|Reservation status|Contract status|Provider settlement|Reservation application/,
  );
  assert.equal(checkoutPosts, 0);
});

test("UNKNOWN checkout never renders a payable QR or offers a replacement attempt", async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    sessionStorage: { getItem: () => null, setItem: () => {} },
    location: { search: "" },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const unknown = {
    id: "507f1f77bcf86cd799439016",
    reservationId,
    purpose: "DEPOSIT",
    amount: 1500000,
    currency: "VND",
    provider: "PAYOS",
    status: "PENDING",
    applicationStatus: "NOT_APPLIED",
    providerSettlementStatus: "NOT_VERIFIED",
    checkoutStatus: "UNKNOWN",
    checkoutUrl: null,
    qrCode:
      "00020101021229370016A0000006770101110113006688123456785204581253037045802VN6304ABCD",
    reconciliationRequired: false,
    createdAt: new Date().toISOString(),
  };
  let checkoutPosts = 0;
  const module = checkoutModule({
    historyPayments: [unknown],
    showQr: true,
    qrDataUrl: "data:image/png;base64,fixture",
    paymentApi: {
      createPayosCheckout: async () => {
        checkoutPosts++;
      },
    },
  });
  module.render();
  await module.flushEffects();
  const html = renderToStaticMarkup(module.render());
  assert.doesNotMatch(html, /aria-label="Mã QR PayOS"|data:image\/png/);
  assert.match(html, /Chưa thể xác nhận liên kết thanh toán/);
  assert.doesNotMatch(html, /Tạo mã QR thanh toán/);
  assert.equal(checkoutPosts, 0);
});

test("uncertain checkout recovery shows read-only history refresh and suppresses a replacement action", async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    sessionStorage: { getItem: () => null, setItem: () => {} },
    location: { search: "" },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  let createCalls = 0;
  let refreshCalls = 0;
  const module = checkoutModule({
    routerState: { selfStorageCreated: true, checkoutRecoveryNeeded: true },
    paymentApi: {
      listPayosPaymentsForReservation: async () => ({
        items: [],
        nextCursor: null,
      }),
      createPayosCheckout: async () => {
        createCalls++;
        throw Error("must remain read-only");
      },
    },
  });
  module.render();
  await module.flushEffects();
  const html = renderToStaticMarkup(module.render());
  assert.match(html, /Chưa xác định được kết quả tạo mã thanh toán/);
  assert.match(html, /Làm mới lịch sử thanh toán/);
  assert.doesNotMatch(html, /Tạo mã QR thanh toán/);
  assert.equal(createCalls, 0);
  assert.equal(refreshCalls, 0);
});

test("refresh recovers an unlinked idempotency attempt and keeps checkout creation blocked", async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const key = `SelfStorage_payos_${customerId}_${reservationId}_DEPOSIT`;
  const values = new Map([
    [
      key,
      JSON.stringify([
        { idempotencyKey: "persisted-original-key", paymentId: null },
      ]),
    ],
  ]);
  globalThis.window = {
    sessionStorage: {
      getItem: (storageKey) => values.get(storageKey) ?? null,
      setItem: (storageKey, value) => values.set(storageKey, value),
    },
    location: { search: "" },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  let createCalls = 0;
  const module = checkoutModule({
    paymentApi: {
      listPayosPaymentsForReservation: async () => ({
        items: [],
        nextCursor: null,
      }),
      createPayosCheckout: async () => {
        createCalls++;
        throw Error("must not create after recovery-only refresh");
      },
    },
  });
  module.render();
  await module.flushEffects();
  const html = renderToStaticMarkup(module.render());
  assert.match(html, /Chưa xác định được kết quả tạo mã thanh toán/);
  assert.match(html, /Làm mới lịch sử thanh toán/);
  assert.doesNotMatch(html, /Tạo mã QR thanh toán/);
  assert.equal(createCalls, 0);
});

test("refresh with a tracked Payment ID but temporarily empty history stays read-only", async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const key = `SelfStorage_payos_${customerId}_${reservationId}_DEPOSIT`;
  const paymentId = "507f1f77bcf86cd799439097";
  const values = new Map([
    [
      key,
      JSON.stringify([{ idempotencyKey: "persisted-original-key", paymentId }]),
    ],
  ]);
  globalThis.window = {
    sessionStorage: {
      getItem: (storageKey) => values.get(storageKey) ?? null,
      setItem: (storageKey, value) => values.set(storageKey, value),
    },
    location: { search: "" },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  let createCalls = 0;
  const module = checkoutModule({
    paymentApi: {
      listPayosPaymentsForReservation: async () => ({
        items: [],
        nextCursor: null,
      }),
      getPayosPaymentStatus: async () => {
        throw Error("status temporarily unavailable");
      },
      createPayosCheckout: async () => {
        createCalls++;
        throw Error("must not create while original ID is unresolved");
      },
    },
  });
  module.render();
  await module.flushEffects();
  const html = renderToStaticMarkup(module.render());
  assert.match(html, /Chưa xác định được kết quả tạo mã thanh toán/);
  assert.doesNotMatch(html, /Tạo mã QR thanh toán/);
  assert.equal(createCalls, 0);
});

test("confirmed terminal failure exposes only the explicit safe retry action", async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const customer = customerId;
  const storageKey = `SelfStorage_payos_${customer}_${reservationId}_FULL_RENT`;
  const paymentId = "507f1f77bcf86cd799439098";
  const values = new Map([
    [
      storageKey,
      JSON.stringify([{ idempotencyKey: "original-key", paymentId }]),
    ],
  ]);
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    location: { search: "" },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const failed = {
    id: paymentId,
    reservationId,
    purpose: "FULL_RENT",
    amount: 3000000,
    currency: "VND",
    provider: "PAYOS",
    status: "FAILED",
    applicationStatus: "NOT_APPLIED",
    providerSettlementStatus: "NOT_VERIFIED",
    checkoutStatus: "FAILED",
    reconciliationRequired: false,
    retryAllowed: true,
    createdAt: new Date().toISOString(),
  };
  const module = checkoutModule({
    reservation: { ...reservation, rentalPaymentFlow: "FULL_UPFRONT_V1" },
    paymentApi: {
      listPayosPaymentsForReservation: async () => ({
        items: [failed],
        nextCursor: null,
      }),
      getPayosPaymentStatus: async () => failed,
    },
  });
  module.render();
  await module.flushEffects();
  const html = renderToStaticMarkup(module.render());
  assert.match(html, /Tạo lần thanh toán mới/);
  assert.doesNotMatch(html, /Mã QR PayOS/);
});

test("Checkout readiness scans older Backend history pages before allowing a new attempt", async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    sessionStorage: { getItem: () => null, setItem: () => {} },
    location: { search: "" },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const oldFailed = Array.from({ length: 25 }, (_, index) => ({
    id: (index + 1).toString(16).padStart(24, "0"),
    reservationId,
    purpose: "DEPOSIT",
    amount: 100000,
    currency: "VND",
    provider: "PAYOS",
    status: "FAILED",
    applicationStatus: "NOT_APPLIED",
    providerSettlementStatus: "NOT_VERIFIED",
    checkoutStatus: "FAILED",
    reconciliationRequired: false,
    createdAt: new Date(Date.now() - (index + 1) * 1000).toISOString(),
  }));
  const oldUnresolved = {
    id: "507f1f77bcf86cd799439099",
    reservationId,
    purpose: "DEPOSIT",
    amount: 1500000,
    currency: "VND",
    provider: "PAYOS",
    status: "PENDING",
    applicationStatus: "NOT_APPLIED",
    providerSettlementStatus: "NOT_VERIFIED",
    checkoutStatus: "UNKNOWN",
    checkoutUrl: null,
    qrCode: null,
    reconciliationRequired: false,
    createdAt: new Date().toISOString(),
  };
  const listCalls = [];
  let checkoutPosts = 0;
  const module = checkoutModule({
    paymentApi: {
      listPayosPaymentsForReservation: async (_id, options) => {
        listCalls.push(options);
        return options?.cursor
          ? { items: [oldUnresolved], nextCursor: null }
          : { items: oldFailed, nextCursor: "older-page" };
      },
      createPayosCheckout: async () => {
        checkoutPosts++;
        throw Error("must remain blocked");
      },
    },
  });
  module.render();
  await module.flushEffects();
  const html = renderToStaticMarkup(module.render());
  assert.equal(listCalls.length, 2);
  assert.deepEqual(listCalls[0], { limit: 25, serviceType: "SELF_STORAGE" });
  assert.deepEqual(listCalls[1], { limit: 25, cursor: "older-page", serviceType: "SELF_STORAGE" });
  assert.match(html, /Chưa thể xác nhận liên kết thanh toán/);
  assert.doesNotMatch(html, /Tạo mã QR thanh toán/);
  assert.equal(checkoutPosts, 0);
});

test("Self-Storage PayOS executes the Contract loader with populated Customer id and exposes the valid Deposit action", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const objectId = (hex) => ({ _bsontype: "ObjectId", toHexString: () => hex });
  let contractLoadArgs;
  const module = checkoutModule({
    reservation: { ...reservation, customerId: objectId(customerId) },
    loadContract: async (...args) => {
      contractLoadArgs = args;
      return draftContract;
    },
  });
  globalThis.window = {
    sessionStorage: { getItem: () => null, setItem: () => {} },
    location: { search: "" },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  try {
    renderToStaticMarkup(module.render());
    assert.equal(typeof module.contractLoader, "function");
    await module.contractLoader({ signal: "contract-fixture" });
    assert.deepEqual(contractLoadArgs, [
      reservationId,
      customerId,
      { signal: "contract-fixture" },
    ]);
    await module.flushEffects();
    const html = renderToStaticMarkup(module.render());
    assert.match(html, /Tiếp tục thanh toán qua PayOS/);
    assert.doesNotMatch(
      html.replace(/<[^>]*>/g, ""),
      /507f1f77bcf86cd799439011|BKG-TEST-01|Payment status|Contract status/,
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("PayOS history failure keeps the Reservation visible and disables new checkout; empty history is valid", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    sessionStorage: { getItem: () => null, setItem: () => {} },
    location: { search: "" },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  try {
    const failed = checkoutModule({ historyError: true });
    let tree = failed.render();
    await failed.flushEffects();
    tree = failed.render();
    const failedHtml = renderToStaticMarkup(tree);
    assert.doesNotMatch(
      failedHtml.replace(/<[^>]*>/g, ""),
      /BKG-TEST-01|Payment status|507f1f77bcf86cd799439011/,
    );
    assert.match(failedHtml, /Không thể xác minh lịch sử thanh toán/);
    const find = (node) => {
      if (!node || typeof node !== "object") return null;
      if (
        node.type === "button" &&
        node.props.children === "Tiếp tục thanh toán qua PayOS"
      )
        return node;
      if (node.props?.children)
        for (const child of React.Children.toArray(node.props.children)) {
          const result = find(child);
          if (result) return result;
        }
      if (typeof node.type === "function") return find(node.type(node.props));
      return null;
    };
    const paymentButton = find(tree);
    assert(paymentButton);
    assert.equal(paymentButton.props.disabled, true);

    const empty = checkoutModule();
    empty.render();
    await empty.flushEffects();
    const emptyHtml = renderToStaticMarkup(empty.render());
    assert.match(emptyHtml, /Chưa có liên kết thanh toán/);
    assert.doesNotMatch(emptyHtml, /Payment history could not be verified/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("unknown checkout outcome refreshes read-only history, displays the original Payment and blocks another POST", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const values = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    location: { search: "" },
    setInterval: () => 1,
    clearInterval: () => {},
  };
  globalThis.document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  try {
    const paymentId = "507f1f77bcf86cd799439099";
    const unknownPayment = {
      id: paymentId,
      reservationId,
      purpose: "DEPOSIT",
      amount: 100000,
      currency: "VND",
      provider: "PAYOS",
      status: "PENDING",
      applicationStatus: "NOT_APPLIED",
      providerSettlementStatus: "NOT_VERIFIED",
      checkoutStatus: "UNKNOWN",
      reconciliationRequired: false,
      checkoutUrl: null,
      qrCode: null,
      createdAt: new Date().toISOString(),
    };
    let historyCalls = 0;
    let createCalls = 0;
    let statusCalls = 0;
    const module = checkoutModule({
      paymentApi: {
        listPayosPaymentsForReservation: async () => ({
          items: ++historyCalls === 1 ? [] : [unknownPayment],
          nextCursor: null,
        }),
        createPayosCheckout: async () => {
          createCalls += 1;
          const error = Error("uncertain provider outcome");
          error.response = {
            status: 503,
            data: { code: "PAYOS_CHECKOUT_OUTCOME_UNKNOWN" },
          };
          throw error;
        },
        getPayosPaymentStatus: async (_reservationId, requestedPaymentId) => {
          statusCalls += 1;
          assert.equal(requestedPaymentId, paymentId);
          return unknownPayment;
        },
      },
    });
    module.render();
    await module.flushEffects();
    let tree = module.render();
    const findButton = (node, label) => {
      if (!node || typeof node !== "object") return null;
      if (node.type === "button" && node.props.children === label) return node;
      if (typeof node.type === "function") {
        const found = findButton(node.type(node.props), label);
        if (found) return found;
      }
      for (const child of React.Children.toArray(node.props?.children)) {
        const found = findButton(child, label);
        if (found) return found;
      }
      return null;
    };
    const depositButton = findButton(tree, "Tiếp tục thanh toán qua PayOS");
    assert(depositButton && !depositButton.props.disabled);
    await depositButton.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    tree = module.render();
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Chưa thể xác nhận liên kết thanh toán/);
    assert.match(html, /Làm mới trạng thái/);
    assert.match(html, /Xem lịch sử thanh toán/);
    const blockedDepositButton = findButton(
      tree,
      "Tiếp tục thanh toán qua PayOS",
    );
    assert.equal(
      blockedDepositButton,
      null,
      "unresolved Payment suppresses a new checkout action",
    );
    assert.equal(
      historyCalls,
      2,
      "history is refreshed once after the uncertain create response",
    );
    assert.equal(createCalls, 1, "refresh and status recovery are read-only");
    const refreshStatus = findButton(tree, "Làm mới trạng thái");
    assert(refreshStatus);
    await refreshStatus.props.onClick();
    assert.equal(statusCalls, 1);
    assert.equal(createCalls, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("Mismatched contract blocks payment; legacy Managed Inventory payment is read-only", () => {
  const mismatched = checkoutModule({
    contract: { ...draftContract, reservationId: facilityId },
  });
  const mismatchedHtml = renderToStaticMarkup(mismatched.render());
  assert.doesNotMatch(
    mismatchedHtml.replace(/<[^>]*>/g, ""),
    /BKG-TEST-01|507f1f77bcf86cd799439011|Tạo mã QR thanh toán/,
  );

  const managed = {
    ...reservation,
    serviceType: "MANAGED_INVENTORY",
    bookingFlowVersion: 2,
  };
  const { component } = lifecycleModule({
    routeResource: {
      data: managed,
      loading: false,
      error: "",
      retry: () => {},
    },
  });
  const managedHtml = renderToStaticMarkup(component());
  assert.match(managedHtml, /Thanh toán Managed lịch sử/);
  assert.match(managedHtml, /Chỉ Reservation Managed V3 mới dùng PayOS Hosted Checkout/);
  assert.doesNotMatch(managedHtml, /payos-checkout/);
  assert.doesNotMatch(managedHtml, /Simulated Payment/);
});
