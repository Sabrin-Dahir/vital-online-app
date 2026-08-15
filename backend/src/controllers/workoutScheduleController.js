const WorkoutSchedule = require('../models/WorkoutSchedule');
const WorkoutTemplate = require('../models/WorkoutTemplate');
const ScheduleCompletion = require('../models/ScheduleCompletion');
const FitnessClass = require('../models/FitnessClass');
const Notification = require('../models/Notification');
const WeeklyWorkoutPlan = require('../models/WeeklyWorkoutPlan');
const { hasActiveAssignment, getAuthorizedCoachIdsForUser } = require('../utils/coachVisibility');
const { calendarDateFromInstant, isSameCalendarDay, getWeekStart, parseLocalDate, formatDateOnlyIso } = require('../utils/weeklyPlanUtils');
const { normalizeMediaUrl } = require('../utils/normalizeMediaUrl');
const { USER_DISPLAY_SELECT } = require('../utils/userDisplay');

function formatDateTime(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function getScheduleTargetUserIds(schedule) {
  if (schedule.client) {
    return [schedule.client._id || schedule.client];
  }
  if (schedule.fitnessClass) {
    const classId = schedule.fitnessClass._id || schedule.fitnessClass;
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

/** Attach enrolledCount from FitnessClass.enrolledStudents for coach UI labels. */
function withFitnessClassMemberCount(schedule) {
  const fitnessClass = schedule?.fitnessClass;
  if (!fitnessClass || typeof fitnessClass !== 'object') return schedule;
  const enrolled = fitnessClass.enrolledStudents;
  const enrolledCount = Array.isArray(enrolled)
    ? enrolled.length
    : Number(fitnessClass.enrolledCount) || 0;
  return {
    ...schedule,
    fitnessClass: {
      ...fitnessClass,
      enrolledCount,
    },
  };
}

function attachCompletionStats(schedules, completions) {
  return schedules.map((schedule) => {
    const scheduleId = String(schedule._id);
    const scheduleCompletions = completions.filter(
      (c) => String(c.workoutSchedule?._id || c.workoutSchedule) === scheduleId,
    );
    const completed = scheduleCompletions.filter((c) => c.status === 'completed').length;
    const pending = scheduleCompletions.filter((c) => c.status === 'pending').length;
    const pendingReview = scheduleCompletions.filter((c) => c.status === 'pending_review').length;
    const missed = scheduleCompletions.filter((c) => c.status === 'missed').length;
    const total = scheduleCompletions.length;
    const title = schedule.workoutTemplate?.title || schedule.title || 'Workout';
    return withFitnessClassMemberCount({
      ...schedule,
      title,
      progress: {
        total,
        completed,
        pending,
        pendingReview,
        missed,
        completionPercent: total ? Math.round((completed / total) * 100) : 0,
        completions: scheduleCompletions,
      },
    });
  });
}

async function ensureUserCompletions(userId, schedules) {
  for (const schedule of schedules) {
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

async function createWorkoutSchedule(req, res) {
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'workout_schedule' })) return;

    const {
      workoutTemplateId,
      clientId,
      fitnessClassId,
      startDateTime,
      endDateTime,
      durationMinutes,
      notes,
      reminderEnabled,
      reminderMinutesBefore,
    } = req.body;

    if (!workoutTemplateId) {
      return res.status(400).json({ message: 'Workout template is required' });
    }
    if (!startDateTime || !endDateTime) {
      return res.status(400).json({ message: 'Start and end time are required' });
    }

    const template = await WorkoutTemplate.findOne({
      _id: workoutTemplateId,
      coach: req.user._id,
      status: 'active',
    });
    if (!template) return res.status(404).json({ message: 'Workout template not found' });

    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid start or end time' });
    }
    if (end <= start) {
      return res.status(400).json({ message: 'End time must be after start time' });
    }

    const base = {
      coach: req.user._id,
      workoutTemplate: workoutTemplateId,
      exercises: (template.exercises || []).map((e) => ({
        name: e.name,
        sets: e.sets ?? 3,
        reps: e.reps ?? 10,
        durationMinutes: e.durationMinutes,
        restSeconds: e.restSeconds,
        equipment: e.equipment || '',
        instructions: e.instructions || '',
        notes: e.notes || '',
        demoImageUrl: normalizeMediaUrl(e.demoImageUrl),
        demoVideoUrl: normalizeMediaUrl(e.demoVideoUrl),
      })),
      startDateTime: start,
      endDateTime: end,
      durationMinutes: durationMinutes ?? Math.round((end - start) / 60000),
      notes: notes || '',
      reminderEnabled: reminderEnabled !== false,
      reminderMinutesBefore: reminderMinutesBefore ?? 30,
      reminderSent: false,
      status: 'scheduled',
    };

    let schedule;
    if (fitnessClassId) {
      const fitnessClass = await FitnessClass.findOne({ _id: fitnessClassId, coach: req.user._id });
      if (!fitnessClass) return res.status(404).json({ message: 'Class not found' });
      schedule = await WorkoutSchedule.create({ ...base, fitnessClass: fitnessClassId });
    } else if (clientId) {
      const allowed = await hasActiveAssignment(req.user._id, clientId);
      if (!allowed) return res.status(403).json({ message: 'Client is not assigned to you' });
      schedule = await WorkoutSchedule.create({ ...base, client: clientId });
    } else {
      return res.status(400).json({ message: 'Client ID or class ID is required' });
    }

    const populated = await WorkoutSchedule.findById(schedule._id)
      .populate('workoutTemplate')
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title category enrolledStudents');

    const userIds = await getScheduleTargetUserIds(populated);
    await createCompletionRecords(schedule, userIds);

    try {
      const { ensureWorkoutAttendance } = require('../utils/attendanceService');
      await Promise.all(
        userIds.map((uid) =>
          ensureWorkoutAttendance({
            coachId: req.user._id,
            userId: uid,
            workoutScheduleId: schedule._id,
            date: schedule.startDateTime,
            scheduledStart: schedule.startDateTime,
            scheduledEnd: schedule.endDateTime,
          }),
        ),
      );
    } catch (attErr) {
      console.warn('workoutSchedule attendance:', attErr.message);
    }

    const workoutTitle = template.title;
    await notifyUsers(
      userIds,
      `New workout scheduled: "${workoutTitle}" on ${formatDateTime(start)}`,
      'workout',
      { screen: 'schedule', startDateTime: start.toISOString() },
    );

    return res.status(201).json(attachCompletionStats([populated.toObject()], [])[0]);
  } catch (error) {
    console.error('createWorkoutSchedule:', error.message);
    return res.status(500).json({ message: 'Error creating workout schedule' });
  }
}

