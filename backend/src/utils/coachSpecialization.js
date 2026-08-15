/**
 * Coach specialization → service authorization (source of truth).
 *
 * Coaches may select multiple specializations.
 * General Fitness authorizes every supported service category.
 * A coach may provide a service if ANY selected specialization authorizes it.
 */

const SPECIALIZATIONS = [
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

/** Service categories mirror specializations (one centralized vocabulary). */
const SERVICE_CATEGORIES = [...SPECIALIZATIONS];

const SPECIALIZATION_ALIASES = {
  general: 'General Fitness',
  fitness: 'General Fitness',
  'general fitness': 'General Fitness',
  nutrition: 'Nutrition',
  'weight loss': 'Weight Loss',
  weightloss: 'Weight Loss',
  'weight-loss': 'Weight Loss',
  lose_weight: 'Weight Loss',
  weight_loss: 'Weight Loss',
  'weight gain': 'Weight Gain',
  weightgain: 'Weight Gain',
  'weight-gain': 'Weight Gain',
  'muscle building': 'Muscle Building',
  'muscle gain': 'Muscle Building',
  muscle_gain: 'Muscle Building',
  'strength training': 'Strength Training',
  strength: 'Strength Training',
  bodybuilding: 'Bodybuilding',
  cardio: 'Cardio & Endurance',
  'cardio & endurance': 'Cardio & Endurance',
  endurance: 'Cardio & Endurance',
  hiit: 'HIIT',
  'functional training': 'Functional Training',
  functional: 'Functional Training',
  'personal training': 'Personal Training',
  pt: 'Personal Training',
  'fitness for beginners': 'Fitness for Beginners',
  beginners: 'Fitness for Beginners',
  "women's fitness": "Women's Fitness",
  "womens fitness": "Women's Fitness",
  "men's fitness": "Men's Fitness",
  "mens fitness": "Men's Fitness",
  'senior fitness': 'Senior Fitness',
  seniors: 'Senior Fitness',
  'youth fitness': 'Youth Fitness',
  'sports training': 'Sports Training',
  sports: 'Sports Training',
  'athletic performance': 'Athletic Performance',
  athletics: 'Athletic Performance',
  'flexibility & mobility': 'Flexibility & Mobility',
  flexibility: 'Flexibility & Mobility',
  mobility: 'Flexibility & Mobility',
  'yoga & mindfulness': 'Yoga & Mindfulness',
  yoga: 'Yoga & Mindfulness',
  'posture & corrective exercise': 'Posture & Corrective Exercise',
  posture: 'Posture & Corrective Exercise',
  'injury prevention': 'Injury Prevention',
  'rehabilitation & recovery': 'Rehabilitation & Recovery',
  rehab: 'Rehabilitation & Recovery',
  recovery: 'Rehabilitation & Recovery',
  'pre/postnatal fitness': 'Pre/Postnatal Fitness',
  prenatal: 'Pre/Postnatal Fitness',
  postnatal: 'Pre/Postnatal Fitness',
  'lifestyle & wellness': 'Lifestyle & Wellness',
  lifestyle: 'Lifestyle & Wellness',
  wellness: 'Lifestyle & Wellness',
  'meal planning': 'Meal Planning',
  'healthy eating': 'Healthy Eating',
  'weight management': 'Weight Management',
};

/**
 * Related service categories each specialization may provide.
 * Self is always included. General Fitness is handled separately (all).
 * @type {Record<string, string[]>}
 */
const RELATED_SERVICES = {
  'General Fitness': SERVICE_CATEGORIES,
  Nutrition: ['Nutrition', 'Meal Planning', 'Healthy Eating', 'Weight Management'],
  'Meal Planning': ['Meal Planning', 'Nutrition', 'Healthy Eating', 'Weight Management'],
  'Healthy Eating': ['Healthy Eating', 'Nutrition', 'Meal Planning', 'Weight Management'],
  'Weight Management': [
    'Weight Management',
    'Weight Loss',
    'Weight Gain',
    'Nutrition',
    'Meal Planning',
    'Healthy Eating',
  ],
  'Weight Loss': ['Weight Loss', 'Weight Management'],
  'Weight Gain': ['Weight Gain', 'Muscle Building', 'Weight Management'],
  'Muscle Building': ['Muscle Building', 'Strength Training', 'Bodybuilding', 'Weight Gain'],
  'Strength Training': ['Strength Training', 'Muscle Building', 'Bodybuilding'],
  Bodybuilding: ['Bodybuilding', 'Muscle Building', 'Strength Training'],
  'Cardio & Endurance': ['Cardio & Endurance', 'HIIT', 'Functional Training'],
  HIIT: ['HIIT', 'Cardio & Endurance', 'Functional Training'],
  'Functional Training': ['Functional Training', 'HIIT', 'Cardio & Endurance', 'Strength Training'],
  'Personal Training': [
    'Personal Training',
    'General Fitness',
    'Fitness for Beginners',
    'Strength Training',
    'Cardio & Endurance',
    'HIIT',
    'Functional Training',
  ],
  'Fitness for Beginners': ['Fitness for Beginners', 'General Fitness', 'Personal Training'],
  "Women's Fitness": ["Women's Fitness", 'General Fitness', 'Personal Training', 'Flexibility & Mobility'],
  "Men's Fitness": ["Men's Fitness", 'General Fitness', 'Personal Training', 'Strength Training'],
  'Senior Fitness': ['Senior Fitness', 'General Fitness', 'Flexibility & Mobility', 'Lifestyle & Wellness'],
  'Youth Fitness': ['Youth Fitness', 'General Fitness', 'Sports Training'],
  'Sports Training': ['Sports Training', 'Athletic Performance', 'Strength Training', 'Cardio & Endurance'],
  'Athletic Performance': ['Athletic Performance', 'Sports Training', 'Strength Training', 'HIIT'],
  'Flexibility & Mobility': ['Flexibility & Mobility', 'Yoga & Mindfulness', 'Posture & Corrective Exercise'],
  'Yoga & Mindfulness': ['Yoga & Mindfulness', 'Flexibility & Mobility', 'Lifestyle & Wellness'],
  'Posture & Corrective Exercise': [
    'Posture & Corrective Exercise',
    'Flexibility & Mobility',
    'Injury Prevention',
    'Rehabilitation & Recovery',
  ],
  'Injury Prevention': ['Injury Prevention', 'Rehabilitation & Recovery', 'Posture & Corrective Exercise'],
  'Rehabilitation & Recovery': [
    'Rehabilitation & Recovery',
    'Injury Prevention',
    'Posture & Corrective Exercise',
    'Flexibility & Mobility',
  ],
  'Pre/Postnatal Fitness': ['Pre/Postnatal Fitness', "Women's Fitness", 'Lifestyle & Wellness'],
  'Lifestyle & Wellness': ['Lifestyle & Wellness', 'Healthy Eating', 'General Fitness', 'Yoga & Mindfulness'],
};

const WORKOUT_SERVICE_CATEGORIES = [
  'General Fitness',
  'Weight Loss',
  'Weight Gain',
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
];

const DIET_SERVICE_CATEGORIES = [
  'Nutrition',
  'Meal Planning',
  'Healthy Eating',
  'Weight Loss',
  'Weight Gain',
  'Weight Management',
];

const UNAUTHORIZED_MESSAGE =
  'This Coach is not authorized to provide this service based on their specialization.';

const MISSING_SPECIALIZATION_MESSAGE =
  'This Coach has no specialization set. An admin must set at least one specialization before services can be provided.';

function normalizeSpecialization(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (SPECIALIZATIONS.includes(raw)) return raw;
  const alias = SPECIALIZATION_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  return null;
}

function normalizeSpecializationList(value) {
  const items = [];
  if (value == null) return items;
  const rawList = Array.isArray(value)
    ? value
    : String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  const seen = new Set();
  for (const item of rawList) {
    const normalized = normalizeSpecialization(item);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      items.push(normalized);
    }
  }
  return items;
}

