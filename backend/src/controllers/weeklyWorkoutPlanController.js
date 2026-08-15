const WeeklyWorkoutPlan = require('../models/WeeklyWorkoutPlan');
const WorkoutSchedule = require('../models/WorkoutSchedule');
const WorkoutTemplate = require('../models/WorkoutTemplate');
const ScheduleCompletion = require('../models/ScheduleCompletion');
const FitnessClass = require('../models/FitnessClass');
const Notification = require('../models/Notification');
const { hasActiveAssignment, getAuthorizedCoachIdsForUser } = require('../utils/coachVisibility');
const { DAY_NAMES, getWeekStart, combineDateAndTime, defaultWeekDays, parseLocalDate, formatDateOnlyIso, calendarDateFromInstant, isSameCalendarDay } = require('../utils/weeklyPlanUtils');
const { normalizeMediaUrl } = require('../utils/normalizeMediaUrl');
const { USER_DISPLAY_SELECT, withDisplayName } = require('../utils/userDisplay');

async function getPlanTargetUserIds(plan) {
  if (plan.client) return [plan.client._id || plan.client];
  if (plan.fitnessClass) {
    const classId = plan.fitnessClass._id || plan.fitnessClass;
    const fitnessClass = await FitnessClass.findById(classId).select('enrolledStudents');
    return fitnessClass?.enrolledStudents || [];
  }
  return [];
}

async function notifyUsers(userIds, message, type = 'update', data = null) {
  if (!userIds.length) return;
  await Notification.insertMany(userIds.map((userId) => ({
    user: userId,
    message,
    type,
    ...(data ? { data } : {}),
  })));
}

async function createCompletionRecords(schedule, userIds) {
  if (!userIds.length) return;
  const records = userIds.map((userId) => ({
    workoutSchedule: schedule._id,
    user: userId,
    coach: schedule.coach,
    status: 'pending',
  }));
  await ScheduleCompletion.insertMany(records, { ordered: false }).catch((err) => {
    if (err.code !== 11000) throw err;
  });
}

async function ensureCompletionRecords(schedule, userIds) {
  if (!userIds.length) return;
  for (const userId of userIds) {
    const exists = await ScheduleCompletion.findOne({
      workoutSchedule: schedule._id,
      user: userId,
    }).select('_id');
    if (!exists) {
      await ScheduleCompletion.create({
        workoutSchedule: schedule._id,
        user: userId,
        coach: schedule.coach,
        status: 'pending',
      }).catch((err) => {
        if (err.code !== 11000) throw err;
      });
    }
  }
}

function normalizeDayExercises(exercises) {
  if (!Array.isArray(exercises)) return [];
  return exercises.map((entry) => {
    if (typeof entry === 'string') {
      return { name: entry.trim(), sets: 3, reps: 10 };
    }
    return {
      name: entry.name,
      sets: entry.sets ?? 3,
      reps: entry.reps ?? 10,
      durationMinutes: entry.durationMinutes,
      restSeconds: entry.restSeconds,
      equipment: entry.equipment || '',
      instructions: entry.instructions || '',
      notes: entry.notes || '',
      demoImageUrl: normalizeMediaUrl(entry.demoImageUrl),
      demoVideoUrl: normalizeMediaUrl(entry.demoVideoUrl),
    };
  }).filter((e) => e.name && String(e.name).trim());
}

async function resolveDayExercises(day, templateId, coachId) {
  const assigned = normalizeDayExercises(day.exercises);
  if (assigned.length) return assigned;
  if (!templateId) return [];
  const template = await WorkoutTemplate.findOne({
    _id: templateId,
    coach: coachId,
    status: 'active',
  }).select('exercises').lean();
  return normalizeDayExercises(template?.exercises || []);
}

