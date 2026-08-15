import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users } from "lucide-react";
import { deleteUser, getUsersMeta } from "../api/adminApi";
import { getErrorMessage } from "../api/client";
import useStableFetch from "../hooks/useStableFetch";
import { formatDate } from "../utils/profileDisplay";
import { memberRegistrationFromUser } from "../utils/memberRegistration";
import {
  Breadcrumbs,
  Button,
  DataTable,
  ErrorState,
  Modal,
  PageHeader,
  useToast } from "../components/ui";

function displayOrDash(value) {
  if (value == null || value === "") return "—";
  return value;
}

export default function UsersPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const { data, loading, error, reload } = useStableFetch(
    () => getUsersMeta({ role: "user" }),
    [],
  );
  const users = (data?.items ?? []).filter((u) => u.role === "user");

  async function confirmDelete() {
    if (!pendingDelete?._id || deleting) return;
    setDeleting(true);
    const name =
      memberRegistrationFromUser(pendingDelete).full_name ||
      pendingDelete.username ||
      "User";
    try {
      const deletedId = pendingDelete._id;
      await deleteUser(deletedId);
      setPendingDelete(null);
      toast.success(`${name} has been permanently deleted`);
      void reload();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  const columns = useMemo(
    () => [
      {
        key: "full_name",
        header: "Full name",
        sortable: true,
        render: (row) => {
          const reg = memberRegistrationFromUser(row);
          return (
            <div>
              <p className="font-semibold">{displayOrDash(reg.full_name)}</p>
              <p className="text-xs text-[var(--vf-muted)]">
                @{reg.username || "—"}
              </p>
            </div>
          );
        } },
      {
        key: "phone",
        header: "Phone",
        render: (row) => displayOrDash(memberRegistrationFromUser(row).phone) },
      {
        key: "clientData.gender",
        header: "Gender",
        render: (row) => displayOrDash(memberRegistrationFromUser(row).gender) },
      {
        key: "clientData.age",
        header: "Age",
        sortable: true,
        render: (row) => displayOrDash(memberRegistrationFromUser(row).age) },
      {
        key: "clientData.height",
        header: "Height",
        render: (row) => {
          const height = memberRegistrationFromUser(row).height;
          return height != null ? `${height} cm` : "—";
        } },
      {
        key: "clientData.weight",
        header: "Weight",
        render: (row) => {
          const weight = memberRegistrationFromUser(row).weight;
          return weight != null ? `${weight} kg` : "—";
        } },
      {
        key: "clientData.fitness_goal",
        header: "Fitness goal",
        render: (row) =>
          displayOrDash(memberRegistrationFromUser(row).fitness_goal_label) },
      {
        key: "createdAt",
        header: "Registered",
        sortable: true,
        render: (row) => formatDate(row.createdAt) },
      {
        key: "actions",
        header: "",
        render: (row) => (
          <div
            className="flex flex-wrap gap-2"
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate(`/users/${row._id}`)}
            >
              View
            </Button>
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
    [navigate, deleting],
  );

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Register clients, view their details, and permanently delete a member account when needed. Clients cannot change their own role."
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Home", to: "/" }, { label: "Users" }]}
          />
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate("/users/register")}>Register client</Button>
            <Button variant="secondary" onClick={reload}>
              Refresh
            </Button>
          </div>
        }
      />
      
      {!loading && error ? <ErrorState message={error} onRetry={reload} /> : null}
      {!loading && !error ? (
        <DataTable
          columns={columns}
          rows={users}
          searchKeys={[
            "full_name",
            "username",
            "phone",
            "clientData.gender",
            "clientData.fitness_goal",
          ]}
          searchPlaceholder="Search name, username, phone…"
          pageSize={0}
          emptyIcon={Users}
          emptyTitle="No users found"
          onRowClick={(row) => navigate(`/users/${row._id}`)}
        />
      ) : null}

      <Modal
        open={Boolean(pendingDelete)}
        title="Delete user?"
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
            <Button variant="danger" disabled={deleting} onClick={confirmDelete}>
              {"Delete permanently"}
            </Button>
          </div>
        }
      >
        {pendingDelete ? (
          <div className="space-y-3 text-sm">
            <p>
              Are you sure you want to delete this user? Permanently delete{" "}
              <strong>
                {memberRegistrationFromUser(pendingDelete).full_name ||
                  pendingDelete.username}
              </strong>
              ?
            </p>
            <p className="rounded-[12px] border border-amber-200 bg-amber-50 p-3 text-amber-900">
              This removes the member account and related data from the database.
              This cannot be undone.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