function normalizeServiceCategory(value) {
  return normalizeSpecialization(value);
}

const GENERAL_FITNESS_EXCLUSIVE_WITH_OTHERS =
  'General Fitness cannot be combined with other specializations. Please remove General Fitness before selecting another specialization.';

const GENERAL_FITNESS_REQUIRES_CLEAR_OTHERS =
  'General Fitness cannot be combined with other specializations. Please remove the other specializations first.';

function validateSpecializationInput(value) {
  const rawList = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  if (!rawList.length) {
    return 'Please select at least one specialization.';
  }
  for (const item of rawList) {
    if (!normalizeSpecialization(item)) {
      return `Invalid specialization: ${item}`;
    }
  }
  const list = normalizeSpecializationList(value);
  if (!list.length) {
    return 'Please select at least one specialization.';
  }
  if (list.includes('General Fitness') && list.length > 1) {
    return 'General Fitness cannot be combined with other specializations. Please remove General Fitness before selecting another specialization.';
  }
  return null;
}

/**
 * Resolve the coach's stored specializations from DB. Never trust client-sent values.
 */
function getCoachSpecializations(user) {
  if (!user) return [];
  const coachData = user.coachData || {};
  const fromSpecialties = normalizeSpecializationList(coachData.specialties);
  if (fromSpecialties.length) return fromSpecialties;

  const fromPrimary = normalizeSpecializationList(coachData.primarySpecialization);
  if (fromPrimary.length) return fromPrimary;

  const fromProfile = normalizeSpecializationList(user.profile?.specialization);
  if (fromProfile.length) return fromProfile;

  return normalizeSpecializationList(user.specialization);
}

