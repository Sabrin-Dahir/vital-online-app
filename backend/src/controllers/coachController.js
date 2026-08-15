const CoachAssignment = require('../models/CoachAssignment');
const CoachClientAssignment = require('../models/CoachClientAssignment');
const { ensureLegacyCoachAssignment } = require('../utils/coachVisibility');
const User = require('../models/User');
const { hasActiveAssignment, getActiveClientIds } = require('../utils/coachVisibility');
const ActivityLog = require('../models/ActivityLog');
const MealLog = require('../models/MealLog');
const WaterLog = require('../models/WaterLog');
const Notification = require('../models/Notification');
const Schedule = require('../models/Schedule');
const Session = require('../models/Session');
const FitnessClass = require('../models/FitnessClass');
const { buildSeries, sum } = require('../utils/progressMetrics');
const coachingLiaisonAgent = require('../agents/coachingLiaisonAgent');
const { USER_DISPLAY_SELECT, withDisplayName, normalizeEnrolledStudents } = require('../utils/userDisplay');
const { backfillGroupPlanAccess, clearPendingGroupPlanAccess } = require('../utils/backfillGroupPlanAccess');

async function buildClientSnapshot(userId) {
  const [meals, activities, water, pendingWorkouts] = await Promise.all([
    MealLog.find({ user: userId }).sort({ date: -1 }).limit(7).maxTimeMS(8000),
    ActivityLog.find({ user: userId }).sort({ date: -1 }).limit(7).maxTimeMS(8000),
    WaterLog.find({ user: userId }).sort({ date: -1 }).limit(7).maxTimeMS(8000),
    ActivityLog.countDocuments({ user: userId, status: 'pending' }).maxTimeMS(8000),
  ]);

  const approvedActivities = activities.filter((a) => a.status === 'approved');
  const caloriesIn = sum(meals, 'calories');
  const caloriesOut = sum(approvedActivities, 'caloriesBurned');
  const hydration = sum(water, 'amountMl');

  const snapshot = {
    summary: {
      caloriesIn,
      caloriesOut,
      hydration,
      netCalories: caloriesIn - caloriesOut,
      logCount: meals.length + activities.length + water.length,
      pendingWorkouts,
    },
    trends: {
      caloriesIn: buildSeries(meals, 'date', 'calories'),
      caloriesOut: buildSeries(activities, 'date', 'caloriesBurned'),
      hydration: buildSeries(water, 'date', 'amountMl'),
    },
    recentLogs: {
      meals: meals.slice(0, 5),
      activities: activities.slice(0, 5),
      water: water.slice(0, 5),
    },
  };

  const analysis = coachingLiaisonAgent.analyzeTrends(snapshot);
  snapshot.analysis = analysis;

  return snapshot;
}

async function getClientGroups(coachId, userId) {
  const classes = await FitnessClass.find({
    coach: coachId,
    enrolledStudents: userId,
  })
    .select('title category date status capacity enrolledStudents')
    .sort({ date: 1 })
    .lean();

  return classes.map((cls) => ({
    _id: cls._id,
    title: cls.title,
    category: cls.category,
    date: cls.date,
    status: cls.status,
    capacity: cls.capacity,
    enrolledCount: (cls.enrolledStudents || []).length,
  }));
}

