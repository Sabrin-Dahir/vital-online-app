import { CalendarDays } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  approveCoachAppointment,
  cancelCoachAppointment,
  completeCoachAppointment,
  createCoachAppointment,
  getCoachAppointments,
  getCoachClients } from "../../api/coachApi";
import { getErrorMessage, withHardTimeout } from "../../api/client";
import { Badge, Button, Card, useToast } from "../../components/ui";
import { fieldClass, formatWhen } from "./roleHelpers";

const toneForStatus = {
  pending: "amber",
  approved: "green",
  completed: "blue",
  rejected: "red",
  cancelled: "red",
  rescheduled: "amber" };

function toLocalInputValue(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function CoachAppointmentsPage() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const preselectedClient = searchParams.get("client") || "";

  const [appointments, setAppointments] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [form, setForm] = useState({
    clientId: preselectedClient,
    dateTime: toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)),
    durationMinutes: "60",
    notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appts, clientRows] = await withHardTimeout(
        Promise.all([
          getCoachAppointments().catch(() => []),
          getCoachClients({ light: true }).catch(() => []),
        ]),
      );
      setAppointments(Array.isArray(appts) ? appts : []);
      setClients(Array.isArray(clientRows) ? clientRows : []);
    } catch (error) {
      toast.error(getErrorMessage(error));
      setAppointments([]);
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (preselectedClient) {
      setForm((current) => ({ ...current, clientId: preselectedClient }));
    }
  }, [preselectedClient]);

  const clientOptions = useMemo(
    () =>
      clients
        .map((row) => row.user || row)
        .filter((u) => u?._id)
        .map((u) => ({
          id: u._id,
          label: `${u.full_name || u.username || "Client"} (@${u.username || "—"})` })),
    [clients],
  );

  async function submit(event) {
    event.preventDefault();
    if (!form.clientId) {
      toast.error("Select a client");
      return;
    }
    if (!form.dateTime) {
      toast.error("Pick a date and time");
      return;
    }
    const when = new Date(form.dateTime);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      toast.error("Appointment must be scheduled in the future");
      return;
    }
    const duration = Number(form.durationMinutes);
    if (!Number.isFinite(duration) || duration < 5 || duration > 240) {
      toast.error("Appointment duration must be between 5 and 240 minutes");
      return;
    }
    setSaving(true);
    try {
      await createCoachAppointment({
        clientId: form.clientId,
        dateTime: when.toISOString(),
        durationMinutes: duration,
        notes: form.notes.trim(),
        timezoneOffsetMinutes: -when.getTimezoneOffset(),
      });
      toast.success("Appointment scheduled with client");
      setForm((current) => ({
        ...current,
        notes: "",
        dateTime: toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)) }));
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function runAction(id, action) {
    setBusyId(id);
    try {
      if (action === "complete") await completeCoachAppointment(id);
      if (action === "cancel") await cancelCoachAppointment(id);
      if (action === "approve") await approveCoachAppointment(id);
      const nextStatus =
        action === "complete" ? "completed" : action === "cancel" ? "cancelled" : action === "approve" ? "approved" : null;
      if (nextStatus) {
        setAppointments((prev) =>
          prev.map((a) => (a._id === id || a.id === id ? { ...a, status: nextStatus } : a)),
        );
      }
      toast.success("Appointment updated");
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      <Card className="p-6">
        <CalendarDays className="h-6 w-6 text-[var(--vf-primary)]" />
        <h1 className="mt-4 text-2xl font-bold">Schedule appointment</h1>
        <p className="mt-2 text-sm text-[var(--vf-muted)]">
          Book a session with one of your assigned clients. They will get a notification.
        </p>
        {clientOptions.length === 0 && !loading ? (
          <p className="mt-4 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No clients linked yet. Members appear after you accept their coaching request from My clients.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="block text-sm md:col-span-2">
              Client
              <select
                value={form.clientId}
                onChange={(e) => setForm((c) => ({ ...c, clientId: e.target.value }))}
                className={fieldClass}
                required
              >
                <option value="">Select client</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Date & time
              <input
                type="datetime-local"
                value={form.dateTime}
                onChange={(e) => setForm((c) => ({ ...c, dateTime: e.target.value }))}
                className={fieldClass}
                required
              />
            </label>
            <label className="block text-sm">
              Duration (minutes)
              <input
                type="number"
                min="5"
                max="240"
                step="5"
                value={form.durationMinutes}
                onChange={(e) => setForm((c) => ({ ...c, durationMinutes: e.target.value }))}
                className={fieldClass}
                required
              />
            </label>
            <label className="block text-sm md:col-span-2">
              Notes (optional)
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))}
                className={fieldClass}
                placeholder="Focus for this session…"
              />
            </label>
            <div className="md:col-span-2">
              <Button type="submit" disabled={saving || clientOptions.length === 0}>
                {"Create appointment"}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="mt-5 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Your appointments</h2>
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
            {"Refresh"}
          </Button>
        </div>
        <ul className="mt-4 space-y-2">
            {appointments.length === 0 ? (
              <li className="rounded-[12px] border border-[var(--vf-border)] px-3 py-6 text-center text-sm text-[var(--vf-muted)]">
                No appointments yet. Schedule one above.
              </li>
            ) : (
              appointments.map((a) => {
                const client = a.client || {};
                return (
                  <li key={a._id} className="rounded-[12px] border border-[var(--vf-border)] px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {client.full_name || client.username || client.name || "Client"}
                        </p>
                        <p className="text-xs text-[var(--vf-muted)]">
                          @{client.username || "—"} · {formatWhen(a.dateTime || a.datetime)}
                          {a.durationMinutes ? ` · ${a.durationMinutes} min` : ""}
                        </p>
                        {a.notes ? <p className="mt-1 text-sm text-[var(--vf-muted)]">{a.notes}</p> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={toneForStatus[a.status] || "amber"}>{a.status}</Badge>
                        {a.status === "pending" ? (
                          <Button size="sm" disabled={busyId === a._id} onClick={() => runAction(a._id, "approve")}>
                            Approve
                          </Button>
                        ) : null}
                        {["pending", "approved", "rescheduled"].includes(a.status) ? (
                          <>
                            <Button size="sm" variant="secondary" disabled={busyId === a._id} onClick={() => runAction(a._id, "complete")}>
                              Complete
                            </Button>
                            <Button size="sm" variant="danger" disabled={busyId === a._id} onClick={() => runAction(a._id, "cancel")}>
                              Cancel
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
      </Card>
    </>
  );
}
