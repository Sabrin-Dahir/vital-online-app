import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { UserRound } from "lucide-react";
import {
  approveCoachApplication,
  deleteCoach,
  getCoachApplications,
  getTrainersMeta,
  rejectCoachApplication } from "../api/adminApi";
import { getErrorMessage, withHardTimeout } from "../api/client";
import { formatDate, formatList } from "../utils/profileDisplay";
import { coachDisplayEmail, coachDisplayName, coachProfileFromUser } from "../utils/coachDisplay";
import {
  Badge,
  Breadcrumbs,
  Button,
  DataTable,
  ErrorState,
  Modal,
  PageHeader,
  useToast } from "../components/ui";

function approvalOf(coach) {
  return (
    coach?.approval_status ||
    coach?.applicationStatus ||
    coach?.coachData?.approval_status ||
    null
  );
}

function isApprovedCoach(coach) {
  if (!coach) return false;
  if (coach.role && coach.role !== "coach") return false;
  if (["suspended", "deleted", "pending"].includes(String(coach.status || ""))) {
    return false;
  }
  const approval = approvalOf(coach);
  return approval === "approved" || approval == null;
}

function specializationLabel(coach) {
  const fromSpecialties = coach.coachData?.specialties || coach.profile?.specializations;
  if (Array.isArray(fromSpecialties) && fromSpecialties.length) {
    return formatList(fromSpecialties);
  }
  const fromRow = coach.specialization;
  if (Array.isArray(fromRow) && fromRow.length) return formatList(fromRow);
  if (typeof fromRow === "string" && fromRow.trim()) return fromRow;
  const profile = coachProfileFromUser(coach);
  return formatList(profile.specialization) || "—";
}

function photoUrl(coach) {
  return (
    coach.photoUrl ||
    coach.avatar ||
    coachProfileFromUser(coach).photoUrl ||
    ""
  );
}

