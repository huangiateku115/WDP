import axios from "axios";
import {apiBaseURL, assertConfirmedRequest} from "./confirmedContract";
import {getAccessToken, clearAuthSession} from "@/lib/authSession";

const axiosClient = axios.create({
  baseURL: apiBaseURL(import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api/v1"),
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

axiosClient.interceptors.request.use((config) => {
  assertConfirmedRequest(config);
  const token = getAccessToken();
  if (token && !config.skipAuth) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const token = getAccessToken();
    if (error.response?.status === 401 && token && !error.config?.skipAuth && error.config?.headers?.Authorization === `Bearer ${token}`) {
      clearAuthSession();
    }
    return Promise.reject(error);
  },
);

export default axiosClient;
