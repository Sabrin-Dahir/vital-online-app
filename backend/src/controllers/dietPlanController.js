const DietPlan = require('../models/DietPlan');
const DietAdherence = require('../models/DietAdherence');
const MealLog = require('../models/MealLog');
const Notification = require('../models/Notification');
const FitnessClass = require('../models/FitnessClass');
const User = require('../models/User');
const { buildTodayProgressSnapshot, countPlannedMeals } = require('../utils/dietProgressSnapshot');
const {
  normalizeMealAdherence,
  applySingleMealToggle,
  buildMealCompletionSummary,
  computeAverageAdherence,
  buildWeekDayCompletionSummary,
  enrichWeekCompletionWithPlannedMeals,
  dateForMondayBasedDay,
  getPlannedMealTypes,
  getMealsForDate,
  startOfLocalDay,
  MEAL_LABELS,
  DAY_NAMES,
} = require('../utils/mealAdherenceUtils');
const {
  getWeekStart,
  formatDateOnlyIso,
  parseLocalDate,
  toDateOnlyStorage,
  calendarDateFromInstant,
} = require('../utils/weeklyPlanUtils');
const { USER_DISPLAY_SELECT, withDisplayName } = require('../utils/userDisplay');
const { hasActiveAssignment } = require('../utils/coachVisibility');
const {
  computeCaloriesInFromDietPlan,
  computeCaloriesInFromMealLogs,
  computeNutritionFromDietPlan,
  computeNutritionFromMealLogs,
} = require('../utils/calorieTrackingUtils');

/** Upsert DietAdherence; retry once on duplicate-key race (unique user+date). */
async function upsertDietAdherence(filter, update, options = {}) {
  try {
    return await DietAdherence.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      runValidators: true,
      ...options,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return DietAdherence.findOneAndUpdate(filter, update, {
        upsert: false,
        new: true,
        runValidators: true,
        ...options,
      });
    }
    throw error;
  }
}

