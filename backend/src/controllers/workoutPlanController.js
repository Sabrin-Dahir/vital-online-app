const ExercisePlan = require('../models/ExercisePlan');
const WorkoutCompletion = require('../models/WorkoutCompletion');
const WeeklyWorkoutPlan = require('../models/WeeklyWorkoutPlan');
const WorkoutSchedule = require('../models/WorkoutSchedule');
const ScheduleCompletion = require('../models/ScheduleCompletion');
const FitnessClass = require('../models/FitnessClass');
const Notification = require('../models/Notification');
const { hasActiveAssignment } = require('../utils/coachVisibility');
const { USER_DISPLAY_SELECT } = require('../utils/userDisplay');
const { normalizeMediaUrl } = require('../utils/normalizeMediaUrl');
const { DAY_NAMES } = require('../utils/weeklyPlanUtils');
const { validateExercises, validateObjectId, validateDate } = require('../utils/fieldValidation');
const { rejectIfInvalid } = require('../middleware/validateRequest');

function normalizeLevel(level) {
  const map = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
  return map[String(level || '').toLowerCase()] || level || 'Beginner';
}

function normalizeExercises(exercises) {
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
      demoImageUrl: normalizeMediaUrl(entry.demoImageUrl),
      demoVideoUrl: normalizeMediaUrl(entry.demoVideoUrl),
      notes: entry.notes || '',
    };
  }).filter((entry) => entry.name);
}

async function createCompletionRecords(plan, userIds, dueDate) {
  if (!userIds.length) return;
  const records = userIds.map((userId) => ({
    exercisePlan: plan._id,
    user: userId,
    coach: plan.coach,
    dueDate: dueDate || plan.dueDate,
    status: 'pending',
  }));
  await WorkoutCompletion.insertMany(records, { ordered: false }).catch((err) => {
    if (err.code !== 11000) throw err;
  });
}

async function notifyUsers(userIds, message, type = 'update') {
  if (!userIds.length) return;
  await Notification.insertMany(
    userIds.map((userId) => ({ user: userId, message, type })),
  );
}

function completionPlanId(completion) {
  const ref = completion.exercisePlan;
  if (ref && typeof ref === 'object' && ref._id) return String(ref._id);
  return String(ref);
}

function attachPlanStats(plans, completions) {
  return plans.map((plan) => {
    const planId = String(plan._id);
    const planCompletions = completions.filter((c) => completionPlanId(c) === planId);
    const completed = planCompletions.filter((c) => c.status === 'completed').length;
    const pending = planCompletions.filter((c) => c.status === 'pending').length;
    const missed = planCompletions.filter((c) => c.status === 'missed').length;
    const total = planCompletions.length;
    return {
      ...plan,
      progress: {
        total,
        completed,
        pending,
        missed,
        completionPercent: total ? Math.round((completed / total) * 100) : 0,
        completions: planCompletions,
      },
    };
  });
}