async function getClients(req, res) {
  try {
  // Query both assignment collections and merge by client ID
  // This ensures clients show up regardless of which collection was populated
  const coachId = req.user._id;
  // light=1 skips heavy per-client snapshots (used by workout forms / pickers).
  const light = req.query.light === '1' || req.query.light === 'true';

  const userSelect = light
    ? 'username full_name avatar'
    : 'username full_name phone clientData avatar';

  const [legacyAssignments, modernAssignments] = await Promise.all([
    CoachAssignment.find({ coach: coachId, status: 'active' })
      .populate('user', userSelect)
      .sort({ updatedAt: -1 })
      .lean(),
    CoachClientAssignment.find({ coach_id: coachId, status: 'active' })
      .populate('user_id', userSelect)
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  // Build a deduplicated map: client _id → normalised assignment object
  const seen = new Map();

  for (const a of legacyAssignments) {
    const u = a.user;
    if (!u?._id) continue;
    const key = String(u._id);
    if (!seen.has(key)) {
      seen.set(key, { ...a, user: u, _source: 'CoachAssignment' });
    }
  }

  const modernToSync = [];
  for (const a of modernAssignments) {
    const u = a.user_id;
    if (!u?._id) continue;
    const key = String(u._id);
    if (!seen.has(key)) {
      modernToSync.push({ key, user: u, assigned_at: a.assigned_at, modernId: a._id });
    }
  }

  if (modernToSync.length) {
    if (light) {
      // Skip legacy write-sync on light lists — pickers only need ids/names.
      modernToSync.forEach((row) => {
        seen.set(row.key, {
          _id: row.modernId,
          user: row.user,
          assigned_at: row.assigned_at,
          status: 'active',
          _source: 'CoachClientAssignment',
        });
      });
    } else {
      const legacyRows = await Promise.all(
        modernToSync.map((row) => ensureLegacyCoachAssignment(coachId, row.user._id)),
      );
      modernToSync.forEach((row, i) => {
        const legacy = legacyRows[i];
        seen.set(row.key, {
          _id: legacy._id,
          user: row.user,
          assigned_at: row.assigned_at,
          status: 'active',
          _source: 'CoachClientAssignment',
        });
      });
    }
  }

  const merged = [...seen.values()].map((assignment) => {
    const u = assignment.user;
    if (!u || typeof u !== 'object') return assignment;
    return {
      ...assignment,
      user: withDisplayName(u),
    };
  });

  if (light) {
    return res.json(merged.map((assignment) => {
      const userId = assignment.user?._id || assignment.user;
      return {
        _id: assignment._id,
        assignmentId: assignment._id,
        userId,
        user: assignment.user,
        assigned_at: assignment.assigned_at,
        status: assignment.status || 'active',
        groups: [],
      };
    }));
  }

  const withSnapshots = await Promise.all(
    merged.map(async (assignment) => ({
      ...assignment,
      snapshot: await buildClientSnapshot(assignment.user?._id),
      groups: await getClientGroups(coachId, assignment.user?._id),
    }))
  );

  return res.json(withSnapshots);
  } catch (error) {
    console.error('getClients:', error.message);
    return res.status(500).json({ message: 'Failed to load clients' });
  }
}

async function getClientDetail(req, res) {
  const coachId = req.user._id;
  const clientId = req.params.id;

  // Check both collections
  let userDoc = null;
  let assignmentBase = null;

  const legacyAssignment = await CoachAssignment.findOne({
    coach: coachId,
    user: clientId,
    status: 'active',
  }).populate('user', 'username full_name phone clientData avatar').lean();

  if (legacyAssignment) {
    userDoc = legacyAssignment.user;
    assignmentBase = legacyAssignment;
  } else {
    const modernAssignment = await CoachClientAssignment.findOne({
      coach_id: coachId,
      user_id: clientId,
      status: 'active',
    }).populate('user_id', 'username full_name phone clientData avatar').lean();

    if (modernAssignment) {
      const legacy = await ensureLegacyCoachAssignment(coachId, clientId);
      userDoc = modernAssignment.user_id;
      assignmentBase = {
        ...(await CoachAssignment.findById(legacy._id)
          .populate('user', 'username full_name phone clientData avatar')
          .lean()),
      };
    }
  }

  if (!assignmentBase || !userDoc) {
    return res.status(404).json({ message: 'Client assignment not found' });
  }

  const normalizedUser = withDisplayName(userDoc);

  const [snapshot, groups] = await Promise.all([
    buildClientSnapshot(userDoc._id),
    getClientGroups(coachId, userDoc._id),
  ]);
  return res.json({ ...assignmentBase, user: normalizedUser, snapshot, groups });
}


async function createFeedback(req, res) {
  const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
  if (!enforceCoachSpecialization(req, res, { resourceType: 'feedback' })) return;

  const assignment = await CoachAssignment.findOne({
    _id: req.body.assignmentId,
    coach: req.user._id,
    status: 'active',
  });

  if (!assignment) {
    return res.status(404).json({ message: 'Assignment not found' });
  }

  const feedback = coachingLiaisonAgent.formatDirectFeedback(req.body.note);
  assignment.feedback.push(feedback);
  await assignment.save();

  // Notify the client, not the coach who just wrote the feedback.
  await Notification.create({
    user: assignment.user,
    message: 'Your coach sent you new feedback.',
    type: 'update',
  });

  return res.status(201).json(assignment);
}

async function updateClientPlan(req, res) {
  const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
  const { assignmentId, customDietPlan, customWorkoutPlan } = req.body;

  if (customDietPlan) {
    if (!enforceCoachSpecialization(req, res, {
      resourceType: 'diet_plan',
      body: { goal: customDietPlan.goal || 'maintenance' },
    })) return;
  }
  if (customWorkoutPlan) {
    if (!enforceCoachSpecialization(req, res, { resourceType: 'exercise_plan' })) return;
  }
  if (!customDietPlan && !customWorkoutPlan) {
    if (!enforceCoachSpecialization(req, res, { resourceType: 'client_plan' })) return;
  }

  const assignment = await CoachAssignment.findOne({
    _id: assignmentId,
    coach: req.user._id,
    status: 'active',
  });

  if (!assignment) {
    return res.status(404).json({ message: 'Assignment not found' });
  }

  if (customDietPlan) assignment.customDietPlan = customDietPlan;
  if (customWorkoutPlan) assignment.customWorkoutPlan = customWorkoutPlan;

  await assignment.save();
  return res.json(assignment);
}

async function assignArticle(req, res) {
  const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
  if (!enforceCoachSpecialization(req, res, { resourceType: 'article' })) return;

  const { assignmentId, articleId } = req.body;
  const assignment = await CoachAssignment.findOne({
    _id: assignmentId,
    coach: req.user._id,
    status: 'active',
  });

  if (!assignment) {
    return res.status(404).json({ message: 'Assignment not found' });
  }

  if (!assignment.assignedArticles.includes(articleId)) {
    assignment.assignedArticles.push(articleId);
    await assignment.save();
  }

  return res.json(assignment);
}

async function removeArticle(req, res) {
  const { assignmentId, articleId } = req.body;
  const assignment = await CoachAssignment.findOne({
    _id: assignmentId,
    coach: req.user._id,
    status: 'active',
  });

  if (!assignment) {
    return res.status(404).json({ message: 'Assignment not found' });
  }

  assignment.assignedArticles = assignment.assignedArticles.filter(
    (id) => String(id) !== String(articleId)
  );
  await assignment.save();

  return res.json(assignment);
}

async function resolveCoachAssignment(coachId, id) {
  // Accept CoachAssignment id, CoachClientAssignment id, or client user id.
  let assignment = await CoachAssignment.findOne({ _id: id, coach: coachId });
  if (assignment) return assignment;

  assignment = await CoachAssignment.findOne({ user: id, coach: coachId });
  if (assignment) return assignment;

  const modern = await CoachClientAssignment.findOne({
    $or: [{ _id: id }, { user_id: id }],
    coach_id: coachId,
  });
  if (!modern?.user_id) return null;

  return ensureLegacyCoachAssignment(coachId, modern.user_id);
}

async function deleteAssignment(req, res) {
  try {
    const assignment = await resolveCoachAssignment(req.user._id, req.params.id);

    if (!assignment) {
      // End modern-only link even if legacy row is missing.
      const modern = await CoachClientAssignment.findOneAndUpdate(
        {
          coach_id: req.user._id,
          $or: [{ _id: req.params.id }, { user_id: req.params.id }],
          status: 'active',
        },
        { $set: { status: 'ended' } },
      );
      if (!modern) {
        return res.status(404).json({ message: 'Assignment not found' });
      }
      return res.json({ message: 'Client unlinked successfully', assignmentId: String(modern._id) });
    }

    await CoachAssignment.deleteOne({ _id: assignment._id, coach: req.user._id });
    await CoachClientAssignment.updateMany(
      { coach_id: req.user._id, user_id: assignment.user, status: 'active' },
      { $set: { status: 'ended' } },
    );

    return res.json({ message: 'Client unlinked successfully', assignmentId: String(assignment._id) });
  } catch (error) {
    console.error('deleteAssignment:', error.message);
    return res.status(500).json({ message: 'Failed to unlink client' });
  }
}

async function updateAssignment(req, res) {
  const { status } = req.body;
  const assignment = await resolveCoachAssignment(req.user._id, req.params.id);

  if (!assignment) {
    return res.status(404).json({ message: 'Assignment not found' });
  }

  // Coaches may end an active link; they cannot reactivate ended assignments.
  if (status !== undefined) {
    const next = String(status);
    if (next === 'active' && assignment.status !== 'active') {
      return res.status(400).json({
        message: 'Cannot reactivate an ended coaching assignment',
        code: 'ASSIGNMENT_REACTIVATE_FORBIDDEN',
      });
    }
    if (!['active', 'ended', 'pending'].includes(next)) {
      return res.status(400).json({ message: 'Invalid assignment status' });
    }
    assignment.status = next;
  }

  await assignment.save();

  // Keep modern CoachClientAssignment in sync when ending a link.
  if (assignment.status === 'ended') {
    await CoachClientAssignment.updateMany(
      { coach_id: req.user._id, user_id: assignment.user, status: 'active' },
      { $set: { status: 'ended' } },
    );
  }

  return res.json(assignment);
}

module.exports = { 
  getClients, 
  getClientDetail, 
  createFeedback, 
  updateClientPlan, 
  assignArticle, 
  removeArticle,
  deleteAssignment,
  updateAssignment
};

// --- New Features ---

async function createNotification(req, res) {
  const { clientId, message, type } = req.body;
  try {
    const allowed = await hasActiveAssignment(req.user._id, clientId);
    if (!allowed) {
      return res.status(403).json({ message: 'Client is not assigned to you' });
    }

    const notification = new Notification({
      user: clientId,
      message,
      type
    });
    await notification.save();
    return res.status(201).json(notification);
  } catch (error) {
    return res.status(500).json({ message: 'Error sending notification' });
  }
}

async function createSchedule(req, res) {
  const { clientId, weekStart, sessionIds } = req.body;
  try {
    const allowed = await hasActiveAssignment(req.user._id, clientId);
    if (!allowed) {
      return res.status(403).json({ message: 'Client is not assigned to you' });
    }

    const schedule = new Schedule({
      coach: req.user._id,
      client: clientId,
      weekStart,
      sessions: sessionIds || []
    });
    await schedule.save();
    return res.status(201).json(schedule);
  } catch (error) {
    return res.status(500).json({ message: 'Error creating schedule' });
  }
}

async function getSchedules(req, res) {
  try {
    const schedules = await Schedule.find({ coach: req.user._id })
      .populate('client', USER_DISPLAY_SELECT)
      .populate('sessions');
    return res.json(schedules);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching schedules' });
  }
}

async function getNotifications(req, res) {
  try {
    const stored = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const alerts = [];
    const assignments = await CoachAssignment.find({ coach: req.user._id, status: 'active' })
      .populate('user', USER_DISPLAY_SELECT)
      .sort({ updatedAt: -1 });

    for (const assignment of assignments) {
      const snapshot = await buildClientSnapshot(assignment.user?._id);
      if (snapshot.analysis?.isActionRequired) {
        alerts.push({
          _id: `alert-${assignment._id}`,
          message: `${assignment.user?.name || 'A client'} needs your review`,
          type: 'update',
          read: false,
          createdAt: assignment.updatedAt,
        });
      }
    }

    return res.json([...alerts, ...stored]);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching notifications' });
  }
}

const EXERCISE_LIBRARY = [
  // Yoga
  { name: 'Mountain Pose', category: 'Yoga', muscle: 'Full Body' },
  { name: "Child's Pose", category: 'Yoga', muscle: 'Back' },
  { name: 'Cat-Cow Stretch', category: 'Yoga', muscle: 'Spine' },
  { name: 'Downward Dog', category: 'Yoga', muscle: 'Full Body' },
  { name: 'Cobra Pose', category: 'Yoga', muscle: 'Back' },
  { name: 'Warrior I', category: 'Yoga', muscle: 'Legs' },
  { name: 'Warrior II', category: 'Yoga', muscle: 'Legs' },
  { name: 'Tree Pose', category: 'Yoga', muscle: 'Core' },
  { name: 'Triangle Pose', category: 'Yoga', muscle: 'Full Body' },
  { name: 'Seated Forward Bend', category: 'Yoga', muscle: 'Hamstrings' },
  // Cardio
  { name: 'Jumping Jacks', category: 'Cardio', muscle: 'Full Body' },
  { name: 'Burpees', category: 'Cardio', muscle: 'Full Body' },
  { name: 'Mountain Climbers', category: 'Cardio', muscle: 'Core' },
  { name: 'High Knees', category: 'Cardio', muscle: 'Legs' },
  { name: 'Running', category: 'Cardio', muscle: 'Legs' },
  { name: 'Cycling', category: 'Cardio', muscle: 'Legs' },
  // Strength Training
  { name: 'Pushups', category: 'Strength Training', muscle: 'Chest' },
  { name: 'Squats', category: 'Strength Training', muscle: 'Legs' },
  { name: 'Lunges', category: 'Strength Training', muscle: 'Legs' },
  { name: 'Deadlifts', category: 'Strength Training', muscle: 'Back' },
  { name: 'Bench Press', category: 'Strength Training', muscle: 'Chest' },
  { name: 'Pull-ups', category: 'Strength Training', muscle: 'Back' },
  { name: 'Bicep Curls', category: 'Strength Training', muscle: 'Arms' },
  { name: 'Tricep Dips', category: 'Strength Training', muscle: 'Arms' },
  { name: 'Shoulder Press', category: 'Strength Training', muscle: 'Shoulders' },
  { name: 'Leg Press', category: 'Strength Training', muscle: 'Legs' },
  // HIIT
  { name: 'Jump Squats', category: 'HIIT', muscle: 'Legs' },
  { name: 'Box Jumps', category: 'HIIT', muscle: 'Legs' },
  { name: 'Kettlebell Swings', category: 'HIIT', muscle: 'Full Body' },
  { name: 'Battle Ropes', category: 'HIIT', muscle: 'Arms' },
  // Core
  { name: 'Planks', category: 'Core', muscle: 'Abs' },
  { name: 'Russian Twists', category: 'Core', muscle: 'Abs' },
  { name: 'Sit-ups', category: 'Core', muscle: 'Abs' },
  // Flexibility
  { name: 'Stretching', category: 'Flexibility', muscle: 'Full Body' },
  { name: 'Yoga Flow', category: 'Flexibility', muscle: 'Full Body' },
  { name: 'Hamstring Stretch', category: 'Flexibility', muscle: 'Legs' },
];

async function getExerciseLibrary(req, res) {
  return res.json(EXERCISE_LIBRARY);
}

async function getCoachClientIds(coachId) {
  return getActiveClientIds(coachId);
}

async function getPendingActivities(req, res) {
  try {
    const clientIds = await getCoachClientIds(req.user._id);
    if (clientIds.length === 0) return res.json([]);

    const activities = await ActivityLog.find({
      user: { $in: clientIds },
      status: 'pending',
    })
      .populate('user', USER_DISPLAY_SELECT)
      .sort({ createdAt: -1 });

    return res.json(activities);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching pending activities' });
  }
}

async function updateActivityStatus(req, res) {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status must be approved or rejected' });
    }

    const activity = await ActivityLog.findById(req.params.id);
    if (!activity) return res.status(404).json({ message: 'Activity not found' });

    const allowed = await hasActiveAssignment(req.user._id, activity.user);
    if (!allowed) return res.status(403).json({ message: 'Not authorized for this client' });

    activity.status = status;
    await activity.save();

    const populated = await ActivityLog.findById(activity._id).populate('user', USER_DISPLAY_SELECT);
    return res.json(populated);
  } catch (error) {
    return res.status(500).json({ message: 'Error updating activity status' });
  }
}

