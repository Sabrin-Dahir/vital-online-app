const ActivityLog = require('../models/ActivityLog');
const MealLog = require('../models/MealLog');
const WaterLog = require('../models/WaterLog');
const DietAdherence = require('../models/DietAdherence');
const User = require('../models/User');
const { buildSeries, sum, formatDay } = require('../utils/progressMetrics');
const {
  resolveCaloriesIn,
  resolveCaloriesInByDay,
  computeCaloriesOut,
  computeCaloriesOutByDay,
  dayKey,
} = require('../utils/calorieTrackingUtils');
const { resolveUserDietPlan } = require('./dietPlanController');
const dataScientistAgent = require('../agents/dataScientistAgent');
const habitAgent = require('../agents/habitAgent');

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date = new Date()) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + 1);
  return d;
}

const calcBmi = require('../utils/calcBmi');
const { bmiCategory } = require('../utils/calcBmi');
const { respondWithCaughtError } = require('../utils/httpErrors');

async function getProgress(req, res) {
  try {
    const today = startOfDay();
    const tomorrow = endOfDay();
    const weekStart = startOfDay();
    weekStart.setDate(weekStart.getDate() - 6);

    const [
      todayMeals,
      todayActivities,
      todayWater,
      weekMeals,
      weekActivities,
      weekWater,
      plan,
      todayAdherence,
      weekAdherence,
      caloriesOutByDay,
    ] = await Promise.all([
      MealLog.find({ user: req.user._id, date: { $gte: today, $lt: tomorrow } }),
      ActivityLog.find({ user: req.user._id, date: { $gte: today, $lt: tomorrow } }),
      WaterLog.find({ user: req.user._id, date: { $gte: today, $lt: tomorrow } }),
      MealLog.find({ user: req.user._id, date: { $gte: weekStart } }).sort({ date: -1 }).limit(100),
      ActivityLog.find({ user: req.user._id, date: { $gte: weekStart } }).sort({ date: -1 }).limit(100),
      WaterLog.find({ user: req.user._id, date: { $gte: weekStart } }).sort({ date: -1 }).limit(100),
      resolveUserDietPlan(req.user._id),
      DietAdherence.findOne({ user: req.user._id, date: today }).lean(),
      DietAdherence.find({
        user: req.user._id,
        date: { $gte: weekStart, $lt: tomorrow },
      }).lean(),
      computeCaloriesOutByDay(req.user._id, weekStart, tomorrow),
    ]);

    const [caloriesIn, caloriesOut, caloriesInByDay] = await Promise.all([
      resolveCaloriesIn(req.user._id, { plan, adherence: todayAdherence, date: today }),
      computeCaloriesOut(req.user._id, today),
      resolveCaloriesInByDay(req.user._id, plan, weekStart, tomorrow, weekAdherence),
    ]);

    const approvedToday = todayActivities.filter((a) => a.status === 'approved');
    const approvedWeek = weekActivities.filter((a) => a.status === 'approved');

    const hydration = sum(todayWater, 'amountMl');

    const caloriesOutTrend = buildSeries(approvedWeek, 'date', 'caloriesBurned');
    for (const point of caloriesOutTrend) {
      const totalForDay = caloriesOutByDay.get(dayKey(point.date));
      if (totalForDay != null) point.value = totalForDay;
    }
    for (const [key, value] of caloriesOutByDay.entries()) {
      if (caloriesOutTrend.some((p) => dayKey(p.date) === key)) continue;
      caloriesOutTrend.push({
        label: formatDay(new Date(Number(key))),
        date: new Date(Number(key)),
        value,
      });
    }
    caloriesOutTrend.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calories-in trend prefers diet-plan adherence when a plan has meals;
    // falls back to MealLog for days without planned meals.
    const caloriesInTrend = buildSeries(weekMeals, 'date', 'calories');
    for (const point of caloriesInTrend) {
      const fromPlan = caloriesInByDay.get(dayKey(point.date));
      if (fromPlan != null) point.value = fromPlan;
    }

    const analysis = dataScientistAgent.processLogsForCharts({
      meals: weekMeals,
      activities: approvedWeek,
      water: weekWater,
    });
    const habitCompliance = habitAgent.generateComplianceReport({
      activities: approvedWeek,
      water: weekWater,
      profile: req.user.profile,
    });

    const height = req.user.clientData?.height;
    const weight = req.user.clientData?.weight;
    const bmi = calcBmi(height, weight);

    return res.json({
      summary: {
        caloriesIn: Number(caloriesIn) || 0,
        caloriesOut: Number(caloriesOut) || 0,
        hydration: Number(hydration) || 0,
        netCalories: (Number(caloriesIn) || 0) - (Number(caloriesOut) || 0),
        bmi,
        bmiCategory: bmiCategory(bmi),
        weightKg: weight ?? null,
        heightCm: height ?? null,
        logCount: todayMeals.length + approvedToday.length + todayWater.length
          + (todayAdherence?.mealAdherence?.some((m) => m.followed) ? 1 : 0),
      },
      trends: {
        caloriesIn: caloriesInTrend,
        caloriesOut: caloriesOutTrend,
        hydration: buildSeries(weekWater, 'date', 'amountMl'),
      },
      reports: analysis.healthReport,
      compliance: habitCompliance,
      recentLogs: {
        meals: weekMeals.slice(0, 5),
        activities: weekActivities.slice(0, 5),
        water: weekWater.slice(0, 5),
      },
    });
  } catch (error) {
    console.error('getProgress:', error.message);
    return res.status(500).json({ message: 'Error fetching progress' });
  }
}

async function logWeight(req, res) {
  try {
    const weight = Number(req.body.weightKg ?? req.body.weight);
    if (!Number.isFinite(weight) || weight < 20 || weight > 300) {
      return res.status(400).json({ message: 'Weight must be between 20 kg and 300 kg.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.clientData) user.clientData = {};
    user.clientData.weight = weight;
    if (!Array.isArray(user.clientData.weight_history)) {
      user.clientData.weight_history = [];
    }
    user.clientData.weight_history.push({ date: new Date(), weight });
    user.markModified('clientData');
    await user.save({ validateModifiedOnly: true });

    const height = user.clientData.height;
    const bmi = calcBmi(height, weight);

    return res.status(201).json({
      weightKg: weight,
      heightCm: height ?? null,
      bmi,
      bmiCategory: bmiCategory(bmi),
      weight_history: user.clientData.weight_history,
    });
  } catch (error) {
    return respondWithCaughtError(res, error, 'Unable to log weight');
  }
}

module.exports = { getProgress, logWeight };
