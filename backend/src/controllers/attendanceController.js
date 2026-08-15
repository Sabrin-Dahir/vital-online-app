const Attendance = require('../models/Attendance');
const FitnessClass = require('../models/FitnessClass');
const ExercisePlan = require('../models/ExercisePlan');
const WorkoutSchedule = require('../models/WorkoutSchedule');
const Session = require('../models/Session');
const Appointment = require('../models/Appointment');
const { hasActiveAssignment, getActiveClientIds } = require('../utils/coachVisibility');
const User = require('../models/User');
const {
  startOfDay,
  endOfDay,
  allowedStatusesFor,
  validateStatusForType,
  computeStats,
  ensureWorkoutAttendance,
  ensureSessionAttendance,
  ensureGroupAttendance,
  ensureDailyAttendance,
  ensureCoachAttendance,
  markAttendanceRecord,
  serializeAttendance,
} = require('../utils/attendanceService');

const USER_SELECT = 'username full_name phone avatar';

function parseRange(query = {}) {
  const now = new Date();
  const range = String(query.range || '').toLowerCase();
  let from = query.from ? new Date(query.from) : null;
  let to = query.to ? new Date(query.to) : null;

  if (range === 'today') {
    from = startOfDay(now);
    to = endOfDay(now);
  } else if (range === 'week') {
    const day = now.getUTCDay();
    const diff = (day + 6) % 7; // Monday start
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
    from = monday;
    to = endOfDay(new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000));
  } else if (range === 'month') {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    to = endOfDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
  }

  if (from && Number.isNaN(from.getTime())) from = null;
  if (to && Number.isNaN(to.getTime())) to = null;
  return { from, to };
}

function buildFilter({ coachId, userId, query }) {
  const filter = {};
  if (coachId) filter.coach = coachId;
  if (userId) filter.user = userId;
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  if (query.clientId) filter.user = query.clientId;
  if (query.workoutId) {
    filter.$or = [
      { exercisePlan: query.workoutId },
      { workoutSchedule: query.workoutId },
    ];
  }
  if (query.sessionId) filter.session = query.sessionId;
  if (query.appointmentId) filter.appointment = query.appointmentId;
  if (query.groupId || query.fitnessClassId) {
    filter.fitnessClass = query.groupId || query.fitnessClassId;
  }
  const { from, to } = parseRange(query);
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = from;
    if (to) filter.date.$lte = to;
  }
  return filter;
}

function populateAttendance(query) {
  return query
    .populate('user', USER_SELECT)
    .populate('coach', USER_SELECT)
    .populate('exercisePlan', 'title dueDate status')
    .populate('workoutSchedule', 'title startDateTime endDateTime status')
    .populate('session', 'date durationMinutes status')
    .populate('appointment', 'dateTime durationMinutes status')
    .populate('fitnessClass', 'title date durationMinutes status enrolledStudents');
}

async function getCoachAttendance(req, res) {
  try {
    const filter = buildFilter({ coachId: req.user._id, query: req.query });
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      populateAttendance(
        Attendance.find(filter).sort({ date: -1, updatedAt: -1 }).skip(skip).limit(limit),
      ).lean(),
      Attendance.countDocuments(filter),
    ]);

    const allForStats = await Attendance.find(filter).select('status type user').lean();
    const stats = computeStats(allForStats);
    const uniqueClients = new Set(
      allForStats.filter((r) => r.user).map((r) => String(r.user)),
    );

    return res.json({
      items: items.map(serializeAttendance),
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      stats: {
        ...stats,
        totalClients: uniqueClients.size,
      },
      statusesByType: {
        workout: Attendance.WORKOUT_STATUSES,
        session: Attendance.SESSION_STATUSES,
        group: Attendance.GROUP_STATUSES,
        daily: Attendance.DAILY_STATUSES,
        coach: Attendance.COACH_STATUSES,
      },
    });
  } catch (error) {
    console.error('getCoachAttendance:', error.message);
    return res.status(500).json({ message: 'Failed to load attendance' });
  }
}