async function createExercisePlan(req, res) {
  const {
    clientId,
    fitnessClassId,
    title,
    description,
    instructions,
    level,
    exercises,
    dueDate,
  } = req.body;
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'exercise_plan' })) return;

    if (rejectIfInvalid(res, validateExercises(exercises))) return;
    const normalizedExercises = normalizeExercises(exercises);
    if (!normalizedExercises.length) {
      return res.status(400).json({ message: 'At least one exercise is required' });
    }
    if (clientId && rejectIfInvalid(res, validateObjectId(clientId, 'Client'))) return;
    if (fitnessClassId && rejectIfInvalid(res, validateObjectId(fitnessClassId, 'Group'))) return;
    if (dueDate && rejectIfInvalid(res, validateDate(dueDate, 'Due date', { required: false }))) return;

    const parsedDueDate = dueDate ? new Date(dueDate) : undefined;
    const baseFields = {
      coach: req.user._id,
      title: title?.trim() || 'Workout Plan',
      description: description || '',
      instructions: instructions || '',
      level: normalizeLevel(level),
      exercises: normalizedExercises,
      dueDate: parsedDueDate,
      status: 'active',
    };

    if (fitnessClassId) {
      const fitnessClass = await FitnessClass.findOne({
        _id: fitnessClassId,
        coach: req.user._id,
      }).populate('enrolledStudents', '_id ' + USER_DISPLAY_SELECT);

      if (!fitnessClass) {
        return res.status(404).json({ message: 'Class not found' });
      }

      const plan = await ExercisePlan.create({
        ...baseFields,
        fitnessClass: fitnessClassId,
      });

      const studentIds = (fitnessClass.enrolledStudents || []).map((s) => s._id || s);
      await createCompletionRecords(plan, studentIds, parsedDueDate);

      try {
        const { ensureWorkoutAttendance } = require('../utils/attendanceService');
        await Promise.all(
          studentIds.map((uid) =>
            ensureWorkoutAttendance({
              coachId: req.user._id,
              userId: uid,
              exercisePlanId: plan._id,
              date: parsedDueDate || new Date(),
              scheduledStart: parsedDueDate || new Date(),
            }),
          ),
        );
      } catch (attErr) {
        console.warn('exercisePlan attendance:', attErr.message);
      }

      const planTitle = plan.title || fitnessClass.title;
      await notifyUsers(
        studentIds,
        `New workout assigned: "${planTitle}" for ${fitnessClass.title}`,
        'update',
      );

      return res.status(201).json(plan);
    }

    if (!clientId) {
      return res.status(400).json({ message: 'Client ID or class ID is required' });
    }

    const allowed = await hasActiveAssignment(req.user._id, clientId);
    if (!allowed) {
      return res.status(403).json({ message: 'Client is not assigned to you' });
    }

    const plan = await ExercisePlan.create({
      ...baseFields,
      client: clientId,
    });

    await createCompletionRecords(plan, [clientId], parsedDueDate);

    try {
      const { ensureWorkoutAttendance } = require('../utils/attendanceService');
      await ensureWorkoutAttendance({
        coachId: req.user._id,
        userId: clientId,
        exercisePlanId: plan._id,
        date: parsedDueDate || new Date(),
        scheduledStart: parsedDueDate || new Date(),
      });
    } catch (attErr) {
      console.warn('exercisePlan attendance:', attErr.message);
    }

    await notifyUsers(
      [clientId],
      `Your coach assigned a new workout: "${plan.title}"`,
      'update',
    );

    return res.status(201).json(plan);
  } catch (error) {
    console.error('createExercisePlan:', error.message);
    return res.status(500).json({ message: 'Error creating exercise plan' });
  }
}

async function getExercisePlans(req, res) {
  try {
    const { clientId } = req.params;
    const allowed = await hasActiveAssignment(req.user._id, clientId);
    if (!allowed) {
      return res.status(403).json({ message: 'Client is not assigned to you' });
    }

    const plans = await ExercisePlan.find({
      coach: req.user._id,
      client: clientId,
      status: 'active',
    }).sort({ createdAt: -1 }).lean();

    const planIds = plans.map((p) => p._id);
    const completions = await WorkoutCompletion.find({ exercisePlan: { $in: planIds } })
      .populate('user', USER_DISPLAY_SELECT)
      .lean();

    return res.json(attachPlanStats(plans, completions));
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching exercise plans' });
  }
}

async function getGroupExercisePlans(req, res) {
  try {
    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.classId,
      coach: req.user._id,
    });
    if (!fitnessClass) {
      return res.status(404).json({ message: 'Class not found' });
    }

    const plans = await ExercisePlan.find({
      coach: req.user._id,
      fitnessClass: req.params.classId,
      status: 'active',
    }).sort({ createdAt: -1 }).lean();

    const planIds = plans.map((p) => p._id);
    const completions = await WorkoutCompletion.find({ exercisePlan: { $in: planIds } })
      .populate('user', USER_DISPLAY_SELECT)
      .lean();

    return res.json(attachPlanStats(plans, completions));
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching group exercise plans' });
  }
}

