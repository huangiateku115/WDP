import axiosClient from "./axiosClient";
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const inventoryApi = {
  getMine: async () => {
    if (USE_MOCK) {
      await delay();
      return { data: [] };
    }
    return axiosClient.get("/inventory/me");
  },
};
export default inventoryApi;
