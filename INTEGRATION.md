# Integration — Frontend · Backend · Mobile

How the three apps connect. They all talk to the **same Express API**, which reads/writes the **same MongoDB Atlas database** (`vitalguide`).

```
┌─────────────────┐     ┌─────────────────┐
│  Flutter mobile │     │  React frontend │
│  (APK / iOS)    │     │  (Vercel / Vite)│
└────────┬────────┘     └────────┬────────┘
         │  HTTPS + JWT          │
         │  /api/*               │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │  Backend (Contabo)    │
         │  Express + Socket.IO  │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │  MongoDB Atlas        │
         │  database: vitalguide │
         └───────────────────────┘
```

| Environment | API base URL |
|-------------|--------------|
| **Production** | `https://169.58.179.28.sslip.io/api` |
| **Local dev** | `http://127.0.0.1:5050/api` |

---

## 1. Backend (hub)

Entry and route mounting:

| File | Role |
|------|------|
| `backend/src/server.js` | Starts HTTP + Socket.IO, connects DB |
| `backend/src/app.js` | Express app — mounts all `/api/*` routes |
| `backend/src/config/db.js` | MongoDB Atlas connection (`MONGO_URI`) |
| `backend/src/config/cors.js` | Allows web (Vercel) + mobile (no Origin) |
| `backend/src/middleware/auth.js` | JWT `Authorization: Bearer <token>` |

Main API mounts in `app.js`:

- `/api/auth` — login, register, me  
- `/api/user` — profile, appointments, workouts  
- `/api/diet` — diet plan, progress, adherence  
- `/api/progress` — calories, water, trends  
- `/api/coach` — coach tools  
- `/api/admin` — admin dashboard  
- `/api/water`, `/api/activity`, `/api/chat`, …

Health check: `GET /api/health`

---

## 2. Mobile → Backend

```
Screens → ApiService → ApiConfig.baseUrl → Backend /api/*
```

| File | Role |
|------|------|
| `mobile/lib/config/api_config.dart` | **Integration point** — builds API URL |
| `mobile/lib/services/api_service.dart` | All HTTP calls + JWT headers |

Key line in `api_service.dart`:

```dart
String get baseUrl => ApiConfig.baseUrl;
```

| Build | Host used |
|-------|-----------|
| **Release APK** | `169.58.179.28.sslip.io` (HTTPS) |
| **Debug** (`flutter run`) | `127.0.0.1:5050` |

Override: `--dart-define=API_URL=https://169.58.179.28.sslip.io/api`

---

## 3. Frontend → Backend

```
Pages → adminApi / memberApi / coachApi → client.js → apiConfig → Backend /api/*
```

| File | Role |
|------|------|
| `frontend/src/config/apiConfig.js` | **Integration point** — `API_BASE_URL` |
| `frontend/src/api/client.js` | Axios instance + JWT interceptor |
| `frontend/src/api/adminApi.js` | Admin endpoints |
| `frontend/src/api/memberApi.js` | Member endpoints |
| `frontend/src/api/coachApi.js` | Coach endpoints |
| `frontend/.env.production` | Production URL for Vercel builds |
| `frontend/.env.development` | Local URL for `npm run dev` |

Key lines in `client.js`:

```js
import { API_BASE_URL } from "../config/apiConfig";
export const api = axios.create({ baseURL: API_BASE_URL, ... });
```

| Mode | API URL |
|------|---------|
| **Production** (`vite build`) | `https://169.58.179.28.sslip.io/api` |
| **Dev** (`npm run dev`) | `http://127.0.0.1:5050/api` |

---

## 4. Shared auth & data

1. Client calls `POST /api/auth/login`  
2. Backend returns JWT  
3. Mobile stores token; web stores `vital_token` / `admin_token` in `localStorage`  
4. Every later request sends `Authorization: Bearer <token>`  
5. Backend validates JWT and reads/writes Atlas `vitalguide`

Same users, diet plans, progress, and coaches — one database for web and mobile.

### Images (ImageKit)

Mobile still sends a compressed base64 data URL. The backend uploads it to **ImageKit** and stores only the HTTPS CDN URL in MongoDB (`User.avatar`, `proofPhoto`).

| File | Role |
|------|------|
| `backend/src/utils/imageKit.js` | Upload helper (`IMAGEKIT_*` env vars) |
| `PUT /api/user/profile/photo` | Profile → ImageKit → `User.avatar` URL |
| Workout complete endpoints | Proof → ImageKit → `proofPhoto` URL |

Required env: `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`

---

## 5. Deploy map

| Piece | Host | Points to |
|-------|------|-----------|
| Backend | Contabo → `169.58.179.28.sslip.io` | Atlas `vitalguide` |
| Frontend | Contabo Nginx | Contabo `/api` |
| Mobile APK | Device install | Contabo `/api` |

CORS on Contabo: set `CLIENT_URL` / `PUBLIC_WEB_URL` to `https://169.58.179.28.sslip.io`.