async function getExercisePlanById(req, res) {
  try {
    const plan = await ExercisePlan.findOne({
      _id: req.params.planId,
      coach: req.user._id,
      status: 'active',
    }).lean();
    if (!plan) return res.status(404).json({ message: 'Workout plan not found' });

    const completions = await WorkoutCompletion.find({ exercisePlan: plan._id })
      .populate('user', USER_DISPLAY_SELECT)
      .lean();

    const [enriched] = attachPlanStats([plan], completions);
    return res.json(enriched);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching workout plan' });
  }
}

async function updateExercisePlan(req, res) {
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'exercise_plan' })) return;

    const plan = await ExercisePlan.findOne({
      _id: req.params.planId,
      coach: req.user._id,
      status: 'active',
    });
    if (!plan) return res.status(404).json({ message: 'Workout plan not found' });

    const {
      title,
      description,
      instructions,
      level,
      exercises,
      dueDate,
    } = req.body;

    if (title !== undefined) plan.title = title.trim() || plan.title;
    if (description !== undefined) plan.description = description;
    if (instructions !== undefined) plan.instructions = instructions;
    if (level !== undefined) plan.level = normalizeLevel(level);
    if (dueDate !== undefined) plan.dueDate = dueDate ? new Date(dueDate) : null;
    if (exercises !== undefined) {
      const normalized = normalizeExercises(exercises);
      if (!normalized.length) {
        return res.status(400).json({ message: 'At least one exercise is required' });
      }
      plan.exercises = normalized;
    }

    await plan.save();

    const targetUserIds = plan.client
      ? [plan.client]
      : await FitnessClass.findById(plan.fitnessClass).then((c) => (c?.enrolledStudents || []));

    if (targetUserIds.length) {
      await notifyUsers(
        targetUserIds,
        `Your workout "${plan.title}" was updated by your coach`,
        'update',
      );
    }

    return res.json(plan);
  } catch (error) {
    console.error('updateExercisePlan:', error.message);
    return res.status(500).json({ message: 'Error updating workout plan' });
  }
}

async function deleteExercisePlan(req, res) {
  try {
    const plan = await ExercisePlan.findOneAndUpdate(
      { _id: req.params.planId, coach: req.user._id },
      { status: 'archived' },
      { new: true },
    );
    if (!plan) return res.status(404).json({ message: 'Workout plan not found' });
    return res.json({ message: 'Workout plan deleted', plan });
  } catch (error) {
    return res.status(500).json({ message: 'Error deleting workout plan' });
  }
}

async function getClientWorkoutProgress(req, res) {
  try {
    const { clientId } = req.params;
    const allowed = await hasActiveAssignment(req.user._id, clientId);
    if (!allowed) return res.status(403).json({ message: 'Client not assigned to you' });

    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const plans = await ExercisePlan.find({ coach: req.user._id, client: clientId, status: 'active' }).lean();
    const planIds = plans.map((p) => p._id);

    const [allCompletions, historyCompletions] = await Promise.all([
      WorkoutCompletion.find({ exercisePlan: { $in: planIds }, user: clientId })
        .populate('user', USER_DISPLAY_SELECT)
        .lean(),
      WorkoutCompletion.find({ user: clientId, coach: req.user._id, createdAt: { $gte: since } })
        .populate('exercisePlan', 'title level')
        .sort({ createdAt: -1 })
        .lean(),
    ]);
    const completed = allCompletions.filter((c) => c.status === 'completed').length;
    const pending = allCompletions.filter((c) => c.status === 'pending').length;
    const missed = allCompletions.filter((c) => c.status === 'missed').length;
    const total = allCompletions.length;

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekCompletions = historyCompletions.filter((c) => new Date(c.createdAt) >= weekAgo);
    const weekCompleted = weekCompletions.filter((c) => c.status === 'completed').length;

    return res.json({
      summary: {
        totalPlans: plans.length,
        totalAssignments: total,
        completed,
        pending,
        missed,
        completionPercent: total ? Math.round((completed / total) * 100) : 0,
        weeklyCompletionPercent: weekCompletions.length
          ? Math.round((weekCompleted / weekCompletions.length) * 100)
          : 0,
      },
      plans: attachPlanStats(plans, allCompletions),
      history: historyCompletions,
    });
  } catch (error) {
    console.error('getClientWorkoutProgress:', error.message);
    return res.status(500).json({ message: 'Error fetching client workout progress' });
  }
}

