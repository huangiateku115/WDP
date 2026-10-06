import axiosClient from "./axiosClient";
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";

const supportApi = {
  getMine: async () => USE_MOCK ? { data: [] } : axiosClient.get("/support/me"),
  create: async (payload) => USE_MOCK
    ? { data: { id: `SUP-${Date.now()}`, status: "OPEN", ...payload } }
    : axiosClient.post("/support", payload),
};
export default supportApi;