/** @deprecated Prefer getCoachSpecializations — returns first specialization for legacy callers. */
function getCoachSpecialization(user) {
  const list = getCoachSpecializations(user);
  return list[0] || null;
}

function allowedServiceCategoriesFor(specializations) {
  const list = normalizeSpecializationList(specializations);
  if (!list.length) return [];
  const allowed = new Set();
  for (const spec of list) {
    if (spec === 'General Fitness') {
      return [...SERVICE_CATEGORIES];
    }
    const related = RELATED_SERVICES[spec] || [spec];
    related.forEach((item) => allowed.add(item));
  }
  return [...allowed];
}

function canProvideService(specializations, serviceCategory) {
  const category = normalizeServiceCategory(serviceCategory);
  if (!category) return false;
  const allowed = allowedServiceCategoriesFor(specializations);
  return allowed.includes(category);
}

function categoryFromDietGoal(goal) {
  const value = String(goal || '').trim().toLowerCase();
  if (value === 'weight_loss' || value === 'lose_weight') return 'Weight Loss';
  if (value === 'muscle_gain' || value === 'gain_muscle' || value === 'weight_gain') {
    return 'Muscle Building';
  }
  return 'Nutrition';
}

function categoryFromClassCategory(category) {
  const normalized = normalizeServiceCategory(category);
  if (normalized) return normalized;
  const raw = String(category || '').trim().toLowerCase();
  if (!raw) return 'General Fitness';
  if (raw.includes('nutrition') || raw.includes('diet') || raw.includes('meal')) {
    return 'Nutrition';
  }
  if (raw.includes('weight loss') || raw.includes('fat loss')) return 'Weight Loss';
  if (raw.includes('weight gain')) return 'Weight Gain';
  if (raw.includes('muscle') || raw.includes('hypertrophy')) return 'Muscle Building';
  if (raw.includes('strength')) return 'Strength Training';
  if (raw.includes('bodybuild')) return 'Bodybuilding';
  if (raw.includes('hiit')) return 'HIIT';
  if (raw.includes('cardio') || raw.includes('endurance')) return 'Cardio & Endurance';
  if (raw.includes('yoga') || raw.includes('mindful')) return 'Yoga & Mindfulness';
  if (raw.includes('flex') || raw.includes('mobility')) return 'Flexibility & Mobility';
  if (raw.includes('functional')) return 'Functional Training';
  if (raw.includes('rehab') || raw.includes('recover')) return 'Rehabilitation & Recovery';
  if (raw.includes('senior')) return 'Senior Fitness';
  if (raw.includes('youth') || raw.includes('teen')) return 'Youth Fitness';
  if (raw.includes('women')) return "Women's Fitness";
  if (raw.includes('men')) return "Men's Fitness";
  if (raw.includes('sport') || raw.includes('athletic')) return 'Sports Training';
  if (raw === 'general' || raw.includes('general fitness')) return 'General Fitness';
  return 'General Fitness';
}

function firstAuthorizedCategory(coachSpecs, preferredCategories) {
  const allowed = new Set(allowedServiceCategoriesFor(coachSpecs));
  for (const preferred of preferredCategories) {
    if (allowed.has(preferred)) return preferred;
  }
  return preferredCategories[0] || 'General Fitness';
}

