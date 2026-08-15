import { UserRoundSearch } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getErrorMessage } from "../../api/client";
import {
  cancelCoachRequest,
  getMemberCoaching,
  getMemberTrainers,
  getMyCoachRequest,
  submitCoachRequest } from "../../api/memberApi";
import CertificateFilesGallery, { pickCertificateFiles } from "../../components/CertificateFilesGallery";
import ProfileDetails from "../../components/ProfileDetails";
import { Badge, Button, Card, Modal } from "../../components/ui";
import { coachDisplayName, coachProfileFromUser } from "../../utils/coachDisplay";
import { isSelectableCoach } from "../../utils/coachVisibility";
import {
  coachMatchesFitnessGoal,
  fitnessGoalLabel,
  normalizeFitnessGoal,
} from "../../utils/coachSpecialization";
import { useAuth } from "../../auth/AuthContext";

function specializationLabel(coach) {
  const profile = coachProfileFromUser(coach);
  const specs = profile.specialization || [];
  return specs.length ? specs.join(", ") : "General coaching";
}

export default function MemberCoachesPage() {
  const { user } = useAuth();
  const [coaches, setCoaches] = useState([]);
  const [coaching, setCoaching] = useState(null);
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detailCoach, setDetailCoach] = useState(null);

  const fitnessGoal = normalizeFitnessGoal(user?.clientData?.fitness_goal);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const [trainers, assignment, myRequest] = await Promise.all([
        getMemberTrainers().catch(() => []),
        getMemberCoaching().catch(() => null),
        getMyCoachRequest().catch(() => null),
      ]);
      setCoaches(
        (Array.isArray(trainers) ? trainers : [])
          .filter(isSelectableCoach)
          .filter((coach) => !fitnessGoal || coachMatchesFitnessGoal(coach, fitnessGoal)),
      );
      setCoaching(assignment || null);
      setRequest(myRequest || null);
    } catch (err) {
      if (!silent) setError(getErrorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [fitnessGoal]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (request?.status !== "pending") return undefined;
    const timer = setInterval(() => {
      load({ silent: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [request?.status, load]);

  const pending = request?.status === "pending";
  const rejected = request?.status === "rejected";
  const assignedCoach = coaching?.coach || null;
  const pendingCoach = pending ? request?.coach : null;
  const canBrowse = !assignedCoach && !pending;

  const pendingCoachName = useMemo(
    () => coachDisplayName(pendingCoach || request?.coach),
    [pendingCoach, request],
  );

  async function requestCoach(coachId) {
    setBusyId(coachId);
    setError("");
    setNotice("");
    try {
      if (!fitnessGoal) {
        setError("Set your fitness goal before requesting a coach.");
        return;
      }
      const coach = coaches.find((c) => String(c._id) === String(coachId));
      if (coach && !coachMatchesFitnessGoal(coach, fitnessGoal)) {
        setError("Request rejected: Coach specialization does not match the client's fitness goal.");
        return;
      }
      const created = await submitCoachRequest(coachId);
      setRequest(created || { status: "pending", coach: coaches.find((c) => c._id === coachId) });
      setNotice("Request sent. Status: Pending Coach Approval.");
      void load({ silent: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId("");
    }
  }

  async function withdrawRequest() {
    setBusyId("withdraw");
    setError("");
    setNotice("");
    try {
      await cancelCoachRequest();
      setRequest(null);
      setNotice("Request withdrawn. You can choose a different coach.");
      void load({ silent: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      <Card className="p-6">
        <UserRoundSearch className="h-6 w-6 text-[var(--vf-primary)]" />
        <h1 className="mt-4 text-2xl font-bold">Coaches</h1>
        <p className="mt-2 text-sm text-[var(--vf-muted)]">
          Browse active coaches and send a request to the coach you want. You are linked only after they accept.
        </p>
        {fitnessGoal ? (
          <p className="mt-3 text-sm font-medium text-[var(--vf-text)]">
            Showing coaches for your fitness goal: {fitnessGoalLabel(fitnessGoal)}
          </p>
        ) : (
          <p className="mt-3 text-sm text-amber-700">
            Set your fitness goal in your profile to see matching coaches.
          </p>
        )}
      </Card>

      
      {!loading && error ? (
        <div className="mt-5 space-y-2">
          <p className="text-sm text-[var(--vf-danger)]">{error || "Unable to load data"}</p>
          <Button size="sm" variant="secondary" onClick={() => load()}>Retry</Button>
        </div>
      ) : null}
      {notice ? <p className="mt-5 text-sm text-emerald-700">{notice}</p> : null}

      <div className="mt-5 space-y-4">
          {assignedCoach ? (
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold">Your coach</h2>
                <Badge tone="green">Linked</Badge>
              </div>
              <p className="mt-2 text-lg font-semibold">{coachDisplayName(assignedCoach)}</p>
              <p className="mt-1 text-sm text-[var(--vf-muted)]">{specializationLabel(assignedCoach)}</p>
              <p className="mt-3 text-sm text-[var(--vf-muted)]">
                Coach-related features are now available for your account.
              </p>
              <div className="mt-4">
                <Button size="sm" variant="secondary" onClick={() => setDetailCoach(assignedCoach)}>
                  View profile &amp; certificates
                </Button>
              </div>
            </Card>
          ) : null}

          {pending ? (
            <Card className="border-amber-200 bg-amber-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-bold text-amber-950">Pending Coach Approval</h2>
                <Badge tone="amber">Pending Coach Approval</Badge>
              </div>
              <p className="mt-2 text-sm text-amber-900">
                Your request to <strong>{pendingCoachName}</strong> is pending their review.
                You can withdraw it if you want to choose someone else.
              </p>
              <div className="mt-4">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === "withdraw"}
                  onClick={withdrawRequest}
                >
                  {busyId === "withdraw" ? "Withdrawing…" : "Choose a different coach"}
                </Button>
              </div>
            </Card>
          ) : null}

          {rejected && canBrowse ? (
            <Card className="border-rose-200 bg-rose-50 p-5">
              <h2 className="font-bold text-rose-950">Request not accepted</h2>
              <p className="mt-2 text-sm text-rose-900">
                Your request to <strong>{coachDisplayName(request?.coach)}</strong> was not
                accepted. Choose a different active coach below.
              </p>
            </Card>
          ) : null}

          {canBrowse ? (
            <Card className="p-5">
              <h2 className="font-bold">Active coaches</h2>
              <p className="mt-1 text-sm text-[var(--vf-muted)]">
                Select your preferred coach to send a coaching request.
              </p>
              <ul className="mt-4 space-y-2">
                {coaches.length === 0 ? (
                  <li className="rounded-[12px] border border-[var(--vf-border)] px-3 py-6 text-center text-sm text-[var(--vf-muted)]">
                    No active coaches are available right now.
                  </li>
                ) : (
                  coaches.map((coach) => {
                    const id = coach.id || coach._id;
                    return (
                      <li
                        key={id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--vf-border)] px-4 py-3"
                      >
                        <div>
                          <p className="font-semibold">{coachDisplayName(coach)}</p>
                          <p className="text-xs text-[var(--vf-muted)]">{specializationLabel(coach)}</p>
                          {coach.profile?.location || coach.coachData?.location ? (
                            <p className="mt-1 text-xs text-[var(--vf-muted)]">
                              {coach.profile?.location || coach.coachData?.location}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDetailCoach(coach)}
                          >
                            View profile
                          </Button>
                          <Button
                            size="sm"
                            disabled={Boolean(busyId)}
                            onClick={() => requestCoach(id)}
                          >
                            {"Request coach"}
                          </Button>
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </Card>
          ) : null}
        </div>

      {detailCoach ? (
        <Modal
          open
          title={coachDisplayName(detailCoach)}
          onClose={() => setDetailCoach(null)}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetailCoach(null)}>
                Close
              </Button>
              {canBrowse ? (
                <Button
                  disabled={Boolean(busyId)}
                  onClick={() => {
                    const id = detailCoach.id || detailCoach._id;
                    setDetailCoach(null);
                    requestCoach(id);
                  }}
                >
                  Request coach
                </Button>
              ) : null}
            </div>
          }
        >
          <div className="space-y-4">
            <ProfileDetails profile={coachProfileFromUser(detailCoach)} />
            <CertificateFilesGallery
              files={pickCertificateFiles(
                detailCoach.profile?.certificateFiles,
                detailCoach.coachData?.certificateFiles,
              )}
              emptyLabel="This coach has not uploaded certificate files yet."
            />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
