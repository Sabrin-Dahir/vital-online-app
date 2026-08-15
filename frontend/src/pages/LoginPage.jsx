import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { getErrorMessage } from "../api/client";
import { BrandMark, Button } from "../components/ui";
import { useTheme } from "../theme/ThemeContext";
import {
  Moon,
  Sun,
  User,
  Lock,
  AlertCircle,
  Eye,
  EyeOff } from "lucide-react";
import { dashboardPath } from "../App";
import { validateLogin, validateEmail, firstFieldError } from "../utils/fieldValidation";

export default function LoginPage() {
  const { user, login, loading } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  if (!loading && user) {
    if (user.must_change_password) {
      return <Navigate to="/change-password" replace />;
    }
    return <Navigate to={dashboardPath(user.role)} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const nextFieldErrors = validateLogin({ username, password });
    setFieldErrors(nextFieldErrors);
    const localError = firstFieldError(nextFieldErrors);
    if (localError) {
      setError(localError);
      return;
    }
    setSubmitting(true);
    setError("");
    setIsLocked(false);
    try {
      const loggedInUser = await login(username.trim(), password);
      if (loggedInUser?.must_change_password) {
        navigate("/change-password", { replace: true });
      } else {
        navigate(dashboardPath(loggedInUser.role), { replace: true });
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 423) {
        setIsLocked(true);
      }
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-6">
      <div
        className="absolute inset-0"
        style={{ background: "var(--vf-gradient)" }}
        aria-hidden
      />
      <div
        className="vf-login-orb absolute -left-24 top-0 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(91,111,214,0.45)_0%,transparent_70%)] blur-3xl"
        aria-hidden
      />
      <div
        className="vf-login-orb-delayed absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(46,58,107,0.55)_0%,transparent_68%)] blur-3xl"
        aria-hidden
      />

      <button
        type="button"
        onClick={toggleTheme}
        className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20 vf-focus sm:right-4 sm:top-4"
        aria-label="Toggle theme"
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <div className="vf-login-shell relative z-10 w-full max-w-[340px]">
        <div className="mb-6 text-center text-white">
          <div className="inline-flex justify-center">
            <BrandMark size="md" light />
          </div>
          <p className="mt-3 text-sm text-white/75">
            Sign in to your workspace
          </p>
        </div>

        <div className="rounded-2xl border border-white/25 bg-[var(--vf-surface)]/95 p-5 shadow-[0_20px_50px_rgba(15,28,46,0.28)] backdrop-blur-xl sm:p-6">
          <div className="vf-login-stagger">
            <h1 className="text-lg font-bold tracking-tight text-[var(--vf-text)]">
              Welcome back
            </h1>

            <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
              <label
                htmlFor="username"
                className="block text-[12px] font-semibold text-[var(--vf-text)]"
              >
                Email
                <div className="relative mt-1.5">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--vf-muted)]" />
                  <input
                    id="username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => {
                      const value = e.target.value;
                      setUsername(value);
                      setFieldErrors((current) => ({
                        ...current,
                        username: value.trim() ? validateEmail(value) : "",
                      }));
                    }}
                    className="vf-login-input w-full rounded-xl border border-[var(--vf-border)] bg-[var(--vf-surface-muted)] py-2.5 pl-9 pr-3 text-sm text-[var(--vf-text)] outline-none placeholder:text-[var(--vf-muted)]/65"
                    aria-invalid={Boolean(fieldErrors.username)}
                  />
                </div>
                {fieldErrors.username ? (
                  <p className="mt-1 text-[11px] text-rose-600">{fieldErrors.username}</p>
                ) : null}
              </label>

              <label
                htmlFor="password"
                className="block text-[12px] font-semibold text-[var(--vf-text)]"
              >
                Password
                <div className="relative mt-1.5">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--vf-muted)]" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFieldErrors((current) => ({ ...current, password: "" }));
                    }}
                    className="vf-login-input w-full rounded-xl border border-[var(--vf-border)] bg-[var(--vf-surface-muted)] py-2.5 pl-9 pr-10 text-sm text-[var(--vf-text)] outline-none placeholder:text-[var(--vf-muted)]/65"
                    placeholder="Password"
                    aria-invalid={Boolean(fieldErrors.password)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--vf-muted)] transition hover:bg-[var(--vf-border)]/40 hover:text-[var(--vf-text)] vf-focus"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                {fieldErrors.password ? (
                  <p className="mt-1 text-[11px] text-rose-600">{fieldErrors.password}</p>
                ) : null}
              </label>

              {error && (
                <div
                  role="alert"
                  className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-relaxed ${
                    isLocked
                      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
                      : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200"
                  }`}
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                id="login-btn"
                className="mt-1 w-full !rounded-xl !py-2.5 text-sm transition duration-200"
                size="md"
                disabled={submitting}
              >
                {"Sign In"}
              </Button>
            </form>

            <div className="mt-5 space-y-2 border-t border-[var(--vf-border)] pt-4 text-center">
              <p className="text-[11px] leading-relaxed text-[var(--vf-muted)]">
                Admin monitoring portal. Members and coaches register in the Vital Fitness app.
              </p>
              <p className="text-[11px] leading-relaxed text-[var(--vf-muted)]">
                Password reset for members is handled here after they contact you.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