async function getCoachWorkoutSchedules(req, res) {
  try {
    const query = { coach: req.user._id, status: { $ne: 'cancelled' } };
    if (req.query.clientId) query.client = req.query.clientId;
    if (req.query.classId) query.fitnessClass = req.query.classId;
    if (req.query.status) query.status = req.query.status;
    if (req.query.standaloneOnly === 'true') {
      query.$or = [{ weeklyPlan: null }, { weeklyPlan: { $exists: false } }];
    }

    // Default window keeps list payloads small (past 14 days → next 60 days).
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 14);
    const to = new Date(now);
    to.setDate(to.getDate() + 60);
    if (!req.query.from && !req.query.to && !req.query.all) {
      query.startDateTime = { $gte: from, $lte: to };
    } else {
      if (req.query.from) {
        const f = new Date(req.query.from);
        if (!Number.isNaN(f.getTime())) query.startDateTime = { ...(query.startDateTime || {}), $gte: f };
      }
      if (req.query.to) {
        const t = new Date(req.query.to);
        if (!Number.isNaN(t.getTime())) query.startDateTime = { ...(query.startDateTime || {}), $lte: t };
      }
    }

    const schedules = await WorkoutSchedule.find(query)
      .populate('workoutTemplate', 'title level')
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title category enrolledStudents')
      .populate('weeklyPlan', 'title weekStartDate')
      .sort({ startDateTime: 1 })
      .limit(Math.min(Number(req.query.limit) || 120, 250))
      .lean();

    const scheduleIds = schedules.map((s) => s._id);
    const completions = scheduleIds.length
      ? await ScheduleCompletion.find({ workoutSchedule: { $in: scheduleIds } })
          .populate('user', USER_DISPLAY_SELECT)
          // List payload: omit proof photo URLs/base64 (keep a boolean flag only).
          .select('workoutSchedule user status completedAt proofPhoto')
          .lean()
      : [];

    const slimCompletions = completions.map((c) => ({
      _id: c._id,
      workoutSchedule: c.workoutSchedule,
      user: c.user,
      status: c.status,
      completedAt: c.completedAt,
      hasProofPhoto: Boolean(c.proofPhoto),
    }));

    const enriched = attachCompletionStats(schedules, slimCompletions);

    const completed = completions.filter((c) => c.status === 'completed').length;
    const pending = completions.filter((c) => c.status === 'pending').length;
    const missed = completions.filter((c) => c.status === 'missed').length;
    const total = completions.length;

    return res.json({
      summary: {
        totalSchedules: schedules.length,
        totalAssignments: total,
        completed,
        pending,
        missed,
        completionPercent: total ? Math.round((completed / total) * 100) : 0,
      },
      schedules: enriched,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching workout schedules' });
  }
}

async function getWorkoutScheduleById(req, res) {
  try {
    const schedule = await WorkoutSchedule.findOne({
      _id: req.params.id,
      coach: req.user._id,
    })
      .populate('workoutTemplate')
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title category enrolledStudents')
      .lean();

    if (!schedule) return res.status(404).json({ message: 'Schedule not found' });

    const completions = await ScheduleCompletion.find({ workoutSchedule: schedule._id })
      .populate('user', USER_DISPLAY_SELECT)
      .lean();

    const [enriched] = attachCompletionStats([schedule], completions);
    return res.json(enriched);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching schedule' });
  }
}

async function updateWorkoutSchedule(req, res) {
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'workout_schedule' })) return;

    const schedule = await WorkoutSchedule.findOne({
      _id: req.params.id,
      coach: req.user._id,
    }).populate('workoutTemplate');
    if (!schedule) return res.status(404).json({ message: 'Schedule not found' });

    const {
      workoutTemplateId,
      startDateTime,
      endDateTime,
      durationMinutes,
      notes,
      reminderEnabled,
      reminderMinutesBefore,
    } = req.body;

    if (workoutTemplateId) {
      const template = await WorkoutTemplate.findOne({
        _id: workoutTemplateId,
        coach: req.user._id,
        status: 'active',
      });
      if (!template) return res.status(404).json({ message: 'Workout template not found' });
      schedule.workoutTemplate = workoutTemplateId;
    }
    if (notes !== undefined) schedule.notes = notes;
    if (reminderEnabled !== undefined) schedule.reminderEnabled = !!reminderEnabled;
    if (reminderMinutesBefore !== undefined) schedule.reminderMinutesBefore = reminderMinutesBefore;
    if (startDateTime !== undefined) {
      const start = new Date(startDateTime);
      if (Number.isNaN(start.getTime())) {
        return res.status(400).json({ message: 'Invalid start time' });
      }
      schedule.startDateTime = start;
    }
    if (endDateTime !== undefined) {
      const end = new Date(endDateTime);
      if (Number.isNaN(end.getTime())) {
        return res.status(400).json({ message: 'Invalid end time' });
      }
      schedule.endDateTime = end;
    }
    if (durationMinutes !== undefined) schedule.durationMinutes = durationMinutes;

    if (startDateTime !== undefined || endDateTime !== undefined) {
      if (schedule.endDateTime <= schedule.startDateTime) {
        return res.status(400).json({ message: 'End time must be after start time' });
      }
      schedule.reminderSent = false;
    }
    if (reminderMinutesBefore !== undefined || reminderEnabled !== undefined) {
      schedule.reminderSent = false;
    }

    await schedule.save();

    const populated = await WorkoutSchedule.findById(schedule._id)
      .populate('workoutTemplate')
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title category enrolledStudents');

    const userIds = await getScheduleTargetUserIds(populated);
    const title = populated.workoutTemplate?.title || 'Workout';
    await notifyUsers(
      userIds,
      `Workout schedule updated: "${title}" on ${formatDateTime(schedule.startDateTime)}`,
      'update',
    );

    return res.json(attachCompletionStats([populated.toObject()], [])[0]);
  } catch (error) {
    console.error('updateWorkoutSchedule:', error.message);
    return res.status(500).json({ message: 'Error updating schedule' });
  }
}