async function resolveDayNutrition(userId, plan, mealAdherence, targetDate) {
  if (plan && getPlannedMealTypes(plan, targetDate).length) {
    return computeNutritionFromDietPlan(plan, { mealAdherence }, targetDate)
      || { protein: 0, carbs: 0, fats: 0 };
  }
  return computeNutritionFromMealLogs(userId, targetDate);
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks'];
const GOALS = ['weight_loss', 'muscle_gain', 'maintenance'];
const PLAN_STATUSES = ['draft', 'active', 'completed', 'archived'];

function planAssigneeName(plan) {
  if (plan?.client) {
    const client = withDisplayName(plan.client);
    return client?.name || 'Client';
  }
  return plan?.fitnessClass?.title || 'Unassigned';
}

async function loadEnrichedDietPlan(planId) {
  const plan = await DietPlan.findById(planId)
    .populate('coach', USER_DISPLAY_SELECT)
    .populate('client', USER_DISPLAY_SELECT)
    .populate('fitnessClass', 'title enrolledStudents')
    .lean();
  return enrichDietPlan(plan);
}

function normalizeStatus(status) {
  const value = String(status || 'active').toLowerCase();
  return PLAN_STATUSES.includes(value) ? value : 'active';
}

function displayStatus(status) {
  return normalizeStatus(status);
}

function mealHasContent(meal) {
  const name = String(meal?.name || '').trim();
  const description = String(meal?.description || '').trim();
  const foodItems = Array.isArray(meal?.foodItems) ? meal.foodItems : [];
  return Boolean(name || description || foodItems.length);
}

function normalizeFoodItems(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMeal(meal, fallbackType) {
  const { normalizeReminderTime, isReminderMealType } = require('../utils/mealReminderUtils');
  const type = MEAL_TYPES.includes(meal?.type)
    ? meal.type
    : (fallbackType || _inferMealType(meal?.name));
  // Snacks stay on the diet plan but never carry a reminder time.
  const reminderTime = isReminderMealType(type)
    ? normalizeReminderTime(meal?.reminderTime)
    : '';

  const nutritionFields = [
    ['calories', meal?.calories],
    ['protein', meal?.protein],
    ['carbs', meal?.carbs],
    ['fats', meal?.fats ?? meal?.fat],
  ];
  for (const [label, raw] of nutritionFields) {
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      const err = new Error(`${label} must be a number`);
      err.status = 400;
      throw err;
    }
    if (parsed < 0) {
      const err = new Error(`${label} cannot be negative`);
      err.status = 400;
      throw err;
    }
  }

  const reminderRaw = String(meal?.reminderTime || '').trim();
  if (
    isReminderMealType(type)
    && reminderRaw
    && !normalizeReminderTime(reminderRaw)
  ) {
    const err = new Error('Meal time must be a valid time (HH:MM)');
    err.status = 400;
    throw err;
  }

  return {
    type,
    name: meal?.name || '',
    description: meal?.description || '',
    foodItems: normalizeFoodItems(meal?.foodItems),
    portionSize: String(meal?.portionSize || '').trim(),
    calories: Math.max(0, Number(meal?.calories) || 0),
    protein: Math.max(0, Number(meal?.protein) || 0),
    carbs: Math.max(0, Number(meal?.carbs) || 0),
    fats: Math.max(0, Number(meal?.fats ?? meal?.fat) || 0),
    reminderTime,
    prepInstructions: String(meal?.prepInstructions || '').trim(),
    mealNotes: String(meal?.mealNotes || meal?.notes || '').trim(),
  };
}

function validateDailyCalories(value) {
  const calories = Number(value);
  if (!Number.isFinite(calories) || calories < 1) {
    return { error: 'dailyCalories must be a positive number' };
  }
  if (calories > 20000) {
    return { error: 'dailyCalories is unrealistically high' };
  }
  return { value: Math.round(calories) };
}

async function findActivePlanForAssignee(coachId, { clientId, fitnessClassId }, excludeId) {
  const query = { coach: coachId, status: 'active' };
  if (clientId) query.client = clientId;
  if (fitnessClassId) query.fitnessClass = fitnessClassId;
  if (excludeId) query._id = { $ne: excludeId };
  return DietPlan.findOne(query).select('_id title status updatedAt').lean();
}

async function completeActivePlansForAssignee(coachId, { clientId, fitnessClassId }, excludeId) {
  const query = { coach: coachId, status: 'active' };
  if (clientId) query.client = clientId;
  if (fitnessClassId) query.fitnessClass = fitnessClassId;
  if (excludeId) query._id = { $ne: excludeId };
  await DietPlan.updateMany(query, { $set: { status: 'completed' } });
}

/**
 * When activating a plan, move other plans that apply to affected user(s)
 * into history (status: completed).
 * - Individual: complete previous individual plans for that client.
 * - Group: complete previous group plans for that class, and individual
 *   active plans for enrolled members so the group plan becomes visible.
 */
async function supersedePlansForActivation(coachId, plan, excludeId) {
  if (plan.client) {
    await completeActivePlansForAssignee(coachId, { clientId: plan.client }, excludeId);
    return;
  }

  if (plan.fitnessClass) {
    await completeActivePlansForAssignee(coachId, { fitnessClassId: plan.fitnessClass }, excludeId);

    const fitnessClass = await FitnessClass.findById(plan.fitnessClass).select('enrolledStudents').lean();
    const studentIds = (fitnessClass?.enrolledStudents || []).map((id) => id);
    if (studentIds.length) {
      await DietPlan.updateMany(
        {
          coach: coachId,
          status: 'active',
          client: { $in: studentIds },
          ...(excludeId ? { _id: { $ne: excludeId } } : {}),
        },
        { $set: { status: 'completed' } },
      );
    }
  }
}

async function notifyPlanAssigned(plan, { isUpdate = false, isResend = false } = {}) {
  const resolvedGoal = (plan.goal || 'maintenance').replace('_', ' ');
  const action = isResend ? 'shared' : (isUpdate ? 'updated' : 'assigned');
  const messageSuffix = `(${resolvedGoal} · ${plan.dailyCalories} kcal/day).`;

  if (plan.fitnessClass) {
    const fitnessClass = await FitnessClass.findById(plan.fitnessClass).populate('enrolledStudents', USER_DISPLAY_SELECT);
    if (!fitnessClass) return;
    const studentIds = (fitnessClass.enrolledStudents || []).map((s) => s._id || s);
    await notifyUsers(
      studentIds,
      `Your coach ${action} a diet plan for ${fitnessClass.title} ${messageSuffix}`,
      isUpdate || isResend ? 'update' : 'diet',
    );
    await Notification.create({
      user: plan.coach,
      message: `Group diet plan ${action} for ${fitnessClass.title}`,
      type: 'update',
    });
    return;
  }

  if (plan.client) {
    const client = await User.findById(plan.client).select(USER_DISPLAY_SELECT).lean();
    const clientName = withDisplayName(client)?.name || 'your client';
    await notifyUsers(
      [plan.client],
      `Your coach ${action} your diet plan ${messageSuffix}`,
      isUpdate || isResend ? 'update' : 'diet',
    );
    await Notification.create({
      user: plan.coach,
      message: `Diet plan ${action} for ${clientName}`,
      type: 'update',
    });
  }
}

function normalizeMealsArray(meals) {
  if (!meals) return [];

  if (Array.isArray(meals)) {
    return meals.map((meal) => normalizeMeal(meal));
  }

  if (typeof meals === 'object') {
    return MEAL_TYPES
      .filter((type) => meals[type])
      .map((type) => {
        const val = meals[type];
        if (typeof val === 'string') {
          return normalizeMeal({
            type,
            name: _capitalize(type),
            description: val,
          }, type);
        }
        return normalizeMeal({ ...val, type }, type);
      });
  }

  return [];
}

function normalizeDietDays(days, weekStartDate = null) {
  const byDay = new Map();
  if (Array.isArray(days)) {
    for (const day of days) {
      const dow = Number(day.dayOfWeek);
      if (!Number.isFinite(dow) || dow < 0 || dow > 6) continue;
      byDay.set(dow, {
        dayOfWeek: dow,
        meals: normalizeMealsArray(day.meals),
        notes: day.notes || '',
        date: day.date || null,
      });
    }
  }
  const weekStart = weekStartDate ? getWeekStart(weekStartDate) : null;
  return Array.from({ length: 7 }, (_, i) => {
    const base = byDay.get(i) || { dayOfWeek: i, meals: [], notes: '', date: null };
    if (!weekStart) return base;
    const localMonday = parseLocalDate(weekStart);
    const dayDate = new Date(localMonday);
    dayDate.setDate(localMonday.getDate() + i);
    return {
      ...base,
      dayOfWeek: i,
      date: toDateOnlyStorage(dayDate),
    };
  });
}

function resolveWeeklyStartDate(weekStartDate, fallback = new Date()) {
  if (weekStartDate == null || weekStartDate === '') return getWeekStart(fallback);
  return getWeekStart(weekStartDate);
}

/** Client-local "today" (midnight) for diet day lock checks. */
function clientLocalToday(timezoneOffsetMinutes) {
  if (timezoneOffsetMinutes == null || timezoneOffsetMinutes === '') {
    return startOfLocalDay(new Date());
  }
  const offset = Number(timezoneOffsetMinutes);
  if (!Number.isFinite(offset)) return startOfLocalDay(new Date());
  return startOfLocalDay(calendarDateFromInstant(new Date(), offset));
}

function dayHasAllWeeklyMealTypes(meals) {
  const types = new Set((meals || []).filter((m) => mealHasContent(m)).map((m) => m.type));
  return MEAL_TYPES.every((t) => types.has(t));
}

/** Weekly: one meal template; each assigned day in days[] gets those meals (schema unchanged). */
function validateWeeklyPlanStructure(weekDays, flatMeals = []) {
  const normalizedFlat = normalizeMealsArray(flatMeals).filter((m) => mealHasContent(m));
  let templateMeals = normalizedFlat;
  const assignedDays = (weekDays || []).filter((d) => (d.meals || []).some((m) => mealHasContent(m)));

  if (!templateMeals.length && assignedDays.length) {
    templateMeals = assignedDays[0].meals.filter((m) => mealHasContent(m));
  }

  if (!dayHasAllWeeklyMealTypes(templateMeals)) {
    return {
      error: 'Add Breakfast, Lunch, Dinner, and Snacks for the weekly plan.',
    };
  }
  if (!assignedDays.length) {
    return {
      error: 'Select at least one day (Monday–Sunday) for this weekly plan.',
    };
  }
  for (const day of assignedDays) {
    if (!dayHasAllWeeklyMealTypes(day.meals)) {
      return {
        error: `Each selected day needs Breakfast, Lunch, Dinner, and Snacks (${DAY_NAMES[day.dayOfWeek]}).`,
      };
    }
  }
  return null;
}

function weeklyPlanHasAllSevenDays(structure) {
  if (!structure || structure.planType !== 'weekly') return true;
  const filled = (structure.days || []).filter((d) =>
    (d.meals || []).some((m) => mealHasContent(m)),
  ).length;
  return filled >= 7;
}

function resolvePlanStructure({ planType, meals, days, targetDayOfWeek, weekStartDate }) {
  const type = planType === 'weekly' ? 'weekly' : 'single_day';
  if (type === 'weekly') {
    const weekStart = resolveWeeklyStartDate(weekStartDate);
    const normalizedDays = normalizeDietDays(days, weekStart);
    const flatMeals = normalizeMealsArray(meals).filter((m) => mealHasContent(m));
    let weekDays = Array.from({ length: 7 }, (_, i) => ({
      dayOfWeek: i,
      meals: (normalizedDays[i]?.meals || []).filter((m) => mealHasContent(m)),
      notes: normalizedDays[i]?.notes || '',
      date: normalizedDays[i]?.date || null,
    }));

    const assignedCount = weekDays.filter((d) => d.meals.length).length;
    if (flatMeals.length && dayHasAllWeeklyMealTypes(flatMeals) && assignedCount === 0) {
      weekDays = weekDays.map((d) => ({ ...d, meals: flatMeals }));
    }

    const weeklyError = validateWeeklyPlanStructure(weekDays, flatMeals);
    if (weeklyError) return weeklyError;

    const templateMeals = flatMeals.length
      ? flatMeals
      : (weekDays.find((d) => d.meals.length)?.meals || []);
    return {
      planType: 'weekly',
      days: weekDays,
      meals: templateMeals,
      targetDayOfWeek: null,
      weekStartDate: weekStart,
    };
  }
  const normalizedMeals = normalizeMealsArray(meals);
  let day = targetDayOfWeek;
  if (day != null && day !== '') {
    day = Number(day);
    if (!Number.isFinite(day) || day < 0 || day > 6) {
      return { error: 'Select a valid day for the single-day plan' };
    }
  } else {
    day = null;
  }
  if (day == null) {
    return { error: 'Check one day for the single-day diet plan' };
  }
  if (!normalizedMeals.some((m) => mealHasContent(m))) {
    return { error: 'Add at least one meal for the selected day' };
  }
  return {
    planType: 'single_day',
    days: [],
    meals: normalizedMeals,
    targetDayOfWeek: day,
    weekStartDate: null,
  };
}

function enrichDietPlan(plan, date = new Date()) {
  if (!plan) return plan;
  const { getMealsForDate, mondayBasedDayOfWeek, DAY_NAMES } = require('../utils/mealAdherenceUtils');
  const obj = plan.toObject ? plan.toObject() : { ...plan };
  if (obj.client) obj.client = withDisplayName(obj.client);
  if (obj.coach) obj.coach = withDisplayName(obj.coach);
  const todaysMeals = getMealsForDate(obj, date);
  const dow = mondayBasedDayOfWeek(date);
  const target = obj.targetDayOfWeek != null ? Number(obj.targetDayOfWeek) : null;
  const rawDays = Array.isArray(obj.days) ? obj.days : [];
  const weekStart = obj.planType === 'weekly' && obj.weekStartDate
    ? getWeekStart(obj.weekStartDate)
    : null;
  const daysOut = obj.planType === 'weekly'
    ? normalizeDietDays(rawDays, weekStart || obj.weekStartDate || null).map((day) => ({
      ...day,
      date: day.date ? formatDateOnlyIso(day.date) : null,
      dayName: DAY_NAMES[day.dayOfWeek] || '',
    }))
    : rawDays;
  return {
    ...obj,
    planType: obj.planType || 'single_day',
    weekStartDate: weekStart ? formatDateOnlyIso(weekStart) : (obj.weekStartDate ? formatDateOnlyIso(obj.weekStartDate) : null),
    days: daysOut,
    meals: Array.isArray(obj.meals) ? obj.meals : [],
    targetDayOfWeek: Number.isFinite(target) ? target : null,
    targetDayName: Number.isFinite(target) ? DAY_NAMES[target] : null,
    todaysMeals,
    todayDayOfWeek: dow,
    todayDayName: DAY_NAMES[dow],
    assigneeType: obj.client ? 'user' : 'group',
    assigneeName: planAssigneeName(obj),
  };
}

function mealsForReminders(plan) {
  const { getMealsForDate } = require('../utils/mealAdherenceUtils');
  return getMealsForDate(plan);
}

function _inferMealType(name) {
  const label = String(name || '').toLowerCase();
  if (label.includes('break')) return 'breakfast';
  if (label.includes('lunch')) return 'lunch';
  if (label.includes('dinner')) return 'dinner';
  return 'snacks';
}

function _capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function notifyUsers(userIds, message, type = 'diet') {
  if (!userIds.length) return;
  await Notification.insertMany(
    userIds.map((userId) => ({ user: userId, message, type })),
  );
}

async function resolveUserDietPlan(clientId) {
  const individual = await DietPlan.findOne({
    client: clientId,
    status: 'active',
  })
    .populate('coach', USER_DISPLAY_SELECT)
    .populate('client', USER_DISPLAY_SELECT)
    .populate('fitnessClass', 'title')
    .lean();

  if (individual) return individual;

  const classIds = await FitnessClass.find({ enrolledStudents: clientId }).distinct('_id');
  if (!classIds.length) return null;

  return DietPlan.findOne({
    fitnessClass: { $in: classIds },
    status: 'active',
  })
    .populate('coach', USER_DISPLAY_SELECT)
    .populate('fitnessClass', 'title')
    .sort({ updatedAt: -1 })
    .lean();
}

/** Past (completed) diet plans for this user — personal or via a group. */
async function getUserDietPlanHistory(req, res) {
  try {
    const userId = req.user._id;
    const classIds = await FitnessClass.find({ enrolledStudents: userId }).distinct('_id');

    const plans = await DietPlan.find({
      status: { $in: ['completed', 'archived'] },
      $or: [
        { client: userId },
        ...(classIds.length ? [{ fitnessClass: { $in: classIds } }] : []),
      ],
    })
      .populate('coach', USER_DISPLAY_SELECT)
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    return res.json({
      plans: plans.map((plan) => ({
        ...plan,
        status: displayStatus(plan.status),
        assigneeType: plan.client ? 'user' : 'group',
        assigneeName: planAssigneeName(plan),
      })),
    });
  } catch (error) {
    console.error('getUserDietPlanHistory:', error.message);
    return res.status(500).json({ message: 'Error fetching diet plan history' });
  }
}

async function verifyCoachClient(coachId, clientId) {
  return hasActiveAssignment(coachId, clientId);
}

// --- User endpoints ---

async function loadWeekCompletion(userId, refDate = new Date(), plan = null, options = {}) {
  const today = options.today || startOfLocalDay(refDate);
  const weekAnchor = plan?.planType === 'weekly' && plan.weekStartDate
    ? parseLocalDate(plan.weekStartDate)
    : refDate;
  const weekStart = dateForMondayBasedDay(0, weekAnchor);
  const weekEnd = dateForMondayBasedDay(6, weekAnchor);
  if (!weekStart || !weekEnd) {
    return buildWeekDayCompletionSummary([], weekAnchor, { today });
  }
  const endExclusive = new Date(weekEnd);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const records = await DietAdherence.find({
    user: userId,
    date: { $gte: weekStart, $lt: endExclusive },
  }).lean();
  const summary = buildWeekDayCompletionSummary(records, weekAnchor, { today });
  if (plan?.planType === 'weekly') {
    return enrichWeekCompletionWithPlannedMeals(plan, summary, weekAnchor);
  }
  return summary;
}

async function getUserAssignedDietPlan(req, res) {
  try {
    const clientId = req.user.role === 'coach' ? req.query.clientId : req.user._id;
    if (!clientId) {
      return res.status(400).json({ message: 'clientId required for coach' });
    }

    if (req.user.role === 'coach') {
      const allowed = await verifyCoachClient(req.user._id, clientId);
      if (!allowed) return res.status(403).json({ message: 'Client not assigned to you' });
    }

    const plan = await resolveUserDietPlan(clientId);

    if (!plan) {
      return res.status(404).json({ message: 'No active diet plan found' });
    }

    // Coaches may only view plans they own (not another coach's active plan for the same client).
    if (req.user.role === 'coach') {
      const planCoachId = plan.coach?._id || plan.coach;
      if (String(planCoachId) !== String(req.user._id)) {
        return res.status(403).json({ message: 'This client\'s active diet plan is not yours' });
      }
    }

    const today = startOfDay();
    const todaySnapshot = await buildTodayProgressSnapshot(clientId, plan);
    const weekCompletion = plan.planType === 'weekly'
      ? await loadWeekCompletion(clientId, today, plan)
      : null;

    return res.json({
      plan: enrichDietPlan(plan),
      today: {
        ...todaySnapshot,
        adherence: await DietAdherence.findOne({ user: clientId, date: today }).lean(),
        weeklyAveragePercent: await computeAverageAdherence(DietAdherence, clientId, 7),
        weekCompletion,
      },
    });
  } catch (error) {
    console.error('getUserAssignedDietPlan:', error.message);
    return res.status(500).json({ message: 'Error fetching diet plan' });
  }
}

async function getUserDietProgress(req, res) {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 14, 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [plan, adherence, mealLogs] = await Promise.all([
      resolveUserDietPlan(req.user._id),
      DietAdherence.find({ user: req.user._id, date: { $gte: since } }).sort({ date: -1 }).lean(),
      MealLog.find({ user: req.user._id, date: { $gte: since } }).sort({ date: -1 }).lean(),
    ]);

    const avgAdherence = adherence.length
      ? Math.round(adherence.reduce((s, a) => s + (a.adherencePercent || 0), 0) / adherence.length)
      : 0;

    const todaySnapshot = await buildTodayProgressSnapshot(req.user._id, plan);
    const weeklyAveragePercent = await computeAverageAdherence(DietAdherence, req.user._id, 7);
    const weekCompletion = plan?.planType === 'weekly'
      ? await loadWeekCompletion(req.user._id, new Date(), plan)
      : null;

    const weightHistory = adherence
      .filter((a) => a.weightKg != null)
      .map((a) => ({ date: a.date, weightKg: a.weightKg }));

    return res.json({
      plan,
      avgAdherence,
      weeklyAveragePercent,
      today: {
        ...todaySnapshot,
        weeklyAveragePercent,
        weekCompletion,
      },
      weekCompletion,
      adherenceHistory: adherence,
      mealLogs,
      weightHistory,
    });
  } catch (error) {
    console.error('getUserDietProgress:', error.message);
    return res.status(500).json({ message: 'Error fetching diet progress' });
  }
}

