/** Coach specialization → allowed services (mirrors backend). */

export const SPECIALIZATIONS = [
  "General Fitness",
  "Weight Loss",
  "Weight Gain",
  "Nutrition",
  "Muscle Building",
  "Strength Training",
  "Bodybuilding",
  "Cardio & Endurance",
  "HIIT",
  "Functional Training",
  "Personal Training",
  "Fitness for Beginners",
  "Women's Fitness",
  "Men's Fitness",
  "Senior Fitness",
  "Youth Fitness",
  "Sports Training",
  "Athletic Performance",
  "Flexibility & Mobility",
  "Yoga & Mindfulness",
  "Posture & Corrective Exercise",
  "Injury Prevention",
  "Rehabilitation & Recovery",
  "Pre/Postnatal Fitness",
  "Lifestyle & Wellness",
  "Meal Planning",
  "Healthy Eating",
  "Weight Management",
];

const ALIASES = {
  general: "General Fitness",
  fitness: "General Fitness",
  "general fitness": "General Fitness",
  nutrition: "Nutrition",
  "weight loss": "Weight Loss",
  weightloss: "Weight Loss",
  "weight-loss": "Weight Loss",
  weight_loss: "Weight Loss",
  "weight gain": "Weight Gain",
  "muscle building": "Muscle Building",
  muscle_gain: "Muscle Building",
  "strength training": "Strength Training",
  bodybuilding: "Bodybuilding",
  hiit: "HIIT",
  "meal planning": "Meal Planning",
  "healthy eating": "Healthy Eating",
  "weight management": "Weight Management",
};

export function normalizeSpecialization(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (SPECIALIZATIONS.includes(raw)) return raw;
  return ALIASES[raw.toLowerCase()] || null;
}

export function normalizeSpecializationList(value) {
  if (value == null) return [];
  const rawList = Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
  const seen = new Set();
  const items = [];
  for (const item of rawList) {
    const normalized = normalizeSpecialization(item);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      items.push(normalized);
    }
  }
  return items;
}

export function validateSpecializationSelection(value) {
  const list = normalizeSpecializationList(value);
  if (!list.length) return "Please select at least one specialization.";
  if (list.includes("General Fitness") && list.length > 1) {
    return "General Fitness cannot be combined with other specializations. Please remove General Fitness before selecting another specialization.";
  }
  return null;
}

/** UI helper: whether selecting `option` into `current` is allowed. */
export function canToggleSpecialization(current, option, { selecting } = {}) {
  const list = normalizeSpecializationList(current);
  const next = normalizeSpecialization(option);
  if (!next) return { ok: false, message: `Invalid specialization: ${option}` };

  const willSelect = selecting ?? !list.includes(next);
  if (!willSelect) return { ok: true, next: list.filter((item) => item !== next) };

  if (next === "General Fitness") {
    if (list.length && !(list.length === 1 && list[0] === "General Fitness")) {
      return {
        ok: false,
        message:
          "General Fitness cannot be combined with other specializations. Please remove the other specializations first.",
      };
    }
    return { ok: true, next: ["General Fitness"] };
  }

  if (list.includes("General Fitness")) {
    return {
      ok: false,
      message:
        "General Fitness cannot be combined with other specializations. Please remove General Fitness before selecting another specialization.",
    };
  }

  return { ok: true, next: [...list, next] };
}

export function getCoachSpecializations(user) {
  if (!user) return [];
  const fromSpecialties = normalizeSpecializationList(user.coachData?.specialties);
  if (fromSpecialties.length) return fromSpecialties;
  const fromProfile = normalizeSpecializationList(user.profile?.specialization);
  if (fromProfile.length) return fromProfile;
  const fromPrimary = normalizeSpecializationList(
    user.primarySpecialization
      || user.coachData?.primarySpecialization
      || user.profile?.primarySpecialization,
  );
  if (fromPrimary.length) return fromPrimary;
  return normalizeSpecializationList(user.specialization);
}

/** @deprecated Prefer getCoachSpecializations */
export function getCoachSpecialization(user) {
  return getCoachSpecializations(user)[0] || null;
}

export function canProvideService(specializations, category) {
  const specs = normalizeSpecializationList(specializations);
  const cat = normalizeSpecialization(category);
  if (!specs.length || !cat) return false;
  if (specs.includes("General Fitness")) return true;
  return specs.includes(cat);
}

export function allowedDietGoals(specializations) {
  const specs = normalizeSpecializationList(specializations);
  if (!specs.length) return [];
  if (specs.includes("General Fitness")) {
    return ["weight_loss", "muscle_gain", "maintenance"];
  }
  const goals = [];
  if (specs.some((s) => ["Weight Loss", "Weight Management"].includes(s))) {
    goals.push("weight_loss");
  }
  if (
    specs.some((s) =>
      ["Muscle Building", "Weight Gain", "Strength Training", "Bodybuilding"].includes(s),
    )
  ) {
    goals.push("muscle_gain");
  }
  if (
    specs.some((s) =>
      ["Nutrition", "Meal Planning", "Healthy Eating", "Lifestyle & Wellness"].includes(s),
    )
  ) {
    goals.push("maintenance");
  }
  return goals;
}

export function allowedClassCategories(specializations) {
  const specs = normalizeSpecializationList(specializations);
  if (!specs.length) return [];
  if (specs.includes("General Fitness")) {
    return [
      "General Fitness",
      "Nutrition",
      "Weight Loss",
      "Weight Gain",
      "Muscle Building",
      "Strength Training",
      "Bodybuilding",
      "Cardio & Endurance",
      "HIIT",
      "Functional Training",
      "Yoga & Mindfulness",
      "Flexibility & Mobility",
      "Sports Training",
      "Personal Training",
    ];
  }
  return specs;
}

export function canAccessWorkouts(specializations) {
  const specs = normalizeSpecializationList(specializations);
  if (!specs.length) return false;
  if (specs.includes("General Fitness")) return true;
  const dietOnly = new Set([
    "Nutrition",
    "Meal Planning",
    "Healthy Eating",
    "Weight Management",
  ]);
  return specs.some((s) => !dietOnly.has(s) || s === "Weight Loss" || s === "Weight Gain");
}

export function canAccessDietPlans(specializations) {
  const specs = normalizeSpecializationList(specializations);
  if (!specs.length) return false;
  if (specs.includes("General Fitness")) return true;
  return specs.some((s) =>
    [
      "Nutrition",
      "Meal Planning",
      "Healthy Eating",
      "Weight Loss",
      "Weight Gain",
      "Weight Management",
      "Lifestyle & Wellness",
    ].includes(s),
  );
}

const FITNESS_GOAL_ALIASES = {
  lose_weight: "Weight Loss",
  weight_loss: "Weight Loss",
  gain_muscle: "Muscle Building",
  muscle_gain: "Muscle Building",
  maintain: "General Fitness",
  other: "General Fitness",
  general: "General Fitness",
};

/** Fitness goals use the same labels as coach specializations. */
export const FITNESS_GOALS = SPECIALIZATIONS.map((value) => ({
  value,
  label: value,
}));

export function normalizeFitnessGoal(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (FITNESS_GOAL_ALIASES[lower]) return FITNESS_GOAL_ALIASES[lower];
  return normalizeSpecialization(raw);
}

export function fitnessGoalLabel(goal) {
  return normalizeFitnessGoal(goal) || "";
}

export function coachMatchesFitnessGoal(coach, fitnessGoal) {
  const goal = normalizeFitnessGoal(fitnessGoal);
  if (!goal) return false;
  const specs = getCoachSpecializations(coach);
  return specs.includes(goal);
}
