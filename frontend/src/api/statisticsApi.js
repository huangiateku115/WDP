import axiosClient from "./axiosClient";

// Statistics read model for the ADMIN / BOM / FACILITY_MANAGER consoles
// (backend/src/routes/statistics.routes.ts). BOM and ADMIN read every facility; a Facility
// Manager is narrowed to its own facility by the backend scope resolver, so the console never
// sends a facility filter to widen the scope.
const clean = (query = {}) => Object.fromEntries(
  Object.entries(query).filter(([, value]) => value !== "" && value !== undefined && value !== null),
);

export const statisticsApi = {
  revenue: (query, config) => axiosClient.get("/statistics/revenue", { ...config, params: clean(query) }),
  utilization: (query, config) => axiosClient.get("/statistics/utilization", { ...config, params: clean(query) }),
  facilitiesRanking: (query, config) => axiosClient.get("/statistics/facilities-ranking", { ...config, params: clean(query) }),
  rentalTrends: (query, config) => axiosClient.get("/statistics/rental-trends", { ...config, params: clean(query) }),
  reservations: (query, config) => axiosClient.get("/statistics/reservations", { ...config, params: clean(query) }),
  filters: (query, config) => axiosClient.get("/statistics/filters", { ...config, params: clean(query) }),
  // csv | xlsx | pdf — returns a file blob, so the caller saves it with `downloadBlob`.
  exportFile: (format, query, config) =>
    axiosClient.get(`/statistics/export/${format}`, { ...config, params: clean(query), responseType: "blob" }),
};

export default statisticsApi;