async function recomputeCaloriesForDay(userId, plan, mealAdherence, targetDate, clientCalories) {
  const plannedTypes = getPlannedMealTypes(plan, targetDate);
  // Always derive from the plan when meals exist so client-sent 0 cannot freeze progress.
  if (plannedTypes.length) {
    return computeCaloriesInFromDietPlan(plan, { mealAdherence }, targetDate) ?? 0;
  }
  if (clientCalories != null && Number.isFinite(Number(clientCalories))) {
    return Math.max(0, Number(clientCalories));
  }
  return computeCaloriesInFromMealLogs(userId, targetDate);
}

async function logUserAdherence(req, res) {
  try {
    const {
      weightKg,
      mealAdherence,
      mealType,
      followed,
      notes,
      caloriesConsumed,
      dayCompleted,
      dayOfWeek,
      date: dateInput,
      timezoneOffsetMinutes,
    } = req.body;

    const plan = await resolveUserDietPlan(req.user._id);
    if (!plan) {
      return res.status(400).json({ message: 'No active diet plan assigned' });
    }

    const todayLocal = clientLocalToday(timezoneOffsetMinutes);

    let targetDate = startOfDay(todayLocal);
    if (dateInput) {
      const raw = String(dateInput).trim();
      const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      if (ymd) {
        // Interpret calendar date in local components (avoid UTC Date.parse shift).
        targetDate = startOfDay(new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
      } else {
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ message: 'Invalid date' });
        }
        targetDate = startOfDay(parsed);
      }
    } else if (dayOfWeek != null && dayOfWeek !== '') {
      const weekAnchor = plan.planType === 'weekly' && plan.weekStartDate
        ? parseLocalDate(plan.weekStartDate)
        : todayLocal;
      const dated = dateForMondayBasedDay(Number(dayOfWeek), weekAnchor);
      if (!dated) return res.status(400).json({ message: 'Invalid dayOfWeek' });
      targetDate = startOfDay(dated);
    }

    // Future diet days stay locked until their calendar date arrives (client-local today).
    if (targetDate.getTime() > todayLocal.getTime()) {
      return res.status(400).json({
        message: 'This diet day is locked until its date arrives.',
        code: 'DIET_DAY_LOCKED',
      });
    }

    const existing = await DietAdherence.findOne({ user: req.user._id, date: targetDate }).lean();

    const clientName = withDisplayName(req.user)?.name
      || req.user.full_name
      || req.user.username
      || 'A client';
    const coachId = plan?.coach?._id || plan?.coach;

    // Weekly day-level completion toggle.
    if (typeof dayCompleted === 'boolean') {
      if (plan.planType !== 'weekly') {
        return res.status(400).json({ message: 'Day completion is only for weekly diet plans' });
      }
      const plannedTypes = getPlannedMealTypes(plan, targetDate);
      const mealRows = plannedTypes.map((type) => {
        const prev = (existing?.mealAdherence || []).find((m) => m.type === type);
        return {
          type,
          followed: dayCompleted,
          notes: prev?.notes || '',
          completedAt: dayCompleted
            ? (prev?.followed && prev?.completedAt ? prev.completedAt : new Date())
            : null,
        };
      });
      const resolvedCalories = await recomputeCaloriesForDay(
        req.user._id,
        plan,
        mealRows,
        targetDate,
        caloriesConsumed,
      );
      const nutrition = await resolveDayNutrition(req.user._id, plan, mealRows, targetDate);

      const record = await upsertDietAdherence(
        { user: req.user._id, date: targetDate },
        {
          $set: {
            coach: coachId,
            dietPlan: plan._id,
            weightKg,
            caloriesConsumed: resolvedCalories || 0,
            targetCalories: plan.dailyCalories || 0,
            dayCompleted,
            followedPlan: dayCompleted,
            completedAt: dayCompleted ? (existing?.completedAt || new Date()) : null,
            adherencePercent: dayCompleted ? 100 : 0,
            coachMarked: false,
            mealAdherence: mealRows,
            notes: notes || existing?.notes || '',
          },
          $setOnInsert: {
            user: req.user._id,
            date: targetDate,
          },
        },
      );

      if (coachId && dayCompleted && !existing?.dayCompleted && !existing?.followedPlan) {
        const dayName = DAY_NAMES[Number(dayOfWeek)]
          || DAY_NAMES[require('../utils/mealAdherenceUtils').mondayBasedDayOfWeek(targetDate)];
        await Notification.create({
          user: coachId,
          message: `${clientName} completed their diet day (${dayName}).`,
          type: 'diet',
        });
      }

      const weekCompletion = await loadWeekCompletion(req.user._id, targetDate, plan, { today: todayLocal });
      const todaySnapshot = await buildTodayProgressSnapshot(req.user._id, plan, todayLocal);
      return res.json({
        ...record.toObject(),
        nutrition,
        weekCompletion,
        weeklyAveragePercent: weekCompletion.weeklyProgressPercent,
        today: todaySnapshot,
      });
    }

    let normalizedMeals;
    if (mealType) {
      if (!MEAL_LABELS[mealType]) {
        return res.status(400).json({ message: 'Invalid mealType' });
      }
      const planned = getPlannedMealTypes(plan, targetDate);
      if (!planned.includes(mealType)) {
        return res.status(400).json({
          message: `${MEAL_LABELS[mealType]} is not planned for this day`,
        });
      }
      normalizedMeals = applySingleMealToggle(existing, mealType, followed, plan, targetDate);
    } else {
      normalizedMeals = normalizeMealAdherence(existing, mealAdherence, plan, targetDate);
    }

    const summary = buildMealCompletionSummary(plan, { mealAdherence: normalizedMeals }, targetDate);
    const adherencePercent = summary.dailyProgressPercent;
    const isFullyCompleted = summary.allCompleted;

    const resolvedCalories = await recomputeCaloriesForDay(
      req.user._id,
      plan,
      normalizedMeals,
      targetDate,
      caloriesConsumed,
    );
    const nutrition = await resolveDayNutrition(req.user._id, plan, normalizedMeals, targetDate);

    const record = await upsertDietAdherence(
      { user: req.user._id, date: targetDate },
      {
        $set: {
          coach: coachId,
          dietPlan: plan._id,
          weightKg,
          caloriesConsumed: resolvedCalories || 0,
          targetCalories: plan.dailyCalories || 0,
          dayCompleted: isFullyCompleted,
          followedPlan: isFullyCompleted,
          completedAt: isFullyCompleted ? (existing?.completedAt || new Date()) : null,
          adherencePercent,
          coachMarked: false,
          mealAdherence: normalizedMeals,
          notes: notes || existing?.notes || '',
        },
        $setOnInsert: {
          user: req.user._id,
          date: targetDate,
        },
      },
    );

    if (coachId && mealType && followed) {
      const prevMeal = (existing?.mealAdherence || []).find((m) => m.type === mealType);
      if (!(prevMeal && prevMeal.followed)) {
        await Notification.create({
          user: coachId,
          message: `${clientName} completed ${MEAL_LABELS[mealType] || mealType} on their diet plan.`,
          type: 'diet',
        });
      }
    }

    if (coachId && isFullyCompleted && !(existing && existing.followedPlan)) {
      await Notification.create({
        user: coachId,
        message: `${clientName} completed all meals on their diet plan today.`,
        type: 'diet',
      });
    }

    const weekCompletion = plan.planType === 'weekly'
      ? await loadWeekCompletion(req.user._id, todayLocal, plan, { today: todayLocal })
      : null;
    const todaySnapshot = await buildTodayProgressSnapshot(req.user._id, plan, todayLocal);

    return res.json({
      ...record.toObject(),
      mealSummary: summary,
      nutrition,
      weekCompletion,
      weeklyAveragePercent: weekCompletion?.weeklyProgressPercent
        ?? await computeAverageAdherence(DietAdherence, req.user._id, 7),
      today: todaySnapshot,
    });
  } catch (error) {
    console.error('logUserAdherence:', error.message);
    return res.status(500).json({ message: 'Error logging adherence' });
  }
}

