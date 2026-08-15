import { CalendarDays, Dumbbell, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../../api/client";
import { Button, Card } from "../../components/ui";
import { formatWhen } from "./roleHelpers";

export async function fetchCoachDashboard() {
  return api.get("/dashboard/coach").then((r) => r.data);
}

export default function CoachDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasDataRef = useRef(false);

  const load = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true);
    setError("");
    let timer;
    try {
      const next = await Promise.race([
        fetchCoachDashboard(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Request timed out. Please retry.")), 20000);
        }),
      ]);
      setData(next);
      hasDataRef.current = true;
    } catch (err) {
      setError(getErrorMessage(err));
      if (!hasDataRef.current) setData(null);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clients = data?.assignments?.length ?? 0;
  const appointments = data?.appointments?.length ?? 0;
  const recentWorkouts = data?.clientProgress?.workoutLogs?.length ?? 0;
  const upcoming = (data?.appointments || []).slice(0, 5);

  return (
    <>
      <div className="rounded-[20px] p-8 text-white" style={{ background: "var(--vf-gradient)" }}>
        <Dumbbell className="h-9 w-9" />
        <h1 className="mt-5 text-3xl font-bold">Coach dashboard</h1>
        <p className="mt-2 text-white/85">Welcome back. Your coaching workspace is ready.</p>
      </div>

      
      {!loading && error ? (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-[var(--vf-danger)]">{error}</p>
          <Button variant="secondary" onClick={load}>Retry</Button>
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--vf-muted)]">
                <Users className="h-4 w-4 text-[var(--vf-primary)]" />
                Active clients
              </div>
              <p className="mt-2 text-2xl font-bold">{clients}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--vf-muted)]">
                <CalendarDays className="h-4 w-4 text-[var(--vf-primary)]" />
                Appointments
              </div>
              <p className="mt-2 text-2xl font-bold">{appointments}</p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--vf-muted)]">
                <Dumbbell className="h-4 w-4 text-[var(--vf-primary)]" />
                Recent workouts
              </div>
              <p className="mt-2 text-2xl font-bold">{recentWorkouts}</p>
            </Card>
          </div>

          <Card className="mt-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">Upcoming appointments</h2>
                <p className="mt-1 text-sm text-[var(--vf-muted)]">Next sessions with your clients.</p>
              </div>
              <Link to="/coach/clients"><Button size="sm" variant="secondary">View clients</Button></Link>
              <Link to="/coach/appointments"><Button size="sm">Schedule appointment</Button></Link>
              <Link to="/coach/sessions"><Button size="sm" variant="secondary">1-on-1 Sessions</Button></Link>
              <Link to="/coach/attendance"><Button size="sm" variant="secondary">Attendance</Button></Link>
            </div>
            <ul className="mt-4 space-y-2">
              {upcoming.length === 0 ? (
                <li className="rounded-[12px] border border-[var(--vf-border)] px-3 py-6 text-center text-sm text-[var(--vf-muted)]">
                  No appointments scheduled yet.
                </li>
              ) : (
                upcoming.map((a) => (
                  <li key={a._id || a.id} className="rounded-[12px] border border-[var(--vf-border)] px-3 py-3 text-sm">
                    <p className="font-semibold">
                      {a.user_id?.full_name || a.user_id?.username || "Client"}
                    </p>
                    <p className="mt-1 text-[var(--vf-muted)]">{formatWhen(a.datetime || a.date)}</p>
                  </li>
                ))
              )}
            </ul>
          </Card>
        </>
      ) : null}
    </>
  );
}