async function syncWeeklySchedules(planOrId) {
  const plan = typeof planOrId === 'object' && planOrId.days
    ? planOrId
    : await WeeklyWorkoutPlan.findById(planOrId);
  if (!plan) return;

  const userIds = await getPlanTargetUserIds(plan);
  const enabledDays = (plan.days || []).filter((d) => d.enabled && d.workoutTemplate && !d.offDay);
  const enabledDayIndexes = new Set(enabledDays.map((d) => Number(d.dayOfWeek)));
  const tz = plan.timezoneOffsetMinutes ?? 0;
  const planTemplateId = plan.workoutTemplate?._id || plan.workoutTemplate || null;

  // Keep existing day sessions (and their completion ticks) when possible.
  // Only cancel days that were disabled, and create days that are genuinely new.
  const existingSchedules = await WorkoutSchedule.find({
    weeklyPlan: plan._id,
    status: { $ne: 'cancelled' },
  });
  const existingByDay = new Map(
    existingSchedules.map((schedule) => [Number(schedule.dayOfWeek), schedule]),
  );

  for (const schedule of existingSchedules) {
    if (!enabledDayIndexes.has(Number(schedule.dayOfWeek))) {
      schedule.status = 'cancelled';
      await schedule.save();
    }
  }

  for (const day of enabledDays) {
    const templateId = day.workoutTemplate?._id || day.workoutTemplate || planTemplateId;
    if (!templateId) continue;

    const start = combineDateAndTime(plan.weekStartDate, day.dayOfWeek, day.startTime, tz);
    let end = combineDateAndTime(plan.weekStartDate, day.dayOfWeek, day.endTime, tz);
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);

    const dayExercises = await resolveDayExercises(day, templateId, plan.coach);
    const existing = existingByDay.get(Number(day.dayOfWeek));

    if (existing) {
      existing.workoutTemplate = templateId;
      existing.exercises = dayExercises;
      existing.client = plan.client || undefined;
      existing.fitnessClass = plan.fitnessClass || undefined;
      existing.startDateTime = start;
      existing.endDateTime = end;
      existing.durationMinutes = Math.round((end - start) / 60000);
      existing.notes = day.notes || '';
      existing.reminderEnabled = plan.reminderEnabled !== false;
      existing.reminderMinutesBefore = plan.reminderMinutesBefore ?? 30;
      existing.status = 'scheduled';
      existing.markModified('exercises');
      await existing.save();
      await ensureCompletionRecords(existing, userIds);
      continue;
    }

    const schedule = await WorkoutSchedule.create({
      coach: plan.coach,
      workoutTemplate: templateId,
      weeklyPlan: plan._id,
      dayOfWeek: day.dayOfWeek,
      exercises: dayExercises,
      client: plan.client || undefined,
      fitnessClass: plan.fitnessClass || undefined,
      startDateTime: start,
      endDateTime: end,
      durationMinutes: Math.round((end - start) / 60000),
      notes: day.notes || '',
      reminderEnabled: plan.reminderEnabled !== false,
      reminderMinutesBefore: plan.reminderMinutesBefore ?? 30,
      reminderSent: false,
      status: 'scheduled',
    });

    await createCompletionRecords(schedule, userIds);
  }

  // Backfill completion rows if class membership changed after plan creation.
  const freshUserIds = await getPlanTargetUserIds(plan);
  const activeSchedules = await WorkoutSchedule.find({
    weeklyPlan: plan._id,
    status: { $ne: 'cancelled' },
  }).select('_id coach');
  for (const schedule of activeSchedules) {
    await ensureCompletionRecords(schedule, freshUserIds);
  }

  // Also backfill exercise plans + any schedules for members who joined after sync.
  if (plan.fitnessClass) {
    const classId = plan.fitnessClass._id || plan.fitnessClass;
    const { backfillGroupPlanAccess } = require('../utils/backfillGroupPlanAccess');
    const fitnessClass = await FitnessClass.findById(classId).select('enrolledStudents').lean();
    await Promise.all(
      (fitnessClass?.enrolledStudents || []).map((uid) =>
        backfillGroupPlanAccess(uid, classId).catch((err) => {
          console.error('backfillGroupPlanAccess syncWeeklySchedules:', err.message);
        }),
      ),
    );
  }
}