// --- Coach endpoints ---

async function getCoachDietPlans(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const skip = (page - 1) * limit;
    const search = String(req.query.search || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || 'all').toLowerCase();
    const assigneeType = String(req.query.assigneeType || 'all').toLowerCase();
    const sortOrder = String(req.query.sort || 'newest').toLowerCase() === 'oldest' ? 1 : -1;

    const query = { coach: req.user._id };
    if (statusFilter !== 'all') {
      if (statusFilter === 'completed') {
        query.status = { $in: ['completed', 'archived'] };
      } else {
        query.status = statusFilter;
      }
    } else {
      query.status = { $ne: 'archived' };
    }

    if (assigneeType === 'user') {
      query.client = { $ne: null };
    } else if (assigneeType === 'group') {
      query.fitnessClass = { $ne: null };
    }

    const fetchLimit = search ? Math.min(limit * 20, 200) : limit;
    const fetchSkip = search ? 0 : skip;

    const plans = await DietPlan.find(query)
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title enrolledStudents')
      .sort({ createdAt: sortOrder })
      .skip(fetchSkip)
      .limit(fetchLimit)
      .lean();

    let enriched = plans.map((plan) => ({
      ...plan,
      status: displayStatus(plan.status),
      assigneeType: plan.client ? 'user' : 'group',
      assigneeName: planAssigneeName(plan),
      client: plan.client ? withDisplayName(plan.client) : plan.client,
    }));

    if (search) {
      enriched = enriched.filter((plan) => {
        const clientName = (plan.assigneeName || '').toLowerCase();
        const className = plan.fitnessClass?.title?.toLowerCase() || '';
        const title = plan.title?.toLowerCase() || '';
        return clientName.includes(search) || className.includes(search) || title.includes(search);
      });
    }

    const total = search ? enriched.length : await DietPlan.countDocuments(query);
    const paged = search ? enriched.slice(skip, skip + limit) : enriched;

    return res.json({
      plans: paged,
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    console.error('getCoachDietPlans:', error.message);
    return res.status(500).json({ message: 'Error fetching diet plans' });
  }
}

async function getDietPlanById(req, res) {
  try {
    const plan = await DietPlan.findOne({ _id: req.params.id, coach: req.user._id })
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title enrolledStudents')
      .lean();
    if (!plan) return res.status(404).json({ message: 'Diet plan not found' });
    const enriched = enrichDietPlan(plan);
    return res.json({
      ...enriched,
      status: displayStatus(plan.status),
      assigneeType: plan.client ? 'user' : 'group',
      assigneeName: planAssigneeName(plan),
    });
  } catch (error) {
    console.error('getDietPlanById:', error.message);
    return res.status(500).json({ message: 'Error fetching diet plan' });
  }
}

async function getClientDietPlan(req, res) {
  try {
    const { clientId } = req.params;
    const allowed = await verifyCoachClient(req.user._id, clientId);
    if (!allowed) return res.status(403).json({ message: 'Client not assigned to you' });

    let plan = await DietPlan.findOne({
      coach: req.user._id,
      client: clientId,
      status: 'active',
    })
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title')
      .lean();

    // Fall back to the plan the user actually sees (e.g. group assignment).
    if (!plan) {
      const resolved = await resolveUserDietPlan(clientId);
      const coachId = resolved?.coach?._id || resolved?.coach;
      if (resolved && String(coachId) === String(req.user._id)) {
        plan = resolved;
      }
    }

    return res.json(plan ? enrichDietPlan(plan) : null);
  } catch (error) {
    console.error('getClientDietPlan:', error.message);
    return res.status(500).json({ message: 'Error fetching client diet plan' });
  }
}

async function getGroupDietPlan(req, res) {
  try {
    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.classId,
      coach: req.user._id,
    });
    if (!fitnessClass) return res.status(404).json({ message: 'Class not found' });

    const plan = await DietPlan.findOne({
      coach: req.user._id,
      fitnessClass: req.params.classId,
      status: 'active',
    })
      .populate('fitnessClass', 'title enrolledStudents')
      .lean();

    return res.json(plan ? enrichDietPlan(plan) : null);
  } catch (error) {
    console.error('getGroupDietPlan:', error.message);
    return res.status(500).json({ message: 'Error fetching group diet plan' });
  }
}

