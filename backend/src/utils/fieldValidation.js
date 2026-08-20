const mongoose = require('mongoose');
const { validatePasswordPolicy, normalizeEmail } = require('./passwordUtils');

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/;
const FULL_NAME_RE = /^[\p{L}]+(?:[\s'\-]+[\p{L}]+)*$/u;
const GIVEN_NAME_RE = /^[\p{L}]+(?:[\s'\-]+[\p{L}]+)*$/u;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{6,18}$/;

const FITNESS_GOALS = [
  'lose_weight',
  'gain_muscle',
  'maintain',
  'other',
  // Canonical specialization-aligned goals (same labels as coach specializations)
  'General Fitness',
  'Weight Loss',
  'Weight Gain',
  'Nutrition',
  'Muscle Building',
  'Strength Training',
  'Bodybuilding',
  'Cardio & Endurance',
  'HIIT',
  'Functional Training',
  'Personal Training',
  'Fitness for Beginners',
  "Women's Fitness",
  "Men's Fitness",
  'Senior Fitness',
  'Youth Fitness',
  'Sports Training',
  'Athletic Performance',
  'Flexibility & Mobility',
  'Yoga & Mindfulness',
  'Posture & Corrective Exercise',
  'Injury Prevention',
  'Rehabilitation & Recovery',
  'Pre/Postnatal Fitness',
  'Lifestyle & Wellness',
  'Meal Planning',
  'Healthy Eating',
  'Weight Management',
];
const GENDERS = ['Male', 'Female'];
const ACTIVITY_LEVELS = ['sedentary', 'moderate', 'active'];
const DIET_GOALS = ['weight_loss', 'muscle_gain', 'maintenance'];
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks'];
const WORKOUT_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'];

/** Somali regions (gobols) — Coach location. Keep in sync with frontend somaliaRegions.js */
const SOMALIA_REGIONS = [
  'Banaadir',
  'Bari',
  'Bay',
  'Bakool',
  'Galgaduud',
  'Gedo',
  'Hiiraan',
  'Jubbada Dhexe',
  'Jubbada Hoose',
  'Mudug',
  'Nugaal',
  'Sanaag',
  'Shabeellaha Dhexe',
  'Shabeellaha Hoose',
  'Sool',
  'Togdheer',
];

const REGION_ALIASES = {
  banadir: 'Banaadir',
  banaadir: 'Banaadir',
  bari: 'Bari',
  bay: 'Bay',
  bakool: 'Bakool',
  galgaduud: 'Galgaduud',
  gedo: 'Gedo',
  hiiraan: 'Hiiraan',
  hiran: 'Hiiraan',
  'jubbada dhexe': 'Jubbada Dhexe',
  'middle juba': 'Jubbada Dhexe',
  'jubbada hoose': 'Jubbada Hoose',
  'lower juba': 'Jubbada Hoose',
  mudug: 'Mudug',
  nugaal: 'Nugaal',
  nugaaal: 'Nugaal',
  sanaag: 'Sanaag',
  'shabeellaha dhexe': 'Shabeellaha Dhexe',
  'middle shabelle': 'Shabeellaha Dhexe',
  'shabeellaha hoose': 'Shabeellaha Hoose',
  'lower shabelle': 'Shabeellaha Hoose',
  sool: 'Sool',
  togdheer: 'Togdheer',
};

function matchSomaliaRegion(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const exact = SOMALIA_REGIONS.find((region) => region.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  return REGION_ALIASES[raw.toLowerCase()] || '';
}

function validateSomaliaRegion(value, { required = true } = {}) {
  if (isBlank(value)) {
    return required ? 'Please select your region.' : null;
  }
  if (!matchSomaliaRegion(value)) {
    return 'Please select your region.';
  }
  return null;
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function requireText(value, label, { min = 1, max = 200 } = {}) {
  if (isBlank(value)) return `${label} is required`;
  const text = String(value).trim();
  if (text.length < min) return `${label} is too short`;
  if (text.length > max) return `${label} is too long`;
  return null;
}

function validateEmail(value, { required = true } = {}) {
  if (isBlank(value)) {
    return required ? 'Email is required' : null;
  }
  const email = normalizeEmail(value);
  if (/^\d+$/.test(email) || !EMAIL_RE.test(email) || email.length < 5 || email.length > 254) {
    return 'Please enter a valid email address';
  }
  return null;
}

function validateFullName(value, { required = true } = {}) {
  if (isBlank(value)) {
    return required ? 'Full name is required' : null;
  }
  const name = String(value).trim();
  if (name.length > 80) return 'Full name is too long';
  if (/\d/.test(name) || !FULL_NAME_RE.test(name)) {
    return 'Full name can only contain letters, spaces, hyphens, and apostrophes.';
  }
  if (name.length < 2) return 'Full name is too short';
  return null;
}

function validateGivenName(value, label = 'Name', { required = true } = {}) {
  if (isBlank(value)) {
    return required ? `${label} is required` : null;
  }
  const name = String(value).trim();
  if (name.length > 40) return `${label} is too long`;
  if (/\d/.test(name) || !GIVEN_NAME_RE.test(name)) {
    return `${label} can only contain letters, spaces, hyphens, and apostrophes.`;
  }
  if (name.length < 2) return `${label} is too short`;
  return null;
}

function splitPersonName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Coach identity for certificates: First Name + Last Name only. */
function resolveCoachPersonName(body = {}) {
  const firstName = String(body.firstName || body.first_name || '').trim();
  const lastName = String(body.lastName || body.last_name || '').trim();
  if (firstName && lastName) {
    return { firstName, lastName, fullName: `${firstName} ${lastName}` };
  }
  const fallback = String(
    body.full_name || body.fullName || body.name || body.expectedName || '',
  ).trim();
  const split = splitPersonName(fallback);
  return {
    firstName: firstName || split.firstName,
    lastName: lastName || split.lastName,
    fullName: [firstName || split.firstName, lastName || split.lastName].filter(Boolean).join(' '),
  };
}

function validateCoachPersonName(body = {}) {
  const { firstName, lastName } = resolveCoachPersonName(body);
  return validateGivenName(firstName, 'First name')
    || validateGivenName(lastName, 'Last name');
}

function validatePhone(value, { required = false } = {}) {
  if (isBlank(value)) {
    return required ? 'Phone number is required' : null;
  }
  const compact = String(value).trim();
  const digits = compact.replace(/\D/g, '');
  if (!PHONE_RE.test(compact) || digits.length < 7 || digits.length > 15) {
    return 'Please enter a valid phone number';
  }
  return null;
}

function validateOptionalNumber(value, label, { min, max, integer = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `${label} must be a number`;
  if (integer && !Number.isInteger(parsed)) return `${label} must be a whole number`;
  if (min != null && parsed < min) return `${label} must be at least ${min}`;
  if (max != null && parsed > max) return `${label} must be at most ${max}`;
  return null;
}

function validateRequiredNumber(value, label, options) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return `${label} is required`;
  }
  return validateOptionalNumber(value, label, options);
}

function validateGender(value, { required = false } = {}) {
  if (isBlank(value)) return required ? 'Gender is required' : null;
  if (!GENDERS.includes(String(value).trim())) {
    return 'Gender must be Male or Female';
  }
  return null;
}

function validateFitnessGoal(value, { required = false } = {}) {
  if (isBlank(value)) return required ? 'Fitness goal is required' : null;
  try {
    const { validateFitnessGoalValue } = require('./coachSpecialization');
    return validateFitnessGoalValue(value, { required });
  } catch (_) {
    if (!FITNESS_GOALS.includes(String(value).trim())) {
      return 'Select a valid fitness goal';
    }
    return null;
  }
}

function validateActivityLevel(value) {
  if (isBlank(value)) return null;
  if (!ACTIVITY_LEVELS.includes(String(value).trim())) {
    return 'Select a valid activity level';
  }
  return null;
}

function validateObjectId(value, label, { required = true } = {}) {
  if (isBlank(value)) return required ? `${label} is required` : null;
  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    return `${label} is invalid`;
  }
  return null;
}

function validateDate(value, label, { required = true } = {}) {
  if (isBlank(value)) return required ? `${label} is required` : null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${label} is not a valid date`;
  return null;
}

function validateTime(value, label, { required = true } = {}) {
  if (isBlank(value)) return required ? `${label} is required` : null;
  if (!TIME_RE.test(String(value).trim())) {
    return `${label} must be a valid time (HH:MM)`;
  }
  return null;
}

function validateDateRange(start, end, { allowEqual = false } = {}) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'Start and end dates must be valid';
  }
  if (allowEqual ? endDate < startDate : endDate <= startDate) {
    return 'End date must be after start date';
  }
  return null;
}

function validateNotPast(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${label} is not a valid date`;
  if (date.getTime() < Date.now() - 60 * 1000) {
    return `${label} cannot be in the past`;
  }
  return null;
}

function validateDurationMinutes(value, { required = true, min = 5, max = 240 } = {}) {
  return (required ? validateRequiredNumber : validateOptionalNumber)(
    value,
    'Appointment duration',
    { min, max, integer: true },
  );
}

function validateExercises(exercises, { required = true } = {}) {
  if (!Array.isArray(exercises) || !exercises.length) {
    return required ? 'At least one exercise is required' : null;
  }
  for (let i = 0; i < exercises.length; i += 1) {
    const entry = exercises[i];
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (isBlank(name)) return `Exercise ${i + 1}: name is required`;
    const setsError = validateOptionalNumber(entry?.sets, `Exercise ${i + 1} sets`, {
      min: 1,
      max: 100,
      integer: true,
    });
    if (setsError) return setsError;
    const repsError = validateOptionalNumber(entry?.reps, `Exercise ${i + 1} repetitions`, {
      min: 1,
      max: 500,
      integer: true,
    });
    if (repsError) return repsError;
    const durationError = validateOptionalNumber(
      entry?.durationMinutes,
      `Exercise ${i + 1} duration`,
      { min: 0, max: 240 },
    );
    if (durationError) return durationError;
    const restError = validateOptionalNumber(entry?.restSeconds, `Exercise ${i + 1} rest time`, {
      min: 0,
      max: 600,
      integer: true,
    });
    if (restError) return restError;
  }
  return null;
}

function validateHeight(value, { required = false } = {}) {
  if (isBlank(value)) {
    return required ? 'Height must be between 50 cm and 250 cm.' : null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 50 || parsed > 250) {
    return 'Height must be between 50 cm and 250 cm.';
  }
  return null;
}

function validateWeight(value, { required = false } = {}) {
  if (isBlank(value)) {
    return required ? 'Weight must be between 20 kg and 300 kg.' : null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 20 || parsed > 300) {
    return 'Weight must be between 20 kg and 300 kg.';
  }
  return null;
}

function validateAge(value, { required = false } = {}) {
  if (isBlank(value)) {
    return required ? 'Age must be between 18 and 120 years.' : null;
  }
  const raw = String(value).trim();
  if (!/^-?\d+$/.test(raw)) {
    return 'Age must be between 18 and 120 years.';
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 18 || parsed > 120) {
    return 'Age must be between 18 and 120 years.';
  }
  return null;
}

function validateMemberProfileFields(body = {}) {
  return (
    validateAge(body.age)
    || validateGender(body.gender)
    || validateHeight(body.height ?? body.heightCm)
    || validateWeight(body.weight ?? body.weightKg)
    || validateFitnessGoal(body.fitness_goal ?? body.fitnessGoal)
    || validateActivityLevel(body.activity_level ?? body.activityLevel)
  );
}

function validateMemberRegistration(body = {}) {
  return (
    validateFullName(body.full_name || body.fullName || body.name)
    || validateEmail(body.username || body.email)
    || validatePasswordPolicy(body.password)
    || validatePhone(body.phone, { required: false })
    || validateMemberProfileFields(body)
  );
}

function validateLoginIdentity(body = {}) {
  const identity = body.username || body.email;
  if (isBlank(identity)) return 'Email is required';
  return validateEmail(identity);
}

function validateLogin(body = {}) {
  return validateLoginIdentity(body) || (isBlank(body.password) ? 'Password is required' : null);
}

function validateNutritionNumber(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `${label} must be a number`;
  if (parsed < 0) return `${label} cannot be negative`;
  if (parsed > 20000) return `${label} is unrealistically high`;
  return null;
}

function validateDietMeal(meal, index = 0) {
  const label = `Meal ${index + 1}`;
  if (!meal || typeof meal !== 'object') return `${label} is invalid`;
  if (!isBlank(meal.type) && !MEAL_TYPES.includes(String(meal.type).trim())) {
    return `${label}: select a valid meal type`;
  }
  const reminder = String(meal.reminderTime || '').trim();
  if (reminder && !TIME_RE.test(reminder) && !/^([01]?\d|2[0-3]):([0-5]\d)$/.test(reminder)) {
    return `${label}: meal time must be HH:MM`;
  }
  return (
    validateNutritionNumber(meal.calories, `${label} calories`)
    || validateNutritionNumber(meal.protein, `${label} protein`)
    || validateNutritionNumber(meal.carbs, `${label} carbohydrates`)
    || validateNutritionNumber(meal.fats ?? meal.fat, `${label} fat`)
  );
}

function validateDietMeals(meals) {
  if (meals == null) return null;
  if (!Array.isArray(meals)) return 'Meals must be a list';
  for (let i = 0; i < meals.length; i += 1) {
    const error = validateDietMeal(meals[i], i);
    if (error) return error;
  }
  return null;
}

function validateDietDays(days) {
  if (days == null) return null;
  if (!Array.isArray(days)) return 'Weekly diet days must be a list';
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    if (day?.dayOfWeek != null) {
      const dow = Number(day.dayOfWeek);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
        return `Day ${i + 1}: day of week must be 0–6`;
      }
    }
    const mealError = validateDietMeals(day?.meals);
    if (mealError) return mealError;
  }
  return null;
}

function firstValidationError(errors) {
  const list = Array.isArray(errors) ? errors.filter(Boolean) : [];
  return list[0] || null;
}

module.exports = {
  EMAIL_RE,
  FULL_NAME_RE,
  TIME_RE,
  PHONE_RE,
  FITNESS_GOALS,
  GENDERS,
  ACTIVITY_LEVELS,
  DIET_GOALS,
  MEAL_TYPES,
  WORKOUT_LEVELS,
  ATTENDANCE_STATUSES,
  SOMALIA_REGIONS,
  isBlank,
  requireText,
  validateEmail,
  validateFullName,
  validateGivenName,
  splitPersonName,
  resolveCoachPersonName,
  validateCoachPersonName,
  validatePhone,
  matchSomaliaRegion,
  validateSomaliaRegion,
  validateOptionalNumber,
  validateRequiredNumber,
  validateHeight,
  validateWeight,
  validateAge,
  validateGender,
  validateFitnessGoal,
  validateActivityLevel,
  validateObjectId,
  validateDate,
  validateTime,
  validateDateRange,
  validateNotPast,
  validateDurationMinutes,
  validateExercises,
  validateMemberProfileFields,
  validateMemberRegistration,
  validateLoginIdentity,
  validateLogin,
  validateNutritionNumber,
  validateDietMeal,
  validateDietMeals,
  validateDietDays,
  firstValidationError,
};