async function getCoachAttendanceSummary(req, res) {
  try {
    const coachId = req.user._id;
    const ranges = ['today', 'week', 'month'];
    const summary = {};
    for (const range of ranges) {
      const filter = buildFilter({ coachId, query: { range } });
      const rows = await Attendance.find(filter).select('status user type').lean();
      summary[range] = {
        ...computeStats(rows),
        totalClients: new Set(rows.filter((r) => r.user).map((r) => String(r.user))).size,
      };
    }
    return res.json({ summary });
  } catch (error) {
    console.error('getCoachAttendanceSummary:', error.message);
    return res.status(500).json({ message: 'Failed to load attendance summary' });
  }
}

/** List assigned clients with per-client attendance stats (never mixes clients). */
async function getAttendanceByClients(req, res) {
  try {
    const coachId = req.user._id;
    const clientIds = await getActiveClientIds(coachId);
    const users = await User.find({ _id: { $in: clientIds } })
      .select(USER_SELECT)
      .lean();

    const filter = buildFilter({ coachId, query: req.query });
    filter.user = { $in: clientIds };
    if (!req.query.type) {
      filter.type = { $ne: 'coach' };
    }

    const rows = clientIds.length
      ? await Attendance.find(filter).select('status user type').lean()
      : [];

    const byUser = new Map();
    for (const id of clientIds) byUser.set(String(id), []);
    for (const row of rows) {
      if (!row.user) continue;
      const key = String(row.user);
      if (!byUser.has(key)) continue;
      byUser.get(key).push(row);
    }

    const items = users
      .map((user) => {
        const records = byUser.get(String(user._id)) || [];
        const stats = computeStats(records);
        return {
          clientId: user._id,
          client: user,
          stats: {
            total: stats.total,
            present: stats.present,
            absent: stats.absent,
            missed: stats.missed,
            no_show: stats.no_show,
            cancelled: stats.cancelled,
            completed: stats.completed,
            attendancePercentage: stats.attendancePercentage,
          },
        };
      })
      .sort((a, b) =>
        String(a.client?.full_name || a.client?.username || '').localeCompare(
          String(b.client?.full_name || b.client?.username || ''),
        ),
      );

    return res.json({ items, total: items.length });
  } catch (error) {
    console.error('getAttendanceByClients:', error.message);
    return res.status(500).json({ message: 'Failed to load client attendance overview' });
  }
}

/** List coach groups with member attendance stats (members only). */
async function getAttendanceByGroups(req, res) {
  try {
    const coachId = req.user._id;
    const classes = await FitnessClass.find({ coach: coachId })
      .select('title category date durationMinutes status enrolledStudents')
      .sort({ date: -1 })
      .lean();

    const classIds = classes.map((c) => c._id);
    const filter = buildFilter({ coachId, query: { ...req.query, type: 'group' } });
    filter.fitnessClass = { $in: classIds };

    const rows = classIds.length
      ? await Attendance.find(filter).select('status user fitnessClass').lean()
      : [];

    const byClass = new Map();
    for (const id of classIds) byClass.set(String(id), []);
    for (const row of rows) {
      if (!row.fitnessClass) continue;
      const key = String(row.fitnessClass);
      if (!byClass.has(key)) continue;
      byClass.get(key).push(row);
    }

    const items = classes.map((cls) => {
      const enrolledIds = (cls.enrolledStudents || []).map((id) => String(id));
      const enrolledSet = new Set(enrolledIds);
      const records = (byClass.get(String(cls._id)) || []).filter((row) =>
        enrolledSet.has(String(row.user)),
      );
      const present = records.filter((r) => r.status === 'present').length;
      const absent = records.filter((r) => r.status === 'absent').length;
      const noShow = records.filter((r) => r.status === 'no_show').length;
      const stats = computeStats(records);
      return {
        groupId: cls._id,
        group: {
          _id: cls._id,
          title: cls.title,
          category: cls.category,
          date: cls.date,
          durationMinutes: cls.durationMinutes,
          status: cls.status,
          totalMembers: enrolledIds.length,
        },
        stats: {
          totalMembers: enrolledIds.length,
          present,
          absent,
          no_show: noShow,
          attendancePercentage: stats.attendancePercentage,
        },
      };
    });

    return res.json({ items, total: items.length });
  } catch (error) {
    console.error('getAttendanceByGroups:', error.message);
    return res.status(500).json({ message: 'Failed to load group attendance overview' });
  }
}

