/**
 * Unit tests for multi-select coach specialization authorization.
 * Run: node backend/src/utils/coachSpecialization.test.js
 */
const assert = require('assert');
const {
  SPECIALIZATIONS,
  canProvideService,
  assertCoachCanProvide,
  validateSpecializationInput,
  specializationToStorage,
  normalizeSpecializationList,
  categoryFromDietGoal,
  UNAUTHORIZED_MESSAGE,
  MISSING_SPECIALIZATION_MESSAGE,
} = require('./coachSpecialization');

assert.ok(SPECIALIZATIONS.includes('General Fitness'));
assert.ok(SPECIALIZATIONS.includes('Meal Planning'));
assert.ok(SPECIALIZATIONS.length >= 28);

// Validation
assert.strictEqual(validateSpecializationInput([]), 'Please select at least one specialization.');
assert.strictEqual(validateSpecializationInput(''), 'Please select at least one specialization.');
assert.ok(validateSpecializationInput(['Not A Real Spec'])?.startsWith('Invalid'));
assert.strictEqual(validateSpecializationInput(['Nutrition', 'Weight Loss']), null);
assert.strictEqual(validateSpecializationInput('Nutrition, Weight Loss'), null);
assert.strictEqual(validateSpecializationInput(['General Fitness']), null);
assert.ok(
  validateSpecializationInput(['General Fitness', 'Nutrition'])?.includes('General Fitness cannot be combined'),
);
assert.ok(
  validateSpecializationInput(['Weight Loss', 'General Fitness'])?.includes('General Fitness cannot be combined'),
);

// Fitness goal → specialization exact matching
{
  const {
    normalizeFitnessGoal,
    coachMatchesFitnessGoal,
    assertCoachMatchesClientGoal,
    GOAL_MISMATCH_MESSAGE,
  } = require('./coachSpecialization');
  assert.strictEqual(normalizeFitnessGoal('lose_weight'), 'Weight Loss');
  assert.strictEqual(normalizeFitnessGoal('Nutrition'), 'Nutrition');
  const nutritionCoach = { coachData: { specialties: ['Nutrition'] } };
  const strengthCoach = { coachData: { specialties: ['Strength Training'] } };
  assert.strictEqual(coachMatchesFitnessGoal(nutritionCoach, 'Nutrition'), true);
  assert.strictEqual(coachMatchesFitnessGoal(nutritionCoach, 'Weight Loss'), false);
  const mismatch = assertCoachMatchesClientGoal(
    { clientData: { fitness_goal: 'Nutrition' } },
    strengthCoach,
  );
  assert.strictEqual(mismatch.ok, false);
  assert.strictEqual(mismatch.message, GOAL_MISMATCH_MESSAGE);
}

// Storage dedupes
{
  const stored = specializationToStorage(['Nutrition', 'Nutrition', 'Weight Loss']);
  assert.deepStrictEqual(stored.specialties, ['Nutrition', 'Weight Loss']);
  assert.strictEqual(stored.primarySpecialization, 'Nutrition');
}

// Legacy General → General Fitness
assert.deepStrictEqual(normalizeSpecializationList('General'), ['General Fitness']);

// Permission scenarios
assert.strictEqual(canProvideService(['Nutrition'], 'Nutrition'), true);
assert.strictEqual(canProvideService(['Nutrition'], 'Meal Planning'), true);
assert.strictEqual(canProvideService(['Nutrition'], 'Healthy Eating'), true);
assert.strictEqual(canProvideService(['Nutrition'], 'Strength Training'), false);

assert.strictEqual(canProvideService(['Weight Loss'], 'Weight Loss'), true);
assert.strictEqual(canProvideService(['Weight Loss'], 'Nutrition'), false);

assert.strictEqual(canProvideService(['Nutrition', 'Weight Loss'], 'Nutrition'), true);
assert.strictEqual(canProvideService(['Nutrition', 'Weight Loss'], 'Weight Loss'), true);
assert.strictEqual(canProvideService(['Nutrition', 'Weight Loss'], 'Strength Training'), false);

assert.strictEqual(canProvideService(['Strength Training', 'Bodybuilding'], 'Strength Training'), true);
assert.strictEqual(canProvideService(['Strength Training', 'Bodybuilding'], 'Bodybuilding'), true);
assert.strictEqual(canProvideService(['Strength Training', 'Bodybuilding'], 'Muscle Building'), true);
assert.strictEqual(canProvideService(['Strength Training', 'Bodybuilding'], 'Nutrition'), false);

assert.strictEqual(canProvideService(['General Fitness'], 'Nutrition'), true);
assert.strictEqual(canProvideService(['General Fitness'], 'HIIT'), true);
assert.strictEqual(canProvideService(['General Fitness'], 'Meal Planning'), true);

// assertCoachCanProvide uses DB specializations
{
  const nutritionCoach = {
    role: 'coach',
    coachData: { specialties: ['Nutrition'], primarySpecialization: 'Nutrition' },
  };
  assert.strictEqual(assertCoachCanProvide(nutritionCoach, 'Nutrition').ok, true);
  assert.strictEqual(assertCoachCanProvide(nutritionCoach, 'Strength Training').ok, false);
  assert.strictEqual(
    assertCoachCanProvide(nutritionCoach, 'Strength Training').message,
    UNAUTHORIZED_MESSAGE,
  );
}

{
  const emptyCoach = { role: 'coach', coachData: { specialties: [] } };
  assert.strictEqual(assertCoachCanProvide(emptyCoach, 'Nutrition').ok, false);
  assert.strictEqual(
    assertCoachCanProvide(emptyCoach, 'Nutrition').message,
    MISSING_SPECIALIZATION_MESSAGE,
  );
}

assert.strictEqual(categoryFromDietGoal('weight_loss'), 'Weight Loss');
assert.strictEqual(categoryFromDietGoal('muscle_gain'), 'Muscle Building');
assert.strictEqual(categoryFromDietGoal('maintenance'), 'Nutrition');

console.log('coachSpecialization multi-select tests passed');
