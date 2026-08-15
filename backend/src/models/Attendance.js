const mongoose = require('mongoose');

const ATTENDANCE_TYPES = ['workout', 'session', 'group', 'daily', 'coach'];

const WORKOUT_STATUSES = ['present', 'absent', 'completed', 'missed'];
const SESSION_STATUSES = ['present', 'absent', 'no_show', 'cancelled', 'completed'];
const GROUP_STATUSES = ['present', 'absent', 'no_show'];
const DAILY_STATUSES = ['present', 'absent'];
const COACH_STATUSES = ['present', 'absent'];

const STATUSES_BY_TYPE = {
  workout: WORKOUT_STATUSES,
  session: SESSION_STATUSES,
  group: GROUP_STATUSES,
  daily: DAILY_STATUSES,
  coach: COACH_STATUSES,
};

const attendanceSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ATTENDANCE_TYPES,
      required: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
      default: 'absent',
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    coach: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    exercisePlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExercisePlan',
      default: null,
      index: true,
    },
    workoutSchedule: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkoutSchedule',
      default: null,
      index: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
      index: true,
    },
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      default: null,
      index: true,
    },
    fitnessClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FitnessClass',
      default: null,
      index: true,
    },
    date: { type: Date, required: true, index: true },
    scheduledStart: { type: Date, default: null },
    scheduledEnd: { type: Date, default: null },
    notes: { type: String, default: '' },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    markedAt: { type: Date, default: null },
    source: {
      type: String,
      enum: ['auto', 'coach', 'system', 'legacy'],
      default: 'auto',
    },
  },
  { timestamps: true },
);

attendanceSchema.path('status').validate(function statusMatchesType(value) {
  const allowed = STATUSES_BY_TYPE[this.type] || [];
  return allowed.includes(value);
}, 'Invalid attendance status for this attendance type');

attendanceSchema.index(
  { type: 1, user: 1, exercisePlan: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'workout',
      exercisePlan: { $type: 'objectId' },
      user: { $type: 'objectId' },
    },
  },
);

attendanceSchema.index(
  { type: 1, user: 1, workoutSchedule: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'workout',
      workoutSchedule: { $type: 'objectId' },
      user: { $type: 'objectId' },
    },
  },
);

attendanceSchema.index(
  { type: 1, user: 1, session: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'session',
      session: { $type: 'objectId' },
      user: { $type: 'objectId' },
    },
  },
);

attendanceSchema.index(
  { type: 1, user: 1, appointment: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'session',
      appointment: { $type: 'objectId' },
      user: { $type: 'objectId' },
    },
  },
);

attendanceSchema.index(
  { type: 1, user: 1, fitnessClass: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'group',
      fitnessClass: { $type: 'objectId' },
      user: { $type: 'objectId' },
    },
  },
);

attendanceSchema.index(
  { type: 1, user: 1, coach: 1, date: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'daily',
      user: { $type: 'objectId' },
    },
  },
);

attendanceSchema.index(
  { type: 1, coach: 1, date: 1 },
  {
    unique: true,
    partialFilterExpression: { type: 'coach' },
  },
);

attendanceSchema.index({ coach: 1, date: -1, type: 1 });
attendanceSchema.index({ user: 1, date: -1, type: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
module.exports.ATTENDANCE_TYPES = ATTENDANCE_TYPES;
module.exports.STATUSES_BY_TYPE = STATUSES_BY_TYPE;
module.exports.WORKOUT_STATUSES = WORKOUT_STATUSES;
module.exports.SESSION_STATUSES = SESSION_STATUSES;
module.exports.GROUP_STATUSES = GROUP_STATUSES;
module.exports.DAILY_STATUSES = DAILY_STATUSES;
module.exports.COACH_STATUSES = COACH_STATUSES;
