import { formatList } from "../utils/profileDisplay";

function Field({ label, value, fullWidth = false }) {
  const display = value == null || value === "" ? "—" : value;
  return (
    <div className={fullWidth ? "sm:col-span-2" : undefined}>
      <div className="flex justify-between gap-4 border-b border-[var(--vf-border)] py-2 text-sm">
        <span className="text-[var(--vf-muted)]">{label}</span>
        <span
          className={` text-[var(--vf-text)] ${fullWidth ? "text-right max-w-[70%]" : ""}`}
        >
          {display}
        </span>
      </div>
    </div>
  );
}

function formatDayAvailability(days) {
  if (!Array.isArray(days) || days.length === 0) return "—";
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

export default function ProfileDetails({ profile, extras = [] }) {
  if (!profile || typeof profile !== "object") {
    return <p className="text-sm text-[var(--vf-muted)]">No profile data.</p>;
  }

  const fields = [
    profile.photoUrl
      ? {
          label: "Photo",
          value: (
            <a
              href={profile.photoUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[var(--vf-primary)]"
            >
              View photo
            </a>
          ) }
      : null,
    { label: "Phone", value: profile.phone },
    { label: "Region / Gobol", value: profile.location },
    { label: "Age", value: profile.age },
    profile.heightCm != null && profile.heightCm !== ""
      ? { label: "Height (cm)", value: profile.heightCm }
      : null,
    profile.weightKg != null && profile.weightKg !== ""
      ? { label: "Weight (kg)", value: profile.weightKg }
      : null,
    profile.bmi != null && profile.bmi !== ""
      ? {
          label: "BMI",
          value: profile.bmiCategory
            ? `${profile.bmi} (${profile.bmiCategory})`
            : profile.bmi,
        }
      : null,
    { label: "Years experience", value: profile.yearsExperience },
    { label: "Experience", value: profile.experience },
    { label: "Certifications", value: profile.certifications },
    {
      label: "Specializations",
      value:
        formatList(profile.specializations)
        || formatList(profile.specialization)
        || profile.primarySpecialization,
      fullWidth: true },
    { label: "Working days", value: formatList(profile.workingDays) },
    { label: "Appointment days", value: formatList(profile.appointmentDays) },
    {
      label: "Working hours",
      value:
        profile.workingHoursStart || profile.workingHoursEnd
          ? `${profile.workingHoursStart || "—"} – ${profile.workingHoursEnd || "—"}`
          : null },
    {
      label: "Appointment duration",
      value:
        profile.appointmentDurationMinutes != null
          ? `${profile.appointmentDurationMinutes} min`
          : null },
    {
      label: "Day availability",
      value: formatDayAvailability(profile.dayAvailability),
      fullWidth: true },
    { label: "Bio", value: profile.bio, fullWidth: true },
    ...extras,
  ].filter(Boolean);

  return (
    <div className="grid gap-x-6 sm:grid-cols-2">
      {fields.map((field) => (
        <Field
          key={field.label}
          label={field.label}
          value={field.value}
          fullWidth={field.fullWidth}
        />
      ))}
    </div>
  );
}