async function getPendingWorkoutSubmissions(req, res) {
  try {
    const WorkoutCompletion = require('../models/WorkoutCompletion');
    const ScheduleCompletion = require('../models/ScheduleCompletion');

    const [exerciseSubs, scheduleSubs] = await Promise.all([
      WorkoutCompletion.find({ coach: req.user._id, status: 'pending_review' })
        .populate('user', USER_DISPLAY_SELECT)
        .populate('exercisePlan', 'title level exercises description instructions')
        .sort({ submittedAt: -1, createdAt: -1 })
        .lean(),
      ScheduleCompletion.find({ coach: req.user._id, status: 'pending_review' })
        .populate('user', USER_DISPLAY_SELECT)
        .populate({
          path: 'workoutSchedule',
          select: 'startDateTime endDateTime durationMinutes notes workoutTemplate',
          populate: { path: 'workoutTemplate', select: 'title level exercises' },
        })
        .sort({ submittedAt: -1, createdAt: -1 })
        .lean(),
    ]);

    const items = [
      ...exerciseSubs.map((c) => ({
        ...c,
        source: 'exercise_plan',
        title: c.exercisePlan?.title || 'Workout',
        workoutDetails: c.exercisePlan,
      })),
      ...scheduleSubs.map((c) => ({
        ...c,
        source: 'schedule',
        title: c.workoutSchedule?.workoutTemplate?.title || 'Scheduled Workout',
        workoutDetails: c.workoutSchedule,
      })),
    ].sort((a, b) => {
      const da = new Date(a.submittedAt || a.createdAt || 0).getTime();
      const db = new Date(b.submittedAt || b.createdAt || 0).getTime();
      return db - da;
    });

    return res.json(items);
  } catch (error) {
    console.error('getPendingWorkoutSubmissions:', error.message);
    return res.status(500).json({ message: 'Error fetching pending workout submissions' });
  }
}