async function getGroupDietProgress(req, res) {
  try {
    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.classId,
      coach: req.user._id,
    }).populate('enrolledStudents', USER_DISPLAY_SELECT);

    if (!fitnessClass) return res.status(403).json({ message: 'Class not found' });

    const days = Math.min(parseInt(req.query.days, 10) || 14, 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const studentIds = (fitnessClass.enrolledStudents || []).map((s) => s._id || s);

    const [plan, adherence] = await Promise.all([
      DietPlan.findOne({ coach: req.user._id, fitnessClass: req.params.classId, status: 'active' }).lean(),
      DietAdherence.find({ user: { $in: studentIds }, date: { $gte: since } }).sort({ date: -1 }).lean(),
    ]);

    const avgAdherence = adherence.length
      ? Math.round(adherence.reduce((s, a) => s + (a.adherencePercent || 0), 0) / adherence.length)
      : 0;

    const memberSnapshots = studentIds.length
      ? await Promise.all(studentIds.map((id) => buildTodayProgressSnapshot(id, plan)))
      : [];

    const today = memberSnapshots.length
      ? {
          caloriesConsumed: Math.round(memberSnapshots.reduce((s, m) => s + m.caloriesConsumed, 0) / memberSnapshots.length),
          targetCalories: plan?.dailyCalories || 0,
          waterMl: Math.round(memberSnapshots.reduce((s, m) => s + m.waterMl, 0) / memberSnapshots.length),
          targetWaterMl: memberSnapshots[0]?.targetWaterMl || 2000,
          mealsCompleted: Math.round(memberSnapshots.reduce((s, m) => s + m.mealsCompleted, 0) / memberSnapshots.length),
          mealsPlanned: plan ? countPlannedMeals(plan) : 0,
          workoutsCompleted: Math.round(memberSnapshots.reduce((s, m) => s + m.workoutsCompleted, 0) / memberSnapshots.length),
          workoutsPlanned: Math.max(...memberSnapshots.map((m) => m.workoutsPlanned), 0),
          dailyGoalPercent: memberSnapshots.length
            ? Math.round(memberSnapshots.reduce((s, m) => s + m.dailyGoalPercent, 0) / memberSnapshots.length)
            : 0,
          adherencePercent: avgAdherence,
          followedPlan: memberSnapshots.some((m) => m.followedPlan),
          hasActivity: memberSnapshots.some((m) => m.hasActivity),
        }
      : {
          caloriesConsumed: 0,
          targetCalories: plan?.dailyCalories || 0,
          waterMl: 0,
          targetWaterMl: 2000,
          mealsCompleted: 0,
          mealsPlanned: plan ? countPlannedMeals(plan) : 0,
          workoutsCompleted: 0,
          workoutsPlanned: 0,
          dailyGoalPercent: 0,
          adherencePercent: 0,
          followedPlan: false,
          hasActivity: false,
        };

    const perMember = studentIds.map((id, index) => {
      const member = fitnessClass.enrolledStudents.find((s) => String(s._id) === String(id));
      const memberRecords = adherence.filter((a) => String(a.user) === String(id));
      const latest = memberRecords[0];
      const snapshot = memberSnapshots[index] || {};
      return {
        userId: id,
        name: withDisplayName(member)?.name || 'Member',
        latestAdherence: latest,
        mealAdherence: latest?.mealAdherence || snapshot.mealAdherence || [],
        mealsCompleted: snapshot.mealsCompleted || 0,
        mealsPlanned: snapshot.mealsPlanned || (plan ? countPlannedMeals(plan) : 0),
        avgAdherence: memberRecords.length
          ? Math.round(memberRecords.reduce((s, r) => s + (r.adherencePercent || 0), 0) / memberRecords.length)
          : 0,
      };
    });

    const plannedTypes = plan
      ? require('../utils/mealAdherenceUtils').getPlannedMealTypes(plan)
      : [];

    return res.json({
      plan,
      memberCount: studentIds.length,
      avgAdherence,
      today: {
        ...today,
        mealAdherence: [],
        plannedMealTypes: plannedTypes,
      },
      caloriesToday: today.caloriesConsumed,
      adherenceHistory: adherence,
      members: perMember,
      plannedMealTypes: plannedTypes,
    });
  } catch (error) {
    console.error('getGroupDietProgress:', error.message);
    return res.status(500).json({ message: 'Error fetching group progress' });
  }
}

