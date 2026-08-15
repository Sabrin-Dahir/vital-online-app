import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import MemberRegistrationFlow from "../components/MemberRegistrationFlow";
import { BrandMark } from "../components/ui";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { establishSession } = useAuth();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="absolute inset-0" style={{ background: "var(--vf-gradient)" }} />
      <main className="relative w-full max-w-lg rounded-[20px] bg-[var(--vf-surface)] p-7 shadow-2xl">
        <BrandMark />
        <div className="mt-7">
          <MemberRegistrationFlow
            mode="self"
            submitLabel="Create account"
            onCreated={(user, _message, extras) => {
              if (!extras?.token || !user) return;
              establishSession(extras.token, user);
              const dest = user.must_change_password ? "/change-password" : "/member/coaches";
              navigate(dest, { replace: true });
            }}
          />
        </div>
        <p className="mt-5 text-center text-sm text-[var(--vf-muted)]">
          Already registered?{" "}
          <Link className="font-semibold text-[var(--vf-primary)]" to="/login">
            Sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
