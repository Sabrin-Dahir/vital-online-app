import axios from "axios";
import { API_BASE_URL } from "../config/apiConfig";

const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 3;

/** Same base URL as Flutter ApiConfig.baseUrl → Existing Backend → MongoDB vitalguide */
export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  // Keep list/dashboard screens from hanging for minutes on a cold API.
  timeout: 20000,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("vital_token") || localStorage.getItem("admin_token");
  if (token) {
    // Same JWT Bearer scheme as Flutter ApiService._headers()
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const status = error.response?.status;
    const method = (config?.method || "get").toLowerCase();

    // Only retry safe GETs, and at most once — long retry chains look like stuck loading.
    if (config && method === "get" && RETRYABLE_STATUSES.has(status)) {
      config.__retryCount = config.__retryCount || 0;
      if (config.__retryCount < Math.min(MAX_RETRIES, 1)) {
        config.__retryCount += 1;
        await sleep(400 * config.__retryCount);
        return api(config);
      }
    }

    if (status === 401 || status === 403) {
      const url = error.config?.url || "";
      const responseCode = error.response?.data?.code;

      // Forced password-change gate — redirect but keep the session token
      if (status === 403 && responseCode === "PASSWORD_CHANGE_REQUIRED") {
        if (!window.location.pathname.includes("/change-password")) {
          window.location.href = "/change-password";
        }
        return Promise.reject(error);
      }

      const isSessionProbe =
        url.includes("/admin/me") || url.includes("/auth/admin/login");
      if (isSessionProbe || status === 401) {
        localStorage.removeItem("vital_token");
        localStorage.removeItem("vital_user");
        localStorage.removeItem("admin_token");
        localStorage.removeItem("admin_user");
        if (status === 401 && !window.location.pathname.includes("/login")) {
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  },
);

export function getErrorMessage(error) {
  const data = error?.response?.data;
  return (
    data?.message ||
    data?.errors?.[0]?.message ||
    data?.errors?.[0]?.msg ||
    error?.message ||
    "Something went wrong"
  );
}

/** Race a promise against a hard deadline so UI loaders always settle. */
export function withHardTimeout(promise, ms = 20000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Request timed out. Please retry."));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export default api;