async function createOrUpdateDietPlan(req, res) {
  try {
    const {
      planId,
      clientId,
      fitnessClassId,
      title,
      goal,
      meals,
      days,
      planType,
      targetDayOfWeek,
      weekStartDate,
      dailyCalories,
      notes,
      status,
      confirmSupersede,
    } = req.body;

    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    let goalForAuth = goal;
    if (!goalForAuth && planId) {
      const existing = await DietPlan.findOne({ _id: planId, coach: req.user._id }).select('goal');
      if (existing?.goal) goalForAuth = existing.goal;
    }
    if (!enforceCoachSpecialization(req, res, {
      resourceType: 'diet_plan',
      body: { ...req.body, goal: goalForAuth },
    })) return;

    const caloriesCheck = validateDailyCalories(dailyCalories);
    if (caloriesCheck.error) {
      return res.status(400).json({ message: caloriesCheck.error });
    }
    if (!clientId && !fitnessClassId) {
      return res.status(400).json({ message: 'clientId or fitnessClassId is required' });
    }
    if (clientId && fitnessClassId) {
      return res.status(400).json({ message: 'Provide either clientId or fitnessClassId, not both' });
    }

    const structure = resolvePlanStructure({ planType, meals, days, targetDayOfWeek, weekStartDate });
    if (structure.error) {
      return res.status(400).json({ message: structure.error });
    }
    if (structure.planType === 'weekly' && !structure.weekStartDate) {
      return res.status(400).json({ message: 'Select a Start Date for the weekly diet plan.' });
    }

    const resolvedGoal = GOALS.includes(goal) ? goal : 'maintenance';
    const resolvedStatus = normalizeStatus(status || 'active');
    const shouldNotify = resolvedStatus === 'active';
    const resolvedCalories = caloriesCheck.value;

    if (shouldNotify) {
      if (!weeklyPlanHasAllSevenDays(structure)) {
        return res.status(400).json({
          message: 'Complete all seven days (Monday–Sunday) before activating a weekly diet plan.',
          code: 'WEEKLY_DAYS_INCOMPLETE',
        });
      }
      const { validateActivePlanMealTimes } = require('../utils/mealReminderUtils');
      const mealTimeCheck = validateActivePlanMealTimes(structure);
      if (mealTimeCheck?.error) {
        return res.status(400).json({ message: mealTimeCheck.error });
      }
    }

    const existingActive = await findActivePlanForAssignee(
      req.user._id,
      { clientId, fitnessClassId },
      planId || null,
    );
    if (shouldNotify && existingActive && confirmSupersede !== true) {
      return res.status(409).json({
        message: 'This assignee already has an active diet plan. Confirm to move it to history and activate the new one.',
        code: 'ACTIVE_PLAN_EXISTS',
        existingPlan: {
          id: existingActive._id,
          title: existingActive.title,
          updatedAt: existingActive.updatedAt,
        },
        requiresConfirmSupersede: true,
      });
    }

    const applyFields = (plan) => {
      plan.title = title || plan.title;
      plan.goal = resolvedGoal;
      plan.planType = structure.planType;
      plan.meals = structure.meals;
      plan.days = structure.days;
      plan.targetDayOfWeek = structure.targetDayOfWeek;
      plan.weekStartDate = structure.planType === 'weekly' ? structure.weekStartDate : null;
      plan.markModified('days');
      plan.markModified('meals');
      plan.dailyCalories = resolvedCalories;
      plan.notes = notes || '';
      plan.status = resolvedStatus;
      if (shouldNotify && !plan.assignedAt) {
        plan.assignedAt = new Date();
      }
    };

    // Supersede before write so unique active indexes never conflict.
    if (shouldNotify) {
      await supersedePlansForActivation(
        req.user._id,
        { client: clientId || null, fitnessClass: fitnessClassId || null },
        planId || null,
      );
    }

    if (fitnessClassId) {
      const fitnessClass = await FitnessClass.findOne({
        _id: fitnessClassId,
        coach: req.user._id,
      });
      if (!fitnessClass) {
        return res.status(404).json({ message: 'Class not found' });
      }

      let plan;
      let isUpdate = false;

      if (planId) {
        plan = await DietPlan.findOne({ _id: planId, coach: req.user._id, fitnessClass: fitnessClassId });
        if (!plan) return res.status(404).json({ message: 'Diet plan not found' });
        isUpdate = true;
        applyFields(plan);
        await plan.save();
      } else {
        plan = await DietPlan.create({
          coach: req.user._id,
          fitnessClass: fitnessClassId,
          title: title || `${fitnessClass.title} Diet Plan`,
          goal: resolvedGoal,
          planType: structure.planType,
          meals: structure.meals,
          days: structure.days,
          targetDayOfWeek: structure.targetDayOfWeek,
          weekStartDate: structure.planType === 'weekly' ? structure.weekStartDate : null,
          dailyCalories: resolvedCalories,
          notes: notes || '',
          status: resolvedStatus,
          assignedAt: shouldNotify ? new Date() : undefined,
        });
      }

      if (shouldNotify) {
        if (plan.status !== 'active') {
          plan.status = 'active';
          plan.assignedAt = plan.assignedAt || new Date();
          await plan.save();
        }
        await notifyPlanAssigned(plan, { isUpdate });
      }

      return res.status(isUpdate ? 200 : 201).json(await loadEnrichedDietPlan(plan._id));
    }

    const allowed = await verifyCoachClient(req.user._id, clientId);
    if (!allowed) return res.status(403).json({ message: 'Client not assigned to you' });

    let plan;
    let isUpdate = false;

    if (planId) {
      plan = await DietPlan.findOne({ _id: planId, coach: req.user._id, client: clientId });
      if (!plan) return res.status(404).json({ message: 'Diet plan not found' });
      isUpdate = true;
      applyFields(plan);
      await plan.save();
    } else {
      plan = await DietPlan.create({
        coach: req.user._id,
        client: clientId,
        title: title || 'Diet Plan',
        goal: resolvedGoal,
        planType: structure.planType,
        meals: structure.meals,
        days: structure.days,
        targetDayOfWeek: structure.targetDayOfWeek,
        weekStartDate: structure.planType === 'weekly' ? structure.weekStartDate : null,
        dailyCalories: resolvedCalories,
        notes: notes || '',
        status: resolvedStatus,
        assignedAt: shouldNotify ? new Date() : undefined,
      });
    }

    if (shouldNotify) {
      if (plan.status !== 'active') {
        plan.status = 'active';
        plan.assignedAt = plan.assignedAt || new Date();
        await plan.save();
      }
      await notifyPlanAssigned(plan, { isUpdate });
    }

    return res.status(isUpdate ? 200 : 201).json(await loadEnrichedDietPlan(plan._id));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: 'An active diet plan already exists for this assignee. Confirm supersede and retry.',
        code: 'ACTIVE_PLAN_EXISTS',
        requiresConfirmSupersede: true,
      });
    }
    const { respondWithCaughtError } = require('../utils/httpErrors');
    return respondWithCaughtError(res, error, 'Error saving diet plan');
  }
}

async function updateDietPlanById(req, res) {
  try {
    const plan = await DietPlan.findOne({ _id: req.params.id, coach: req.user._id });
    if (!plan) return res.status(404).json({ message: 'Diet plan not found' });

    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, {
      resourceType: 'diet_plan',
      body: { ...req.body, goal: req.body.goal || plan.goal },
    })) return;

    const previousStatus = plan.status;
    const {
      title,
      goal,
      meals,
      days,
      planType,
      targetDayOfWeek,
      weekStartDate,
      dailyCalories,
      notes,
      status,
      confirmSupersede,
    } = req.body;
    if (title) plan.title = title;
    if (goal && GOALS.includes(goal)) plan.goal = goal;
    if (
      planType !== undefined
      || meals !== undefined
      || days !== undefined
      || targetDayOfWeek !== undefined
      || weekStartDate !== undefined
    ) {
      const structure = resolvePlanStructure({
        planType: planType || plan.planType || 'single_day',
        meals: meals !== undefined ? meals : plan.meals,
        days: days !== undefined ? days : plan.days,
        targetDayOfWeek: targetDayOfWeek !== undefined ? targetDayOfWeek : plan.targetDayOfWeek,
        weekStartDate: weekStartDate !== undefined ? weekStartDate : plan.weekStartDate,
      });
      if (structure.error) {
        return res.status(400).json({ message: structure.error });
      }
      const nextStatus = status ? normalizeStatus(status) : plan.status;
      if (nextStatus === 'active') {
        if (!weeklyPlanHasAllSevenDays(structure)) {
          return res.status(400).json({
            message: 'Complete all seven days (Monday–Sunday) before activating a weekly diet plan.',
            code: 'WEEKLY_DAYS_INCOMPLETE',
          });
        }
        const { validateActivePlanMealTimes } = require('../utils/mealReminderUtils');
        const mealTimeCheck = validateActivePlanMealTimes(structure);
        if (mealTimeCheck?.error) {
          return res.status(400).json({ message: mealTimeCheck.error });
        }
      }
      plan.planType = structure.planType;
      plan.meals = structure.meals;
      plan.days = structure.days;
      plan.targetDayOfWeek = structure.targetDayOfWeek;
      plan.weekStartDate = structure.planType === 'weekly' ? structure.weekStartDate : null;
      plan.markModified('days');
      plan.markModified('meals');
    }
    if (dailyCalories !== undefined) {
      const caloriesCheck = validateDailyCalories(dailyCalories);
      if (caloriesCheck.error) {
        return res.status(400).json({ message: caloriesCheck.error });
      }
      plan.dailyCalories = caloriesCheck.value;
    }
    if (notes !== undefined) plan.notes = notes;
    if (status) plan.status = normalizeStatus(status);

    const becomingActive = plan.status === 'active' && previousStatus !== 'active';
    if (becomingActive) {
      const activateStructure = {
        planType: plan.planType,
        meals: plan.meals,
        days: plan.days,
      };
      if (!weeklyPlanHasAllSevenDays(activateStructure)) {
        return res.status(400).json({
          message: 'Complete all seven days (Monday–Sunday) before activating a weekly diet plan.',
          code: 'WEEKLY_DAYS_INCOMPLETE',
        });
      }
      const { validateActivePlanMealTimes } = require('../utils/mealReminderUtils');
      const mealTimeCheck = validateActivePlanMealTimes(activateStructure);
      if (mealTimeCheck?.error) {
        return res.status(400).json({ message: mealTimeCheck.error });
      }
      const existingActive = await findActivePlanForAssignee(
        req.user._id,
        { clientId: plan.client, fitnessClassId: plan.fitnessClass },
        plan._id,
      );
      if (existingActive && confirmSupersede !== true) {
        return res.status(409).json({
          message: 'This assignee already has an active diet plan. Confirm to move it to history.',
          code: 'ACTIVE_PLAN_EXISTS',
          existingPlan: {
            id: existingActive._id,
            title: existingActive.title,
            updatedAt: existingActive.updatedAt,
          },
          requiresConfirmSupersede: true,
        });
      }
      await supersedePlansForActivation(req.user._id, plan, plan._id);
      plan.status = 'active';
      plan.assignedAt = plan.assignedAt || new Date();
    }

    await plan.save();

    if (plan.status === 'active') {
      await notifyPlanAssigned(plan, { isUpdate: !becomingActive });
    }

    return res.json(await loadEnrichedDietPlan(plan._id));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: 'An active diet plan already exists for this assignee.',
        code: 'ACTIVE_PLAN_EXISTS',
        requiresConfirmSupersede: true,
      });
    }
    console.error('updateDietPlanById:', error.message);
    return res.status(500).json({ message: 'Error updating diet plan' });
  }
}

