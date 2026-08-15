const mongoose = require('mongoose');

const APPOINTMENT_STATUSES = [
  'pending',
  'approved',
  'confirmed',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
  'rescheduled',
  'no_show',
];

const SESSION_MODES = ['online', 'in_person'];

const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    name: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const appointmentSchema = new mongoose.Schema(
  {
    // Canonical fields used by appointmentController
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    coach: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    dateTime: { type: Date, default: null, index: true },
    durationMinutes: { type: Number, default: 60, min: 5, max: 240 },
    type: {
      type: String,
      enum: ['user_request', 'coach_created', 'admin_created', 'booked', 'other'],
      default: 'user_request',
    },
    notes: { type: String, default: '' },
    coachNotes: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    fitnessClass: { type: mongoose.Schema.Types.ObjectId, ref: 'FitnessClass', default: null },
    status: {
      type: String,
      enum: APPOINTMENT_STATUSES,
      default: 'pending',
      index: true,
    },

    // 1-on-1 session extras (additive — safe for existing docs)
    sessionMode: {
      type: String,
      enum: SESSION_MODES,
      default: 'in_person',
    },
    meetingLink: { type: String, default: '' },
    attachments: { type: [attachmentSchema], default: [] },
    followUpOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    reminderSent: { type: Boolean, default: false },
    reminderMinutesBefore: { type: Number, default: 30 },
    rescheduledFrom: { type: Date, default: null },

    // Mirrored fields for dashboardController / older readers
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    datetime: { type: Date, default: null },
    date: { type: Date, default: null },
    time: { type: String, default: '' },
    duration: { type: Number, default: 60 },
  },
  { timestamps: true },
);

appointmentSchema.pre('validate', function syncMirroredFields() {
  if (this.client && !this.user_id) this.user_id = this.client;
  if (this.user_id && !this.client) this.client = this.user_id;
  if (this.coach && !this.coach_id) this.coach_id = this.coach;
  if (this.coach_id && !this.coach) this.coach = this.coach_id;

  // Always keep datetime mirrors in sync when dateTime is set (fixes reschedule drift).
  if (this.dateTime) {
    this.datetime = this.dateTime;
    this.date = this.dateTime;
    try {
      this.time = new Date(this.dateTime).toISOString().slice(11, 16);
    } catch {
      /* ignore */
    }
  } else if (this.datetime && !this.dateTime) {
    this.dateTime = this.datetime;
    this.date = this.datetime;
  }

  if (this.durationMinutes != null) this.duration = this.durationMinutes;
  else if (this.duration != null) this.durationMinutes = this.duration;

  // Normalize confirmed ↔ approved for mixed readers
  if (this.status === 'confirmed') this.status = 'approved';
});

appointmentSchema.index({ coach: 1, dateTime: 1 });
appointmentSchema.index(
  { coach: 1, dateTime: 1 },
  {
    unique: true,
    name: 'coach_slot_unique',
    partialFilterExpression: {
      status: { $in: ['pending', 'approved', 'rescheduled', 'confirmed', 'in_progress'] },
      dateTime: { $type: 'date' },
    },
  },
);
appointmentSchema.index({ client: 1, dateTime: 1 });
appointmentSchema.index({ coach_id: 1, datetime: 1 });
appointmentSchema.index({ user_id: 1, datetime: 1 });
appointmentSchema.index({ followUpOf: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
module.exports.APPOINTMENT_STATUSES = APPOINTMENT_STATUSES;
module.exports.SESSION_MODES = SESSION_MODES;