async function getGroupWorkoutProgress(req, res) {
  try {
    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.classId,
      coach: req.user._id,
    }).populate('enrolledStudents', USER_DISPLAY_SELECT);
    if (!fitnessClass) return res.status(404).json({ message: 'Class not found' });

    const plans = await ExercisePlan.find({
      coach: req.user._id,
      fitnessClass: req.params.classId,
      status: 'active',
    }).lean();

    const planIds = plans.map((p) => p._id);
    const completions = await WorkoutCompletion.find({ exercisePlan: { $in: planIds } })
      .populate('user', USER_DISPLAY_SELECT)
      .populate('exercisePlan', 'title')
      .lean();

    const completed = completions.filter((c) => c.status === 'completed').length;
    const pending = completions.filter((c) => c.status === 'pending').length;
    const missed = completions.filter((c) => c.status === 'missed').length;
    const total = completions.length;

    const memberStats = (fitnessClass.enrolledStudents || []).map((student) => {
      const studentId = String(student._id || student);
      const studentCompletions = completions.filter((c) => String(c.user?._id || c.user) === studentId);
      const done = studentCompletions.filter((c) => c.status === 'completed').length;
      const studentTotal = studentCompletions.length;
      return {
        user: student,
        completed: done,
        pending: studentCompletions.filter((c) => c.status === 'pending').length,
        missed: studentCompletions.filter((c) => c.status === 'missed').length,
        total: studentTotal,
        completionPercent: studentTotal ? Math.round((done / studentTotal) * 100) : 0,
      };
    });

    return res.json({
      class: {
        _id: fitnessClass._id,
        title: fitnessClass.title,
        enrolledCount: fitnessClass.enrolledStudents?.length ?? 0,
      },
      summary: {
        totalPlans: plans.length,
        totalAssignments: total,
        completed,
        pending,
        missed,
        completionPercent: total ? Math.round((completed / total) * 100) : 0,
      },
      plans: attachPlanStats(plans, completions),
      memberStats,
      history: completions,
    });
  } catch (error) {
    console.error('getGroupWorkoutProgress:', error.message);
    return res.status(500).json({ message: 'Error fetching group workout progress' });
  }
}

async function sendWorkoutReminder(req, res) {
  try {
    const plan = await ExercisePlan.findOne({
      _id: req.params.planId,
      coach: req.user._id,
      status: 'active',
    });
    if (!plan) return res.status(404).json({ message: 'Workout plan not found' });

    let userIds = [];
    if (plan.client) {
      userIds = [plan.client];
    } else if (plan.fitnessClass) {
      const fitnessClass = await FitnessClass.findById(plan.fitnessClass);
      userIds = fitnessClass?.enrolledStudents || [];
    }

    const pendingCompletions = await WorkoutCompletion.find({
      exercisePlan: plan._id,
      status: 'pending',
      user: { $in: userIds },
    });
    const targetIds = pendingCompletions.map((c) => c.user);

    await notifyUsers(
      targetIds,
      `Workout reminder: "${plan.title}" is ready. Don't forget to complete it!`,
      'reminder',
    );

    return res.json({ sent: targetIds.length, message: 'Workout reminders sent' });
  } catch (error) {
    console.error('sendWorkoutReminder:', error.message);
    return res.status(500).json({ message: 'Error sending workout reminder' });
  }
}