async function sendDietPlanAgain(req, res) {
  try {
    const plan = await DietPlan.findOne({ _id: req.params.id, coach: req.user._id });
    if (!plan) return res.status(404).json({ message: 'Diet plan not found' });

    if (plan.status !== 'active') {
      const activateStructure = {
        planType: plan.planType,
        meals: plan.meals,
        days: plan.days,
      };
      if (!weeklyPlanHasAllSevenDays(activateStructure)) {
        return res.status(400).json({
          message: 'Complete all seven days (Monday–Sunday) before activating a weekly diet plan.',
          code: 'WEEKLY_DAYS_INCOMPLETE',
        });
      }
      const { validateActivePlanMealTimes } = require('../utils/mealReminderUtils');
      const mealTimeCheck = validateActivePlanMealTimes(activateStructure);
      if (mealTimeCheck?.error) {
        return res.status(400).json({ message: mealTimeCheck.error, code: 'MEAL_TIME_REQUIRED' });
      }
      await supersedePlansForActivation(req.user._id, plan, plan._id);
      plan.status = 'active';
      plan.assignedAt = new Date();
      await plan.save();
      await notifyPlanAssigned(plan, { isResend: false });
      return res.json({
        message: 'Diet plan activated and sent successfully',
        plan: await loadEnrichedDietPlan(plan._id),
      });
    }

    await notifyPlanAssigned(plan, { isResend: true });
    return res.json({
      message: 'Diet plan sent successfully',
      plan: await loadEnrichedDietPlan(plan._id),
    });
  } catch (error) {
    console.error('sendDietPlanAgain:', error.message);
    return res.status(500).json({ message: 'Error sending diet plan' });
  }
}

async function getDietPlanCompletions(req, res) {
  try {
    const coachId = req.user._id;
    const filter = String(req.query.status || 'all').toLowerCase();
    const today = startOfDay();

    const [individualPlans, groupPlans] = await Promise.all([
      DietPlan.find({
        coach: coachId,
        status: 'active',
        client: { $ne: null },
      })
        .populate('client', USER_DISPLAY_SELECT)
        .lean(),
      DietPlan.find({
        coach: coachId,
        status: 'active',
        fitnessClass: { $ne: null },
      })
        .populate({
          path: 'fitnessClass',
          select: 'title enrolledStudents',
          populate: { path: 'enrolledStudents', select: USER_DISPLAY_SELECT },
        })
        .lean(),
    ]);

    const entries = [];

    for (const plan of individualPlans) {
      if (!plan.client) continue;
      const clientId = plan.client._id || plan.client;
      const adherence = await DietAdherence.findOne({ user: clientId, date: today }).lean();
      const summary = buildMealCompletionSummary(plan, adherence);
      const weekCompletion = plan.planType === 'weekly'
        ? await loadWeekCompletion(clientId, today, plan)
        : null;
      const weeklyAveragePercent = weekCompletion?.weeklyProgressPercent
        ?? await computeAverageAdherence(DietAdherence, clientId, 7);
      const completed = plan.planType === 'weekly'
        ? !!weekCompletion?.allDaysCompleted
        : summary.allCompleted;
      const progressPercent = plan.planType === 'weekly'
        ? (weekCompletion?.weeklyProgressPercent || 0)
        : summary.dailyProgressPercent;

      entries.push({
        userId: clientId,
        userName: withDisplayName(plan.client)?.name || 'Client',
        planId: plan._id,
        planName: plan.title || 'Diet Plan',
        planType: plan.planType || 'single_day',
        assigneeType: 'user',
        completed,
        progressPercent,
        completedMeals: summary.completedMeals,
        missedMeals: summary.missedMeals,
        mealsPlanned: summary.mealsPlanned,
        meals: summary.meals,
        completedDays: weekCompletion?.completedDays ?? null,
        daysPlanned: weekCompletion?.daysPlanned ?? null,
        weekDays: weekCompletion?.days ?? null,
        weeklyAveragePercent,
        completionDate: completed
          ? (adherence?.completedAt || null)
          : null,
        status: completed ? 'completed' : 'not_completed',
      });
    }

    for (const plan of groupPlans) {
      const classDoc = plan.fitnessClass;
      const students = classDoc?.enrolledStudents || [];
      for (const student of students) {
        const studentId = student._id || student;
        const studentName = withDisplayName(student)?.name || 'Member';
        const adherence = await DietAdherence.findOne({ user: studentId, date: today }).lean();
        const summary = buildMealCompletionSummary(plan, adherence);
        const weekCompletion = plan.planType === 'weekly'
          ? await loadWeekCompletion(studentId, today, plan)
          : null;
        const weeklyAveragePercent = weekCompletion?.weeklyProgressPercent
          ?? await computeAverageAdherence(DietAdherence, studentId, 7);
        const completed = plan.planType === 'weekly'
          ? !!weekCompletion?.allDaysCompleted
          : summary.allCompleted;
        const progressPercent = plan.planType === 'weekly'
          ? (weekCompletion?.weeklyProgressPercent || 0)
          : summary.dailyProgressPercent;

        entries.push({
          userId: studentId,
          userName: studentName,
          planId: plan._id,
          planName: plan.title || `${classDoc?.title || 'Group'} Diet Plan`,
          planType: plan.planType || 'single_day',
          assigneeType: 'group',
          groupName: classDoc?.title || 'Group',
          completed,
          progressPercent,
          completedMeals: summary.completedMeals,
          missedMeals: summary.missedMeals,
          mealsPlanned: summary.mealsPlanned,
          meals: summary.meals,
          completedDays: weekCompletion?.completedDays ?? null,
          daysPlanned: weekCompletion?.daysPlanned ?? null,
          weekDays: weekCompletion?.days ?? null,
          weeklyAveragePercent,
          completionDate: completed
            ? (adherence?.completedAt || null)
            : null,
          status: completed ? 'completed' : 'not_completed',
        });
      }
    }

    entries.sort((a, b) => a.userName.localeCompare(b.userName));

    let users = entries;
    if (filter === 'completed') {
      users = entries.filter((e) => e.completed);
    } else if (filter === 'not_completed') {
      users = entries.filter((e) => !e.completed && e.mealsPlanned > 0);
    }

    return res.json({
      users,
      total: users.length,
      completedCount: entries.filter((e) => e.completed).length,
      notCompletedCount: entries.filter((e) => !e.completed).length,
    });
  } catch (error) {
    console.error('getDietPlanCompletions:', error.message);
    return res.status(500).json({ message: 'Error fetching diet plan completions' });
  }
}

async function archiveDietPlan(req, res) {
  try {
    const plan = await DietPlan.findOneAndUpdate(
      { _id: req.params.id, coach: req.user._id },
      { $set: { status: 'archived' } },
      { new: true, runValidators: true },
    );
    if (!plan) return res.status(404).json({ message: 'Diet plan not found' });
    return res.json({
      ...plan.toObject(),
      status: displayStatus(plan.status),
      message: 'Diet plan archived (kept in history)',
    });
  } catch (error) {
    console.error('archiveDietPlan:', error.message);
    return res.status(500).json({ message: 'Error archiving diet plan' });
  }
}