async function deleteWorkoutSchedule(req, res) {
  try {
    const schedule = await WorkoutSchedule.findOneAndUpdate(
      { _id: req.params.id, coach: req.user._id },
      { $set: { status: 'cancelled' } },
      { new: true, runValidators: true },
    )
      .populate('workoutTemplate')
      .populate('client', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title');

    if (!schedule) return res.status(404).json({ message: 'Schedule not found' });

    const userIds = await getScheduleTargetUserIds(schedule);
    const title = schedule.workoutTemplate?.title || 'Workout';
    await notifyUsers(userIds, `Workout schedule cancelled: "${title}"`, 'update');

    return res.json({ message: 'Schedule deleted', schedule });
  } catch (error) {
    return res.status(500).json({ message: 'Error deleting schedule' });
  }
}

async function getUserWorkoutSchedules(req, res) {
  try {
    const enrolledClasses = await FitnessClass.find({ enrolledStudents: req.user._id }).select('_id');
    const classIds = enrolledClasses.map((c) => c._id);
    const authorizedCoachIds = await getAuthorizedCoachIdsForUser(req.user._id);

    const targetOr = [{ client: req.user._id }];
    if (classIds.length) targetOr.push({ fitnessClass: { $in: classIds } });

    const scheduleQuery = {
      status: { $in: ['scheduled', 'completed'] },
      $or: targetOr,
    };
    if (authorizedCoachIds.length) {
      scheduleQuery.coach = { $in: authorizedCoachIds };
    }

    const schedules = await WorkoutSchedule.find(scheduleQuery)
      .populate('coach', USER_DISPLAY_SELECT)
      .populate('workoutTemplate')
      .populate('fitnessClass', 'title')
      .populate('weeklyPlan', 'title weekStartDate')
      .sort({ startDateTime: 1 })
      .lean();

    await ensureUserCompletions(req.user._id, schedules);

    const scheduleIds = schedules.map((s) => s._id);
    const completions = await ScheduleCompletion.find({
      workoutSchedule: { $in: scheduleIds },
      user: req.user._id,
    }).lean();

    const completionMap = new Map(
      completions.map((c) => [String(c.workoutSchedule), c]),
    );

    const tz = Number.isFinite(Number(req.query.timezoneOffsetMinutes))
      ? Number(req.query.timezoneOffsetMinutes)
      : 0;
    const now = new Date();
    const todayCal = calendarDateFromInstant(now, tz);

    const result = schedules.map((s) => {
      const completion = completionMap.get(String(s._id));
      const title = s.workoutTemplate?.title || s.title || 'Workout';
      const status = completion?.status || 'pending';
      return {
        ...s,
        title,
        workout: s.workoutTemplate,
        date: s.startDateTime,
        scheduledAt: s.startDateTime,
        type: 'workout_schedule',
        assigneeType: s.fitnessClass ? 'group' : 'user',
        groupName: s.fitnessClass?.title || null,
        completion: completion
          ? {
              _id: completion._id,
              status: completion.status,
              completedAt: completion.completedAt,
              notes: completion.notes || '',
              durationMinutes: completion.durationMinutes,
              submittedAt: completion.submittedAt,
              coachFeedback: completion.coachFeedback || '',
              hasProofPhoto: Boolean(completion.proofPhoto),
              completable: status === 'pending' || status === 'missed',
            }
          : { status: 'pending', completable: true },
      };
    });

    const openStatuses = new Set(['pending', 'pending_review']);
    const today = result.filter((s) => {
      const scheduleDay = calendarDateFromInstant(s.startDateTime, tz);
      if (!isSameCalendarDay(scheduleDay, todayCal)) return false;
      if (s.completion?.status === 'missed') return false;
      return s.status === 'scheduled' && openStatuses.has(s.completion?.status || 'pending');
    });
    const upcoming = result.filter((s) => {
      const scheduleDay = calendarDateFromInstant(s.startDateTime, tz);
      if (scheduleDay < todayCal) return false;
      if (isSameCalendarDay(scheduleDay, todayCal)) return false;
      const d = new Date(s.startDateTime);
      return d >= now && s.status === 'scheduled' && openStatuses.has(s.completion?.status || 'pending');
    });
    const history = result.filter((s) => {
      const scheduleDay = calendarDateFromInstant(s.startDateTime, tz);
      if (scheduleDay < todayCal) return true;
      if (s.completion?.status === 'completed' || s.completion?.status === 'missed') return true;
      const d = new Date(s.startDateTime);
      return d < now;
    });

    const planTargetOr = [{ client: req.user._id }];
    if (classIds.length) planTargetOr.push({ fitnessClass: { $in: classIds } });

    const planQuery = {
      status: 'active',
      $or: planTargetOr,
    };
    if (authorizedCoachIds.length) {
      planQuery.coach = { $in: authorizedCoachIds };
    }

    const activePlans = await WeeklyWorkoutPlan.find(planQuery)
      .select('weekStartDate days')
      .sort({ weekStartDate: 1 })
      .lean();

    const todayWeekStart = getWeekStart(todayCal);
    let suggestedWeekStart = formatDateOnlyIso(todayWeekStart);

    for (const plan of activePlans) {
      const hasWorkoutDays = (plan.days || []).some((d) => d.enabled && d.workoutTemplate && !d.offDay);
      if (!hasWorkoutDays) continue;

      const planWeekStart = getWeekStart(plan.weekStartDate);
      const planWeekEnd = new Date(planWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

      const overlapsCurrentWeek = planWeekStart <= todayWeekStart && todayWeekStart < planWeekEnd;
      const isFutureWeek = planWeekStart >= todayWeekStart;

      if (overlapsCurrentWeek || isFutureWeek) {
        suggestedWeekStart = formatDateOnlyIso(overlapsCurrentWeek ? todayWeekStart : planWeekStart);
        break;
      }
    }

    return res.json({
      today,
      upcoming,
      history,
      all: result,
      suggestedWeekStart,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching your workout schedules' });
  }
}

async function completeWorkoutSchedule(req, res) {
  try {
    const { validateWorkoutProof } = require('../utils/workoutProofUtils');
    const proof = validateWorkoutProof(req.body);
    if (!proof.ok) {
      return res.status(400).json({ message: proof.message });
    }

    const { uploadImageDataUrl } = require('../utils/imageKit');
    let proofUrl = proof.proofPhoto;
    try {
      proofUrl = await uploadImageDataUrl(proof.proofPhoto, {
        folder: '/vital/workout-proofs',
        fileNamePrefix: `proof_${req.user._id}`,
        tags: ['workout_proof', 'schedule'],
      });
    } catch (uploadError) {
      console.error('completeWorkoutSchedule ImageKit:', uploadError.message);
      if (uploadError.code === 'IMAGEKIT_NOT_CONFIGURED') {
        return res.status(503).json({ message: uploadError.message, code: uploadError.code });
      }
      return res.status(500).json({ message: 'Unable to upload workout photo' });
    }

    const completion = await ScheduleCompletion.findOne({
      workoutSchedule: req.params.scheduleId,
      user: req.user._id,
      status: { $in: ['pending', 'missed'] },
    }).populate({
      path: 'workoutSchedule',
      populate: { path: 'workoutTemplate', select: 'title' },
    });

    if (!completion) {
      return res.status(404).json({ message: 'No incomplete scheduled workout found' });
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
      const title = completion.workoutSchedule?.workoutTemplate?.title || 'Workout';
      await Notification.create({
        user: completion.coach,
        message: `${req.user.name} submitted scheduled workout "${title}" for review`,
        type: 'workout',
      });
    }

    return res.json(completion);
  } catch (error) {
    console.error('completeWorkoutSchedule:', error.message);
    return res.status(500).json({ message: 'Error completing scheduled workout' });
  }
}

async function processWorkoutScheduleReminders() {
  try {
    const now = new Date();
    const schedules = await WorkoutSchedule.find({
      status: 'scheduled',
      reminderEnabled: true,
      reminderSent: false,
      startDateTime: { $gt: now },
    })
      .populate('workoutTemplate', 'title')
      .populate('client', '_id')
      .populate('fitnessClass', '_id');

    for (const schedule of schedules) {
      const reminderAt = new Date(
        schedule.startDateTime.getTime() - (schedule.reminderMinutesBefore || 30) * 60000,
      );
      if (now >= reminderAt) {
        const userIds = await getScheduleTargetUserIds(schedule);
        const title = schedule.workoutTemplate?.title || 'Workout';
        await notifyUsers(
          userIds,
          `Reminder: "${title}" starts in ${schedule.reminderMinutesBefore || 30} minutes (${formatDateTime(schedule.startDateTime)})`,
          'reminder',
        );
        schedule.reminderSent = true;
        await schedule.save();
      }
    }

    // Mark missed: past end time still pending
    const pastSchedules = await WorkoutSchedule.find({
      status: 'scheduled',
      endDateTime: { $lt: now },
    }).select('_id');

    const pastIds = pastSchedules.map((s) => s._id);
    if (pastIds.length) {
      await ScheduleCompletion.updateMany(
        { workoutSchedule: { $in: pastIds }, status: 'pending' },
        { $set: { status: 'missed' } },
      );
    }
  } catch (error) {
    console.error('processWorkoutScheduleReminders:', error.message);
  }
}

module.exports = {
  createWorkoutSchedule,
  getCoachWorkoutSchedules,
  getWorkoutScheduleById,
  updateWorkoutSchedule,
  deleteWorkoutSchedule,
  getUserWorkoutSchedules,
  completeWorkoutSchedule,
  processWorkoutScheduleReminders,
};
