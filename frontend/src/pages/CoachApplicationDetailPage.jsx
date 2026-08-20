import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  approveCoachApplication,
  getCoachApplication,
  rejectCoachApplication } from "../api/adminApi";
import { getErrorMessage } from "../api/client";
import CertificateFilesGallery, { pickCertificateFiles } from "../components/CertificateFilesGallery";
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  ErrorState,
  PageHeader,
  useToast } from "../components/ui";
import { formatDate, formatList } from "../utils/profileDisplay";

function applicationStatusTone(status) {
  if (status === "approved") return "green";
  if (status === "rejected") return "red";
  return "amber";
}

function formatDayAvailability(days) {
  if (!Array.isArray(days) || !days.length) return "—";
  return (
    days
      .map((d) => {
        if (!d?.day) return null;
        return `${d.day} ${d.start || ""}–${d.end || ""}`.trim();
      })
      .filter(Boolean)
      .join(", ") || "—"
  );
}

function InfoRow({ label, value }) {
  const display = value == null || value === "" ? "—" : value;
  return (
    <div className="min-w-0">
      <p className="text-xs text-[var(--vf-muted)]">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium text-[var(--vf-text)]">{display}</p>
    </div>
  );
}

export default function CoachApplicationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewing, setReviewing] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await getCoachApplication(id);
      setApp(data);
    } catch (err) {
      setError(getErrorMessage(err));
      setApp(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function approve() {
    if (!app?._id || reviewing) return;
    setReviewing(true);
    try {
      await approveCoachApplication(app._id);
      toast.success("Coach approved — listed under Active Coaches");
      navigate("/coaches?tab=applications&status=approved", { replace: true });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setReviewing(false);
    }
  }

  async function reject() {
    if (!app?._id || reviewing) return;
    const reasonInput = window.prompt(
      "Optional rejection reason (shown to the coach):",
      "",
    );
    if (reasonInput === null) return;
    const reason = String(reasonInput).trim() || "Rejected by admin";
    setReviewing(true);
    try {
      await rejectCoachApplication(app._id, reason);
      toast.warning("Application rejected");
      navigate("/coaches?tab=applications&status=rejected", { replace: true });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setReviewing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-[var(--vf-muted)]">
        Loading application…
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!app) return <ErrorState message="Application not found" onRetry={load} />;

  const displayName =
    app.user?.full_name || app.user?.name || app.user?.username || "Applicant";
  const email = app.user?.username || app.user?.email || "";
  const profile = app.profile || {};
  const certificates = pickCertificateFiles(
    app.certificateFiles,
    profile.certificateFiles,
    app.user?.coachData?.certificateFiles,
  );
  const experienceNotes = String(profile.experience || app.experience || "").trim();
  const yearsValue = profile.yearsExperience ?? app.yearsExperience;
  const yearsLabel =
    yearsValue != null && yearsValue !== ""
      ? `${yearsValue} year${Number(yearsValue) === 1 ? "" : "s"}`
      : null;
  const yearsToken = String(yearsValue ?? "").trim().toLowerCase();
  const notesToken = experienceNotes.replace(/\s+/g, "").toLowerCase();
  const experienceIsRedundant =
    !experienceNotes ||
    notesToken === yearsToken ||
    notesToken === `${yearsToken}yr` ||
    notesToken === `${yearsToken}yrs` ||
    notesToken === `${yearsToken}year` ||
    notesToken === `${yearsToken}years`;
  const showExperienceNotes = Boolean(experienceNotes && !experienceIsRedundant);
  const status = app.status || "pending";
  const backTo = "/coaches?tab=applications";

  return (
    <div>
      <PageHeader
        title={displayName}
        subtitle="Full coach registration application for admin review."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Home", to: "/" },
              { label: "Coaches", to: "/coaches" },
              { label: "Registrations", to: backTo },
              { label: displayName },
            ]}
          />
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Link to={backTo}>
              <Button variant="secondary">Back to registrations</Button>
            </Link>
            {status === "pending" ? (
              <>
                <Button disabled={reviewing} onClick={approve}>
                  {reviewing ? "Working…" : "Approve"}
                </Button>
                <Button variant="danger" disabled={reviewing} onClick={reject}>
                  Reject
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={applicationStatusTone(status)}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
        <span className="text-sm text-[var(--vf-muted)]">
          Applied {formatDate(app.createdAt)}
          {app.reviewedAt ? ` · Reviewed ${formatDate(app.reviewedAt)}` : ""}
        </span>
        {email ? (
          <span className="text-sm text-[var(--vf-muted)]">· {email}</span>
        ) : null}
      </div>

      {status === "rejected" && app.rejectionReason ? (
        <Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Rejection reason</p>
          <p className="mt-1 leading-6">{app.rejectionReason}</p>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-5 xl:col-span-2">
          <h3 className="font-bold text-[var(--vf-text)]">Applicant</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <InfoRow label="First Name" value={app.firstName || displayName.split(/\s+/)[0]} />
            <InfoRow
              label="Last Name"
              value={app.lastName || displayName.split(/\s+/).slice(1).join(" ")}
            />
            <InfoRow label="Registration status" value={status} />
          </div>
        </Card>

        <Card className="p-5 xl:col-span-2">
          <h3 className="font-bold text-[var(--vf-text)]">Certificates</h3>
          <div className="mt-4">
            <CertificateFilesGallery
              files={certificates}
              title=""
              showTitleWhenEmpty
              emptyLabel="No certificate files on this application. Ask the coach to re-upload before approving."
            />
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-bold text-[var(--vf-text)]">Contact</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <InfoRow label="Phone" value={profile.phone || app.phone} />
            <InfoRow label="Region / Gobol" value={profile.location || app.location} />
            <InfoRow label="Age" value={profile.age ?? app.age} />
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-bold text-[var(--vf-text)]">Professional</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <InfoRow label="Years of experience" value={yearsLabel} />
            <InfoRow
              label="Certifications"
              value={profile.certifications || app.certifications}
            />
            <InfoRow
              label="Specialization"
              value={
                formatList(profile.specialization) !== "—"
                  ? formatList(profile.specialization)
                  : app.specialization
              }
            />
            {showExperienceNotes ? (
              <InfoRow label="Experience notes" value={experienceNotes} />
            ) : null}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-bold text-[var(--vf-text)]">Schedule</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <InfoRow label="Working days" value={formatList(profile.workingDays || app.workingDays)} />
            <InfoRow
              label="Appointment days"
              value={formatList(profile.appointmentDays || app.appointmentDays)}
            />
            <InfoRow
              label="Day availability"
              value={formatDayAvailability(profile.dayAvailability || app.dayAvailability)}
            />
            <InfoRow
              label="Appointment duration"
              value={
                (profile.appointmentDurationMinutes ?? app.appointmentDurationMinutes) != null
                  ? `${profile.appointmentDurationMinutes ?? app.appointmentDurationMinutes} min`
                  : null
              }
            />
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-bold text-[var(--vf-text)]">About</h3>
          <div className="mt-4 grid gap-4">
            <InfoRow label="Bio" value={profile.bio || app.bio} />
            <InfoRow label="Application message" value={app.message} />
          </div>
        </Card>
      </div>

      {status === "pending" ? (
        <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-[var(--vf-border)] pt-4">
          <Link to={backTo}>
            <Button variant="secondary">Close</Button>
          </Link>
          <Button disabled={reviewing} onClick={approve}>
            {reviewing ? "Working…" : "Approve"}
          </Button>
          <Button variant="danger" disabled={reviewing} onClick={reject}>
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}
