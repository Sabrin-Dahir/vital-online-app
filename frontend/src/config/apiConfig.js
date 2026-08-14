/**
 * Shared API config — must match Flutter's ApiConfig
 * (mobile/lib/config/api_config.dart)
 *
 * Development (`npm run dev`): local backend http://127.0.0.1:5050/api
 * Production (`vite build`): Contabo VPS + Atlas vitalguide
 *
 * Override anytime with VITE_API_URL / VITE_SOCKET_URL.
 */
const LOCAL_API_URL = "http://127.0.0.1:5050/api";
const PROD_API_URL = "https://169.58.179.28.sslip.io/api";

const DEFAULT_API_URL = import.meta.env.PROD ? PROD_API_URL : LOCAL_API_URL;

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL || DEFAULT_API_URL
).replace(/\/$/, "");

/** Origin without `/api` — used for Socket.IO and health checks */
export const API_ORIGIN = API_BASE_URL.replace(/\/api$/, "");

export const API_HEALTH_URL = `${API_ORIGIN}/api/health`;

export const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL || API_ORIGIN).replace(/\/$/, "");

export default API_BASE_URL;