async function reviewWorkoutSubmission(req, res) {
  try {
    const WorkoutCompletion = require('../models/WorkoutCompletion');
    const ScheduleCompletion = require('../models/ScheduleCompletion');
    const { source, status, feedback } = req.body || {};

    if (!['exercise_plan', 'schedule'].includes(source)) {
      return res.status(400).json({ message: 'source must be exercise_plan or schedule' });
    }
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status must be approved or rejected' });
    }

    const Model = source === 'schedule' ? ScheduleCompletion : WorkoutCompletion;
    const completion = await Model.findById(req.params.id);
    if (!completion) return res.status(404).json({ message: 'Submission not found' });
    if (String(completion.coach) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized for this submission' });
    }
    if (completion.status !== 'pending_review') {
      return res.status(400).json({ message: 'This workout is not pending review' });
    }

    if (status === 'approved') {
      const proofPhoto = String(completion.proofPhoto || '').trim();
      const notes = String(completion.notes || '').trim();
      const durationMinutes = Number(completion.durationMinutes);
      if (!proofPhoto || !notes || !Number.isFinite(durationMinutes) || durationMinutes < 1) {
        return res.status(400).json({
          message: 'Cannot approve a workout that is missing photo, notes, or duration',
          code: 'WORKOUT_PROOF_INCOMPLETE',
        });
      }
    }

    const note = String(feedback || '').trim();
    completion.coachFeedback = note;
    completion.reviewedAt = new Date();

    if (status === 'approved') {
      completion.status = 'completed';
      completion.completedAt = new Date();
    } else {
      completion.status = 'pending';
      // Keep proof so user can edit/resubmit, but allow resubmit from pending
    }

    await completion.save();

    let title = 'Workout';
    if (source === 'exercise_plan') {
      const populated = await WorkoutCompletion.findById(completion._id)
        .populate('exercisePlan', 'title')
        .lean();
      title = populated?.exercisePlan?.title || title;
    } else {
      const populated = await ScheduleCompletion.findById(completion._id)
        .populate({
          path: 'workoutSchedule',
          populate: { path: 'workoutTemplate', select: 'title' },
        })
        .lean();
      title = populated?.workoutSchedule?.workoutTemplate?.title || title;
    }

    await Notification.create({
      user: completion.user,
      message: status === 'approved'
        ? `Your coach approved "${title}"${note ? `: ${note}` : ''}`
        : `Your coach requested changes on "${title}"${note ? `: ${note}` : ''}. Please resubmit.`,
      type: 'workout',
    });

    const result = await Model.findById(completion._id)
      .populate('user', USER_DISPLAY_SELECT)
      .lean();
    return res.json({ ...result, source });
  } catch (error) {
    console.error('reviewWorkoutSubmission:', error.message);
    return res.status(500).json({ message: 'Error reviewing workout submission' });
  }
}

