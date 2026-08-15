import { Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Share2,
  Users,
  UserRound,
  X,
  ClipboardCheck,
  Dumbbell } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { getMyNotifications } from "../api/adminApi";
import { BrandMark } from "./ui";

const MEMBER_NAV = [
  { to: "/member/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/member/coaches", label: "Coaches", icon: Users },
  { to: "/member/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/member/sessions", label: "1-on-1 Sessions", icon: Dumbbell },
  { to: "/member/attendance", label: "My Attendance", icon: ClipboardCheck },
  { to: "/member/account", label: "My account", icon: UserRound },
  { to: "/member/progress", label: "Log progress", icon: HeartPulse },
  { to: "/member/share", label: "Share & invite", icon: Share2 },
  { to: "/member/notifications", label: "Notifications", icon: Bell },
  { to: "/member/password", label: "Change password", icon: KeyRound },
];

const COACH_NAV = [
  { to: "/coach/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/coach/clients", label: "My clients", icon: Users },
  { to: "/coach/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/coach/sessions", label: "1-on-1 Sessions", icon: Dumbbell },
  { to: "/coach/attendance", label: "Attendance", icon: ClipboardCheck },
  { to: "/coach/account", label: "My account", icon: UserRound },
  { to: "/coach/notifications", label: "Notifications", icon: Bell },
  { to: "/coach/password", label: "Change password", icon: KeyRound },
];

export default function RoleShell({ role }) {
  const { user, loading, logout, token, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshChrome = useCallback(async () => {
    if (!token) return;
    try {
      const [meUser, notifs] = await Promise.all([
        refreshUser().catch(() => null),
        getMyNotifications().catch(() => []),
      ]);
      if (meUser) setProfile(meUser);
      const list = Array.isArray(notifs) ? notifs : [];
      setUnreadCount(list.filter((n) => !n.read).length);
    } catch {
      /* ignore chrome refresh errors */
    }
  }, [token, refreshUser]);

  useEffect(() => {
    refreshChrome();
  }, [refreshChrome]);

  const nav = useMemo(() => (role === "coach" ? COACH_NAV : MEMBER_NAV), [role]);
  const displayUser = profile || user;
  const pageTitle =
    role === "coach" ? "Coach workspace" : "Member workspace";

  
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  const approval =
    user.coachApplicationStatus || user.coachData?.approval_status || null;
  const unapprovedCoach =
    user.role === "coach" && (approval === "pending" || approval === "rejected");
  // Match SessionGuard: unapproved coaches may use the member shell.
  if (user.role !== role && !(role === "user" && unapprovedCoach)) {
    const dest =
      user.role === "admin" ? "/" : user.role === "coach" ? "/coach/dashboard" : "/member/dashboard";
    return <Navigate to={dest} replace />;
  }

  return (
    <div className="min-h-screen bg-[var(--vf-bg)] text-[var(--vf-text)]">
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-950/45 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-[var(--vf-sidebar-border)] bg-[var(--vf-sidebar)] transition-transform md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-[var(--vf-sidebar-border)] px-4">
          <BrandMark size="sm" light />
          <button type="button" className="p-2 text-[var(--vf-sidebar-text)] md:hidden" onClick={() => setMobileOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => {
            const NavIcon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium ${
                    isActive
                      ? "bg-[var(--vf-sidebar-active-bg)] text-[var(--vf-sidebar-active-text)]"
                      : "text-[var(--vf-sidebar-text)] hover:bg-[var(--vf-sidebar-hover)] hover:text-[var(--vf-sidebar-active-text)]"
                  }`
                }
              >
                <NavIcon className="h-5 w-5" />
                {item.label}
                {item.to.includes("notifications") && unreadCount > 0 ? (
                  <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-[var(--vf-sidebar-border)] p-3">
          <div className="mb-3 rounded-[12px] bg-[var(--vf-sidebar-hover)] p-3">
            <p className="truncate text-sm font-semibold text-[var(--vf-sidebar-active-text)]">
              {displayUser?.full_name || displayUser?.username}
            </p>
            <p className="mt-1 text-xs capitalize text-[var(--vf-sidebar-muted)]">{displayUser?.role}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-[var(--vf-sidebar-text)] hover:bg-[var(--vf-sidebar-hover)] hover:text-[var(--vf-sidebar-active-text)]"
          >
            <LogOut className="h-5 w-5" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-h-screen md:pl-[272px]">
        <header className="sticky top-0 z-30 flex h-16 items-center border-b border-[var(--vf-border)] bg-[var(--vf-surface)] px-4 md:px-6">
          <button type="button" className="mr-3 p-2 text-[var(--vf-muted)] md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            {role === "coach" ? (
              <Dumbbell className="h-4 w-4 text-[var(--vf-primary)]" />
            ) : (
              <HeartPulse className="h-4 w-4 text-[var(--vf-primary)]" />
            )}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--vf-primary)]">Vital Fitness</p>
              <h2 className="text-base font-bold">{pageTitle}</h2>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-5xl p-5 md:p-8">
          <Outlet context={{ profile: displayUser, setProfile, refreshChrome, unreadCount, setUnreadCount }} />
        </section>
      </main>
    </div>
  );
}