function normalizeDays(days, planTemplateId = null) {
  const base = defaultWeekDays();
  if (!Array.isArray(days)) return base;
  const planTemplateStr = planTemplateId ? String(planTemplateId) : null;

  return base.map((defaultDay) => {
    const incoming = days.find((d) => Number(d.dayOfWeek) === defaultDay.dayOfWeek);
    if (!incoming) return defaultDay;
    const templateId = incoming.workoutTemplateId
      || incoming.workoutTemplate?._id
      || incoming.workoutTemplate
      || planTemplateStr
      || null;
    const templateIdStr = templateId ? String(templateId) : null;
    const exercises = normalizeDayExercises(incoming.exercises);
    const offDay = !!incoming.offDay;
    const enabled = !offDay && !!incoming.enabled && !!templateIdStr && (
      exercises.length > 0 || !!incoming.enabled
    );
    // Prefer assigned exercises; empty list kept when enabled so sync can fall back to template
    return {
      dayOfWeek: defaultDay.dayOfWeek,
      enabled: !offDay && !!incoming.enabled && !!templateIdStr,
      offDay,
      workoutTemplate: (!offDay && !!incoming.enabled && !!templateIdStr) ? templateIdStr : null,
      exercises: (!offDay && !!incoming.enabled) ? exercises : [],
      startTime: incoming.startTime || '09:00',
      endTime: incoming.endTime || '10:00',
      notes: incoming.notes || '',
    };
  });
}

function slimDayExercises(exercises) {
  if (!Array.isArray(exercises)) return [];
  return exercises.map((e) => ({
    name: e?.name || '',
    sets: e?.sets,
    reps: e?.reps,
  }));
}

function attachWeeklyProgress(plan, completions, planSchedules = [], { slim = false } = {}) {
  const scheduleByDay = {};
  planSchedules.forEach((s) => {
    scheduleByDay[s.dayOfWeek] = s._id;
  });

  const days = (plan.days || []).map((day) => {
    const scheduleId = scheduleByDay[day.dayOfWeek];
    const dayCompletions = scheduleId
      ? completions.filter((c) => String(c.workoutSchedule) === String(scheduleId))
      : [];
    const completed = dayCompletions.filter((c) => c.status === 'completed').length;
    const pending = dayCompletions.filter((c) => c.status === 'pending').length;
    const missed = dayCompletions.filter((c) => c.status === 'missed').length;
    const total = dayCompletions.length;
    const slimCompletions = slim
      ? dayCompletions.map((c) => ({
          _id: c._id,
          user: c.user,
          status: c.status,
          completedAt: c.completedAt,
        }))
      : dayCompletions;
    return {
      ...day,
      exercises: slim ? slimDayExercises(day.exercises) : day.exercises,
      dayName: DAY_NAMES[day.dayOfWeek],
      scheduleId,
      progress: {
        completed,
        pending,
        missed,
        total,
        completionPercent: total ? Math.round((completed / total) * 100) : 0,
        completions: slimCompletions,
      },
    };
  });

  const allCompleted = days.reduce((s, d) => s + (d.progress?.completed || 0), 0);
  const allPending = days.reduce((s, d) => s + (d.progress?.pending || 0), 0);
  const allMissed = days.reduce((s, d) => s + (d.progress?.missed || 0), 0);
  const allTotal = allCompleted + allPending + allMissed;

  return {
    ...plan,
    days,
    summary: {
      completed: allCompleted,
      pending: allPending,
      missed: allMissed,
      total: allTotal,
      completionPercent: allTotal ? Math.round((allCompleted / allTotal) * 100) : 0,
    },
  };
}