async function getCoachReports(req, res) {
  try {
    const clientIds = await getCoachClientIds(req.user._id);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalClients,
      totalSessions,
      completedSessions,
      pendingWorkouts,
      approvedWorkouts,
      rejectedWorkouts,
      activitiesByType,
      monthlySessions,
    ] = await Promise.all([
      CoachAssignment.countDocuments({ coach: req.user._id }),
      Session.countDocuments({ coach: req.user._id }),
      Session.countDocuments({ coach: req.user._id, status: 'completed' }),
      ActivityLog.countDocuments({ user: { $in: clientIds }, status: 'pending' }),
      ActivityLog.countDocuments({ user: { $in: clientIds }, status: 'approved' }),
      ActivityLog.countDocuments({ user: { $in: clientIds }, status: 'rejected' }),
      ActivityLog.aggregate([
        { $match: { user: { $in: clientIds } } },
        { $group: { _id: '$activityType', count: { $sum: 1 }, calories: { $sum: '$caloriesBurned' } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      Session.aggregate([
        { $match: { coach: req.user._id, date: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const totalWorkouts = pendingWorkouts + approvedWorkouts + rejectedWorkouts;
    const attendanceRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;
    const workoutCompletionRate = totalWorkouts > 0
      ? Math.round((approvedWorkouts / totalWorkouts) * 100)
      : 0;

    return res.json({
      totalClients,
      totalSessions,
      completedSessions,
      attendanceRate,
      pendingWorkouts,
      approvedWorkouts,
      rejectedWorkouts,
      workoutCompletionRate,
      activitiesByType,
      monthlySessions,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching coach reports' });
  }
}

async function assertCoachOwnsClient(coachId, clientId) {
  const ok = await hasActiveAssignment(coachId, clientId);
  return ok ? { coach: coachId, user: clientId } : null;
}

function formatFitnessClass(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  const enrolled = normalizeEnrolledStudents(obj.enrolledStudents || []);
  return {
    ...obj,
    enrolledStudents: enrolled,
    enrolledCount: enrolled.length,
  };
}

async function getClasses(req, res) {
  try {
    const light = req.query.light === '1' || req.query.light === 'true';
    let query = FitnessClass.find({ coach: req.user._id }).sort({ date: 1 });
    if (light) {
      // Picker lists need titles + live member counts (from enrolledStudents in DB).
      // Skip populating student documents to keep the payload small.
      query = query
        .select('title category date durationMinutes capacity status enrolledStudents')
        .lean();
      const classes = await query;
      return res.json(
        classes.map((cls) => ({
          _id: cls._id,
          title: cls.title,
          category: cls.category,
          date: cls.date,
          durationMinutes: cls.durationMinutes,
          capacity: cls.capacity,
          status: cls.status,
          enrolledCount: Array.isArray(cls.enrolledStudents) ? cls.enrolledStudents.length : 0,
        })),
      );
    }
    const classes = await query.populate('enrolledStudents', USER_DISPLAY_SELECT);
    return res.json(classes.map(formatFitnessClass));
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching classes' });
  }
}

async function getClassDetail(req, res) {
  try {
    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.id,
      coach: req.user._id,
    }).populate('enrolledStudents', USER_DISPLAY_SELECT);

    if (!fitnessClass) return res.status(404).json({ message: 'Class not found' });

    return res.json(formatFitnessClass(fitnessClass));
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching class' });
  }
}

async function createClass(req, res) {
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'class' })) return;

    const { title, description, category, date, durationMinutes, capacity } = req.body;
    if (!title || !date) {
      return res.status(400).json({ message: 'Title and date are required' });
    }

    const fitnessClass = await FitnessClass.create({
      coach: req.user._id,
      title,
      description: description || '',
      category: category || 'General',
      date,
      durationMinutes: durationMinutes || 60,
      capacity: capacity || 20,
    });

    const populated = await FitnessClass.findById(fitnessClass._id)
      .populate('enrolledStudents', USER_DISPLAY_SELECT);

    await Notification.create({
      user: req.user._id,
      message: `Class "${title}" created`,
      type: 'update',
    });

    return res.status(201).json(formatFitnessClass(populated));
  } catch (error) {
    console.error('createClass:', error.message);
    return res.status(500).json({ message: 'Error creating class' });
  }
}

async function updateClass(req, res) {
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'class' })) return;

    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.id,
      coach: req.user._id,
    });

    if (!fitnessClass) return res.status(404).json({ message: 'Class not found' });

    const { title, description, category, date, durationMinutes, capacity, status } = req.body;
    if (title) fitnessClass.title = title;
    if (description !== undefined) fitnessClass.description = description;
    if (category) fitnessClass.category = category;
    if (date) fitnessClass.date = date;
    if (durationMinutes) fitnessClass.durationMinutes = durationMinutes;
    if (capacity) fitnessClass.capacity = capacity;
    if (status) fitnessClass.status = status;

    await fitnessClass.save();
    const populated = await FitnessClass.findById(fitnessClass._id)
      .populate('enrolledStudents', USER_DISPLAY_SELECT);
    return res.json(formatFitnessClass(populated));
  } catch (error) {
    return res.status(500).json({ message: 'Error updating class' });
  }
}