async function getGroupAttendance(req, res) {
  try {
    const fitnessClass = await FitnessClass.findOne({
      _id: req.params.classId,
      coach: req.user._id,
    }).populate('enrolledStudents', USER_SELECT);
    if (!fitnessClass) return res.status(404).json({ message: 'Group not found' });

    // Ensure records exist for enrolled members
    for (const student of fitnessClass.enrolledStudents || []) {
      const studentId = student._id || student;
      try {
        await ensureGroupAttendance({
          coachId: req.user._id,
          userId: studentId,
          fitnessClassId: fitnessClass._id,
          scheduledStart: fitnessClass.date,
          durationMinutes: fitnessClass.durationMinutes,
        });
      } catch (ensureErr) {
        console.warn('ensureGroupAttendance:', ensureErr.message);
      }
    }

    const records = await populateAttendance(
      Attendance.find({ type: 'group', fitnessClass: fitnessClass._id, coach: req.user._id }),
    ).lean();

    const stats = computeStats(records);
    return res.json({
      group: {
        _id: fitnessClass._id,
        title: fitnessClass.title,
        date: fitnessClass.date,
        durationMinutes: fitnessClass.durationMinutes,
        status: fitnessClass.status,
        totalMembers: (fitnessClass.enrolledStudents || []).length,
      },
      members: fitnessClass.enrolledStudents || [],
      items: records.map(serializeAttendance),
      stats: {
        totalMembers: (fitnessClass.enrolledStudents || []).length,
        present: records.filter((r) => r.status === 'present').length,
        absent: records.filter((r) => r.status === 'absent').length,
        no_show: records.filter((r) => r.status === 'no_show').length,
        attendancePercentage: stats.attendancePercentage,
      },
    });
  } catch (error) {
    console.error('getGroupAttendance:', error.message);
    return res.status(500).json({ message: 'Failed to load group attendance' });
  }
}

async function getClientAttendance(req, res) {
  try {
    const clientId = req.params.clientId;
    const owns = await hasActiveAssignment(req.user._id, clientId);
    if (!owns) return res.status(403).json({ message: 'Client is not assigned to you' });

    const filter = buildFilter({
      coachId: req.user._id,
      userId: clientId,
      query: req.query,
    });
    const items = await populateAttendance(
      Attendance.find(filter).sort({ date: -1 }).limit(200),
    ).lean();
    return res.json({
      items: items.map(serializeAttendance),
      stats: computeStats(items),
    });
  } catch (error) {
    console.error('getClientAttendance:', error.message);
    return res.status(500).json({ message: 'Failed to load client attendance' });
  }
}