async function getClientDietProgress(req, res) {
  try {
    const { clientId } = req.params;
    const allowed = await verifyCoachClient(req.user._id, clientId);
    if (!allowed) return res.status(403).json({ message: 'Client not assigned to you' });

    const days = Math.min(parseInt(req.query.days, 10) || 14, 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    let plan = null;
    if (req.query.planId) {
      plan = await DietPlan.findOne({ _id: req.query.planId, coach: req.user._id }).lean();
    }
    if (!plan) {
      plan = await DietPlan.findOne({ coach: req.user._id, client: clientId, status: 'active' }).lean();
    }
    if (!plan) {
      // Fall back to an active group plan for a class this coach owns and the client is in.
      const classIds = await FitnessClass.find({
        coach: req.user._id,
        enrolledStudents: clientId,
      }).distinct('_id');
      if (classIds.length) {
        plan = await DietPlan.findOne({
          coach: req.user._id,
          fitnessClass: { $in: classIds },
          status: 'active',
        })
          .sort({ updatedAt: -1 })
          .lean();
      }
    }

    const [adherence, mealLogs] = await Promise.all([
      DietAdherence.find({ user: clientId, date: { $gte: since } }).sort({ date: -1 }).lean(),
      MealLog.find({ user: clientId, date: { $gte: since } }).sort({ date: -1 }).lean(),
    ]);

    const avgAdherence = adherence.length
      ? Math.round(adherence.reduce((s, a) => s + (a.adherencePercent || 0), 0) / adherence.length)
      : 0;

    const todaySnapshot = await buildTodayProgressSnapshot(clientId, plan);
    const weekCompletion = plan?.planType === 'weekly'
      ? await loadWeekCompletion(clientId, new Date(), plan)
      : null;
    const plannedMealTypes = plan
      ? require('../utils/mealAdherenceUtils').getPlannedMealTypes(plan)
      : [];

    return res.json({
      plan,
      avgAdherence,
      weekCompletion,
      today: {
        ...todaySnapshot,
        plannedMealTypes,
        weekCompletion,
      },
      caloriesToday: todaySnapshot.caloriesConsumed,
      adherenceHistory: adherence,
      mealLogs,
      weightHistory: adherence.filter((a) => a.weightKg != null).map((a) => ({
        date: a.date,
        weightKg: a.weightKg,
      })),
      plannedMealTypes,
    });
  } catch (error) {
    console.error('getClientDietProgress:', error.message);
    return res.status(500).json({ message: 'Error fetching client progress' });
  }
}

async function markClientAdherence(req, res) {
  try {
    const { clientId } = req.params;
    const { date, followedPlan, adherencePercent, notes, weightKg } = req.body;

    const allowed = await verifyCoachClient(req.user._id, clientId);
    if (!allowed) return res.status(403).json({ message: 'Client not assigned to you' });

    const plan = await DietPlan.findOne({ coach: req.user._id, client: clientId, status: 'active' })
      || await (async () => {
        const classIds = await FitnessClass.find({
          coach: req.user._id,
          enrolledStudents: clientId,
        }).distinct('_id');
        if (!classIds.length) return null;
        return DietPlan.findOne({
          coach: req.user._id,
          fitnessClass: { $in: classIds },
          status: 'active',
        }).sort({ updatedAt: -1 });
      })();
    const recordDate = date ? startOfDay(new Date(date)) : startOfDay();
    const plannedTypes = plan ? getPlannedMealTypes(plan, recordDate) : [];
    const mealAdherence = plannedTypes.map((type) => ({
      type,
      followed: !!followedPlan,
      completedAt: followedPlan ? new Date() : null,
      notes: '',
    }));

    const caloriesConsumed = plan
      ? (computeCaloriesInFromDietPlan(plan, { mealAdherence }, recordDate) ?? 0)
      : 0;
    const summary = plan
      ? buildMealCompletionSummary(plan, { mealAdherence }, recordDate)
      : { dailyProgressPercent: followedPlan ? 100 : 0, allCompleted: !!followedPlan };

    const record = await upsertDietAdherence(
      { user: clientId, date: recordDate },
      {
        $set: {
          coach: req.user._id,
          dietPlan: plan?._id,
          followedPlan: !!followedPlan,
          dayCompleted: !!followedPlan,
          completedAt: followedPlan ? new Date() : null,
          adherencePercent: adherencePercent ?? summary.dailyProgressPercent,
          caloriesConsumed,
          coachMarked: true,
          weightKg,
          targetCalories: plan?.dailyCalories || 0,
          notes: notes || '',
          mealAdherence,
        },
        $setOnInsert: {
          user: clientId,
          date: recordDate,
        },
      },
    );

    const todaySnapshot = plan
      ? await buildTodayProgressSnapshot(clientId, plan, recordDate)
      : null;

    return res.json({
      ...record.toObject(),
      mealSummary: summary,
      today: todaySnapshot,
    });
  } catch (error) {
    console.error('markClientAdherence:', error.message);
    return res.status(500).json({ message: 'Error marking adherence' });
  }
}

async function sendGroupMealReminders(req, res) {
  try {
    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.classId,
      coach: req.user._id,
    });
    if (!fitnessClass) return res.status(403).json({ message: 'Class not found' });

    const plan = await DietPlan.findOne({
      coach: req.user._id,
      fitnessClass: req.params.classId,
      status: 'active',
    });
    if (!plan) return res.status(404).json({ message: 'No active diet plan for this group' });

    const {
      buildMealReminderPayload,
      normalizeReminderTime,
      isReminderMealType,
    } = require('../utils/mealReminderUtils');
    const { mealHasContent: hasMeal } = require('../utils/mealAdherenceUtils');
    const studentIds = (fitnessClass.enrolledStudents || []).map((id) => id);
    // Snacks are diet-plan content only — never send snack reminder notifications.
    const dayMeals = mealsForReminders(plan).filter(
      (m) => hasMeal(m) && isReminderMealType(m.type),
    );
    const mealsWithReminders = dayMeals.filter((m) => normalizeReminderTime(m.reminderTime));
    const mealsToSend = mealsWithReminders.length ? mealsWithReminders : dayMeals;
    const dateKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;

    for (const studentId of studentIds) {
      for (const meal of mealsToSend) {
        const payload = buildMealReminderPayload(plan, meal, { dateKey });
        await Notification.create({
          user: studentId,
          message: payload.message,
          type: payload.type,
          data: payload.data,
        });
      }
    }

    return res.json({
      sent: studentIds.length * mealsToSend.length,
      message: 'Meal reminders sent to group',
    });
  } catch (error) {
    console.error('sendGroupMealReminders:', error.message);
    return res.status(500).json({ message: 'Error sending reminders' });
  }
}

async function sendMealReminders(req, res) {
  try {
    const { clientId } = req.params;
    const allowed = await verifyCoachClient(req.user._id, clientId);
    if (!allowed) return res.status(403).json({ message: 'Client not assigned to you' });

    const plan = await DietPlan.findOne({ coach: req.user._id, client: clientId, status: 'active' });
    if (!plan) return res.status(404).json({ message: 'No active diet plan for client' });

    const {
      buildMealReminderPayload,
      normalizeReminderTime,
      isReminderMealType,
    } = require('../utils/mealReminderUtils');
    const { mealHasContent: hasMeal } = require('../utils/mealAdherenceUtils');
    // Snacks are diet-plan content only — never send snack reminder notifications.
    const dayMeals = mealsForReminders(plan).filter(
      (m) => hasMeal(m) && isReminderMealType(m.type),
    );
    const mealsWithReminders = dayMeals.filter((m) => normalizeReminderTime(m.reminderTime));
    const mealsToSend = mealsWithReminders.length ? mealsWithReminders : dayMeals;
    const dateKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;

    for (const meal of mealsToSend) {
      const payload = buildMealReminderPayload(plan, meal, { dateKey });
      await Notification.create({
        user: clientId,
        message: payload.message,
        type: payload.type,
        data: payload.data,
      });
    }

    return res.json({ sent: mealsToSend.length, message: 'Meal reminders sent' });
  } catch (error) {
    console.error('sendMealReminders:', error.message);
    return res.status(500).json({ message: 'Error sending reminders' });
  }
}

module.exports = {
  getUserAssignedDietPlan,
  getUserDietPlanHistory,
  getUserDietProgress,
  logUserAdherence,
  getCoachDietPlans,
  getDietPlanCompletions,
  getDietPlanById,
  getClientDietPlan,
  getGroupDietPlan,
  getGroupDietProgress,
  createOrUpdateDietPlan,
  updateDietPlanById,
  archiveDietPlan,
  sendDietPlanAgain,
  getClientDietProgress,
  markClientAdherence,
  sendMealReminders,
  sendGroupMealReminders,
  normalizeMealsArray,
  resolveUserDietPlan,
};