async function deleteClass(req, res) {
  try {
    const deleted = await FitnessClass.findOneAndDelete({
      _id: req.params.id,
      coach: req.user._id,
    });
    if (!deleted) return res.status(404).json({ message: 'Class not found' });
    return res.json({ message: 'Class deleted' });
  } catch (error) {
    return res.status(500).json({ message: 'Error deleting class' });
  }
}

async function enrollStudent(req, res) {
  try {
    const { studentId } = req.body;
    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.id,
      coach: req.user._id,
    });

    if (!fitnessClass) return res.status(404).json({ message: 'Class not found' });
    if (!studentId) return res.status(400).json({ message: 'Student ID is required' });

    const assignment = await assertCoachOwnsClient(req.user._id, studentId);
    if (!assignment) {
      return res.status(403).json({
        message: 'Only approved clients can be added to a class. Approve this user first.',
      });
    }

    if (fitnessClass.enrolledStudents.length >= fitnessClass.capacity) {
      return res.status(400).json({ message: 'Class is at full capacity' });
    }

    const alreadyEnrolled = fitnessClass.enrolledStudents.some(
      (id) => String(id) === String(studentId)
    );
    if (alreadyEnrolled) {
      return res.status(400).json({ message: 'Client is already enrolled' });
    }

    fitnessClass.enrolledStudents.push(studentId);
    await fitnessClass.save();

    try {
      const { ensureGroupAttendance } = require('../utils/attendanceService');
      await ensureGroupAttendance({
        coachId: req.user._id,
        userId: studentId,
        fitnessClassId: fitnessClass._id,
        scheduledStart: fitnessClass.date,
        durationMinutes: fitnessClass.durationMinutes,
      });
    } catch (attErr) {
      console.warn('enroll attendance:', attErr.message);
    }

    await backfillGroupPlanAccess(studentId, fitnessClass._id).catch((err) => {
      console.error('backfillGroupPlanAccess enrollStudent:', err.message);
    });

    const populated = await FitnessClass.findById(fitnessClass._id)
      .populate('enrolledStudents', USER_DISPLAY_SELECT);
    return res.json(formatFitnessClass(populated));
  } catch (error) {
    return res.status(500).json({ message: 'Error enrolling student' });
  }
}

