import axios from "axios";
import { apiBaseURL, assertConfirmedRequest } from "./confirmedContract";
import { getAccessToken, clearAuthSession } from "@/lib/authSession";

const axiosClient = axios.create({
  baseURL: apiBaseURL(
    import.meta.env.VITE_API_BASE_URL || "https://wdp-m4ns.onrender.com/api/v1",
  ),
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

axiosClient.interceptors.request.use((config) => {
  assertConfirmedRequest(config);
  const token = getAccessToken();
  if (token && !config.skipAuth)
    config.headers.Authorization = `Bearer ${token}`;
  return config;
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const token = getAccessToken();
    // This controller uses 401 for a rejected PIN after authentication succeeded.
    // Authentication middleware failures have no access-log action and still clear the session.
    const rejectedSimulationPin =
      error.config?.url === "/access/simulate-unlock" &&
      error.response?.data?.data?.action === "UNLOCK_FAILED";
    if (
      error.response?.status === 401 &&
      !rejectedSimulationPin &&
      token &&
      !error.config?.skipAuth &&
      error.config?.headers?.Authorization === `Bearer ${token}`
    ) {
      clearAuthSession();
    }
    return Promise.reject(error);
  },
);

export default axiosClient;
