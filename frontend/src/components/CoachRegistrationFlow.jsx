import { useState, useEffect } from "react";
import { registerCoachAdmin, validateCoachCertificate } from "../api/adminApi";
import { getErrorMessage } from "../api/client";
import { matchSomaliaRegion, SOMALIA_REGIONS, validateSomaliaRegion } from "../utils/somaliaRegions";
import { SPECIALIZATIONS, validateSpecializationSelection, canToggleSpecialization } from "../utils/coachSpecialization";
import {
  validateEmail,
  validateGivenName,
  validatePassword,
} from "../utils/fieldValidation";
import {
  RegistrationCredentialInput,
  useFreshRegistrationForm,
} from "./RegistrationCredentialInput";
import { Button } from "./ui";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const STEP_TITLES = [
  "Account",
  "Personal Info",
  "Professional",
  "Appointment Days",
  "About You",
  "Review",
];
const DURATION_OPTIONS = [30, 45, 60];
const MAX_CERTIFICATES = 5;
const MAX_CERT_BYTES = 10 * 1024 * 1024;

const inputClass =
  "mt-1.5 w-full rounded-[12px] border border-[var(--vf-border)] bg-[var(--vf-surface-muted)] px-3 py-2.5 outline-none ring-[var(--vf-accent)] focus:ring-2";
const helpClass = "mt-1 text-sm text-[var(--vf-muted)]";
const titleClass = "text-lg font-bold text-[var(--vf-text)]";

function createEmptyCoachForm() {
  return {
    firstName: "",
    lastName: "",
    username: "",
    password: "",
    phone: "",
    age: "",
    location: "",
    yearsExperience: "",
    certifications: "",
    specialization: [],
    bio: "",
    experience: "",
    message: "",
    workingDays: [],
    appointmentDays: [],
    dayAvailability: {},
    appointmentDurationMinutes: 60,
    certificates: [],
  };
}

function toggleDay(list, day) {
  return list.includes(day) ? list.filter((item) => item !== day) : [...list, day];
}

function orderedDays(selected) {
  return WEEKDAYS.filter((day) => selected.includes(day));
}

