import { useState } from "react";
import { registerMember, registerMemberAdmin } from "../api/adminApi";
import { getErrorMessage } from "../api/client";
import {
  RegistrationCredentialInput,
  useFreshRegistrationForm,
} from "./RegistrationCredentialInput";
import { Button } from "./ui";
import {
  firstFieldError,
  validateAge,
  validateEmail,
  validateFullName,
  validateHeight,
  validateMemberRegistration,
  validateWeight,
  calcBmi,
  bmiCategory,
} from "../utils/fieldValidation";
import { FITNESS_GOALS } from "../utils/coachSpecialization";

function createEmptyMemberForm() {
  return {
    full_name: "",
    username: "",
    phone: "",
    password: "",
    gender: "Male",
    age: "",
    height: "",
    weight: "",
    fitness_goal: "General Fitness",
  };
}

const inputClass =
  "mt-1.5 w-full rounded-[12px] border border-[var(--vf-border)] bg-[var(--vf-surface-muted)] px-3 py-2.5 outline-none ring-[var(--vf-accent)] focus:ring-2";
const helpClass = "mt-1 text-sm text-[var(--vf-muted)]";

function optionalNumber(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function memberRegistrationPayload(form) {
  const payload = {
    full_name: String(form.full_name || "").trim(),
    username: String(form.username || "").trim().toLowerCase(),
    password: form.password,
    phone: String(form.phone || "").trim(),
    gender: form.gender === "Female" ? "Female" : "Male",
    fitness_goal: FITNESS_GOALS.some((goal) => goal.value === form.fitness_goal)
      ? form.fitness_goal
      : "maintain",
  };
  const age = optionalNumber(form.age);
  const height = optionalNumber(form.height);
  const weight = optionalNumber(form.weight);
  if (age !== undefined) payload.age = age;
  if (height !== undefined) payload.height = height;
  if (weight !== undefined) payload.weight = weight;
  return payload;
}

function validateMemberForm(form) {
  return validateMemberRegistration(form);
}

/**
 * Shared member (client) registration — same instructions, fields, and
 * validation as the app RegisterScreen. Self-signup uses POST /auth/register.
 * Admin uses POST /admin/users so the admin session is not replaced.
 */
export default function MemberRegistrationFlow({
  mode = "self",
  onCancel,
  onCreated,
  submitLabel = "Create account",
}) {
  const isAdmin = mode === "admin";
  const { form, setField, resetForm, markEdited } = useFreshRegistrationForm(createEmptyMemberForm);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const set = setField;

  async function submit(event) {
    event.preventDefault();
    const nextFieldErrors = validateMemberForm(form);
    setFieldErrors(nextFieldErrors);
    const validationError = firstFieldError(nextFieldErrors);
    if (validationError) {
      setError(validationError);
      setSuccess("");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = memberRegistrationPayload(form);
      if (isAdmin) {
        const result = await registerMemberAdmin(payload);
        const created = result?.user;
        if (!created?._id) {
          throw new Error("Account was created but the server did not return the user.");
        }
        if (created.role && created.role !== "user") {
          throw new Error("Registration did not create a member account.");
        }
        onCreated?.(created, result.message);
        resetForm();
        setShowPassword(false);
        return;
      }

      const result = await registerMember(payload);
      if (!result?.token || !result?.user) {
        throw new Error("Registration succeeded but sign-in failed. Please sign in.");
      }
      setSuccess(
        result.message ||
          "Account created. Opening your dashboard so you can choose a coach…",
      );
      onCreated?.(result.user, result.message, { token: result.token });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" autoComplete="off" autoCorrect="off">
      <div className="text-center">
        <h2 className="text-2xl font-extrabold">Create client account</h2>
        <p className="mt-2 text-sm leading-snug text-[var(--vf-muted)]">
          You are registering as a member. Your account role stays Member. After
          signup you can browse coaches and send a coaching request.
        </p>
      </div>

      {error ? (
        <p className="rounded-[12px] border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-[12px] border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      <label className="text-sm font-semibold">
        Full name
        <RegistrationCredentialInput
          required
          autoComplete="name"
          name={isAdmin ? "member-register-full-name" : "member-self-full-name"}
          value={form.full_name}
          onFocus={markEdited}
          onChange={(e) => {
            const value = e.target.value;
            set("full_name", value);
            setFieldErrors((current) => ({
              ...current,
              full_name: value.trim() ? validateFullName(value) : "",
            }));
          }}
          className={inputClass}
        />
        {fieldErrors.full_name ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.full_name}</p> : null}
      </label>

      <label className="text-sm font-semibold">
        Email
        <RegistrationCredentialInput
          required
          type="email"
          autoComplete="new-email"
          name={isAdmin ? "member-register-email" : "member-self-email"}
          value={form.username}
          onFocus={markEdited}
          onChange={(e) => {
            const value = e.target.value;
            set("username", value);
            setFieldErrors((current) => ({
              ...current,
              username: value.trim() ? validateEmail(value) : "",
            }));
          }}
          className={inputClass}
        />
        {fieldErrors.username ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.username}</p> : (
        <span className={helpClass}>Used to sign in to your account.</span>
        )}
      </label>

      <label className="text-sm font-semibold">
        Phone
        <RegistrationCredentialInput
          type="tel"
          autoComplete="off"
          name={isAdmin ? "member-register-phone" : "member-self-phone"}
          value={form.phone}
          onFocus={markEdited}
          onChange={(e) => {
            set("phone", e.target.value);
            setFieldErrors((current) => ({ ...current, phone: "" }));
          }}
          className={inputClass}
        />
        {fieldErrors.phone ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.phone}</p> : null}
      </label>

      <label className="text-sm font-semibold">
        Password
        <div className="relative">
          <RegistrationCredentialInput
            required
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            name={isAdmin ? "member-register-password" : "member-self-password"}
            minLength={6}
            maxLength={128}
            value={form.password}
            onFocus={markEdited}
            onChange={(e) => {
              set("password", e.target.value);
              setFieldErrors((current) => ({ ...current, password: "" }));
            }}
            className={`${inputClass} pr-20`}
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--vf-muted)]"
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        {fieldErrors.password ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p> : null}
      </label>

      <fieldset>
        <legend className="text-sm font-semibold">Gender</legend>
        <div className="mt-2 flex gap-2">
          {["Male", "Female"].map((gender) => {
            const selected = form.gender === gender;
            return (
              <button
                key={gender}
                type="button"
                onClick={() => set("gender", gender)}
                className={`flex-1 rounded-[12px] border px-3 py-2.5 text-sm font-semibold ${
                  selected
                    ? "border-[var(--vf-primary)] bg-[var(--vf-primary)] text-white"
                    : "border-[var(--vf-border)] bg-transparent"
                }`}
              >
                {gender}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">
          Age
          <input
            inputMode="numeric"
            value={form.age}
            onChange={(e) => {
              const value = e.target.value;
              set("age", value);
              setFieldErrors((current) => ({
                ...current,
                age: value.trim() ? validateAge(value) : "",
              }));
            }}
            className={inputClass}
          />
          {fieldErrors.age ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.age}</p> : null}
        </label>
        <label className="text-sm font-semibold">
          Height (cm)
          <input
            inputMode="decimal"
            value={form.height}
            onChange={(e) => {
              const value = e.target.value;
              set("height", value);
              setFieldErrors((current) => ({
                ...current,
                height: value.trim() ? validateHeight(value) : "",
              }));
            }}
            className={inputClass}
          />
          {fieldErrors.height ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.height}</p> : null}
        </label>
      </div>

      <label className="text-sm font-semibold">
        Weight (kg)
        <input
          inputMode="decimal"
          value={form.weight}
          onChange={(e) => {
            const value = e.target.value;
            set("weight", value);
            setFieldErrors((current) => ({
              ...current,
              weight: value.trim() ? validateWeight(value) : "",
            }));
          }}
          className={inputClass}
        />
        {fieldErrors.weight ? <p className="mt-1 text-xs text-rose-600">{fieldErrors.weight}</p> : null}
      </label>

      {(() => {
        const previewBmi = calcBmi(form.height, form.weight);
        const category = bmiCategory(previewBmi);
        if (previewBmi == null) return null;
        return (
          <p className="rounded-[12px] border border-[var(--vf-border)] bg-[var(--vf-surface-muted)] px-3 py-2 text-sm text-[var(--vf-muted)]">
            BMI (auto): <strong className="text-[var(--vf-text)]">{previewBmi}</strong>
            {category ? ` · ${category}` : ""}
          </p>
        );
      })()}

      <label className="text-sm font-semibold">
        Fitness goal
        <select
          value={form.fitness_goal}
          onChange={(e) => set("fitness_goal", e.target.value)}
          className={inputClass}
        >
          {FITNESS_GOALS.map((goal) => (
            <option key={goal.value} value={goal.value}>
              {goal.label}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-[12px] border border-[color-mix(in_srgb,var(--vf-primary)_20%,transparent)] bg-[color-mix(in_srgb,var(--vf-primary)_8%,transparent)] p-3">
        <p className="text-[12.5px] leading-relaxed text-[var(--vf-muted)]">
          After you register, you can browse the available coaches and choose the
          coach you want.
        </p>
      </div>

      <div className={onCancel ? "flex gap-3" : ""}>
        {onCancel ? (
          <Button type="button" variant="secondary" className="flex-1" disabled={saving} onClick={() => {
            resetForm();
            setShowPassword(false);
            onCancel();
          }}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" className={onCancel ? "flex-1" : ""} disabled={saving}>
          {saving ? "Creating…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
