const HEIGHT_MIN = 50;
const HEIGHT_MAX = 250;
const WEIGHT_MIN = 20;
const WEIGHT_MAX = 300;

function isValidHeightCm(heightCm) {
  const height = Number(heightCm);
  return Number.isFinite(height) && height >= HEIGHT_MIN && height <= HEIGHT_MAX;
}

function isValidWeightKg(weightKg) {
  const weight = Number(weightKg);
  return Number.isFinite(weight) && weight >= WEIGHT_MIN && weight <= WEIGHT_MAX;
}

/**
 * BMI from validated height (cm) + weight (kg).
 * Returns null when either value is missing or outside allowed ranges.
 */
function calcBmi(heightCm, weightKg) {
  if (!isValidHeightCm(heightCm) || !isValidWeightKg(weightKg)) {
    return null;
  }

  const heightMeters = Number(heightCm) / 100;
  if (!heightMeters) return null;

  return Number((Number(weightKg) / (heightMeters * heightMeters)).toFixed(1));
}

function bmiCategory(bmi) {
  if (bmi == null || !Number.isFinite(Number(bmi))) return null;
  const value = Number(bmi);
  if (value < 18.5) return 'Underweight';
  if (value < 25) return 'Normal weight';
  if (value < 30) return 'Overweight';
  return 'Obesity';
}

module.exports = calcBmi;
module.exports.calcBmi = calcBmi;
module.exports.bmiCategory = bmiCategory;
module.exports.isValidHeightCm = isValidHeightCm;
module.exports.isValidWeightKg = isValidWeightKg;
module.exports.HEIGHT_MIN = HEIGHT_MIN;
module.exports.HEIGHT_MAX = HEIGHT_MAX;
module.exports.WEIGHT_MIN = WEIGHT_MIN;
module.exports.WEIGHT_MAX = WEIGHT_MAX;
