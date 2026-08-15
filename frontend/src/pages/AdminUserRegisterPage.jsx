import { useLocation, useNavigate } from "react-router-dom";
import MemberRegistrationFlow from "../components/MemberRegistrationFlow";
import { Breadcrumbs, PageHeader, useToast } from "../components/ui";

export default function AdminUserRegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  return (
    <div>
      <PageHeader
        title="User Registration"
        subtitle="Follow the same member registration instructions, fields, and requirements used in the app."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Home", to: "/" },
              { label: "Users", to: "/users" },
              { label: "Register" },
            ]}
          />
        }
      />
      <div className="mx-auto max-w-lg rounded-[20px] bg-[var(--vf-surface)] p-6 shadow-sm sm:p-7">
        <MemberRegistrationFlow
          key={location.key}
          mode="admin"
          submitLabel="Create account"
          onCancel={() => navigate("/users")}
          onCreated={(user, message) => {
            toast.success(message || `${user?.full_name || "Client"} registered`);
            navigate("/users", { replace: true });
          }}
        />
      </div>
    </div>
  );
}
