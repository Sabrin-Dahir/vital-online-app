import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage } from "../../api/client";
import { Badge, Button, Card } from "../../components/ui";

const RANGES = ["today", "week", "month"];
const TYPES = ["", "workout", "session", "group", "daily"];

function statusTone(status) {
  if (status === "present" || status === "completed") return "green";
  if (status === "absent" || status === "missed" || status === "no_show") return "red";
  if (status === "cancelled") return "slate";
  return "amber";
}

function statusesForType(type) {
  if (type === "session") return ["present", "absent", "no_show", "cancelled", "completed"];
  if (type === "workout") return ["present", "absent", "completed", "missed"];
  if (type === "group") return ["present", "absent", "no_show"];
  return ["present", "absent"];
}

export default function CoachAttendancePage() {
  const [range, setRange] = useState("week");
  const [type, setType] = useState("");
  const [viewMode, setViewMode] = useState("user");
  const [items, setItems] = useState([]);
  const [clients, setClients] = useState([]);
  const [groups, setGroups] = useState([]);
  const [stats, setStats] = useState({});
  const [summary, setSummary] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [detailItems, setDetailItems] = useState([]);
  const [detailStats, setDetailStats] = useState({});
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (range) params.set("range", range);
      if (type) params.set("type", type);
      const qs = params.toString();
      const [listRes, summaryRes, clientsRes, groupsRes] = await Promise.all([
        api.get(`/coach/attendance?${qs}`),
        api.get("/coach/attendance/summary"),
        api.get(`/coach/attendance/clients?${qs}`),
        api.get(`/coach/attendance/groups?${range ? `range=${range}` : ""}`),
      ]);
      setItems(listRes.data.items || []);
      setStats(listRes.data.stats || {});
      setSummary(summaryRes.data.summary || {});
      setClients(clientsRes.data.items || []);
      setGroups(groupsRes.data.items || []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [range, type]);

  useEffect(() => {
    load();
  }, [load]);

  async function openClient(row) {
    setSelectedGroup(null);
    setSelectedClient(row);
    setDetailLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (range) params.set("range", range);
      if (type) params.set("type", type);
      const res = await api.get(`/coach/attendance/clients/${row.clientId}?${params.toString()}`);
      setDetailItems(res.data.items || []);
      setDetailStats(res.data.stats || {});
    } catch (err) {
      setError(getErrorMessage(err));
      setDetailItems([]);
      setDetailStats({});
    } finally {
      setDetailLoading(false);
    }
  }

  async function openGroup(row) {
    setSelectedClient(null);
    setSelectedGroup(row);
    setDetailLoading(true);
    setError("");
    try {
      const res = await api.get(`/coach/attendance/groups/${row.groupId}`);
      setDetailItems(res.data.items || []);
      setDetailStats(res.data.stats || {});
    } catch (err) {
      setError(getErrorMessage(err));
      setDetailItems([]);
      setDetailStats({});
    } finally {
      setDetailLoading(false);
    }
  }

  async function updateStatus(id, status) {
    try {
      await api.patch(`/coach/attendance/${id}`, { status });
      await load();
      if (selectedClient) await openClient(selectedClient);
      if (selectedGroup) await openGroup(selectedGroup);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const detailTitle = selectedClient
    ? selectedClient.client?.full_name || selectedClient.client?.username || "Client"
    : selectedGroup?.group?.title || "Group";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Attendance</h1>
          <p className="text-sm text-[var(--vf-muted)]">
            Track workout, session, and group attendance for your clients.
          </p>
        </div>
        <Button variant="secondary" onClick={load}>Refresh</Button>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {RANGES.map((key) => (
          <Card key={key} className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--vf-muted)]">{key}</p>
            <p className="mt-1 text-2xl font-bold">{summary[key]?.attendancePercentage ?? 0}%</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ["Clients", stats.totalClients],
          ["Present", stats.present],
          ["Absent", stats.absent],
          ["Missed", stats.missed],
          ["No Show", stats.no_show],
          ["Rate", `${stats.attendancePercentage ?? 0}%`],
        ].map(([label, value]) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-[var(--vf-muted)]">{label}</p>
            <p className="text-lg font-bold">{value ?? 0}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {RANGES.map((item) => (
          <Button key={item} size="sm" variant={range === item ? "primary" : "secondary"} onClick={() => setRange(item)}>
            {item}
          </Button>
        ))}
        {TYPES.map((item) => (
          <Button
            key={item || "all"}
            size="sm"
            variant={type === item ? "primary" : "secondary"}
            onClick={() => setType(item)}
          >
            {item || "all"}
          </Button>
        ))}
      </div>

      <div className="inline-flex rounded-xl border border-[var(--vf-border)] p-1">
        <Button
          size="sm"
          variant={viewMode === "user" ? "primary" : "secondary"}
          onClick={() => {
            setViewMode("user");
            setSelectedGroup(null);
          }}
        >
          By User
        </Button>
        <Button
          size="sm"
          variant={viewMode === "group" ? "primary" : "secondary"}
          onClick={() => {
            setViewMode("group");
            setSelectedClient(null);
          }}
        >
          By Group
        </Button>
      </div>

      {viewMode === "user" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--vf-surface-muted)] text-left">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Present</th>
                  <th className="px-4 py-3">Absent</th>
                  <th className="px-4 py-3">Missed</th>
                  <th className="px-4 py-3">No Show</th>
                  <th className="px-4 py-3">Rate</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading && !clients.length ? (
                  <tr><td className="px-4 py-6" colSpan={8}>Loading…</td></tr>
                ) : null}
                {!loading && !clients.length ? (
                  <tr><td className="px-4 py-6" colSpan={8}>No assigned clients yet.</td></tr>
                ) : null}
                {clients.map((row) => (
                  <tr key={row.clientId} className="border-t border-[var(--vf-border)]">
                    <td className="px-4 py-3 font-medium">
                      {row.client?.full_name || row.client?.username || "—"}
                    </td>
                    <td className="px-4 py-3">{row.stats?.total ?? 0}</td>
                    <td className="px-4 py-3">{row.stats?.present ?? 0}</td>
                    <td className="px-4 py-3">{row.stats?.absent ?? 0}</td>
                    <td className="px-4 py-3">{row.stats?.missed ?? 0}</td>
                    <td className="px-4 py-3">{row.stats?.no_show ?? 0}</td>
                    <td className="px-4 py-3">{row.stats?.attendancePercentage ?? 0}%</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => openClient(row)}>
                        View Attendance →
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[var(--vf-surface-muted)] text-left">
                <tr>
                  <th className="px-4 py-3">Group</th>
                  <th className="px-4 py-3">Members</th>
                  <th className="px-4 py-3">Present</th>
                  <th className="px-4 py-3">Absent</th>
                  <th className="px-4 py-3">No Show</th>
                  <th className="px-4 py-3">Rate</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading && !groups.length ? (
                  <tr><td className="px-4 py-6" colSpan={7}>Loading…</td></tr>
                ) : null}
                {!loading && !groups.length ? (
                  <tr><td className="px-4 py-6" colSpan={7}>No groups yet.</td></tr>
                ) : null}
                {groups.map((row) => (
                  <tr key={row.groupId} className="border-t border-[var(--vf-border)]">
                    <td className="px-4 py-3 font-medium">{row.group?.title || "—"}</td>
                    <td className="px-4 py-3">{row.stats?.totalMembers ?? 0}</td>
                    <td className="px-4 py-3">{row.stats?.present ?? 0}</td>
                    <td className="px-4 py-3">{row.stats?.absent ?? 0}</td>
                    <td className="px-4 py-3">{row.stats?.no_show ?? 0}</td>
                    <td className="px-4 py-3">{row.stats?.attendancePercentage ?? 0}%</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => openGroup(row)}>
                        View Group Attendance →
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(selectedClient || selectedGroup) ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{detailTitle}</h2>
              <p className="text-sm text-[var(--vf-muted)]">
                {selectedGroup
                  ? `${detailStats.totalMembers ?? 0} Members → ${detailStats.present ?? 0} Present → ${detailStats.absent ?? 0} Absent`
                  : `Total ${detailStats.total ?? 0} · Present ${detailStats.present ?? 0} · Absent ${detailStats.absent ?? 0} · ${detailStats.attendancePercentage ?? 0}%`}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSelectedClient(null);
                setSelectedGroup(null);
                setDetailItems([]);
              }}
            >
              Close
            </Button>
          </div>
          {detailLoading ? <p className="text-sm">Loading…</p> : null}
          {!detailLoading && !detailItems.length ? (
            <p className="text-sm text-[var(--vf-muted)]">No attendance records.</p>
          ) : null}
          <div className="divide-y divide-[var(--vf-border)]">
            {detailItems.map((row) => (
              <div key={row._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">
                    {selectedGroup
                      ? (row.user?.full_name || row.user?.username || "Member")
                      : String(row.type || "").toUpperCase()}
                  </p>
                  <p className="text-xs text-[var(--vf-muted)]">
                    {row.date ? new Date(row.date).toLocaleDateString() : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                  <select
                    className="rounded-lg border border-[var(--vf-border)] bg-transparent px-2 py-1"
                    value={row.status}
                    onChange={(e) => updateStatus(row._id, e.target.value)}
                  >
                    {statusesForType(row.type).map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--vf-border)] px-4 py-3 font-semibold">Recent history</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--vf-surface-muted)] text-left">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Update</th>
              </tr>
            </thead>
            <tbody>
              {loading && !items.length ? (
                <tr><td className="px-4 py-6" colSpan={5}>Loading…</td></tr>
              ) : null}
              {!loading && !items.length ? (
                <tr><td className="px-4 py-6" colSpan={5}>No attendance records yet.</td></tr>
              ) : null}
              {items.map((row) => (
                <tr key={row._id} className="border-t border-[var(--vf-border)]">
                  <td className="px-4 py-3">{row.user?.full_name || row.user?.username || "—"}</td>
                  <td className="px-4 py-3 capitalize">{row.type}</td>
                  <td className="px-4 py-3">{row.date ? new Date(row.date).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(row.status)}>{row.status}</Badge></td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded-lg border border-[var(--vf-border)] bg-transparent px-2 py-1"
                      value={row.status}
                      onChange={(e) => updateStatus(row._id, e.target.value)}
                    >
                      {statusesForType(row.type).map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