async function updateAttendance(req, res) {
  try {
    const record = await Attendance.findOne({ _id: req.params.id, coach: req.user._id });
    if (!record) return res.status(404).json({ message: 'Attendance record not found' });

    const { status, notes } = req.body;
    if (!status) return res.status(400).json({ message: 'Attendance status is required' });

    // Ownership: for client records, coach must still own the client (or class)
    if (record.user && record.type !== 'group') {
      const owns = await hasActiveAssignment(req.user._id, record.user);
      if (!owns && record.type !== 'coach') {
        // Allow historical records for ended assignments still owned by coach id
        // Coach id match already enforced above.
      }
    }

    if (record.type === 'group' && record.fitnessClass) {
      const fitnessClass = await FitnessClass.findOne({
        _id: record.fitnessClass,
        coach: req.user._id,
      });
      if (!fitnessClass) return res.status(404).json({ message: 'Group not found' });
      const enrolled = (fitnessClass.enrolledStudents || []).some(
        (id) => String(id) === String(record.user),
      );
      if (!enrolled) {
        return res.status(403).json({ message: 'User is not a member of this group' });
      }
    }

    const result = await markAttendanceRecord(record, {
      status,
      notes,
      markedBy: req.user._id,
    });
    if (result.error) {
      return res.status(result.status || 400).json({
        message: result.error,
        code: result.code,
      });
    }

    // Keep legacy FitnessClass.attendance in sync for group records
    if (record.type === 'group' && record.fitnessClass && record.user) {
      const fitnessClass = await FitnessClass.findById(record.fitnessClass);
      if (fitnessClass) {
        const existing = (fitnessClass.attendance || []).find(
          (row) => String(row.student) === String(record.user),
        );
        const present = status === 'present';
        if (existing) {
          existing.present = present;
          existing.markedAt = new Date();
        } else {
          fitnessClass.attendance.push({
            student: record.user,
            present,
            markedAt: new Date(),
          });
        }
        await fitnessClass.save();
      }
    }

    const populated = await populateAttendance(Attendance.findById(record._id));
    return res.json(serializeAttendance(populated));
  } catch (error) {
    console.error('updateAttendance:', error.message);
    return res.status(500).json({ message: 'Failed to update attendance' });
  }
}

async function createOrMarkAttendance(req, res) {
  try {
    const {
      type,
      status,
      clientId,
      userId,
      exercisePlanId,
      workoutScheduleId,
      sessionId,
      appointmentId,
      fitnessClassId,
      groupId,
      date,
      notes,
    } = req.body;

    const targetUserId = clientId || userId;
    if (!type) return res.status(400).json({ message: 'Attendance type is required' });
    if (!status) return res.status(400).json({ message: 'Attendance status is required' });
    const statusError = validateStatusForType(type, status);
    if (statusError) return res.status(400).json({ message: statusError });

    if (type !== 'coach' && !targetUserId) {
      return res.status(400).json({ message: 'Client is required' });
    }

    if (type !== 'coach') {
      if (type === 'group') {
        const classId = fitnessClassId || groupId;
        const fitnessClass = await FitnessClass.findOne({
          _id: classId,
          coach: req.user._id,
        });
        if (!fitnessClass) return res.status(404).json({ message: 'Group not found' });
        const enrolled = (fitnessClass.enrolledStudents || []).some(
          (id) => String(id) === String(targetUserId),
        );
        if (!enrolled) {
          return res.status(403).json({ message: 'User is not a member of this group' });
        }
        let record = await ensureGroupAttendance({
          coachId: req.user._id,
          userId: targetUserId,
          fitnessClassId: fitnessClass._id,
          scheduledStart: fitnessClass.date,
          durationMinutes: fitnessClass.durationMinutes,
        });
        const result = await markAttendanceRecord(record, {
          status,
          notes,
          markedBy: req.user._id,
        });
        if (result.error) return res.status(result.status || 400).json({ message: result.error });
        return res.status(201).json(serializeAttendance(result.record));
      }

      const owns = await hasActiveAssignment(req.user._id, targetUserId);
      if (!owns) return res.status(403).json({ message: 'Client is not assigned to you' });
    }

    let record = null;
    if (type === 'workout') {
      if (exercisePlanId) {
        const plan = await ExercisePlan.findOne({ _id: exercisePlanId, coach: req.user._id });
        if (!plan) return res.status(404).json({ message: 'Workout plan not found' });
        if (plan.client && String(plan.client) !== String(targetUserId)) {
          return res.status(403).json({ message: 'User is not assigned to this workout' });
        }
        record = await ensureWorkoutAttendance({
          coachId: req.user._id,
          userId: targetUserId,
          exercisePlanId: plan._id,
          date: plan.dueDate || date,
          scheduledStart: plan.dueDate || date,
        });
      } else if (workoutScheduleId) {
        const schedule = await WorkoutSchedule.findOne({
          _id: workoutScheduleId,
          coach: req.user._id,
        });
        if (!schedule) return res.status(404).json({ message: 'Workout schedule not found' });
        if (schedule.client && String(schedule.client) !== String(targetUserId)) {
          return res.status(403).json({ message: 'User is not assigned to this workout' });
        }
        record = await ensureWorkoutAttendance({
          coachId: req.user._id,
          userId: targetUserId,
          workoutScheduleId: schedule._id,
          date: schedule.startDateTime || date,
          scheduledStart: schedule.startDateTime,
          scheduledEnd: schedule.endDateTime,
        });
      } else {
        return res.status(400).json({ message: 'Workout reference is required' });
      }
    } else if (type === 'session') {
      if (sessionId) {
        const session = await Session.findOne({ _id: sessionId, coach: req.user._id });
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (String(session.client) !== String(targetUserId)) {
          return res.status(403).json({ message: 'User is not assigned to this session' });
        }
        record = await ensureSessionAttendance({
          coachId: req.user._id,
          userId: targetUserId,
          sessionId: session._id,
          scheduledStart: session.date,
          durationMinutes: session.durationMinutes,
        });
      } else if (appointmentId) {
        const appointment = await Appointment.findOne({
          _id: appointmentId,
          coach: req.user._id,
        });
        if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
        const apptClient = appointment.client || appointment.user_id;
        if (String(apptClient) !== String(targetUserId)) {
          return res.status(403).json({ message: 'User is not assigned to this appointment' });
        }
        record = await ensureSessionAttendance({
          coachId: req.user._id,
          userId: targetUserId,
          appointmentId: appointment._id,
          scheduledStart: appointment.dateTime || appointment.datetime,
          durationMinutes: appointment.durationMinutes,
        });
      } else {
        return res.status(400).json({ message: 'Session or appointment reference is required' });
      }
    } else if (type === 'daily') {
      record = await ensureDailyAttendance({
        coachId: req.user._id,
        userId: targetUserId,
        date,
      });
    } else if (type === 'coach') {
      record = await ensureCoachAttendance({ coachId: req.user._id, date });
    } else {
      return res.status(400).json({ message: 'Unsupported attendance type' });
    }

    const result = await markAttendanceRecord(record, {
      status,
      notes,
      markedBy: req.user._id,
    });
    if (result.error) return res.status(result.status || 400).json({ message: result.error });
    return res.status(201).json(serializeAttendance(result.record));
  } catch (error) {
    console.error('createOrMarkAttendance:', error.message);
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Duplicate attendance record' });
    }
    return res.status(500).json({ message: 'Failed to save attendance' });
  }
}

