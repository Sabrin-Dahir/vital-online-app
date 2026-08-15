import api from "./client";

function absoluteAppUrl(pathOrUrl) {
  if (!pathOrUrl) return "";
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

export const getMemberProgress = () =>
  api.get("/progress").then((r) => r.data);

export const getMemberWorkoutProgress = (days = 7) =>
  api.get("/user/workouts/progress", { params: { days } }).then((r) => r.data);

export const getMemberDietProgress = (days = 7) =>
  api.get("/diet/progress", { params: { days } }).then((r) => r.data);

export const logMemberDietAdherence = (payload) =>
  api.post("/diet/adherence", payload).then((r) => r.data);

export const getUserAppointments = () =>
  api.get("/user/appointments").then((r) => r.data);

export const cancelUserAppointment = (id) =>
  api.patch(`/user/appointments/${id}/cancel`).then((r) => r.data);


export const logMemberWater = (amountMl) =>
  api.post("/water/log", { amountMl: Number(amountMl) }).then((r) => r.data);

export const logMemberActivity = ({ activityType, durationMinutes, caloriesBurned }) =>
  api
    .post("/activity/log", {
      activityType,
      durationMinutes: Number(durationMinutes),
      caloriesBurned: Number(caloriesBurned) || 0,
    })
    .then((r) => r.data);

export const logMemberWeight = (weightKg) =>
  api.post("/progress/weight", { weightKg: Number(weightKg) }).then((r) => r.data);

export const createShareCard = (type, extra = {}) =>
  api.post("/share/cards", { type, ...extra }).then((r) => {
    const data = r.data;
    return {
      ...data,
      url: absoluteAppUrl(data.path || `/s/${data.token}`),
    };
  });

export const getShareCard = (token) =>
  api.get(`/share/cards/${token}`).then((r) => r.data);

export const getMyInvite = () =>
  api.get("/share/invite").then((r) => {
    const data = r.data;
    const path = data.path || (data.code ? `/register?ref=${encodeURIComponent(data.code)}` : "/register");
    return {
      ...data,
      url: absoluteAppUrl(path),
      shareUrl: absoluteAppUrl(path),
    };
  });

export const getInviteStats = () =>
  api.get("/share/invite/stats").then((r) => r.data);

export const getMemberTrainers = () =>
  api.get("/user/trainers").then((r) => (Array.isArray(r.data) ? r.data : r.data?.items || []));

export const getMemberCoaching = () =>
  api.get("/user/coaching").then((r) => r.data);

export const getMyCoachRequest = () =>
  api.get("/user/coach-request").then((r) => r.data);

export const submitCoachRequest = (coachId, message = "") =>
  api.post("/user/coach-request", { coachId, message }).then((r) => r.data);

export const cancelCoachRequest = () =>
  api.delete("/user/coach-request").then((r) => r.data);

export const getCoachIncomingRequests = () =>
  api.get("/coach/requests").then((r) => (Array.isArray(r.data) ? r.data : []));

export const getCoachIncomingRequestDetail = (id) =>
  api.get(`/coach/requests/${id}`).then((r) => r.data);

export const approveCoachRequest = (id, body = {}) =>
  api.patch(`/coach/requests/${id}/approve`, body).then((r) => r.data);

export const rejectCoachRequest = (id) =>
  api.patch(`/coach/requests/${id}/reject`).then((r) => r.data);

export { absoluteAppUrl };