// --- User endpoints ---

function mapExercisesForDisplay(exercises = []) {
  return (Array.isArray(exercises) ? exercises : [])
    .map((entry) => {
      if (typeof entry === 'string') {
        return { name: entry.trim(), sets: 3, reps: 10 };
      }
      if (!entry || typeof entry !== 'object') return null;
      const name = String(entry.name || '').trim();
      if (!name) return null;
      return {
        name,
        sets: entry.sets ?? 3,
        reps: entry.reps ?? 10,
        durationMinutes: entry.durationMinutes,
        restSeconds: entry.restSeconds,
        equipment: entry.equipment || '',
        instructions: entry.instructions || '',
        notes: entry.notes || '',
        demoImageUrl: normalizeMediaUrl(entry.demoImageUrl),
        demoVideoUrl: normalizeMediaUrl(entry.demoVideoUrl),
        dayOfWeek: entry.dayOfWeek,
        dayName: entry.dayName,
      };
    })
    .filter(Boolean);
}

function collectWeeklyPlanExercises(plan) {
  const collected = [];
  const seen = new Set();
  const templateExercises = mapExercisesForDisplay(plan.workoutTemplate?.exercises || []);

  for (const day of plan.days || []) {
    if (!day?.enabled || day.offDay) continue;
    const dayExercises = mapExercisesForDisplay(day.exercises || []);
    const source = dayExercises.length ? dayExercises : templateExercises;
    for (const exercise of source) {
      const key = `${exercise.name}|${exercise.sets}|${exercise.reps}|${day.dayOfWeek}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({
        ...exercise,
        dayOfWeek: day.dayOfWeek,
        dayName: DAY_NAMES[day.dayOfWeek] || undefined,
      });
    }
  }

  if (collected.length) return collected;
  return templateExercises;
}

async function ensureUserExerciseCompletions(userId, plans) {
  for (const plan of plans) {
    const exists = await WorkoutCompletion.findOne({
      exercisePlan: plan._id,
      user: userId,
    }).select('_id');
    if (exists) continue;
    await WorkoutCompletion.create({
      exercisePlan: plan._id,
      user: userId,
      coach: plan.coach?._id || plan.coach,
      dueDate: plan.dueDate,
      status: 'pending',
    }).catch((err) => {
      if (err.code !== 11000) throw err;
    });
  }
}

async function ensureUserScheduleCompletions(userId, schedules) {
  for (const schedule of schedules) {
    await ScheduleCompletion.updateOne(
      { workoutSchedule: schedule._id, user: userId },
      {
        $setOnInsert: {
          workoutSchedule: schedule._id,
          user: userId,
          coach: schedule.coach?._id || schedule.coach,
          status: 'pending',
        },
      },
      { upsert: true },
    );
  }
}

/**
 * Unified member "My Workouts" feed:
 * - Exercise plans (individual + group)
 * - Weekly workout plans (individual + group)
 * - Standalone schedules (not already covered by a weekly plan)
 */
async function getUserExercisePlans(req, res) {
  try {
    const userId = req.user._id;
    const enrolledClasses = await FitnessClass.find({ enrolledStudents: userId }).select('_id');
    const classIds = enrolledClasses.map((c) => c._id);

    const targetOr = [{ client: userId }];
    if (classIds.length) {
      targetOr.push({ fitnessClass: { $in: classIds } });
    }

    const [exercisePlans, weeklyPlans, schedules] = await Promise.all([
      ExercisePlan.find({ status: 'active', $or: targetOr })
        .populate('coach', USER_DISPLAY_SELECT)
        .populate('fitnessClass', 'title')
        .sort({ createdAt: -1 })
        .lean(),
      WeeklyWorkoutPlan.find({ status: 'active', $or: targetOr })
        .populate('coach', USER_DISPLAY_SELECT)
        .populate('fitnessClass', 'title')
        .populate('workoutTemplate', 'title level exercises')
        .sort({ weekStartDate: -1, createdAt: -1 })
        .lean(),
      WorkoutSchedule.find({
        status: { $in: ['scheduled', 'completed'] },
        weeklyPlan: null,
        $or: targetOr,
      })
        .populate('coach', USER_DISPLAY_SELECT)
        .populate('fitnessClass', 'title')
        .populate('workoutTemplate', 'title level exercises')
        .sort({ startDateTime: -1 })
        .lean(),
    ]);

    await ensureUserExerciseCompletions(userId, exercisePlans);

    const weeklySchedules = await WorkoutSchedule.find({
      weeklyPlan: { $in: weeklyPlans.map((p) => p._id) },
      status: { $in: ['scheduled', 'completed'] },
      $or: targetOr,
    })
      .select('_id weeklyPlan coach dayOfWeek startDateTime endDateTime durationMinutes exercises')
      .lean();

    const allSchedules = [...schedules, ...weeklySchedules];
    await ensureUserScheduleCompletions(userId, allSchedules);

    const [exerciseCompletions, scheduleCompletions] = await Promise.all([
      WorkoutCompletion.find({
        exercisePlan: { $in: exercisePlans.map((p) => p._id) },
        user: userId,
      }).lean(),
      ScheduleCompletion.find({
        workoutSchedule: { $in: allSchedules.map((s) => s._id) },
        user: userId,
      }).lean(),
    ]);

    const exerciseCompletionMap = new Map(
      exerciseCompletions.map((c) => [String(c.exercisePlan), c]),
    );
    const scheduleCompletionMap = new Map(
      scheduleCompletions.map((c) => [String(c.workoutSchedule), c]),
    );

    const items = [];

    for (const plan of exercisePlans) {
      const c = exerciseCompletionMap.get(String(plan._id));
      items.push({
        ...plan,
        exercises: mapExercisesForDisplay(plan.exercises),
        source: 'exercise_plan',
        assigneeType: plan.fitnessClass ? 'group' : 'user',
        groupName: plan.fitnessClass?.title || null,
        completion: c
          ? {
              _id: c._id,
              status: c.status,
              completedAt: c.completedAt,
              dueDate: c.dueDate,
              notes: c.notes || '',
              durationMinutes: c.durationMinutes,
              submittedAt: c.submittedAt,
              reviewedAt: c.reviewedAt,
              coachFeedback: c.coachFeedback || '',
              hasProofPhoto: Boolean(c.proofPhoto),
            }
          : { status: 'pending' },
      });
    }

    for (const plan of weeklyPlans) {
      const planSchedules = weeklySchedules.filter(
        (schedule) => String(schedule.weeklyPlan) === String(plan._id),
      );
      const days = (plan.days || []).map((day) => {
        const schedule = planSchedules.find(
          (candidate) => candidate.dayOfWeek === day.dayOfWeek,
        );
        const dayCompletion = schedule
          ? scheduleCompletionMap.get(String(schedule._id))
          : null;
        return {
          ...day,
          dayName: DAY_NAMES[day.dayOfWeek],
          scheduleId: schedule?._id || null,
          startDateTime: schedule?.startDateTime || null,
          endDateTime: schedule?.endDateTime || null,
          durationMinutes: schedule?.durationMinutes,
          exercises: mapExercisesForDisplay(
            schedule?.exercises?.length ? schedule.exercises : day.exercises,
          ),
          completion: schedule
            ? {
                status: dayCompletion?.status || 'pending',
                completedAt: dayCompletion?.completedAt || null,
                notes: dayCompletion?.notes || '',
                durationMinutes: dayCompletion?.durationMinutes,
                coachFeedback: dayCompletion?.coachFeedback || '',
                hasProofPhoto: Boolean(dayCompletion?.proofPhoto),
              }
            : null,
        };
      });
      const trackableDays = days.filter(
        (day) => day.enabled && !day.offDay && day.scheduleId,
      );
      const completedDays = trackableDays.filter(
        (day) => day.completion?.status === 'completed',
      ).length;

      items.push({
        _id: plan._id,
        title: plan.title || plan.workoutTemplate?.title || 'Weekly Workout Plan',
        description: plan.fitnessClass
          ? `Group plan · ${plan.fitnessClass.title}`
          : 'Weekly plan',
        level: normalizeLevel(plan.workoutTemplate?.level),
        exercises: collectWeeklyPlanExercises(plan),
        coach: plan.coach,
        client: plan.client,
        fitnessClass: plan.fitnessClass,
        weekStartDate: plan.weekStartDate,
        days,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
        source: 'weekly_plan',
        assigneeType: plan.fitnessClass ? 'group' : 'user',
        groupName: plan.fitnessClass?.title || null,
        completion: {
          status: trackableDays.length > 0 && completedDays === trackableDays.length
            ? 'completed'
            : 'pending',
          completable: false,
          completedDays,
          totalDays: trackableDays.length,
        },
      });
    }

    for (const schedule of schedules) {
      const c = scheduleCompletionMap.get(String(schedule._id));
      const template = schedule.workoutTemplate || {};
      const exercises = mapExercisesForDisplay(
        (schedule.exercises && schedule.exercises.length)
          ? schedule.exercises
          : (template.exercises || []),
      );
      items.push({
        _id: schedule._id,
        title: template.title || schedule.title || 'Workout',
        description: schedule.fitnessClass
          ? `Group · ${schedule.fitnessClass.title}`
          : (schedule.notes || ''),
        level: normalizeLevel(template.level),
        exercises,
        coach: schedule.coach,
        client: schedule.client,
        fitnessClass: schedule.fitnessClass,
        startDateTime: schedule.startDateTime,
        endDateTime: schedule.endDateTime,
        durationMinutes: schedule.durationMinutes,
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt,
        source: 'schedule',
        assigneeType: schedule.fitnessClass ? 'group' : 'user',
        groupName: schedule.fitnessClass?.title || null,
        completion: c
          ? {
              _id: c._id,
              status: c.status,
              completedAt: c.completedAt,
              notes: c.notes || '',
              durationMinutes: c.durationMinutes,
              submittedAt: c.submittedAt,
              reviewedAt: c.reviewedAt,
              coachFeedback: c.coachFeedback || '',
              hasProofPhoto: Boolean(c.proofPhoto),
              completable: c.status === 'pending' || c.status === 'missed',
            }
          : { status: 'pending', completable: true },
      });
    }

    items.sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || a.weekStartDate || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || b.weekStartDate || 0).getTime();
      return bTime - aTime;
    });

    return res.json(items);
  } catch (error) {
    console.error('getUserExercisePlans:', error.message);
    return res.status(500).json({ message: 'Error fetching your workouts' });
  }
}

async function completeWorkout(req, res) {
  try {
    const proof = require('../utils/workoutProofUtils').validateWorkoutProof(req.body);
    if (!proof.ok) {
      return res.status(400).json({ message: proof.message });
    }

    const { uploadImageDataUrl } = require('../utils/imageKit');
    let proofUrl = proof.proofPhoto;
    try {
      proofUrl = await uploadImageDataUrl(proof.proofPhoto, {
        folder: '/vital/workout-proofs',
        fileNamePrefix: `proof_${req.user._id}`,
        tags: ['workout_proof', 'exercise_plan'],
      });
    } catch (uploadError) {
      console.error('completeWorkout ImageKit:', uploadError.message);
      if (uploadError.code === 'IMAGEKIT_NOT_CONFIGURED') {
        return res.status(503).json({ message: uploadError.message, code: uploadError.code });
      }
      return res.status(500).json({ message: 'Unable to upload workout photo' });
    }

    const completion = await WorkoutCompletion.findOne({
      exercisePlan: req.params.planId,
      user: req.user._id,
      status: { $in: ['pending', 'missed'] },
    }).populate('exercisePlan', 'title coach');

    if (!completion) {
      return res.status(404).json({ message: 'No pending workout found' });
    }

    completion.status = 'pending_review';
    completion.notes = proof.notes;
    completion.durationMinutes = proof.durationMinutes;
    completion.proofPhoto = proofUrl;
    completion.submittedAt = new Date();
    completion.completedAt = undefined;
    completion.reviewedAt = undefined;
    completion.coachFeedback = '';
    await completion.save();

    if (completion.coach) {
      await Notification.create({
        user: completion.coach,
        message: `${req.user.name} submitted workout "${completion.exercisePlan?.title || 'Workout'}" for review`,
        type: 'update',
      });
    }

    return res.json(completion);
  } catch (error) {
    console.error('completeWorkout:', error.message);
    return res.status(500).json({ message: 'Error completing workout' });
  }
}

async function getUserWorkoutProgress(req, res) {
  try {
    const { computeWorkoutStreak } = require('../utils/workoutProofUtils');
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [exerciseCompletions, scheduleCompletions] = await Promise.all([
      WorkoutCompletion.find({
        user: req.user._id,
        createdAt: { $gte: since },
      })
        .populate('exercisePlan', 'title level exercises')
        .sort({ createdAt: -1 })
        .lean(),
      ScheduleCompletion.find({
        user: req.user._id,
        createdAt: { $gte: since },
      })
        .populate({
          path: 'workoutSchedule',
          select: 'startDateTime dayOfWeek workoutTemplate weeklyPlan fitnessClass',
          populate: { path: 'workoutTemplate', select: 'title level exercises' },
        })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const history = [
      ...exerciseCompletions.map((completion) => ({
        ...completion,
        source: 'exercise_plan',
      })),
      ...scheduleCompletions.map((completion) => ({
        ...completion,
        source: 'schedule',
      })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const completed = history.filter((c) => c.status === 'completed').length;
    const pending = history.filter((c) => c.status === 'pending').length;
    const pendingReview = history.filter((c) => c.status === 'pending_review').length;
    const missed = history.filter((c) => c.status === 'missed').length;
    const total = history.length;

    const streakDates = history
      .filter((c) => c.status === 'completed')
      .map((c) => c.completedAt || c.reviewedAt || c.submittedAt || c.updatedAt || c.createdAt);

    // Streak uses all-time completed days in a wider window for accuracy
    const [allExerciseDone, allScheduleDone] = await Promise.all([
      WorkoutCompletion.find({ user: req.user._id, status: 'completed' })
        .select('completedAt reviewedAt submittedAt updatedAt createdAt')
        .lean(),
      ScheduleCompletion.find({ user: req.user._id, status: 'completed' })
        .select('completedAt reviewedAt submittedAt updatedAt createdAt')
        .lean(),
    ]);
    const allStreakDates = [
      ...allExerciseDone,
      ...allScheduleDone,
    ].map((c) => c.completedAt || c.reviewedAt || c.submittedAt || c.updatedAt || c.createdAt);

    return res.json({
      summary: {
        completed,
        pending,
        pendingReview,
        missed,
        completionPercent: total ? Math.round((completed / total) * 100) : 0,
        streak: computeWorkoutStreak(allStreakDates.length ? allStreakDates : streakDates),
      },
      history,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching workout progress' });
  }
}

module.exports = {
  createExercisePlan,
  getExercisePlans,
  getGroupExercisePlans,
  getExercisePlanById,
  updateExercisePlan,
  deleteExercisePlan,
  getClientWorkoutProgress,
  getGroupWorkoutProgress,
  sendWorkoutReminder,
  getUserExercisePlans,
  completeWorkout,
  getUserWorkoutProgress,
};
