const Attendance = require('../models/Attendance');
const {
  STATUSES_BY_TYPE,
  WORKOUT_STATUSES,
  SESSION_STATUSES,
  GROUP_STATUSES,
} = Attendance;

function startOfDay(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfDay(dateInput) {
  const start = startOfDay(dateInput);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function addDuration(start, durationMinutes = 60) {
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return null;
  return new Date(s.getTime() + (Number(durationMinutes) || 60) * 60 * 1000);
}

function allowedStatusesFor(type) {
  return STATUSES_BY_TYPE[type] || [];
}

function validateStatusForType(type, status) {
  const allowed = allowedStatusesFor(type);
  if (!allowed.includes(status)) {
    return `Status must be one of: ${allowed.join(', ')}`;
  }
  return null;
}

function isPositiveAttendance(status) {
  return status === 'present' || status === 'completed';
}

function computeStats(records = []) {
  const counts = {
    total: records.length,
    present: 0,
    absent: 0,
    missed: 0,
    no_show: 0,
    cancelled: 0,
    completed: 0,
  };
  for (const row of records) {
    if (Object.prototype.hasOwnProperty.call(counts, row.status)) {
      counts[row.status] += 1;
    }
  }
  const attended = records.filter((r) => isPositiveAttendance(r.status)).length;
  const actionable = records.filter((r) => r.status !== 'cancelled').length;
  counts.attendancePercentage = actionable > 0
    ? Math.round((attended / actionable) * 100)
    : 0;
  return counts;
}

async function upsertAttendance(filter, setOnInsert, setOnUpdate = {}) {
  try {
    const existing = await Attendance.findOne(filter);
    if (existing) {
      // Repair legacy/invalid statuses without failing the whole request.
      const allowed = STATUSES_BY_TYPE[existing.type] || [];
      if (existing.status && !allowed.includes(existing.status)) {
        existing.status = allowed.includes('absent') ? 'absent' : allowed[0];
        existing.source = existing.source || 'system';
        await existing.save();
      }
      if (Object.keys(setOnUpdate).length) {
        Object.assign(existing, setOnUpdate);
        await existing.save();
      }
      return existing;
    }

    return await Attendance.create({
      ...filter,
      ...setOnInsert,
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return Attendance.findOne(filter);
    }
    throw error;
  }
}

async function ensureWorkoutAttendance({
  coachId,
  userId,
  exercisePlanId = null,
  workoutScheduleId = null,
  date,
  scheduledStart = null,
  scheduledEnd = null,
  initialStatus = 'absent',
}) {
  if (!coachId || !userId) return null;
  if (!exercisePlanId && !workoutScheduleId) return null;
  const day = startOfDay(date || scheduledStart || new Date());
  const filter = exercisePlanId
    ? { type: 'workout', user: userId, exercisePlan: exercisePlanId }
    : { type: 'workout', user: userId, workoutSchedule: workoutScheduleId };

  return upsertAttendance(filter, {
    type: 'workout',
    status: WORKOUT_STATUSES.includes(initialStatus) ? initialStatus : 'absent',
    user: userId,
    coach: coachId,
    exercisePlan: exercisePlanId,
    workoutSchedule: workoutScheduleId,
    date: day,
    scheduledStart: scheduledStart ? new Date(scheduledStart) : day,
    scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
    source: 'auto',
  });
}

async function ensureSessionAttendance({
  coachId,
  userId,
  sessionId = null,
  appointmentId = null,
  scheduledStart,
  durationMinutes = 60,
  initialStatus = 'absent',
}) {
  if (!coachId || !userId) return null;
  if (!sessionId && !appointmentId) return null;
  const start = new Date(scheduledStart);
  if (Number.isNaN(start.getTime())) return null;
  const end = addDuration(start, durationMinutes);
  const day = startOfDay(start);
  const filter = sessionId
    ? { type: 'session', user: userId, session: sessionId }
    : { type: 'session', user: userId, appointment: appointmentId };

  return upsertAttendance(filter, {
    type: 'session',
    status: SESSION_STATUSES.includes(initialStatus) ? initialStatus : 'absent',
    user: userId,
    coach: coachId,
    session: sessionId,
    appointment: appointmentId,
    date: day,
    scheduledStart: start,
    scheduledEnd: end,
    source: 'auto',
  });
}

async function ensureGroupAttendance({
  coachId,
  userId,
  fitnessClassId,
  scheduledStart,
  durationMinutes = 60,
  initialStatus = 'absent',
}) {
  if (!coachId || !userId || !fitnessClassId) return null;
  const start = new Date(scheduledStart || Date.now());
  const day = startOfDay(start);
  return upsertAttendance(
    { type: 'group', user: userId, fitnessClass: fitnessClassId },
    {
      type: 'group',
      status: GROUP_STATUSES.includes(initialStatus) ? initialStatus : 'absent',
      user: userId,
      coach: coachId,
      fitnessClass: fitnessClassId,
      date: day,
      scheduledStart: start,
      scheduledEnd: addDuration(start, durationMinutes),
      source: 'auto',
    },
  );
}

async function ensureDailyAttendance({ coachId, userId, date, initialStatus = 'absent' }) {
  if (!coachId || !userId) return null;
  const day = startOfDay(date || new Date());
  return upsertAttendance(
    { type: 'daily', user: userId, coach: coachId, date: day },
    {
      type: 'daily',
      status: initialStatus === 'present' ? 'present' : 'absent',
      user: userId,
      coach: coachId,
      date: day,
      scheduledStart: day,
      source: 'auto',
    },
  );
}

async function ensureCoachAttendance({ coachId, date, initialStatus = 'absent' }) {
  if (!coachId) return null;
  const day = startOfDay(date || new Date());
  return upsertAttendance(
    { type: 'coach', coach: coachId, date: day },
    {
      type: 'coach',
      status: initialStatus === 'present' ? 'present' : 'absent',
      user: null,
      coach: coachId,
      date: day,
      scheduledStart: day,
      source: 'auto',
    },
  );
}

async function markAttendanceRecord(doc, { status, notes, markedBy, force = false }) {
  if (!doc) return { error: 'Attendance record not found', status: 404 };
  const statusError = validateStatusForType(doc.type, status);
  if (statusError) return { error: statusError, status: 400 };

  if (doc.type === 'session' && status === 'completed' && !force) {
    const end = doc.scheduledEnd ? new Date(doc.scheduledEnd) : null;
    if (end && Date.now() < end.getTime()) {
      return {
        error: 'A session cannot be marked Completed before its scheduled end time.',
        status: 400,
        code: 'SESSION_NOT_ENDED',
      };
    }
  }

  doc.status = status;
  if (notes !== undefined) doc.notes = String(notes || '').trim();
  doc.markedBy = markedBy || null;
  doc.markedAt = new Date();
  doc.source = 'coach';
  await doc.save();
  return { record: doc };
}

/**
 * Keep attendance in sync when a Session/Appointment status changes.
 * Maps completed / cancelled / no_show → attendance status. Does not overwrite
 * present/absent manually marked by coach unless force=true.
 */
async function syncLinkedSessionAttendance({
  sessionId = null,
  appointmentId = null,
  status,
  markedBy = null,
  force = false,
}) {
  const mapped = {
    completed: 'completed',
    cancelled: 'cancelled',
    no_show: 'no_show',
  }[status];
  if (!mapped) return null;

  const filter = { type: 'session' };
  if (sessionId) filter.session = sessionId;
  else if (appointmentId) filter.appointment = appointmentId;
  else return null;

  let doc = await Attendance.findOne(filter);
  if (!doc) return null;

  if (
    !force &&
    ['present', 'absent'].includes(doc.status) &&
    mapped !== 'cancelled'
  ) {
    // Preserve coach-marked present/absent; still apply cancelled/no_show/completed when forced by lifecycle
    if (mapped === 'completed') {
      // completed supersedes pending absent defaults only
      if (doc.status === 'absent' && doc.source === 'auto') {
        return markAttendanceRecord(doc, { status: mapped, markedBy, force: true });
      }
      return doc;
    }
  }

  return markAttendanceRecord(doc, {
    status: mapped,
    markedBy,
    force: mapped === 'completed' || mapped === 'cancelled' || mapped === 'no_show',
  });
}

function serializeAttendance(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  return {
    _id: obj._id,
    type: obj.type,
    status: obj.status,
    user: obj.user,
    coach: obj.coach,
    exercisePlan: obj.exercisePlan,
    workoutSchedule: obj.workoutSchedule,
    session: obj.session,
    appointment: obj.appointment,
    fitnessClass: obj.fitnessClass,
    date: obj.date,
    scheduledStart: obj.scheduledStart,
    scheduledEnd: obj.scheduledEnd,
    notes: obj.notes || '',
    markedBy: obj.markedBy,
    markedAt: obj.markedAt,
    source: obj.source,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

module.exports = {
  startOfDay,
  endOfDay,
  addDuration,
  allowedStatusesFor,
  validateStatusForType,
  isPositiveAttendance,
  computeStats,
  upsertAttendance,
  ensureWorkoutAttendance,
  ensureSessionAttendance,
  ensureGroupAttendance,
  ensureDailyAttendance,
  ensureCoachAttendance,
  markAttendanceRecord,
  syncLinkedSessionAttendance,
  serializeAttendance,
};