function serializeWeeklyPlan(plan) {
  if (!plan) return plan;
  let fitnessClass = plan.fitnessClass;
  if (fitnessClass && typeof fitnessClass === 'object') {
    const enrolled = fitnessClass.enrolledStudents;
    const enrolledCount = Array.isArray(enrolled)
      ? enrolled.length
      : Number(fitnessClass.enrolledCount) || 0;
    fitnessClass = { ...fitnessClass, enrolledCount };
  }
  const memberLabel = fitnessClass
    ? `${fitnessClass.enrolledCount === 1 ? '1 Member' : `${fitnessClass.enrolledCount || 0} Members`}`
    : null;
  return {
    ...plan,
    client: plan.client ? withDisplayName(plan.client) : plan.client,
    fitnessClass,
    weekStartDate: formatDateOnlyIso(plan.weekStartDate),
    assigneeName: plan.client
      ? (withDisplayName(plan.client)?.name || 'Client')
      : (fitnessClass
        ? `${fitnessClass.title || 'Group'} — ${memberLabel}`
        : 'Group'),
  };
}

async function createWeeklyWorkoutPlan(req, res) {
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'weekly_workout_plan' })) return;

    const {
      clientId,
      fitnessClassId,
      title,
      weekStartDate,
      days,
      workoutTemplateId,
      reminderEnabled,
      reminderMinutesBefore,
      timezoneOffsetMinutes,
    } = req.body;

    if (!weekStartDate) {
      return res.status(400).json({ message: 'Week start date is required' });
    }
    if (!workoutTemplateId) {
      return res.status(400).json({ message: 'Select a workout title first' });
    }

    const planTemplate = await WorkoutTemplate.findOne({
      _id: workoutTemplateId,
      coach: req.user._id,
      status: 'active',
    });
    if (!planTemplate) {
      return res.status(400).json({ message: 'Invalid workout template' });
    }

    const normalizedDays = normalizeDays(days, workoutTemplateId);
    const enabledWithTemplate = normalizedDays.filter((d) => d.enabled && d.workoutTemplate && !d.offDay);
    if (!enabledWithTemplate.length) {
      return res.status(400).json({ message: 'Enable at least one day and assign exercises' });
    }

    for (const day of enabledWithTemplate) {
      if (!day.exercises?.length) {
        return res.status(400).json({
          message: `Assign at least one exercise for ${DAY_NAMES[day.dayOfWeek]}`,
        });
      }
      if (String(day.workoutTemplate) !== String(workoutTemplateId)) {
        return res.status(400).json({
          message: `All days must use the selected workout (${planTemplate.title})`,
        });
      }
    }

    const weekStart = getWeekStart(weekStartDate);
    const base = {
      coach: req.user._id,
      title: title?.trim() || planTemplate.title || 'Weekly Workout Plan',
      workoutTemplate: workoutTemplateId,
      weekStartDate: weekStart,
      days: normalizedDays,
      reminderEnabled: reminderEnabled !== false,
      reminderMinutesBefore: reminderMinutesBefore ?? 30,
      timezoneOffsetMinutes: Number.isFinite(Number(timezoneOffsetMinutes))
        ? Number(timezoneOffsetMinutes)
        : 0,
      status: 'active',
    };

    let plan;
    if (fitnessClassId) {
      const fitnessClass = await FitnessClass.findOne({ _id: fitnessClassId, coach: req.user._id });
      if (!fitnessClass) return res.status(404).json({ message: 'Class not found' });
      plan = await WeeklyWorkoutPlan.create({ ...base, fitnessClass: fitnessClassId });
    } else if (clientId) {
      const allowed = await hasActiveAssignment(req.user._id, clientId);
      if (!allowed) return res.status(403).json({ message: 'Client is not assigned to you' });
      plan = await WeeklyWorkoutPlan.create({ ...base, client: clientId });
    } else {
      return res.status(400).json({ message: 'Client ID or class ID is required' });
    }

    await syncWeeklySchedules(plan._id);

    const populated = await WeeklyWorkoutPlan.findById(plan._id)
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title enrolledStudents')
      .populate('workoutTemplate', 'title level exercises')
      .populate('days.workoutTemplate', 'title level')
      .lean();

    const userIds = await getPlanTargetUserIds(populated);
    const scheduleCount = await WorkoutSchedule.countDocuments({
      weeklyPlan: plan._id,
      status: 'scheduled',
    });
    await notifyUsers(
      userIds,
      `Your coach assigned a weekly workout plan starting ${weekStart.toLocaleDateString()} (${scheduleCount} sessions)`,
      'workout',
      { screen: 'schedule', weekStart: formatDateOnlyIso(weekStart) },
    ).catch((err) => console.error('notifyUsers createWeeklyWorkoutPlan:', err.message));

    return res.status(201).json(serializeWeeklyPlan(populated));
  } catch (error) {
    console.error('createWeeklyWorkoutPlan:', error.message);
    return res.status(500).json({ message: 'Error creating weekly workout plan' });
  }
}