function resolveServiceCategory({
  resourceType,
  body = {},
  coachSpecialization = null,
  coachSpecializations = null,
} = {}) {
  const coachSpecs = coachSpecializations
    || normalizeSpecializationList(coachSpecialization)
    || [];

  const explicit = normalizeServiceCategory(
    body.serviceCategory || body.service_category || body.categoryType,
  );
  if (explicit) return explicit;

  switch (resourceType) {
    case 'diet_plan':
      return categoryFromDietGoal(body.goal);
    case 'class': {
      const fromLabel = categoryFromClassCategory(body.category || body.title);
      if (fromLabel && fromLabel !== 'General Fitness') return fromLabel;
      return firstAuthorizedCategory(coachSpecs, [
        ...coachSpecs.filter((s) => s !== 'General Fitness'),
        'General Fitness',
      ]);
    }
    case 'exercise_plan':
    case 'workout_template':
    case 'workout_schedule':
    case 'weekly_workout_plan':
      return firstAuthorizedCategory(coachSpecs, [
        ...coachSpecs.filter((s) => WORKOUT_SERVICE_CATEGORIES.includes(s)),
        'General Fitness',
        'Strength Training',
        'Personal Training',
        'Weight Loss',
      ]);
    case 'appointment':
    case 'session':
    case 'feedback':
    case 'article':
    case 'client_plan':
      return coachSpecs[0] || 'General Fitness';
    default:
      return normalizeServiceCategory(body.category) || 'General Fitness';
  }
}

function assertCoachCanProvide(user, serviceCategory) {
  const specializations = getCoachSpecializations(user);
  if (!specializations.length) {
    return {
      ok: false,
      status: 403,
      message: MISSING_SPECIALIZATION_MESSAGE,
      code: 'COACH_SPECIALIZATION_REQUIRED',
    };
  }
  const category = normalizeServiceCategory(serviceCategory);
  if (!category) {
    return {
      ok: false,
      status: 400,
      message: 'A valid service category is required.',
      code: 'SERVICE_CATEGORY_REQUIRED',
    };
  }
  if (!canProvideService(specializations, category)) {
    return {
      ok: false,
      status: 403,
      message: UNAUTHORIZED_MESSAGE,
      code: 'COACH_SPECIALIZATION_DENIED',
      specializations,
      specialization: specializations[0],
      serviceCategory: category,
    };
  }
  return {
    ok: true,
    specializations,
    specialization: specializations[0],
    serviceCategory: category,
  };
}

function enforceCoachSpecialization(req, res, { resourceType, body, serviceCategory } = {}) {
  const payload = body || req.body || {};
  const specializations = getCoachSpecializations(req.user);
  const category = serviceCategory
    || resolveServiceCategory({
      resourceType,
      body: payload,
      coachSpecializations: specializations,
      coachSpecialization: specializations[0] || null,
    });
  const result = assertCoachCanProvide(req.user, category);
  if (!result.ok) {
    res.status(result.status).json({
      message: result.message,
      code: result.code,
      specialization: result.specialization,
      specializations: result.specializations,
      serviceCategory: result.serviceCategory,
    });
    return false;
  }
  req.coachSpecialization = result.specialization;
  req.coachSpecializations = result.specializations;
  req.serviceCategory = result.serviceCategory;
  return true;
}

function specializationToStorage(value) {
  const specialties = normalizeSpecializationList(value);
  return {
    specialties,
    primarySpecialization: specialties[0] || null,
    label: specialties.join(', '),
  };
}

function dietGoalsForSpecializations(specializations) {
  const allowed = new Set(allowedServiceCategoriesFor(specializations));
  const goals = [];
  if (allowed.has('Weight Loss') || allowed.has('Weight Management')) goals.push('weight_loss');
  if (
    allowed.has('Muscle Building')
    || allowed.has('Weight Gain')
    || allowed.has('Strength Training')
    || allowed.has('Bodybuilding')
  ) {
    goals.push('muscle_gain');
  }
  if (
    allowed.has('Nutrition')
    || allowed.has('Meal Planning')
    || allowed.has('Healthy Eating')
    || allowed.has('General Fitness')
    || allowed.has('Lifestyle & Wellness')
  ) {
    goals.push('maintenance');
  }
  return goals.length ? goals : [];
}

function classCategoriesForSpecializations(specializations) {
  const allowed = allowedServiceCategoriesFor(specializations);
  if (!allowed.length) return [];
  if (allowed.length === SERVICE_CATEGORIES.length) {
    return [
      'General Fitness',
      'Nutrition',
      'Weight Loss',
      'Weight Gain',
      'Muscle Building',
      'Strength Training',
      'Bodybuilding',
      'Cardio & Endurance',
      'HIIT',
      'Functional Training',
      'Yoga & Mindfulness',
      'Flexibility & Mobility',
      'Sports Training',
      'Personal Training',
    ];
  }
  return allowed;
}

function canAccessWorkouts(specializations) {
  const allowed = allowedServiceCategoriesFor(specializations);
  return allowed.some((item) => WORKOUT_SERVICE_CATEGORIES.includes(item));
}

