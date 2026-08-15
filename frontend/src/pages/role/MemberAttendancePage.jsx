import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage } from "../../api/client";
import { Badge, Button, Card } from "../../components/ui";

function statusTone(status) {
  if (status === "present" || status === "completed") return "green";
  if (status === "absent" || status === "missed" || status === "no_show") return "red";
  return "slate";
}

export default function MemberAttendancePage() {
  const [range, setRange] = useState("month");
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [summary, setSummary] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (range && range !== "all") params.set("range", range);
      const [listRes, summaryRes] = await Promise.all([
        api.get(`/user/attendance?${params.toString()}`),
        api.get("/user/attendance/summary"),
      ]);
      setItems(listRes.data.items || []);
      setStats(listRes.data.stats || {});
      setSummary(summaryRes.data.summary || {});
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const all = summary.all || stats;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">My Attendance</h1>
        <p className="text-sm text-[var(--vf-muted)]">Your workout and session attendance history.</p>
      </div>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <Card className="p-5">
        <p className="text-sm text-[var(--vf-muted)]">Attendance rate</p>
        <p className="mt-1 text-4xl font-bold">{all.attendancePercentage ?? 0}%</p>
        <p className="mt-2 text-sm text-[var(--vf-muted)]">
          Present {all.present ?? 0} · Absent {all.absent ?? 0} · Missed {all.missed ?? 0}
        </p>
      </Card>

      <div className="flex flex-wrap gap-2">
        {["week", "month", "all"].map((item) => (
          <Button key={item} size="sm" variant={range === item ? "primary" : "secondary"} onClick={() => setRange(item)}>
            {item}
          </Button>
        ))}
      </div>

      <Card className="divide-y divide-[var(--vf-border)]">
        {loading && !items.length ? <p className="p-4 text-sm">Loading…</p> : null}
        {!loading && !items.length ? <p className="p-4 text-sm">No attendance history yet.</p> : null}
        {items.map((row) => (
          <div key={row._id} className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-semibold capitalize">{row.type}</p>
              <p className="text-xs text-[var(--vf-muted)]">
                {row.date ? new Date(row.date).toLocaleDateString() : "—"}
              </p>
            </div>
            <Badge tone={statusTone(row.status)}>{row.status}</Badge>
          </div>
        ))}
      </Card>
    </div>
  );
}