async function getCoachWeeklyWorkoutPlans(req, res) {
  try {
    const query = { coach: req.user._id, status: 'active' };
    if (req.query.clientId) query.client = req.query.clientId;
    if (req.query.classId) query.fitnessClass = req.query.classId;

    // Default: recent weeks only — older history is rarely needed in Workout Management.
    if (!req.query.from && !req.query.all) {
      const from = new Date();
      from.setDate(from.getDate() - 28);
      query.weekStartDate = { $gte: from };
    }

    const plans = await WeeklyWorkoutPlan.find(query)
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title enrolledStudents')
      .populate('workoutTemplate', 'title level')
      .populate('days.workoutTemplate', 'title level')
      .sort({ weekStartDate: -1 })
      .limit(Math.min(Number(req.query.limit) || 24, 60))
      .lean();

    const planIds = plans.map((p) => p._id);
    const schedules = planIds.length
      ? await WorkoutSchedule.find({
          weeklyPlan: { $in: planIds },
          status: { $ne: 'cancelled' },
        }).select('_id weeklyPlan dayOfWeek').lean()
      : [];

    const schedulesByPlan = new Map();
    for (const s of schedules) {
      const key = String(s.weeklyPlan);
      if (!schedulesByPlan.has(key)) schedulesByPlan.set(key, []);
      schedulesByPlan.get(key).push(s);
    }

    const scheduleIds = schedules.map((s) => s._id);
    const completions = scheduleIds.length
      ? await ScheduleCompletion.find({
          workoutSchedule: { $in: scheduleIds },
        })
          .populate('user', USER_DISPLAY_SELECT)
          .select('workoutSchedule user status completedAt')
          .lean()
      : [];

    const enriched = plans.map((plan) =>
      attachWeeklyProgress(plan, completions, schedulesByPlan.get(String(plan._id)) || [], {
        slim: true,
      }),
    );

    return res.json(enriched.map(serializeWeeklyPlan));
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching weekly plans' });
  }
}

async function updateWeeklyWorkoutPlan(req, res) {
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'weekly_workout_plan' })) return;

    const plan = await WeeklyWorkoutPlan.findOne({
      _id: req.params.id,
      coach: req.user._id,
      status: 'active',
    });
    if (!plan) return res.status(404).json({ message: 'Weekly plan not found' });

    const { title, weekStartDate, days, workoutTemplateId, reminderEnabled, reminderMinutesBefore, timezoneOffsetMinutes } = req.body;
    if (title !== undefined) plan.title = title.trim() || plan.title;
    if (weekStartDate !== undefined) plan.weekStartDate = getWeekStart(weekStartDate);
    if (reminderEnabled !== undefined) plan.reminderEnabled = !!reminderEnabled;
    if (reminderMinutesBefore !== undefined) plan.reminderMinutesBefore = reminderMinutesBefore;
    if (timezoneOffsetMinutes !== undefined && Number.isFinite(Number(timezoneOffsetMinutes))) {
      plan.timezoneOffsetMinutes = Number(timezoneOffsetMinutes);
    }

    const effectiveTemplateId = workoutTemplateId || plan.workoutTemplate?.toString() || plan.workoutTemplate;
    if (workoutTemplateId) {
      const planTemplate = await WorkoutTemplate.findOne({
        _id: workoutTemplateId,
        coach: req.user._id,
        status: 'active',
      });
      if (!planTemplate) return res.status(400).json({ message: 'Invalid workout template' });
      plan.workoutTemplate = workoutTemplateId;
    }

    if (days !== undefined) {
      const normalizedDays = normalizeDays(days, effectiveTemplateId);
      const enabledWithTemplate = normalizedDays.filter((d) => d.enabled && d.workoutTemplate && !d.offDay);
      if (!enabledWithTemplate.length) {
        return res.status(400).json({ message: 'Enable at least one day and assign exercises' });
      }
      for (const day of enabledWithTemplate) {
        if (!day.exercises?.length) {
          return res.status(400).json({
            message: `Assign at least one exercise for ${DAY_NAMES[day.dayOfWeek]}`,
          });
        }
      }
      plan.days = normalizedDays;
      plan.markModified('days');
    }

    await plan.save();
    await syncWeeklySchedules(plan._id);

    const populated = await WeeklyWorkoutPlan.findById(plan._id)
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title enrolledStudents')
      .populate('workoutTemplate', 'title level exercises')
      .populate('days.workoutTemplate', 'title level')
      .lean();

    const userIds = await getPlanTargetUserIds(populated);
    await notifyUsers(userIds, 'Your weekly workout plan was updated by your coach', 'workout', { screen: 'schedule' });

    return res.json(serializeWeeklyPlan(populated));
  } catch (error) {
    console.error('updateWeeklyWorkoutPlan:', error.message);
    return res.status(500).json({ message: 'Error updating weekly plan' });
  }
}

