import { Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "../../api/client";
import { getCoachClientDetail, getCoachClients } from "../../api/coachApi";
import {
  approveCoachRequest,
  getCoachIncomingRequestDetail,
  getCoachIncomingRequests,
  rejectCoachRequest,
} from "../../api/memberApi";
import { Badge, Button, Card, Modal } from "../../components/ui";
import { fitnessGoalLabel } from "../../utils/coachSpecialization";
import { formatWhen } from "./roleHelpers";

function activityLevelLabel(level) {
  switch (level) {
    case "sedentary":
      return "Sedentary";
    case "moderate":
      return "Moderate";
    case "active":
      return "Active";
    default:
      return level || "";
  }
}

function displayValue(value, suffix = "") {
  if (value === null || value === undefined) return "Not specified";
  const text = String(value).trim();
  if (!text) return "Not specified";
  return suffix ? `${text}${suffix}` : text;
}

function requesterFields(user = {}) {
  const clientData = user.clientData || {};
  const profile = user.profile || {};
  const fitnessGoal =
    fitnessGoalLabel(user.fitness_goal || user.fitnessGoal || clientData.fitness_goal) ||
    "";
  const fitnessLevel =
    activityLevelLabel(user.activity_level || user.fitness_level || clientData.activity_level) ||
    user.experience ||
    profile.experience ||
    "";
  const location = user.location || user.region || profile.location || "";
  const age = user.age ?? clientData.age ?? profile.age ?? null;
  const gender = user.gender || clientData.gender || "";
  const height = user.height ?? clientData.height ?? profile.heightCm ?? null;
  const weight = user.weight ?? clientData.weight ?? profile.weightKg ?? null;
  const medicalNotes = user.medical_notes || clientData.medical_notes || "";
  const photo = user.avatar || user.photoUrl || profile.photoUrl || "";
  const name = user.full_name || user.name || user.username || "Member";
  const email = user.email || user.username || "";
  const phone = user.phone || profile.phone || "";

  return {
    name,
    email,
    phone,
    photo,
    fitnessGoal,
    fitnessLevel,
    location,
    age,
    gender,
    height,
    weight,
    medicalNotes,
    goals: Array.isArray(user.goals) ? user.goals : profile.goals || [],
    bio: user.bio || profile.bio || "",
    bmi: user.bmi ?? profile.bmi ?? null,
  };
}

function ClientProfileModal({ open, onClose, clientId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!open || !clientId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    setDetail(null);
    getCoachClientDetail(clientId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  const fields = requesterFields(detail?.user || {});

  const rows = [
    ["Full name", displayValue(fields.name)],
    ["Email", displayValue(fields.email)],
    ["Phone", displayValue(fields.phone)],
    ["Age", displayValue(fields.age)],
    ["Gender", displayValue(fields.gender)],
    ["Height", displayValue(fields.height, " cm")],
    ["Weight", displayValue(fields.weight, " kg")],
    ["Fitness goal", displayValue(fields.fitnessGoal)],
    ["Fitness level", displayValue(fields.fitnessLevel)],
    ["Location / Region", displayValue(fields.location)],
    ["Medical notes", displayValue(fields.medicalNotes)],
  ];

  return (
    <Modal open={open} onClose={onClose} title="Client profile" wide>
      {loading ? <p className="text-sm text-[var(--vf-muted)]">Loading profile…</p> : null}
      {error ? <p className="text-sm text-[var(--vf-danger)]">{error}</p> : null}
      {!loading && !error && detail ? (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            {fields.photo ? (
              <img
                src={fields.photo}
                alt={fields.name}
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--vf-primary)]/15 text-xl font-bold text-[var(--vf-primary)]">
                {(fields.name[0] || "C").toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-lg font-bold">{fields.name}</p>
              {fields.email ? <p className="text-sm text-[var(--vf-muted)]">{fields.email}</p> : null}
              {fields.phone ? <p className="text-sm text-[var(--vf-muted)]">{fields.phone}</p> : null}
            </div>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="rounded-[12px] border border-[var(--vf-border)] px-3 py-2"
              >
                <dt className="text-xs uppercase tracking-wide text-[var(--vf-muted)]">{label}</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--vf-text)]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Modal>
  );
}

function RequestInfoModal({
  open,
  onClose,
  requestId,
  initialRequest,
  busyId,
  onAccept,
  onReject,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState(initialRequest || null);

  useEffect(() => {
    if (!open || !requestId) return undefined;
    let cancelled = false;
    setRequest(initialRequest || null);
    setLoading(true);
    setError("");
    getCoachIncomingRequestDetail(requestId)
      .then((data) => {
        if (!cancelled) setRequest(data);
      })
      .catch((err) => {
        if (!cancelled) {
          if (initialRequest) setRequest(initialRequest);
          else setError(getErrorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Intentionally depend on request id / open only; card payload is a fallback seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestId]);

  const fields = requesterFields(request?.user || {});
  const status = request?.status || "pending";
  const rows = [
    ["Fitness goal", displayValue(fields.fitnessGoal)],
    ["Fitness level", displayValue(fields.fitnessLevel)],
    ["Age", displayValue(fields.age)],
    ["Gender", displayValue(fields.gender)],
    ["Location / Region", displayValue(fields.location)],
    ["Height", displayValue(fields.height, " cm")],
    ["Weight", displayValue(fields.weight, " kg")],
    ["BMI", displayValue(fields.bmi)],
    ["Email", displayValue(fields.email)],
    ["Phone", displayValue(fields.phone)],
    ["Medical notes", displayValue(fields.medicalNotes)],
  ];

  return (
    <Modal open={open} onClose={onClose} title="Member profile" wide>
      {loading && !request ? (
        <p className="text-sm text-[var(--vf-muted)]">Loading member info…</p>
      ) : null}
      {error ? <p className="text-sm text-[var(--vf-danger)]">{error}</p> : null}
      {request ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              {fields.photo ? (
                <img
                  src={fields.photo}
                  alt={fields.name}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--vf-primary)]/15 text-xl font-bold text-[var(--vf-primary)]">
                  {(fields.name[0] || "M").toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-lg font-bold">{fields.name}</p>
                <p className="mt-1 text-sm text-[var(--vf-muted)]">
                  Fitness Goal: <span className="font-semibold text-[var(--vf-text)]">{displayValue(fields.fitnessGoal)}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone="amber">{status === "pending" ? "Pending" : status}</Badge>
                  {fields.location ? <Badge tone="slate">{fields.location}</Badge> : null}
                </div>
              </div>
            </div>
            <p className="text-xs text-[var(--vf-muted)]">
              Requested {formatWhen(request.createdAt) || "—"}
            </p>
          </div>

          {request.message ? (
            <div className="rounded-[12px] border border-[var(--vf-border)] px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-[var(--vf-muted)]">Message</p>
              <p className="mt-1 text-sm italic text-[var(--vf-text)]">“{request.message}”</p>
            </div>
          ) : null}

          <dl className="grid gap-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="rounded-[12px] border border-[var(--vf-border)] px-3 py-2"
              >
                <dt className="text-xs uppercase tracking-wide text-[var(--vf-muted)]">{label}</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--vf-text)]">{value}</dd>
              </div>
            ))}
          </dl>

          {fields.goals?.length ? (
            <div className="rounded-[12px] border border-[var(--vf-border)] px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-[var(--vf-muted)]">Additional goals</p>
              <p className="mt-1 text-sm font-semibold">{fields.goals.join(" · ")}</p>
            </div>
          ) : null}

          {fields.bio ? (
            <div className="rounded-[12px] border border-[var(--vf-border)] px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-[var(--vf-muted)]">About</p>
              <p className="mt-1 text-sm">{fields.bio}</p>
            </div>
          ) : null}

          {status === "pending" ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--vf-border)] pt-4">
              <Button
                size="sm"
                variant="secondary"
                disabled={Boolean(busyId)}
                onClick={() => onReject(requestId)}
              >
                {busyId === `reject-${requestId}` ? "Rejecting…" : "Reject Request"}
              </Button>
              <Button
                size="sm"
                disabled={Boolean(busyId)}
                onClick={() => onAccept(requestId)}
              >
                {busyId === `approve-${requestId}` ? "Accepting…" : "Accept Request"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

export default function CoachClientsPage() {
  const [assignments, setAssignments] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedRequest, setSelectedRequest] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const [clients, pending] = await Promise.all([
        getCoachClients({ light: false }),
        getCoachIncomingRequests().catch(() => []),
      ]);
      setAssignments(Array.isArray(clients) ? clients : []);
      setRequests(Array.isArray(pending) ? pending : []);
    } catch (err) {
      if (!silent) setError(getErrorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (requests.length === 0) return undefined;
    const timer = setInterval(() => load({ silent: true }), 15000);
    return () => clearInterval(timer);
  }, [requests.length, load]);

  async function approve(id) {
    setBusyId(`approve-${id}`);
    setError("");
    setNotice("");
    try {
      await approveCoachRequest(id);
      setRequests((prev) => prev.filter((r) => r._id !== id && r.id !== id));
      setSelectedRequest(null);
      setNotice("Request accepted. The member is now linked to you.");
      void load({ silent: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId("");
    }
  }

  async function reject(id) {
    setBusyId(`reject-${id}`);
    setError("");
    setNotice("");
    try {
      await rejectCoachRequest(id);
      setRequests((prev) => prev.filter((r) => r._id !== id && r.id !== id));
      setSelectedRequest(null);
      setNotice("Request declined. The member can choose another coach.");
      void load({ silent: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <Users className="h-6 w-6 text-[var(--vf-primary)]" />
        <h1 className="mt-4 text-2xl font-bold">My clients</h1>
        <p className="mt-2 text-sm text-[var(--vf-muted)]">
          Review coaching requests and manage members currently linked to you.
        </p>

        {!loading && error ? (
          <div className="mt-5 space-y-2">
            <p className="text-sm text-[var(--vf-danger)]">{error || "Unable to load data"}</p>
            <Button size="sm" variant="secondary" onClick={() => load()}>Retry</Button>
          </div>
        ) : null}
        {notice ? <p className="mt-5 text-sm text-emerald-700">{notice}</p> : null}
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Incoming coach requests</h2>
          <Badge tone="amber">{requests.length} pending</Badge>
        </div>
        <p className="mt-1 text-sm text-[var(--vf-muted)]">
          View member info first, then accept or reject. Opening a profile does not accept the request.
        </p>
        <ul className="mt-4 space-y-2">
          {requests.length === 0 ? (
            <li className="rounded-[12px] border border-[var(--vf-border)] px-3 py-6 text-center text-sm text-[var(--vf-muted)]">
              No pending coaching requests.
            </li>
          ) : (
            requests.map((req) => {
              const id = req.id || req._id;
              const fields = requesterFields(req.user || {});
              return (
                <li
                  key={id}
                  className="rounded-[12px] border border-[var(--vf-border)] px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {fields.photo ? (
                        <img
                          src={fields.photo}
                          alt={fields.name}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--vf-primary)]/15 text-base font-bold text-[var(--vf-primary)]">
                          {(fields.name[0] || "M").toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold">{fields.name}</p>
                        <p className="mt-1 text-sm text-[var(--vf-text)]">
                          Fitness Goal: {displayValue(fields.fitnessGoal)}
                        </p>
                        {fields.location ? (
                          <p className="text-sm text-[var(--vf-muted)]">Location: {fields.location}</p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--vf-muted)]">
                          <Badge tone="amber">Pending</Badge>
                          {fields.age != null ? <span>Age {fields.age}</span> : null}
                          {fields.gender ? <span>{fields.gender}</span> : null}
                          {fields.fitnessLevel ? <span>{fields.fitnessLevel}</span> : null}
                        </div>
                        {req.message ? (
                          <p className="mt-2 text-sm italic text-[var(--vf-muted)]">“{req.message}”</p>
                        ) : null}
                        <p className="mt-1 text-xs text-[var(--vf-muted)]">
                          Requested {formatWhen(req.createdAt) || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={Boolean(busyId)}
                        onClick={() => setSelectedRequest(req)}
                      >
                        View Info
                      </Button>
                      <Button
                        size="sm"
                        disabled={Boolean(busyId)}
                        onClick={() => approve(id)}
                      >
                        {busyId === `approve-${id}` ? "Accepting…" : "Accept"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={Boolean(busyId)}
                        onClick={() => reject(id)}
                      >
                        {busyId === `reject-${id}` ? "Rejecting…" : "Reject"}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </Card>

      <Card className="p-6">
        <h2 className="font-bold">Linked clients</h2>
        <p className="mt-1 text-sm text-[var(--vf-muted)]">
          Members who selected you and whose requests you accepted. Open a profile to review fitness details.
        </p>
        <ul className="mt-4 space-y-2">
          {assignments.length === 0 ? (
            <li className="rounded-[12px] border border-[var(--vf-border)] px-3 py-6 text-center text-sm text-[var(--vf-muted)]">
              No linked clients yet. Members appear here after you accept their coaching request.
            </li>
          ) : (
            assignments.map((a) => {
              const user = a.user || {};
              const clientId = user._id || user.id;
              return (
                <li
                  key={a.id || a._id || clientId}
                  className="rounded-[12px] border border-[var(--vf-border)] px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{user.full_name || user.username || "Client"}</p>
                      <p className="text-xs text-[var(--vf-muted)]">
                        @{user.username || "—"}
                        {user.phone ? ` · ${user.phone}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-[var(--vf-muted)]">
                        Linked {formatWhen(a.assigned_at) || "—"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!clientId}
                      onClick={() => setSelectedClientId(String(clientId))}
                    >
                      View profile
                    </Button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </Card>

      <ClientProfileModal
        open={Boolean(selectedClientId)}
        clientId={selectedClientId}
        onClose={() => setSelectedClientId("")}
      />

      <RequestInfoModal
        open={Boolean(selectedRequest)}
        requestId={selectedRequest?._id || selectedRequest?.id}
        initialRequest={selectedRequest}
        busyId={busyId}
        onClose={() => setSelectedRequest(null)}
        onAccept={approve}
        onReject={reject}
      />
    </div>
  );
}
