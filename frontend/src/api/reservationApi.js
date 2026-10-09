import axiosClient from "./axiosClient";

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
  createReal: ({facilityId,storageUnitId,startDate,endDate,pricingPolicyId,estimatedRent,depositAmount})=>axiosClient.post('/reservations',{facilityId,storageUnitId,startDate,endDate,pricingPolicyId,estimatedRent,depositAmount}),
  mineReal: config=>axiosClient.get('/reservations/me',config),
  detailReal: (id,config)=>axiosClient.get(`/reservations/${encodeURIComponent(id)}`,config),
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
};

export default reservationApi;
