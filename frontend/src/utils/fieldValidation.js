/** Frontend mirrors of backend/src/utils/fieldValidation.js */

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/;
export const FULL_NAME_RE = /^[\p{L}]+(?:\s+[\p{L}]+)*$/u;
export const PHONE_RE = /^\+?[0-9][0-9\s\-()]{6,18}$/;
export const FITNESS_GOALS = ["lose_weight", "gain_muscle", "maintain", "other"];

export function validateEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return "Email is required";
  if (/^\d+$/.test(email) || !EMAIL_RE.test(email) || email.length < 5) {
    return "Please enter a valid email address";
  }
  return "";
}

export function validateFullName(value) {
  const name = String(value || "").trim();
  if (!name) return "Full name is required";
  if (name.length > 80) return "Full name is too long";
  if (/\d/.test(name) || !FULL_NAME_RE.test(name)) {
    return "Full name can only contain letters and spaces.";
  }
  if (name.length < 2) return "Full name is too short";
  return "";
}

export function validatePassword(value) {
  const password = String(value || "");
  if (!password) return "Password is required";
  if (password.length < 6) return "Password must be at least 6 characters";
  if (password.length > 128) return "Password must be at most 128 characters";
  return "";
}

export function validatePhone(value, { required = false } = {}) {
  const phone = String(value || "").trim();
  if (!phone) return required ? "Phone number is required" : "";
  const digits = phone.replace(/\D/g, "");
  if (!PHONE_RE.test(phone) || digits.length < 7 || digits.length > 15) {
    return "Please enter a valid phone number";
  }
  return "";
}

export function validateOptionalNumber(value, label, { min, max } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return `${label} must be a number`;
  if (min != null && parsed < min) return `${label} must be at least ${min}`;
  if (max != null && parsed > max) return `${label} must be at most ${max}`;
  return "";
}

export function validateLogin(form) {
  return {
    username: validateEmail(form.username || form.email),
    password: form.password ? "" : "Password is required",
  };
}

export function validateHeight(value, { required = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return required ? "Height must be between 50 cm and 250 cm." : "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 50 || parsed > 250) {
    return "Height must be between 50 cm and 250 cm.";
  }
  return "";
}

export function validateWeight(value, { required = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return required ? "Weight must be between 20 kg and 300 kg." : "";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 20 || parsed > 300) {
    return "Weight must be between 20 kg and 300 kg.";
  }
  return "";
}

export function validateAge(value, { required = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return required ? "Age must be between 18 and 120 years." : "";
  if (!/^-?\d+$/.test(raw)) return "Age must be between 18 and 120 years.";
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 18 || parsed > 120) {
    return "Age must be between 18 and 120 years.";
  }
  return "";
}

export function calcBmi(heightCm, weightKg) {
  const height = Number(heightCm);
  const weight = Number(weightKg);
  if (!Number.isFinite(height) || height < 50 || height > 250) return null;
  if (!Number.isFinite(weight) || weight < 20 || weight > 300) return null;
  const meters = height / 100;
  if (!meters) return null;
  return Number((weight / (meters * meters)).toFixed(1));
}

export function bmiCategory(bmi) {
  if (bmi == null || !Number.isFinite(Number(bmi))) return "";
  const value = Number(bmi);
  if (value < 18.5) return "Underweight";
  if (value < 25) return "Normal weight";
  if (value < 30) return "Overweight";
  return "Obesity";
}

export function validateMemberRegistration(form) {
  return {
    full_name: validateFullName(form.full_name),
    username: validateEmail(form.username),
    password: validatePassword(form.password),
    phone: validatePhone(form.phone),
    age: validateAge(form.age),
    height: validateHeight(form.height),
    weight: validateWeight(form.weight),
  };
}

export function firstFieldError(errors) {
  if (!errors || typeof errors !== "object") return "";
  return Object.values(errors).find((message) => Boolean(message)) || "";
}