export default function CoachesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = ["all", "applications", "coaches"].includes(searchParams.get("tab"))
    ? searchParams.get("tab")
    : "all";
  const [tab, setTabState] = useState(initialTab);
  const [reviewingId, setReviewingId] = useState(null);
  const [allCoaches, setAllCoaches] = useState([]);
  const [allApplications, setAllApplications] = useState([]);
  const [applicationFilter, setApplicationFilter] = useState(
    searchParams.get("status") || "all",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function setTab(next) {
    setTabState(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  }

  function removeCoachFromLists(deletedId) {
    const id = String(deletedId);
    setAllCoaches((prev) => prev.filter((c) => String(c._id) !== id));
    setAllApplications((prev) =>
      prev.filter((a) => {
        const userId = a.user?._id ?? a.user;
        return String(userId) !== id;
      }),
    );
  }

  async function confirmDeleteCoach() {
    if (!pendingDelete?._id || deleting) return;
    setDeleting(true);
    const deletedId = pendingDelete._id;
    const name = coachDisplayName(pendingDelete);
    try {
      await deleteCoach(deletedId);
      removeCoachFromLists(deletedId);
      setPendingDelete(null);
      toast.success(`${name} has been permanently deleted`);
      void load({ silent: true });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  async function load({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const [trainers, appsResult] = await withHardTimeout(
        Promise.all([
          getTrainersMeta().catch(() => ({ items: [] })),
          getCoachApplications("all").catch(() => []),
        ]),
      );
      const items = Array.isArray(trainers?.items) ? trainers.items : [];
      setAllCoaches(items);
      const apps = Array.isArray(appsResult) ? appsResult : [];
      setAllApplications(apps);
    } catch (err) {
      if (!silent) {
        setError(getErrorMessage(err));
        setAllCoaches([]);
        setAllApplications([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Keep dashboard in sync when new coaches register or applications change.
  useEffect(() => {
    const timer = setInterval(() => load({ silent: true }), 12000);
    const onFocus = () => load({ silent: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const activeCoaches = useMemo(
    () => allCoaches.filter(isApprovedCoach),
    [allCoaches],
  );

  const applicationCounts = useMemo(
    () => ({
      all: allApplications.length,
      pending: allApplications.filter((a) => a.status === "pending").length,
      approved: allApplications.filter((a) => a.status === "approved").length,
      rejected: allApplications.filter((a) => a.status === "rejected").length }),
    [allApplications],
  );

  const filteredApplications = useMemo(() => {
    if (applicationFilter === "all") return allApplications;
    return allApplications.filter((a) => a.status === applicationFilter);
  }, [allApplications, applicationFilter]);

  function applicationStatusTone(status) {
    if (status === "approved") return "green";
    if (status === "rejected") return "red";
    return "amber";
  }

  function applicationDisplayName(app) {
    return (
      app.user?.full_name ||
      app.user?.name ||
      app.user?.username ||
      "Applicant"
    );
  }

  function applicationProfile(app) {
    return (
      app.profile || {
        phone: app.phone,
        location: app.location,
        age: app.age,
        yearsExperience: app.yearsExperience,
        certifications: app.certifications,
        specialization: app.specialization,
        bio: app.bio,
        experience: app.experience,
        workingDays: app.workingDays,
        appointmentDays: app.appointmentDays,
        dayAvailability: app.dayAvailability,
        appointmentDurationMinutes: app.appointmentDurationMinutes }
    );
  }

  const applicationColumns = useMemo(
    () => [
      {
        key: "applicant",
        header: "Applicant",
        sortable: true,
        render: (row) => {
          const name = applicationDisplayName(row);
          const email = row.user?.username || row.user?.email || "";
          return (
            <div>
              <p className="font-semibold text-[var(--vf-text)]">{name}</p>
              <p className="text-xs text-[var(--vf-muted)]">{email || "—"}</p>
            </div>
          );
        } },
      {
        key: "specialization",
        header: "Specialization",
        render: (row) =>
          row.specialization || formatList(applicationProfile(row).specialization) || "—" },
      {
        key: "location",
        header: "Region / Gobol",
        render: (row) => row.location || applicationProfile(row).location || "—" },
      {
        key: "status",
        header: "Status",
        sortable: true,
        render: (row) => (
          <Badge tone={applicationStatusTone(row.status)}>
            {(row.status || "pending").charAt(0).toUpperCase() +
              (row.status || "pending").slice(1)}
          </Badge>
        ) },
      {
        key: "createdAt",
        header: "Applied",
        sortable: true,
        render: (row) => formatDate(row.createdAt) },
      {
        key: "reviewedAt",
        header: "Reviewed",
        sortable: true,
        render: (row) => (row.reviewedAt ? formatDate(row.reviewedAt) : "—") },
      {
        key: "actions",
        header: "",
        render: (row) => (
          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Link to={`/coaches/applications/${row._id}`}>
              <Button size="sm" variant="secondary">
                View
              </Button>
            </Link>
            {row.status === "pending" ? (
              <>
                <Button
                  size="sm"
                  disabled={Boolean(reviewingId) || deleting}
                  onClick={() => approve(row._id)}
                >
                  {reviewingId === row._id ? "Approving…" : "Approve"}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={Boolean(reviewingId) || deleting}
                  onClick={() => reject(row._id)}
                >
                  Reject
                </Button>
              </>
            ) : null}
          </div>
        ) },
    ],
    [deleting, reviewingId],
  );

  const columns = useMemo(
    () => [
      {
        key: "full_name",
        header: "Coach",
        sortable: true,
        render: (row) => {
          const name = coachDisplayName(row);
          const email = coachDisplayEmail(row);
          const photo = photoUrl(row);
          return (
            <div className="flex items-center gap-3">
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--vf-surface-muted)] text-sm font-bold text-[var(--vf-primary)]">
                  {(name || "?").charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <p className="font-semibold text-[var(--vf-text)]">{name}</p>
                <p className="text-xs text-[var(--vf-muted)]">{email || "—"}</p>
              </div>
            </div>
          );
        } },
      {
        key: "status",
        header: "Account",
        sortable: true,
        render: (row) => (
          <Badge tone={row.status === "active" ? "green" : "amber"}>
            {row.status || "—"}
          </Badge>
        ) },
      {
        key: "approval_status",
        header: "Approval",
        sortable: true,
        render: (row) => {
          const approval = approvalOf(row);
          const tone =
            approval === "approved" ? "green" : approval === "pending" ? "amber" : "red";
          return <Badge tone={tone}>{approval}</Badge>;
        } },
      {
        key: "phone",
        header: "Phone",
        render: (row) => row.phone || coachProfileFromUser(row).phone || "—" },
      {
        key: "specialization",
        header: "Specialization",
        render: (row) => specializationLabel(row) },
      {
        key: "location",
        header: "Region / Gobol",
        render: (row) =>
          row.profile?.location
          || row.coachData?.location
          || coachProfileFromUser(row).location
          || "—" },
      {
        key: "activeClients",
        header: "Linked clients",
        sortable: true,
        render: (row) => row.activeClients ?? 0 },
      {
        key: "createdAt",
        header: "Registered",
        sortable: true,
        render: (row) => formatDate(row.createdAt) },
      {
        key: "actions",
        header: "",
        render: (row) => (
          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {row.role === "coach" ? (
              <Link to={`/coaches/${row._id}`}>
                <Button size="sm" variant="secondary">
                  View
                </Button>
              </Link>
            ) : (
              <span className="text-xs text-[var(--vf-muted)]">Pending approval</span>
            )}
            <Button
              size="sm"
              variant="danger"
              disabled={deleting}
              onClick={() => setPendingDelete(row)}
            >
              Delete
            </Button>
          </div>
        ) },
    ],
    [deleting],
  );

  async function approve(id) {
    if (reviewingId) return;
    setReviewingId(id);
    try {
      await approveCoachApplication(id);
      setAllApplications((prev) =>
        prev.map((a) =>
          a._id === id || a.id === id ? { ...a, status: "approved" } : a,
        ),
      );
      toast.success("Coach approved — now listed under Active Coaches");
      setTab("applications");
      setApplicationFilter("approved");
      void load({ silent: true });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setReviewingId(null);
    }
  }

  async function reject(id) {
    if (reviewingId) return;
    const reasonInput = window.prompt(
      "Optional rejection reason (shown to the coach):",
      "",
    );
    if (reasonInput === null) return;
    const reason = String(reasonInput).trim() || "Rejected by admin";
    setReviewingId(id);
    try {
      await rejectCoachApplication(id, reason);
      setAllApplications((prev) =>
        prev.map((a) =>
          a._id === id || a.id === id ? { ...a, status: "rejected", rejectionReason: reason } : a,
        ),
      );
      toast.warning("Application rejected");
      setTab("applications");
      setApplicationFilter("rejected");
      void load({ silent: true });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setReviewingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Coaches"
        subtitle="Register coaches, approve or reject applications, and permanently delete coach accounts when needed."
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Home", to: "/" }, { label: "Coaches" }]}
          />
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate("/coaches/register")}>Register coach</Button>
            <Button
              variant={tab === "all" ? "primary" : "secondary"}
              onClick={() => setTab("all")}
            >
              All Coaches ({allCoaches.length})
            </Button>
            <Button
              variant={tab === "applications" ? "primary" : "secondary"}
              onClick={() => setTab("applications")}
            >
              Registrations ({applicationCounts.all})
            </Button>
            <Button
              variant={tab === "coaches" ? "primary" : "secondary"}
              onClick={() => setTab("coaches")}
            >
              Active Coaches ({activeCoaches.length})
            </Button>
          </div>
        }
      />

      
      {error ? <ErrorState message={error} onRetry={() => load()} /> : null}

      {!loading && !error && tab === "all" ? (
        <>
          <p className="mb-4 text-sm text-[var(--vf-muted)]">
            Every coach account and pending applicant from the database. Approve actions are only on Applications.
          </p>
          <DataTable
            columns={columns}
            rows={allCoaches}
            searchKeys={[
              "full_name",
              "username",
              "phone",
              "coachData.bio",
              "coachData.specialties",
            ]}
            searchPlaceholder="Search all coaches…"
            pageSize={0}
            pageSizeOptions={[10, 25, 50, 0]}
            emptyIcon={UserRound}
            emptyTitle="No coaches found in the database"
          />
        </>
      ) : null}

      {!loading && !error && tab === "applications" ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {[
              ["all", "All", applicationCounts.all],
              ["pending", "Pending", applicationCounts.pending],
              ["approved", "Approved", applicationCounts.approved],
              ["rejected", "Rejected", applicationCounts.rejected],
            ].map(([key, label, count]) => (
              <Button
                key={key}
                size="sm"
                variant={applicationFilter === key ? "primary" : "secondary"}
                onClick={() => setApplicationFilter(key)}
              >
                {label} ({count})
              </Button>
            ))}
          </div>
          <p className="mb-4 text-sm text-[var(--vf-muted)]">
            All coach registration requests from the database. Approve or reject pending
            applications; approved and rejected history stays visible here. The list refreshes
            automatically every 12 seconds.
          </p>
          <DataTable
            columns={applicationColumns}
            rows={filteredApplications}
            searchKeys={[
              "user.full_name",
              "user.username",
              "specialization",
              "phone",
              "location",
            ]}
            searchPlaceholder="Search registration requests…"
            pageSize={10}
            pageSizeOptions={[10, 25, 50, 0]}
            emptyIcon={UserRound}
            emptyTitle={
              applicationFilter === "all"
                ? "No coach registration requests yet"
                : `No ${applicationFilter} registration requests`
            }
          />
        </>
      ) : null}

      {!loading && !error && tab === "coaches" ? (
        <>
          <p className="mb-4 text-sm text-[var(--vf-muted)]">
            Approved coaches only. Members can browse this list and send coaching requests.
          </p>
          <DataTable
            columns={columns}
            rows={activeCoaches}
            searchKeys={[
              "full_name",
              "username",
              "phone",
              "coachData.bio",
              "coachData.specialties",
            ]}
            searchPlaceholder="Search active coaches…"
            pageSize={0}
            pageSizeOptions={[10, 25, 50, 0]}
            emptyIcon={UserRound}
            emptyTitle="No approved coaches yet"
          />
        </>
      ) : null}

      <Modal
        open={Boolean(pendingDelete)}
        title="Delete coach?"
        onClose={() => (!deleting ? setPendingDelete(null) : null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </Button>
            <Button variant="danger" disabled={deleting} onClick={confirmDeleteCoach}>
              {"Delete permanently"}
            </Button>
          </div>
        }
      >
        {pendingDelete ? (
          <div className="space-y-3 text-sm">
            <p>
              Are you sure you want to delete this coach? Permanently delete{" "}
              <strong>{coachDisplayName(pendingDelete)}</strong>?
            </p>
            <p className="rounded-[12px] border border-amber-200 bg-amber-50 p-3 text-amber-900">
              This removes the coach account and all related coach data from the
              database. This cannot be undone.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