function canAccessDietPlans(specializations) {
  const allowed = allowedServiceCategoriesFor(specializations);
  return allowed.some((item) => DIET_SERVICE_CATEGORIES.includes(item));
}

/** Legacy fitness_goal values → canonical specialization (exact match for coach discovery). */
const FITNESS_GOAL_ALIASES = {
  lose_weight: 'Weight Loss',
  weight_loss: 'Weight Loss',
  gain_muscle: 'Muscle Building',
  muscle_gain: 'Muscle Building',
  maintain: 'General Fitness',
  other: 'General Fitness',
  general: 'General Fitness',
};

const GOAL_MISMATCH_MESSAGE =
  "Request rejected: Coach specialization does not match the client's fitness goal.";
const GOAL_REQUIRED_MESSAGE =
  'Set your fitness goal before browsing or requesting a coach.';

/**
 * Normalize a member fitness goal to a canonical specialization label.
 * Accepts legacy enum values and specialization names/aliases.
 */
function normalizeFitnessGoal(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (FITNESS_GOAL_ALIASES[lower]) return FITNESS_GOAL_ALIASES[lower];
  return normalizeSpecialization(raw);
}

function validateFitnessGoalValue(value, { required = false } = {}) {
  if (value == null || String(value).trim() === '') {
    return required ? 'Fitness goal is required' : null;
  }
  if (!normalizeFitnessGoal(value)) {
    return 'Select a valid fitness goal';
  }
  return null;
}

function getClientFitnessGoal(user) {
  if (!user) return null;
  return normalizeFitnessGoal(
    user.clientData?.fitness_goal
      ?? user.fitness_goal
      ?? user.fitnessGoal
      ?? null,
  );
}

/** Exact specialization match — goal "Nutrition" only matches coaches with Nutrition. */
function coachMatchesFitnessGoal(coachUser, fitnessGoal) {
  const goal = normalizeFitnessGoal(fitnessGoal);
  if (!goal) return false;
  const specs = getCoachSpecializations(coachUser);
  return specs.includes(goal);
}

function assertCoachMatchesClientGoal(clientUser, coachUser) {
  const goal = getClientFitnessGoal(clientUser);
  if (!goal) {
    return {
      ok: false,
      status: 400,
      message: GOAL_REQUIRED_MESSAGE,
      code: 'FITNESS_GOAL_REQUIRED',
    };
  }
  if (!coachMatchesFitnessGoal(coachUser, goal)) {
    return {
      ok: false,
      status: 403,
      message: GOAL_MISMATCH_MESSAGE,
      code: 'FITNESS_GOAL_MISMATCH',
      fitnessGoal: goal,
      coachSpecializations: getCoachSpecializations(coachUser),
    };
  }
  return { ok: true, fitnessGoal: goal };
}

/** Allowed stored values for User.clientData.fitness_goal (canonical + legacy). */
const FITNESS_GOAL_STORAGE_VALUES = [
  ...SPECIALIZATIONS,
  'lose_weight',
  'gain_muscle',
  'maintain',
  'other',
];

module.exports = {
  SPECIALIZATIONS,
  SERVICE_CATEGORIES,
  RELATED_SERVICES,
  WORKOUT_SERVICE_CATEGORIES,
  DIET_SERVICE_CATEGORIES,
  UNAUTHORIZED_MESSAGE,
  MISSING_SPECIALIZATION_MESSAGE,
  GENERAL_FITNESS_EXCLUSIVE_WITH_OTHERS,
  GENERAL_FITNESS_REQUIRES_CLEAR_OTHERS,
  FITNESS_GOAL_ALIASES,
  FITNESS_GOAL_STORAGE_VALUES,
  GOAL_MISMATCH_MESSAGE,
  GOAL_REQUIRED_MESSAGE,
  normalizeSpecialization,
  normalizeSpecializationList,
  normalizeServiceCategory,
  validateSpecializationInput,
  getCoachSpecialization,
  getCoachSpecializations,
  canProvideService,
  categoryFromDietGoal,
  categoryFromClassCategory,
  resolveServiceCategory,
  assertCoachCanProvide,
  enforceCoachSpecialization,
  specializationToStorage,
  allowedServiceCategoriesFor,
  dietGoalsForSpecializations,
  classCategoriesForSpecializations,
  canAccessWorkouts,
  canAccessDietPlans,
  normalizeFitnessGoal,
  validateFitnessGoalValue,
  getClientFitnessGoal,
  coachMatchesFitnessGoal,
  assertCoachMatchesClientGoal,
};
