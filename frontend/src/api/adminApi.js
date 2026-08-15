import api from "./client";

/** Central login — the backend returns the authenticated user's role. */
export const login = (username, password) =>
  api
    .post("/auth/login", {
      username,
      email: username,
      password,
    })
    .then((r) => r.data);

export const registerMember = (data) =>
  api.post("/auth/register", data).then((r) => r.data);

/** Session check for every role. */
export const getMe = () => api.get("/auth/me").then((r) => r.data);

/** Change the current user's password. */
export const changePassword = (currentPassword, newPassword) =>
  api
    .post("/auth/change-password", { currentPassword, newPassword })
    .then((r) => r.data);

/** @deprecated Admin member mutations are forbidden (403). Kept for API compatibility. */
export const regeneratePassword = (id) =>
  api.post(`/admin/users/${id}/regenerate-password`).then((r) => r.data);

/** Fetch all audit log entries (admin only). */
export const getAuditLogs = () =>
  api.get("/admin/audit-logs").then((r) => r.data);

export const getDashboard = () =>
  api.get("/admin/dashboard").then((r) => r.data);

export const getStatistics = () =>
  api.get("/admin/statistics").then((r) => r.data);

export const getReports = () => api.get("/admin/reports").then((r) => r.data);

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  return data?.items || [];
}

export const getUsers = (params = {}) =>
  api
    .get("/admin/users", { params: { ...params, role: "user" } })
    .then((r) => unwrapList(r.data).filter((u) => u.role === "user"));

export const getUsersMeta = (params = {}) =>
  api.get("/admin/users", { params: { ...params, role: "user" } }).then((r) => {
    const data = r.data;
    const raw = Array.isArray(data) ? data : data?.items || [];
    const items = raw.filter((u) => u.role === "user");
    if (Array.isArray(data)) return { items, total: items.length };
    return {
      items,
      total: data?.total ?? items.length,
    };
  });

export const getUserDetail = (id) =>
  api.get(`/admin/users/${id}/detail`).then((r) => r.data);

export const getCoachDetail = (id) =>
  api.get(`/admin/trainers/${id}/detail`).then((r) => r.data);

/** @deprecated Admin member mutations are forbidden (403). */
export const updateUserStatus = (id, status) =>
  api.patch(`/admin/users/${id}/status`, { status }).then((r) => r.data);

export const createUser = (data) =>
  api.post("/admin/users", data).then((r) => r.data);

/** Admin creates a member using the same payload as public /auth/register. */
export const registerMemberAdmin = (data) =>
  api.post("/admin/users", { ...data, role: "user" }).then((r) => r.data);

export const registerCoachAdmin = (data) =>
  api.post("/admin/users", { ...data, role: "coach" }).then((r) => r.data);

export const validateCoachCertificate = (data) =>
  api.post("/auth/validate-coach-certificate", data).then((r) => r.data);

export const updateUserRole = (id, role) =>
  api.patch(`/admin/users/${id}/role`, { role }).then((r) => r.data);

/** @deprecated Admin profile/status mutations are forbidden (403). */
export const updateUser = (id, data) =>
  api.patch(`/admin/users/${id}`, data).then((r) => r.data);

/** Delete a member account (admin only). Edit/update endpoints remain forbidden. */
export const deleteUser = (id) =>
  api.delete(`/admin/users/${id}`).then((r) => r.data);

export const getTrainers = () =>
  api.get("/admin/trainers").then((r) =>
    unwrapList(r.data).filter((coach) => coach.role === "coach"),
  );

export const getTrainersMeta = () =>
  api.get("/admin/trainers").then((r) => {
    const data = r.data;
    const raw = Array.isArray(data) ? data : data?.items || [];
    // Keep every row returned by the API (approved coaches + pending applicants).
    const items = raw.filter(Boolean);
    return {
      items,
      total: data?.total ?? items.length,
      coachAccounts: data?.coachAccounts ?? items.filter((c) => c.role === "coach").length,
      pendingApplicants: data?.pendingApplicants ?? 0,
    };
  });

export const deleteCoach = (id) =>
  api.delete(`/admin/trainers/${id}`).then((r) => r.data);

export const updateCoachSpecialization = (id, specialization) =>
  api
    .patch(`/admin/trainers/${id}/specialization`, {
      specializations: Array.isArray(specialization)
        ? specialization
        : [specialization].filter(Boolean),
      specialization: Array.isArray(specialization)
        ? specialization
        : specialization,
    })
    .then((r) => r.data);

export const getCoachApplications = (status) =>
  api
    .get("/admin/coach-applications", { params: status ? { status } : {} })
    .then((r) => r.data);

export const getCoachApplication = (id) =>
  api.get(`/admin/coach-applications/${id}`).then((r) => r.data);

export const approveCoachApplication = (id) =>
  api.patch(`/admin/coach-applications/${id}/approve`).then((r) => r.data);

export const rejectCoachApplication = (id, reason = "") =>
  api
    .patch(`/admin/coach-applications/${id}/reject`, { reason })
    .then((r) => r.data);

export const getAppointments = (params = {}) =>
  api.get("/admin/appointments", { params }).then((r) => r.data);

export const getCoachingProgress = () =>
  api.get("/admin/coaching-progress").then((r) => r.data);

export const getDietPlans = (params = {}) =>
  api.get("/admin/diet-plans", { params }).then((r) => r.data);

export const getDietAdherence = (params = {}) =>
  api.get("/admin/diet-adherence", { params }).then((r) => r.data);

export const getExercises = () =>
  api.get("/admin/exercises").then((r) => r.data);

export const approveExercise = (id) =>
  api.patch(`/admin/exercises/${id}/approve`).then((r) => r.data);

export const rejectExercise = (id) =>
  api.patch(`/admin/exercises/${id}/reject`).then((r) => r.data);

export const getWorkoutsOverview = () =>
  api.get("/admin/workouts/overview").then((r) => r.data);

export const getMeals = () => api.get("/admin/meals").then((r) => r.data);

export const getClasses = () => api.get("/admin/classes").then((r) => r.data);

export const sendAnnouncement = (payload) =>
  api.post("/admin/notifications", payload).then((r) => r.data);

/** Member/coach in-app notifications */
export const getMyNotifications = () =>
  api.get("/user/notifications").then((r) => (Array.isArray(r.data) ? r.data : r.data?.items || []));

export const markMyNotificationRead = (id) =>
  api.patch(`/user/notifications/${id}/read`).then((r) => r.data);
