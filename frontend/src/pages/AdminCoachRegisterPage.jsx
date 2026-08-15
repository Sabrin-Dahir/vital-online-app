import { useLocation, useNavigate } from "react-router-dom";
import CoachRegistrationFlow from "../components/CoachRegistrationFlow";
import { Breadcrumbs, PageHeader, useToast } from "../components/ui";

export default function AdminCoachRegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  return (
    <div>
      <PageHeader
        title="Coach Registration"
        subtitle="Follow the same coach registration instructions, steps, and requirements used in the app."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Home", to: "/" },
              { label: "Coaches", to: "/coaches" },
              { label: "Register" },
            ]}
          />
        }
      />
      <CoachRegistrationFlow
        key={location.key}
        submitLabel="Submit Application"
        onCancel={() => navigate("/coaches")}
        onCreated={(user, message) => {
          toast.success(message || `${user?.full_name || "Coach"} registered`);
          navigate("/coaches", { replace: true });
        }}
      />
    </div>
  );
}
