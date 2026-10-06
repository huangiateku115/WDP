import axiosClient from "./axiosClient";
import { mockFacilities } from "../mocks/facilities";

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

const facilityApi = {
  getAll: async () => {
    if (USE_MOCK) {
      await delay();
      return { data: mockFacilities };
    }
    return axiosClient.get("/facilities");
  },
  getById: async (id) => {
    if (USE_MOCK) {
      await delay();
      return { data: mockFacilities.find((x) => x.id === id) };
    }
    return axiosClient.get(`/facilities/${id}`);
  },
};

export default facilityApi;