export default function CoachRegistrationFlow({
  onCancel,
  onCreated,
  submitLabel = "Submit Application",
}) {
  const [step, setStep] = useState(0);
  const { form, setForm, setField, resetForm, markEdited } = useFreshRegistrationForm(createEmptyCoachForm);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [validatingCert, setValidatingCert] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const set = setField;

  useEffect(() => {
    return () => {
      form.certificates.forEach((item) => {
        if (item?.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const workingDays = orderedDays(form.workingDays);
  const appointmentDays = orderedDays(form.appointmentDays);

  function showError(message) {
    setError(message);
    return false;
  }

  function validateCurrentStep() {
    if (step === 0) {
      const firstError = validateGivenName(form.firstName, "First name");
      if (firstError) {
        setFieldErrors((current) => ({ ...current, firstName: firstError }));
        return showError(firstError);
      }
      const lastError = validateGivenName(form.lastName, "Last name");
      if (lastError) {
        setFieldErrors((current) => ({ ...current, lastName: lastError }));
        return showError(lastError);
      }
      const emailError = validateEmail(form.username);
      if (emailError) {
        setFieldErrors((current) => ({ ...current, username: emailError }));
        return showError(emailError);
      }
      const passwordError = validatePassword(form.password);
      if (passwordError) return showError(passwordError);
      return true;
    }
    if (step === 1) {
      if (!form.phone.trim()) return showError("Phone number is required");
      const digits = form.phone.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 15) {
        return showError("Please enter a valid phone number");
      }
      const age = Number(form.age);
      if (!Number.isFinite(age) || !Number.isInteger(age) || age < 18 || age > 120) {
        return showError("Age must be between 18 and 120 years.");
      }
      const locationError = validateSomaliaRegion(form.location);
      if (locationError) return showError(locationError);
      return true;
    }
    if (step === 2) {
      const years = Number(form.yearsExperience);
      if (!Number.isFinite(years) || years < 0) return showError("Enter valid years of experience");
      if (!form.certifications.trim()) return showError("List your certifications");
      if (!form.certificates.length) {
        return showError(
          "Upload at least one certificate.",
        );
      }
      const specializationError = validateSpecializationSelection(form.specialization);
      if (specializationError) return showError(specializationError);
      if (!workingDays.length) return showError("Select at least one working day");
      return true;
    }
    if (step === 3) {
      if (!appointmentDays.length) return showError("Select at least one appointment day");
      for (const day of appointmentDays) {
        const hours = form.dayAvailability[day];
        if (!hours?.start || !hours?.end) return showError(`Set working hours for ${day}`);
        const [sh, sm] = hours.start.split(":").map(Number);
        const [eh, em] = hours.end.split(":").map(Number);
        const startMinutes = sh * 60 + sm;
        const endMinutes = eh * 60 + em;
        if (endMinutes <= startMinutes) {
          return showError(`${day}: end time must be after the start time`);
        }
        if (endMinutes - startMinutes < form.appointmentDurationMinutes) {
          return showError(`${day}: working hours must fit at least one appointment slot`);
        }
      }
      return true;
    }
    return true;
  }

  function next() {
    setError("");
    if (!validateCurrentStep()) return;
    if (step < STEP_TITLES.length - 1) {
      setStep((current) => current + 1);
      return;
    }
    void submit();
  }

  async function prepareCertificatesForSubmit(certificates) {
    const prepared = [];
    for (const item of certificates) {
      if (item.url) {
        prepared.push({
          url: item.url,
          fileName: item.fileName || item.name,
          mimeType: item.mimeType,
          uploadedAt: item.uploadedAt,
        });
      } else if (item.dataUrl) {
        prepared.push({
          dataUrl: item.dataUrl,
          fileName: item.fileName || item.name,
          mimeType: item.mimeType,
        });
      } else if (item.file) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error(`Could not read ${item.name}`));
          reader.readAsDataURL(item.file);
        });
        prepared.push({
          dataUrl,
          fileName: item.name || item.fileName,
          mimeType: item.mimeType || item.file.type,
        });
      }
    }
    return prepared;
  }

  async function submit() {
    setSaving(true);
    setError("");
    try {
      const certificateFilesPayload = await prepareCertificatesForSubmit(form.certificates);
      const result = await registerCoachAdmin({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        full_name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        email: form.username.trim(),
        username: form.username.trim(),
        password: form.password,
        phone: form.phone.trim(),
        age: Number(form.age),
        location: matchSomaliaRegion(form.location) || form.location.trim(),
        yearsExperience: Number(form.yearsExperience),
        certifications: form.certifications.trim(),
        specialization: form.specialization,
        bio: form.bio.trim(),
        experience: form.experience.trim(),
        message: form.message.trim(),
        workingDays,
        appointmentDays,
        dayAvailability: appointmentDays.map((day) => ({
          day,
          start: form.dayAvailability[day].start,
          end: form.dayAvailability[day].end,
        })),
        appointmentDurationMinutes: form.appointmentDurationMinutes,
        certificateFiles: certificateFilesPayload,
      });
      onCreated?.(result.user, result.message);
      resetForm();
      setStep(0);
      setShowPassword(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function toggleWorkingDay(day) {
    setForm((current) => ({
      ...current,
      workingDays: toggleDay(current.workingDays, day),
    }));
  }

  function toggleAppointmentDay(day) {
    setForm((current) => {
      const selected = current.appointmentDays.includes(day);
      const appointmentDaysNext = selected
        ? current.appointmentDays.filter((item) => item !== day)
        : [...current.appointmentDays, day];
      const dayAvailability = { ...current.dayAvailability };
      if (selected) {
        delete dayAvailability[day];
      } else {
        dayAvailability[day] = dayAvailability[day] || { start: "09:00", end: "17:00" };
      }
      return { ...current, appointmentDays: appointmentDaysNext, dayAvailability };
    });
  }

  function onCertificateFiles(event) {
    const rawFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (!rawFiles.length) return;

    const remaining = MAX_CERTIFICATES - form.certificates.length;
    if (remaining <= 0) {
      showError(`You can upload at most ${MAX_CERTIFICATES} certificates`);
      return;
    }

    const additions = [];
    let lastError = "";
    for (const file of rawFiles.slice(0, remaining)) {
      const lower = file.name.toLowerCase();

      if (file.size > MAX_CERT_BYTES) {
        lastError = `${file.name} exceeds the 10 MB limit`;
        continue;
      }

      const isImage = file.type.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif|bmp|svg|avif|heic)$/i.test(lower);
      const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
      const previewUrl = isImage ? URL.createObjectURL(file) : null;
      const mimeType = file.type || (isPdf ? "application/pdf" : isImage ? "image/jpeg" : "application/octet-stream");

      additions.push({
        file,
        name: file.name,
        fileName: file.name,
        mimeType,
        size: file.size,
        previewUrl,
        isPdf,
        isImage,
      });
    }

    if (additions.length > 0) {
      setForm((current) => ({
        ...current,
        certificates: [...current.certificates, ...additions],
      }));
      setError(lastError);
    } else if (lastError) {
      setError(lastError);
    }
  }

  function removeCertificate(index) {
    setForm((current) => {
      const target = current.certificates[index];
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return {
        ...current,
        certificates: current.certificates.filter((_, i) => i !== index),
      };
    });
    setError("");
  }

  const stepBody = (() => {
    if (step === 0) {
      return (
        <>
          <h2 className={titleClass}>Create your account</h2>
          <p className={helpClass}>
            Start with your login credentials. You will access the coach dashboard after admin approval.
          </p>
          <label className="mt-5 block text-sm font-semibold">
            First Name *
            <RegistrationCredentialInput
              className={inputClass}
              name="coach-register-first-name"
              autoComplete="given-name"
              value={form.firstName}
              onFocus={markEdited}
              onChange={(e) => {
                const value = e.target.value;
                set("firstName", value);
                setFieldErrors((current) => ({
                  ...current,
                  firstName: value.trim() ? validateGivenName(value, "First name") : "",
                }));
              }}
            />
            {fieldErrors.firstName ? (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.firstName}</p>
            ) : null}
          </label>
          <label className="mt-4 block text-sm font-semibold">
            Last Name *
            <RegistrationCredentialInput
              className={inputClass}
              name="coach-register-last-name"
              autoComplete="family-name"
              value={form.lastName}
              onFocus={markEdited}
              onChange={(e) => {
                const value = e.target.value;
                set("lastName", value);
                setFieldErrors((current) => ({
                  ...current,
                  lastName: value.trim() ? validateGivenName(value, "Last name") : "",
                }));
              }}
            />
            {fieldErrors.lastName ? (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.lastName}</p>
            ) : null}
          </label>
          <label className="mt-4 block text-sm font-semibold">
            Email Address *
            <RegistrationCredentialInput
              type="email"
              className={inputClass}
              name="coach-register-email"
              autoComplete="new-email"
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
            />
            {fieldErrors.username ? (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.username}</p>
            ) : null}
          </label>
          <label className="mt-4 block text-sm font-semibold">
            Password *
            <div className="relative">
              <RegistrationCredentialInput
                type={showPassword ? "text" : "password"}
                className={inputClass}
                name="coach-register-password"
                autoComplete="new-password"
                value={form.password}
                onFocus={markEdited}
                onChange={(e) => set("password", e.target.value)}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--vf-muted)]"
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>
        </>
      );
    }
    if (step === 1) {
      return (
        <>
          <h2 className={titleClass}>Personal information</h2>
          <p className={helpClass}>
            This information is reviewed by admins and kept private from other coaches.
          </p>
          <label className="mt-5 block text-sm font-semibold">
            Phone Number *
            <input
              className={inputClass}
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </label>
          <label className="mt-4 block text-sm font-semibold">
            Age *
            <input
              className={inputClass}
              inputMode="numeric"
              placeholder="Must be 18+"
              value={form.age}
              onChange={(e) => set("age", e.target.value)}
            />
          </label>
          <label className="mt-4 block text-sm font-semibold">
            Region / Gobol *
            <select
              className={inputClass}
              value={matchSomaliaRegion(form.location)}
              onChange={(e) => set("location", e.target.value)}
            >
              <option value="">Select Somali region</option>
              {SOMALIA_REGIONS.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </label>
        </>
      );
    }
    if (step === 2) {
      return (
        <>
          <h2 className={titleClass}>Professional credentials</h2>
          <p className={helpClass}>
            Share your training background so admins can verify your qualifications.
          </p>
          <label className="mt-5 block text-sm font-semibold">
            Years of Experience *
            <input
              className={inputClass}
              inputMode="numeric"
              value={form.yearsExperience}
              onChange={(e) => set("yearsExperience", e.target.value)}
            />
          </label>
          <label className="mt-4 block text-sm font-semibold">
            Certifications *
            <textarea
              className={inputClass}
              rows={3}
              placeholder="e.g. NASM-CPT, ACE, CPR/AED"
              value={form.certifications}
              onChange={(e) => set("certifications", e.target.value)}
            />
          </label>
          <div className="mt-6">
            <h3 className={titleClass}>Certificate Upload *</h3>
            <p className={helpClass}>
              Upload your certificate files. Max 10 MB each, up to {MAX_CERTIFICATES}.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {form.certificates.map((file, index) => {
                const isPdf = file.isPdf || file.mimeType?.includes("pdf") || (file.name || file.fileName || "").toLowerCase().endsWith(".pdf");
                const previewSrc = file.previewUrl || file.preview || file.url || file.dataUrl;
                const name = file.name || file.fileName || `Certificate ${index + 1}`;

                return (
                  <div
                    key={`${name}-${index}`}
                    className="group relative flex w-28 flex-col items-center overflow-hidden rounded-[12px] border border-[var(--vf-border)] bg-[var(--vf-surface-muted)] p-2"
                  >
                    <div className="relative h-20 w-full overflow-hidden rounded-[8px] bg-black/5 flex items-center justify-center">
                      {isPdf || !previewSrc ? (
                        <div className="flex flex-col items-center justify-center p-1 text-center">
                          <svg className="h-8 w-8 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V7.5L14.5 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span className="mt-1 text-[10px] font-bold uppercase text-rose-600">PDF</span>
                        </div>
                      ) : (
                        <img src={previewSrc} alt={name} className="h-full w-full object-cover" />
                      )}
                      <button
                        type="button"
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white hover:bg-rose-600"
                        title="Remove certificate"
                        onClick={() => removeCertificate(index)}
                      >
                        ×
                      </button>
                    </div>
                    <p className="mt-1.5 w-full truncate text-center text-[11px] font-medium text-[var(--vf-text)]" title={name}>
                      {name}
                    </p>
                  </div>
                );
              })}
            </div>
            <label className="mt-3 inline-flex">
              <input
                type="file"
                accept="*/*"
                multiple
                className="hidden"
                disabled={form.certificates.length >= MAX_CERTIFICATES}
                onChange={onCertificateFiles}
              />
              <span className="cursor-pointer rounded-[12px] border border-[var(--vf-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--vf-surface-muted)]">
                {form.certificates.length ? "Add more certificates" : "Upload certificates"}
              </span>
            </label>
            {form.certificates.length ? (
              <p className="mt-2 text-xs text-[var(--vf-muted)]">
                {form.certificates.length} / {MAX_CERTIFICATES} uploaded
              </p>
            ) : null}
          </div>
          <div className="mt-4">
            <p className="text-sm font-semibold">Specializations *</p>
            <p className={helpClass}>
              Select one or more specialized options, or General Fitness alone (it cannot be combined).
            </p>
            <div className="mt-3 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto rounded-[12px] border border-[var(--vf-border)] bg-[var(--vf-surface-muted)] p-3 sm:grid-cols-2">
              {SPECIALIZATIONS.map((option) => {
                const selected = form.specialization.includes(option);
                const generalSelected = form.specialization.includes("General Fitness");
                const othersSelected = form.specialization.some((item) => item !== "General Fitness");
                const disabled =
                  !selected
                  && (
                    (generalSelected && option !== "General Fitness")
                    || (option === "General Fitness" && othersSelected)
                  );
                return (
                  <label
                    key={option}
                    className={`flex items-start gap-2 rounded-[10px] px-2 py-1.5 text-sm ${
                      disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                    } ${
                      selected
                        ? "bg-[color-mix(in_srgb,var(--vf-primary)_12%,transparent)] text-[var(--vf-primary)]"
                        : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected}
                      disabled={disabled}
                      onChange={() => {
                        const result = canToggleSpecialization(form.specialization, option, {
                          selecting: !selected,
                        });
                        if (!result.ok) {
                          showError(result.message);
                          return;
                        }
                        set("specialization", result.next);
                      }}
                    />
                    <span>{option}</span>
                  </label>
                );
              })}
            </div>
            {form.specialization.includes("General Fitness") ? (
              <p className={`mt-2 ${helpClass}`}>
                General Fitness is exclusive. Remove it before selecting other specializations.
              </p>
            ) : null}
            {form.specialization.length ? (
              <div className="mt-3">
                <p className="text-sm font-semibold">Selected Specializations:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--vf-text)]">
                  {form.specialization.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div className="mt-6">
            <h3 className={titleClass}>Working Days</h3>
            <p className={helpClass}>
              Select the days you actively coach or work with clients. This is your general coaching schedule.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WEEKDAYS.map((day) => {
                const selected = form.workingDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleWorkingDay(day)}
                    className={`rounded-[12px] border px-3 py-2 text-sm font-semibold ${
                      selected
                        ? "border-[var(--vf-primary)] bg-[color-mix(in_srgb,var(--vf-primary)_12%,transparent)] text-[var(--vf-primary)]"
                        : "border-[var(--vf-border)]"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <p className={`mt-3 text-xs ${workingDays.length ? "text-[var(--vf-muted)]" : "text-amber-700"}`}>
              {workingDays.length
                ? `${workingDays.length} working day${workingDays.length === 1 ? "" : "s"} selected`
                : "Select at least one working day to continue."}
            </p>
          </div>
        </>
      );
    }
    if (step === 3) {
      return (
        <>
          <h2 className={titleClass}>Appointment Days</h2>
          <p className={helpClass}>
            Choose which days accept bookings, then set start and end times for each selected day.
          </p>
          <h3 className={`${titleClass} mt-5`}>Appointment Days</h3>
          <p className={helpClass}>
            Choose the days when members can book appointments with you. This is separate from your working
            days — pick any combination that fits your availability.
          </p>
          <div className="mt-3 rounded-[12px] border border-[var(--vf-border)] bg-[var(--vf-surface-muted)] p-3 text-sm">
            <p className="font-semibold">Examples</p>
            <p className="mt-1 text-[var(--vf-muted)]">
              Monday only · Monday, Wednesday & Friday · Saturday & Sunday · any custom mix
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WEEKDAYS.map((day) => {
              const selected = form.appointmentDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleAppointmentDay(day)}
                  className={`rounded-[12px] border px-3 py-2 text-sm font-semibold ${
                    selected
                      ? "border-[var(--vf-primary)] bg-[color-mix(in_srgb,var(--vf-primary)_12%,transparent)] text-[var(--vf-primary)]"
                      : "border-[var(--vf-border)]"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <p className={`mt-3 text-xs ${appointmentDays.length ? "text-[var(--vf-muted)]" : "text-amber-700"}`}>
            {appointmentDays.length
              ? `${appointmentDays.length} appointment day${appointmentDays.length === 1 ? "" : "s"} selected`
              : "Select at least one appointment day to continue."}
          </p>
          {appointmentDays.length ? (
            <div className="mt-5 space-y-3">
              <p className="text-sm font-semibold">Hours per day</p>
              {appointmentDays.map((day) => (
                <div key={day} className="rounded-[12px] border border-[var(--vf-border)] p-3">
                  <p className="mb-2 font-semibold">{day}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-[var(--vf-muted)]">
                      Start Time
                      <input
                        type="time"
                        className={inputClass}
                        value={form.dayAvailability[day]?.start || "09:00"}
                        onChange={(e) =>
                          setForm((current) => ({
                            ...current,
                            dayAvailability: {
                              ...current.dayAvailability,
                              [day]: {
                                ...(current.dayAvailability[day] || { end: "17:00" }),
                                start: e.target.value,
                              },
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-wide text-[var(--vf-muted)]">
                      End Time
                      <input
                        type="time"
                        className={inputClass}
                        value={form.dayAvailability[day]?.end || "17:00"}
                        onChange={(e) =>
                          setForm((current) => ({
                            ...current,
                            dayAvailability: {
                              ...current.dayAvailability,
                              [day]: {
                                ...(current.dayAvailability[day] || { start: "09:00" }),
                                end: e.target.value,
                              },
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <p className="mt-5 text-sm font-semibold">Appointment Duration</p>
          <div className="mt-2 flex gap-2">
            {DURATION_OPTIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => set("appointmentDurationMinutes", minutes)}
                className={`flex-1 rounded-[12px] border px-3 py-3 text-sm font-semibold ${
                  form.appointmentDurationMinutes === minutes
                    ? "border-[var(--vf-primary)] text-[var(--vf-primary)]"
                    : "border-[var(--vf-border)]"
                }`}
              >
                {minutes} min
              </button>
            ))}
          </div>
          <div className="mt-6 rounded-[16px] border border-[var(--vf-border)] p-4">
            <h3 className={titleClass}>Appointment Availability</h3>
            <div className="mt-3 space-y-2 text-sm">
              {appointmentDays.length
                ? appointmentDays.map((day) => (
                    <p key={day}>
                      {day}: {form.dayAvailability[day]?.start} – {form.dayAvailability[day]?.end}
                    </p>
                  ))
                : <p className="text-[var(--vf-muted)]">No appointment days selected yet.</p>}
              <p>Duration: {form.appointmentDurationMinutes} Minutes</p>
            </div>
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[var(--vf-muted)]">
              <li>Clients can only book on your selected working days.</li>
              <li>Each day uses the start and end times you set above.</li>
              <li>Booked time slots automatically become unavailable.</li>
              <li>You can update your availability anytime after registration.</li>
            </ul>
          </div>
        </>
      );
    }
    if (step === 4) {
      return (
        <>
          <h2 className={titleClass}>Tell us about yourself</h2>
          <p className={helpClass}>
            Share as little or as much as you like — short bios and detailed profiles are both fine. Once
            approved, this information can be visible to app members.
          </p>
          <label className="mt-5 block text-sm font-semibold">
            Professional Bio
            <textarea
              className={inputClass}
              rows={3}
              placeholder="Optional — introduce yourself in a few words or a longer story"
              value={form.bio}
              onChange={(e) => set("bio", e.target.value)}
            />
          </label>
          <label className="mt-4 block text-sm font-semibold">
            Work Experience
            <textarea
              className={inputClass}
              rows={3}
              placeholder="Optional — coaching history, certifications highlights, achievements"
              value={form.experience}
              onChange={(e) => set("experience", e.target.value)}
            />
          </label>
          <label className="mt-4 block text-sm font-semibold">
            Why do you want to coach?
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Optional — your motivation for joining VitalFitness"
              value={form.message}
              onChange={(e) => set("message", e.target.value)}
            />
          </label>
        </>
      );
    }
    return (
      <>
        <h2 className={titleClass}>Review your application</h2>
        <p className={helpClass}>Confirm everything is correct before submitting for admin approval.</p>
        <ReviewCard title="Account" rows={[["First name", form.firstName], ["Last name", form.lastName], ["Email", form.username]]} />
        <ReviewCard
          title="Personal"
          rows={[
            ["Phone", form.phone],
            ["Age", form.age],
            ["Region / Gobol", form.location],
          ]}
        />
        <ReviewCard
          title="Professional"
          rows={[
            ["Experience", `${form.yearsExperience} years`],
            ["Certifications", form.certifications],
            ["Certificate files", `${form.certificates.length} uploaded`],
            ["Specializations", form.specialization.join(", ") || "—"],
            ["Working Days", workingDays.join(", ")],
          ]}
        />
        <ReviewCard
          title="Appointment Days"
          rows={[
            ["Days", appointmentDays.join(", ")],
            ...appointmentDays.map((day) => [
              day,
              `${form.dayAvailability[day]?.start} – ${form.dayAvailability[day]?.end}`,
            ]),
            ["Appointment Duration", `${form.appointmentDurationMinutes} minutes`],
          ]}
        />
        <ReviewCard
          title="Profile"
          rows={[
            ["Bio", form.bio],
            ["Work History", form.experience],
            ["Motivation", form.message],
          ]}
        />
      </>
    );
  })();

  return (
    <form
      className="mx-auto max-w-3xl"
      autoComplete="off"
      autoCorrect="off"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      <p className="text-sm font-semibold text-[var(--vf-muted)]">
        Step {step + 1} of {STEP_TITLES.length}: {STEP_TITLES[step]}
      </p>
      <div className="mt-2 mb-5 flex gap-1.5">
        {STEP_TITLES.map((title, index) => (
          <div
            key={title}
            className={`h-1.5 flex-1 rounded-full ${
              index <= step ? "bg-[var(--vf-primary)]" : "bg-[var(--vf-border)]"
            }`}
          />
        ))}
      </div>
      {error ? (
        <div className="mb-4 rounded-[12px] border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      <div className="vf-card p-5 sm:p-6">{stepBody}</div>
      <div className="mt-4 flex gap-3">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={saving}
          onClick={() => {
            if (step === 0) {
              resetForm();
              onCancel?.();
            } else {
              setError("");
              setStep((current) => current - 1);
            }
          }}
        >
          {step === 0 ? "Cancel" : "Back"}
        </Button>
        <Button className="flex-[2]" disabled={saving || validatingCert} onClick={next}>
          {saving
            ? "Submitting…"
            : step === STEP_TITLES.length - 1
              ? submitLabel
              : "Continue"}
        </Button>
      </div>
    </form>
  );
}

function ReviewCard({ title, rows }) {
  return (
    <div className="mt-4 rounded-[12px] border border-[var(--vf-border)] p-4">
      <h3 className="mb-2 font-bold">{title}</h3>
      <dl className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-[var(--vf-muted)]">{label}</dt>
            <dd className="max-w-[60%] text-right">{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
