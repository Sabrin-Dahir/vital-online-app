const MealLog = require('../models/MealLog');
const nutritionalAgent = require('../agents/nutritionalAgent');
const { respondWithCaughtError } = require('../utils/httpErrors');
const {
  requireText,
  validateRequiredNumber,
  validateOptionalNumber,
} = require('../utils/fieldValidation');

async function createDietLog(req, res) {
  try {
    const mealNameError = requireText(req.body.mealName || req.body.name, 'Meal name', {
      min: 1,
      max: 200,
    });
    if (mealNameError) return res.status(400).json({ message: mealNameError });

    const caloriesError = validateRequiredNumber(
      req.body.calories,
      'Calories',
      { min: 0, max: 20000 },
    );
    if (caloriesError) return res.status(400).json({ message: caloriesError });

    const proteinError = validateOptionalNumber(req.body.protein, 'Protein', { min: 0, max: 20000 });
    if (proteinError) return res.status(400).json({ message: proteinError });
    const carbsError = validateOptionalNumber(req.body.carbs, 'Carbohydrates', { min: 0, max: 20000 });
    if (carbsError) return res.status(400).json({ message: carbsError });
    const fatsError = validateOptionalNumber(req.body.fats ?? req.body.fat, 'Fat', {
      min: 0,
      max: 20000,
    });
    if (fatsError) return res.status(400).json({ message: fatsError });

    const log = await MealLog.create({
      user: req.user._id,
      mealName: String(req.body.mealName || req.body.name).trim(),
      calories: Number(req.body.calories),
      protein: Number(req.body.protein) || 0,
      carbs: Number(req.body.carbs) || 0,
      fats: Number(req.body.fats ?? req.body.fat) || 0,
      date: req.body.date ? new Date(req.body.date) : new Date(),
    });
    return res.status(201).json(log);
  } catch (error) {
    return respondWithCaughtError(res, error, 'Unable to log meal');
  }
}

async function getDietHistory(req, res) {
  const logs = await MealLog.find({ user: req.user._id }).sort({ date: -1 });
  const intakeSummary = nutritionalAgent.calculateDailyIntake(logs);
  return res.json({ logs, intakeSummary });
}

async function getSuggestedPlan(req, res) {
  const profile = req.user.profile;
  if (!profile) {
    return res.status(400).json({ message: 'Profile not found. Please complete onboarding.' });
  }
  const plan = nutritionalAgent.generateDietPlan(profile);
  return res.json(plan);
}

module.exports = { createDietLog, getDietHistory, getSuggestedPlan };