async function unenrollStudent(req, res) {
  try {
    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.id,
      coach: req.user._id,
    });

    if (!fitnessClass) return res.status(404).json({ message: 'Class not found' });

    fitnessClass.enrolledStudents = fitnessClass.enrolledStudents.filter(
      (id) => String(id) !== String(req.params.userId)
    );
    fitnessClass.attendance = fitnessClass.attendance.filter(
      (entry) => String(entry.student) !== String(req.params.userId)
    );
    await fitnessClass.save();

    await clearPendingGroupPlanAccess(req.params.userId, fitnessClass._id).catch((err) => {
      console.error('clearPendingGroupPlanAccess unenrollStudent:', err.message);
    });

    const populated = await FitnessClass.findById(fitnessClass._id)
      .populate('enrolledStudents', USER_DISPLAY_SELECT);
    return res.json(formatFitnessClass(populated));
  } catch (error) {
    return res.status(500).json({ message: 'Error removing enrollment' });
  }
}

/**
 * Move a client between groups (classes).
 * Body: { classId: string | null, fromClassId?: string }
 * - classId set: remove from current group(s) and enroll in classId
 * - classId null: remove from fromClassId (or all coach groups)
 */
async function changeClientGroup(req, res) {
  try {
    const clientId = req.params.id;
    const { classId = null, fromClassId = null } = req.body || {};

    const assignment = await assertCoachOwnsClient(req.user._id, clientId);
    if (!assignment) {
      return res.status(403).json({ message: 'Client is not assigned to you' });
    }

    let targetClass = null;
    if (classId) {
      targetClass = await FitnessClass.findOne({
        _id: classId,
        coach: req.user._id,
      });
      if (!targetClass) {
        return res.status(404).json({ message: 'Target group not found' });
      }
      if (['completed', 'cancelled'].includes(targetClass.status)) {
        return res.status(400).json({ message: 'Cannot assign to a completed or cancelled group' });
      }
    }

    const enrollmentFilter = {
      coach: req.user._id,
      enrolledStudents: clientId,
    };
    if (fromClassId) {
      enrollmentFilter._id = fromClassId;
    } else if (classId) {
      // When switching groups, leave every current group owned by this coach
      enrollmentFilter._id = { $ne: classId };
    }

    const currentGroups = await FitnessClass.find(enrollmentFilter);
    for (const group of currentGroups) {
      group.enrolledStudents = group.enrolledStudents.filter(
        (id) => String(id) !== String(clientId)
      );
      group.attendance = (group.attendance || []).filter(
        (entry) => String(entry.student) !== String(clientId)
      );
      await group.save();
      await clearPendingGroupPlanAccess(clientId, group._id).catch((err) => {
        console.error('clearPendingGroupPlanAccess changeClientGroup:', err.message);
      });
    }

    if (targetClass) {
      const alreadyEnrolled = targetClass.enrolledStudents.some(
        (id) => String(id) === String(clientId)
      );
      if (!alreadyEnrolled) {
        if (targetClass.enrolledStudents.length >= targetClass.capacity) {
          return res.status(400).json({ message: 'Target group is at full capacity' });
        }
        targetClass.enrolledStudents.push(clientId);
        await targetClass.save();
      }

      await backfillGroupPlanAccess(clientId, targetClass._id).catch((err) => {
        console.error('backfillGroupPlanAccess changeClientGroup:', err.message);
      });

      await Notification.create({
        user: clientId,
        message: `Your coach moved you to the group "${targetClass.title}".`,
        type: 'update',
      }).catch(() => {});
    } else if (currentGroups.length > 0) {
      await Notification.create({
        user: clientId,
        message: 'Your coach removed you from your group class.',
        type: 'update',
      }).catch(() => {});
    }

    const groups = await getClientGroups(req.user._id, clientId);
    return res.json({
      message: classId ? 'Client group updated' : 'Client removed from group',
      groups,
      targetClass: targetClass ? formatFitnessClass(targetClass) : null,
    });
  } catch (error) {
    console.error('changeClientGroup:', error.message);
    return res.status(500).json({ message: 'Error changing client group' });
  }
}

