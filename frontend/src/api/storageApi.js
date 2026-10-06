import axiosClient from "./axiosClient";
import { mockStorageUnits } from "../mocks/storageUnits";

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

const storageApi = {
  getAvailable: async ({ facilityId, serviceType } = {}) => {
    if (USE_MOCK) {
      await delay();
      let data = mockStorageUnits.filter((x) => x.available);
      if (facilityId) data = data.filter((x) => x.facilityId === facilityId);
      if (serviceType) data = data.filter((x) => x.serviceType === serviceType);
      return { data };
    }
    return axiosClient.get("/storage/available", { params: { facilityId, serviceType } });
  },
  getById: async (id) => {
    if (USE_MOCK) {
      await delay();
      return { data: mockStorageUnits.find((x) => x.id === id) };
    }
    return axiosClient.get(`/storage/${id}`);
  },
};

export default storageApi;