async function deleteWeeklyWorkoutPlan(req, res) {
  try {
    const plan = await WeeklyWorkoutPlan.findOneAndUpdate(
      { _id: req.params.id, coach: req.user._id },
      { $set: { status: 'archived' } },
      { new: true, runValidators: true },
    );
    if (!plan) return res.status(404).json({ message: 'Weekly plan not found' });

    await WorkoutSchedule.updateMany(
      { weeklyPlan: plan._id },
      { $set: { status: 'cancelled' } },
    );

    const userIds = await getPlanTargetUserIds(plan);
    await notifyUsers(userIds, 'Your weekly workout plan was cancelled', 'workout');

    return res.json({ message: 'Weekly plan deleted', plan });
  } catch (error) {
    console.error('deleteWeeklyWorkoutPlan:', error.message);
    return res.status(500).json({ message: 'Error deleting weekly plan' });
  }
}

async function getUserWeeklySchedule(req, res) {
  try {
    const tz = Number.isFinite(Number(req.query.timezoneOffsetMinutes))
      ? Number(req.query.timezoneOffsetMinutes)
      : 0;
    const weekStart = getWeekStart(req.query.weekStart || new Date());
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const enrolledClasses = await FitnessClass.find({ enrolledStudents: req.user._id }).select('_id');
    const classIds = enrolledClasses.map((c) => c._id);
    const authorizedCoachIds = await getAuthorizedCoachIdsForUser(req.user._id);

    const planTargetOr = [{ client: req.user._id }];
    if (classIds.length) planTargetOr.push({ fitnessClass: { $in: classIds } });

    const planQuery = {
      status: 'active',
      weekStartDate: { $gte: weekStart, $lt: weekEnd },
      $or: planTargetOr,
    };
    if (authorizedCoachIds.length) {
      planQuery.coach = { $in: authorizedCoachIds };
    }

    const activeWeeklyPlanIds = await WeeklyWorkoutPlan.find(planQuery).distinct('_id');

    const activeWeeklyPlans = await WeeklyWorkoutPlan.find({
      _id: { $in: activeWeeklyPlanIds },
    }).select('days').lean();

    const offDaySet = new Set();
    for (const plan of activeWeeklyPlans) {
      for (const day of plan.days || []) {
        if (day.offDay) offDaySet.add(day.dayOfWeek);
      }
    }

    const scheduleTargetOr = [{ client: req.user._id }];
    if (classIds.length) scheduleTargetOr.push({ fitnessClass: { $in: classIds } });

    const scheduleQuery = {
      status: { $in: ['scheduled', 'completed'] },
      $and: [
        {
          $or: [
            { startDateTime: { $gte: weekStart, $lt: weekEnd } },
            { weeklyPlan: { $in: activeWeeklyPlanIds } },
          ],
        },
        { $or: scheduleTargetOr },
      ],
    };
    if (authorizedCoachIds.length) {
      scheduleQuery.coach = { $in: authorizedCoachIds };
    }

    const schedules = await WorkoutSchedule.find(scheduleQuery)
      .populate('workoutTemplate')
      .populate('coach', USER_DISPLAY_SELECT)
      .populate('weeklyPlan', 'title weekStartDate')
      .sort({ startDateTime: 1 })
      .lean();

    await Promise.all(
      schedules.map((schedule) => ensureCompletionRecords(schedule, [req.user._id])),
    );

    const scheduleIds = schedules.map((s) => s._id);
    const completions = await ScheduleCompletion.find({
      workoutSchedule: { $in: scheduleIds },
      user: req.user._id,
    }).lean();

    const completionMap = new Map(
      completions.map((c) => [String(c.workoutSchedule), c]),
    );

    const weekDays = DAY_NAMES.map((dayName, dayOfWeek) => {
      const dayDate = parseLocalDate(weekStart);
      dayDate.setDate(dayDate.getDate() + dayOfWeek);

      const daySchedule = schedules.find((s) => {
        const planId = s.weeklyPlan?._id || s.weeklyPlan;
        if (s.dayOfWeek != null && s.dayOfWeek === dayOfWeek && planId
            && activeWeeklyPlanIds.some((id) => String(id) === String(planId))) {
          return true;
        }
        const sd = calendarDateFromInstant(s.startDateTime, tz);
        return isSameCalendarDay(sd, dayDate);
      });

      if (!daySchedule) {
        if (offDaySet.has(dayOfWeek)) {
          return {
            dayOfWeek,
            dayName,
            date: formatDateOnlyIso(dayDate),
            hasWorkout: false,
            isOffDay: true,
            status: 'off',
            completed: false,
          };
        }
        return {
          dayOfWeek,
          dayName,
          date: formatDateOnlyIso(dayDate),
          hasWorkout: false,
          isOffDay: false,
          status: 'none',
          completed: false,
        };
      }

      const completion = completionMap.get(String(daySchedule._id));
      const status = completion?.status || 'pending';

      return {
        dayOfWeek,
        dayName,
        date: formatDateOnlyIso(dayDate),
        hasWorkout: true,
        isOffDay: false,
        completed: status === 'completed',
        status,
        schedule: {
          ...daySchedule,
          title: daySchedule.workoutTemplate?.title || 'Workout',
          completion: completion
            ? { _id: completion._id, status: completion.status, completedAt: completion.completedAt }
            : { status: 'pending' },
        },
      };
    });

    const completedCount = weekDays.filter((d) => d.completed).length;
    const workoutDays = weekDays.filter((d) => d.hasWorkout).length;
    const offDays = weekDays.filter((d) => d.isOffDay).length;

    return res.json({
      weekStart: formatDateOnlyIso(weekStart),
      weekEnd: formatDateOnlyIso(new Date(weekEnd.getTime() - 24 * 60 * 60 * 1000)),
      dayNames: DAY_NAMES,
      days: weekDays,
      summary: {
        workoutDays,
        offDays,
        completed: completedCount,
        pending: weekDays.filter((d) => d.hasWorkout && d.status === 'pending').length,
        missed: weekDays.filter((d) => d.hasWorkout && d.status === 'missed').length,
        completionPercent: workoutDays ? Math.round((completedCount / workoutDays) * 100) : 0,
      },
    });
  } catch (error) {
    console.error('getUserWeeklySchedule:', error.message);
    return res.status(500).json({ message: 'Error fetching weekly schedule' });
  }
}

module.exports = {
  createWeeklyWorkoutPlan,
  getCoachWeeklyWorkoutPlans,
  updateWeeklyWorkoutPlan,
  deleteWeeklyWorkoutPlan,
  getUserWeeklySchedule,
  DAY_NAMES,
};