async function markAttendance(req, res) {
  try {
    const { studentId, present } = req.body;
    const { validateObjectId } = require('../utils/fieldValidation');
    const studentError = validateObjectId(studentId, 'User');
    if (studentError) return res.status(400).json({ message: studentError });
    if (present !== undefined && typeof present !== 'boolean') {
      return res.status(400).json({ message: 'Attendance status must be true or false' });
    }

    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.id,
      coach: req.user._id,
    });

    if (!fitnessClass) return res.status(404).json({ message: 'Class not found' });

    const isEnrolled = fitnessClass.enrolledStudents.some(
      (id) => String(id) === String(studentId)
    );
    if (!isEnrolled) {
      return res.status(400).json({ message: 'Student is not enrolled in this class' });
    }

    const existing = fitnessClass.attendance.find(
      (entry) => String(entry.student) === String(studentId)
    );
    if (existing) {
      existing.present = present !== false;
      existing.markedAt = new Date();
    } else {
      fitnessClass.attendance.push({
        student: studentId,
        present: present !== false,
        markedAt: new Date(),
      });
    }

    await fitnessClass.save();

    try {
      const {
        ensureGroupAttendance,
        markAttendanceRecord,
      } = require('../utils/attendanceService');
      const record = await ensureGroupAttendance({
        coachId: req.user._id,
        userId: studentId,
        fitnessClassId: fitnessClass._id,
        scheduledStart: fitnessClass.date,
        durationMinutes: fitnessClass.durationMinutes,
      });
      if (record) {
        await markAttendanceRecord(record, {
          status: present === false ? 'absent' : 'present',
          markedBy: req.user._id,
        });
      }
    } catch (syncError) {
      console.warn('markAttendance sync:', syncError.message);
    }

    const populated = await FitnessClass.findById(fitnessClass._id)
      .populate('enrolledStudents', USER_DISPLAY_SELECT);
    return res.json(formatFitnessClass(populated));
  } catch (error) {
    if (error?.name === 'ValidationError') {
      const first = Object.values(error.errors || {})[0];
      return res.status(400).json({ message: first?.message || 'Invalid attendance data' });
    }
    return res.status(500).json({ message: 'Error marking attendance' });
  }
}

module.exports = {
  getClients,
  getClientDetail,
  createFeedback,
  updateClientPlan,
  assignArticle,
  removeArticle,
  deleteAssignment,
  updateAssignment,
  createNotification,
  getNotifications,
  createSchedule,
  getSchedules,
  getExerciseLibrary,
  getPendingActivities,
  updateActivityStatus,
  getPendingWorkoutSubmissions,
  reviewWorkoutSubmission,
  getCoachReports,
  getClasses,
  getClassDetail,
  createClass,
  updateClass,
  deleteClass,
  enrollStudent,
  unenrollStudent,
  changeClientGroup,
  markAttendance,
};
