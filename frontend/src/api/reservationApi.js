import managedReservationApi from "./managedReservationApi";
import {
  serviceType,
  MANAGED_INVENTORY,
  SELF_STORAGE,
} from "@/lib/customerReservationService";
import axiosClient from "./axiosClient";
import { selfStorageCreateReservationPayload } from "@/lib/selfStorageReservation";

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const delay = (ms = 450) => new Promise((r) => setTimeout(r, ms));
const INDEX_KEY = "SelfStorage_reservations";

const getIndex = () => JSON.parse(sessionStorage.getItem(INDEX_KEY) || "[]");
const saveOne = (item) => {
  sessionStorage.setItem(`reservation_${item.id}`, JSON.stringify(item));
  const list = getIndex().filter((x) => x.id !== item.id);
  list.unshift(item);
  sessionStorage.setItem(INDEX_KEY, JSON.stringify(list));
};

const reservationApi = {
  createManaged: (payload) =>
    axiosClient.post("/reservations/managed", payload),
  createReal: (payload, config) =>
    axiosClient.post("/reservations", selfStorageCreateReservationPayload(payload), config),
  // Public route (no auth): POST /reservations/estimate {startDate,endDate,pricingPolicyId}
  // -> {estimatedRent,depositAmount,taxAmount,durationDays,basePrice}. Consumed by
  // selfStorageEstimate() in lib/selfStorageReservation.js and by RentalPeriodIntegration.
  // Restored after a shared-file rewrite dropped it (the rental wizard failed with
  // "reservationApi.estimateReal is not a function").
  estimateReal: ({ startDate, endDate, pricingPolicyId } = {}, config) =>
    axiosClient.post(
      "/reservations/estimate",
      { startDate, endDate, pricingPolicyId },
      config,
    ),
  mineReal: (config) => axiosClient.get("/reservations/me", config),
  // Generic Backend detail lacks a Customer ownership check; use the owned collection.
  detailReal: async (id, config) => {
    const response = await axiosClient.get("/reservations/me", config);
    if (response.data?.success !== true || !Array.isArray(response.data.data))
      throw Error("Unsupported reservation response.");
    const item = response.data.data.find((r) => (r._id || r.id) === id);
    if (!item) throw Error("Reservation is unavailable in your account.");
    return { ...response, data: { success: true, data: item } };
  },
  detailForCustomer: async (id, config) => {
    const owned = await reservationApi.detailReal(id, config);
    const item = owned.data.data;
    if (serviceType(item) !== MANAGED_INVENTORY) return owned;
    const detail = await managedReservationApi.detail(id, config);
    if (
      detail.data?.success !== true ||
      detail.data.data?._id !== id ||
      detail.data.data?.serviceType !== MANAGED_INVENTORY
    )
      throw Error("Unsupported Managed reservation response.");
    return {
      ...detail,
      data: {
        success: true,
        data: {
          ...item,
          ...detail.data.data,
          facilityId: item.facilityId || detail.data.data.facilityId,
        },
      },
    };
  },
  cancelForService: (item) => {
    const type = serviceType(item);
    if (type === MANAGED_INVENTORY)
      return managedReservationApi.cancel(item._id || item.id);
    if (type === SELF_STORAGE)
      return reservationApi.cancelReal(item._id || item.id);
    throw Error("Unsupported service. Cancellation is unavailable.");
  },
  cancelReal: (id) =>
    axiosClient.patch(`/reservations/${encodeURIComponent(id)}/cancel`),
  create: async (payload) => {
    if (USE_MOCK) {
      await delay(700);
      const item = {
        id: `RES-${Date.now()}`,
        reservationCode: `VS-${Math.floor(100000 + Math.random() * 900000)}`,
        status: "PENDING_APPROVAL",
        createdAt: new Date().toISOString(),
        ...payload,
      };
      saveOne(item);
      return { data: item };
    }
    return axiosClient.post("/reservations", payload);
  },

  getById: async (id) => {
    if (USE_MOCK) {
      await delay();
      const saved = sessionStorage.getItem(`reservation_${id}`);
      return { data: saved ? JSON.parse(saved) : null };
    }
    return axiosClient.get(`/reservations/${id}`);
  },

  getMine: async () => {
    if (USE_MOCK) {
      await delay();
      return { data: getIndex() };
    }
    return axiosClient.get("/reservations/me");
  },

  approveMock: async (id) => {
    if (!USE_MOCK) throw new Error("Mock only");
    await delay();
    const saved = sessionStorage.getItem(`reservation_${id}`);
    if (!saved) throw new Error("Reservation not found");
    const updated = {
      ...JSON.parse(saved),
      status: "APPROVED",
      approvedAt: new Date().toISOString(),
    };
    saveOne(updated);
    return { data: updated };
  },

  requestCheckout: (id, note) => axiosClient.post(`/reservations/${encodeURIComponent(id)}/checkout-request`, { note }),
  renewQuote: (id, durationMonths) => axiosClient.post(`/reservations/${encodeURIComponent(id)}/renew-quote`, { durationMonths }),
  renewReservation: (id, durationMonths) => axiosClient.post(`/reservations/${encodeURIComponent(id)}/renew`, { durationMonths }),
};

export default reservationApi;
