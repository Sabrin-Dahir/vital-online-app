import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Layout from "./components/Layout";
import RoleShell from "./components/RoleShell";
import AppointmentsPage from "./pages/AppointmentsPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import CoachesPage from "./pages/CoachesPage";
import CoachApplicationDetailPage from "./pages/CoachApplicationDetailPage";
import AdminCoachRegisterPage from "./pages/AdminCoachRegisterPage";
import AdminUserRegisterPage from "./pages/AdminUserRegisterPage";
import CoachDetailPage from "./pages/CoachDetailPage";
import DashboardPage from "./pages/DashboardPage";
import InsightsPage from "./pages/InsightsPage";
import LoginPage from "./pages/LoginPage";
import UserDetailPage from "./pages/UserDetailPage";
import UsersPage from "./pages/UsersPage";
import RegisterPage from "./pages/RegisterPage";
import ShareCardPage from "./pages/ShareCardPage";
import MemberDashboardPage from "./pages/role/MemberDashboardPage";
import MemberProgressPage from "./pages/role/MemberProgressPage";
import MemberSharePage from "./pages/role/MemberSharePage";
import MemberAppointmentsPage from "./pages/role/MemberAppointmentsPage";
import MemberSessionsPage from "./pages/role/MemberSessionsPage";
import MemberCoachesPage from "./pages/role/MemberCoachesPage";
import RoleAccountPage from "./pages/role/RoleAccountPage";
import RoleNotificationsPage from "./pages/role/RoleNotificationsPage";
import RolePasswordPage from "./pages/role/RolePasswordPage";
import CoachDashboardPage from "./pages/role/CoachDashboardPage";
import CoachClientsPage from "./pages/role/CoachClientsPage";
import CoachAppointmentsPage from "./pages/role/CoachAppointmentsPage";
import CoachSessionsPage from "./pages/role/CoachSessionsPage";
import CoachAttendancePage from "./pages/role/CoachAttendancePage";
import MemberAttendancePage from "./pages/role/MemberAttendancePage";

export function dashboardPath(role) {
  if (role === "admin") return "/";
  return role === "coach" ? "/coach/dashboard" : "/member/dashboard";
}

function coachApprovalStatus(user) {
  return (
    user?.coachApplicationStatus ||
    user?.coachData?.approval_status ||
    null
  );
}

/** Blocks protected routes until the user has changed their initial password. */
function SessionGuard({ children, role }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;

  const approval = coachApprovalStatus(user);
  const unapprovedCoach =
    user.role === "coach" && (approval === "pending" || approval === "rejected");

  // Unapproved coaches must not use the coach shell — send them to member UI.
  if (role === "coach" && unapprovedCoach) {
    return <Navigate to="/member/dashboard" replace />;
  }

  // Allow unapproved coaches into the member shell (role may still be "coach").
  if (role === "user" && unapprovedCoach) {
    return children;
  }

  if (role && user.role !== role) return <Navigate to={dashboardPath(user.role)} replace />;
  return children;
}

/** Blocks the change-password page from users who don't need it. */
function ChangePasswordGuard({ children }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.must_change_password) return <Navigate to={dashboardPath(user.role)} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/s/:token" element={<ShareCardPage />} />

      <Route
        path="/change-password"
        element={
          <ChangePasswordGuard>
            <ChangePasswordPage />
          </ChangePasswordGuard>
        }
      />

      <Route
        path="/"
        element={
          <SessionGuard role="admin">
            <Layout />
          </SessionGuard>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/register" element={<AdminUserRegisterPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />
        <Route path="coaches" element={<CoachesPage />} />
        <Route path="coaches/register" element={<AdminCoachRegisterPage />} />
        <Route path="coaches/applications/:id" element={<CoachApplicationDetailPage />} />
        <Route path="coaches/:id" element={<CoachDetailPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route
          path="coaching-progress"
          element={<Navigate to="/insights?tab=progress" replace />}
        />
        <Route path="diet" element={<Navigate to="/insights?tab=diet" replace />} />
        <Route
          path="workouts"
          element={<Navigate to="/insights?tab=workouts" replace />}
        />
        <Route
          path="reports"
          element={<Navigate to="/insights?tab=reports" replace />}
        />
      </Route>

      <Route
        path="/member"
        element={
          <SessionGuard role="user">
            <RoleShell role="user" />
          </SessionGuard>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<MemberDashboardPage />} />
        <Route path="coaches" element={<MemberCoachesPage />} />
        <Route path="appointments" element={<MemberAppointmentsPage />} />
        <Route path="sessions" element={<MemberSessionsPage />} />
        <Route path="attendance" element={<MemberAttendancePage />} />
        <Route path="account" element={<RoleAccountPage role="user" />} />
        <Route path="progress" element={<MemberProgressPage />} />
        <Route path="share" element={<MemberSharePage />} />
        <Route path="notifications" element={<RoleNotificationsPage />} />
        <Route path="password" element={<RolePasswordPage role="user" />} />
      </Route>

      <Route
        path="/coach"
        element={
          <SessionGuard role="coach">
            <RoleShell role="coach" />
          </SessionGuard>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<CoachDashboardPage />} />
        <Route path="clients" element={<CoachClientsPage />} />
        <Route path="appointments" element={<CoachAppointmentsPage />} />
        <Route path="sessions" element={<CoachSessionsPage />} />
        <Route path="attendance" element={<CoachAttendancePage />} />
        <Route path="account" element={<RoleAccountPage role="coach" />} />
        <Route path="notifications" element={<RoleNotificationsPage />} />
        <Route path="password" element={<RolePasswordPage role="coach" />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
