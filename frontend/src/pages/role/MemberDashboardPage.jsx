import { Dumbbell, Droplets, Flame, HeartPulse, UtensilsCrossed } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { getMe, getMyNotifications } from "../../api/adminApi";
import {
  getMemberCoaching,
  getMemberDietProgress,
  getMemberProgress,
  getMemberWorkoutProgress,
  getMyCoachRequest } from "../../api/memberApi";
import { Badge, Button, Card } from "../../components/ui";
import { assignedCoachFromUser, formatWhen } from "./roleHelpers";
import { coachDisplayName } from "../../utils/coachDisplay";

export default function MemberDashboardPage() {
  const { profile, setProfile, setUnreadCount } = useOutletContext();
  const [progress, setProgress] = useState(null);
  const [workoutProgress, setWorkoutProgress] = useState(null);
  const [dietProgress, setDietProgress] = useState(null);
  const [coachBanner, setCoachBanner] = useState(null);
  const [coachRequest, setCoachRequest] = useState(null);
  const [coaching, setCoaching] = useState(null);

  const load = useCallback(async () => {
    // Shell already loads profile + unread count — only refresh me/notifs if needed for coach banner.
    const tasks = [
      getMyNotifications()
        .then((notifs) => {
          const list = Array.isArray(notifs) ? notifs : [];
          setUnreadCount?.(list.filter((n) => !n.read).length);
          const unreadCoach = list.find(
            (n) =>
              !n.read &&
              (n.type === "coach_assigned" ||
                /coach request was approved/i.test(n.message || "") ||
                /assigned to coach/i.test(n.message || "")),
          );
          setCoachBanner(unreadCoach || null);
        })
        .catch(() => {}),
      getMemberProgress()
        .then((progressData) => setProgress(progressData))
        .catch(() => {}),
      getMemberWorkoutProgress(7)
        .then((workoutData) => setWorkoutProgress(workoutData))
        .catch(() => {}),
      getMemberDietProgress(7)
        .then((dietData) => setDietProgress(dietData))
        .catch(() => {}),
      getMyCoachRequest()
        .then((request) => setCoachRequest(request || null))
        .catch(() => {}),
      getMemberCoaching()
        .then((assignment) => setCoaching(assignment || null))
        .catch(() => {}),
    ];
    // Soft-refresh profile in background only when shell has no profile yet.
    if (!profile) {
      tasks.push(
        getMe()
          .then((meData) => {
            if (meData?.user) setProfile?.(meData.user);
          })
          .catch(() => {}),
      );
    }
    await Promise.all(tasks);
  }, [profile, setProfile, setUnreadCount]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (coachRequest?.status !== "pending") return undefined;
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [coachRequest?.status, load]);

  const displayUser = profile;
  const assignedCoach = assignedCoachFromUser(displayUser) || coaching?.coach || null;
  const pendingRequest = coachRequest?.status === "pending";
  const rejectedRequest = coachRequest?.status === "rejected";
  const workoutsDone = workoutProgress?.summary?.completed ?? 0;
  const dietAdherence = dietProgress?.weeklyAveragePercent ?? dietProgress?.avgAdherence ?? 0;
  const waterMl = progress?.summary?.hydration ?? 0;
  const caloriesOut = progress?.summary?.caloriesOut ?? 0;
  const caloriesIn = progress?.summary?.caloriesIn ?? dietProgress?.today?.caloriesConsumed ?? 0;
  const calorieTarget = dietProgress?.today?.targetCalories ?? dietProgress?.plan?.dailyCalories ?? 0;

  return (
    <>
      <div className="rounded-[20px] p-8 text-white" style={{ background: "var(--vf-gradient)" }}>
        <HeartPulse className="h-9 w-9" />
        <h1 className="mt-5 text-3xl font-bold">My fitness dashboard</h1>
        <p className="mt-2 text-white/85">Welcome back. Keep building healthy habits.</p>
      </div>

      {coachBanner ? (
        <div className="mt-5 rounded-[16px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          <p className="font-semibold">Coach linked</p>
          <p className="mt-1">
            {coachBanner.message || "Your coach accepted your request. You are now linked."}
          </p>
          <p className="mt-1 text-xs text-emerald-800">{formatWhen(coachBanner.createdAt)}</p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--vf-muted)]">
            <Dumbbell className="h-4 w-4 text-[var(--vf-primary)]" />
            Workouts (7d)
          </div>
          <p className="mt-2 text-2xl font-bold">{workoutsDone}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--vf-muted)]">
            <HeartPulse className="h-4 w-4 text-[var(--vf-primary)]" />
            Diet adherence
          </div>
          <p className="mt-2 text-2xl font-bold">{dietAdherence}%</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--vf-muted)]">
            <Droplets className="h-4 w-4 text-[var(--vf-primary)]" />
            Water
          </div>
          <p className="mt-2 text-2xl font-bold">{Math.round(waterMl / 100) / 10} L</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--vf-muted)]">
            <UtensilsCrossed className="h-4 w-4 text-[var(--vf-primary)]" />
            Calories in
          </div>
          <p className="mt-2 text-2xl font-bold">
            {Math.round(caloriesIn)}
            {calorieTarget > 0 ? (
              <span className="ml-1 text-sm font-medium text-[var(--vf-muted)]">/ {calorieTarget}</span>
            ) : null}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--vf-muted)]">
            <Flame className="h-4 w-4 text-[var(--vf-primary)]" />
            Calories out
          </div>
          <p className="mt-2 text-2xl font-bold">{Math.round(caloriesOut)}</p>
        </Card>
      </div>

      <Card className="mt-5 p-6">
        <h2 className="font-bold">Quick actions</h2>
        <p className="mt-2 text-sm text-[var(--vf-muted)]">
          Jump to coaches, logging, sharing, or your account details.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/member/coaches"><Button size="sm">Browse coaches</Button></Link>
          <Link to="/member/appointments"><Button size="sm" variant="secondary">My appointments</Button></Link>
          <Link to="/member/sessions"><Button size="sm" variant="secondary">1-on-1 Sessions</Button></Link>
          <Link to="/member/attendance"><Button size="sm" variant="secondary">My Attendance</Button></Link>
          <Link to="/member/progress"><Button size="sm" variant="secondary">Log progress</Button></Link>
          <Link to="/member/share"><Button size="sm" variant="secondary">Share & invite</Button></Link>
          <Link to="/member/account"><Button size="sm" variant="secondary">My account</Button></Link>
        </div>
        {assignedCoach ? (
          <p className="mt-4 rounded-[12px] bg-[var(--vf-surface-muted)] px-3 py-2 text-sm">
            Your coach is <strong>{coachDisplayName(assignedCoach)}</strong>
            {assignedCoach.username ? ` (@${assignedCoach.username})` : ""}.
          </p>
        ) : pendingRequest ? (
          <p className="mt-4 text-sm text-amber-900">
            <Badge tone="amber">Pending Coach Approval</Badge>
            <span className="ml-2">
              Your request to {coachDisplayName(coachRequest?.coach)} is pending review.{" "}
              <Link className="font-semibold text-[var(--vf-primary)]" to="/member/coaches">
                View status
              </Link>
            </span>
          </p>
        ) : rejectedRequest ? (
          <p className="mt-4 text-sm text-rose-900">
            <Badge tone="red">Request not accepted</Badge>
            <span className="ml-2">
              Choose a different coach from the{" "}
              <Link className="font-semibold text-[var(--vf-primary)]" to="/member/coaches">
                Coaches
              </Link>{" "}
              page.
            </span>
          </p>
        ) : (
          <p className="mt-4 text-sm text-amber-900">
            <Badge tone="amber">No coach yet</Badge>
            <span className="ml-2">
              Browse active coaches and send a request to the coach you want.{" "}
              <Link className="font-semibold text-[var(--vf-primary)]" to="/member/coaches">
                Open Coaches
              </Link>
            </span>
          </p>
        )}
      </Card>
    </>
  );
}