async function getMyAttendance(req, res) {
  try {
    const filter = buildFilter({ userId: req.user._id, query: req.query });
    // Members never see coach-only attendance
    filter.type = filter.type || { $ne: 'coach' };
    if (req.query.type) filter.type = req.query.type;

    const items = await populateAttendance(
      Attendance.find(filter).sort({ date: -1 }).limit(200),
    ).lean();
    return res.json({
      items: items.map(serializeAttendance),
      stats: computeStats(items),
    });
  } catch (error) {
    console.error('getMyAttendance:', error.message);
    return res.status(500).json({ message: 'Failed to load attendance' });
  }
}

async function getMyAttendanceSummary(req, res) {
  try {
    const userId = req.user._id;
    const ranges = ['today', 'week', 'month'];
    const summary = {};
    for (const range of ranges) {
      const filter = buildFilter({ userId, query: { range } });
      filter.type = { $ne: 'coach' };
      const rows = await Attendance.find(filter).select('status type').lean();
      summary[range] = computeStats(rows);
    }
    const all = await Attendance.find({ user: userId, type: { $ne: 'coach' } })
      .select('status')
      .lean();
    summary.all = computeStats(all);
    return res.json({ summary });
  } catch (error) {
    console.error('getMyAttendanceSummary:', error.message);
    return res.status(500).json({ message: 'Failed to load attendance summary' });
  }
}

module.exports = {
  getCoachAttendance,
  getCoachAttendanceSummary,
  getAttendanceByClients,
  getAttendanceByGroups,
  getGroupAttendance,
  getClientAttendance,
  updateAttendance,
  createOrMarkAttendance,
  getMyAttendance,
  getMyAttendanceSummary,
  allowedStatusesFor,
};
