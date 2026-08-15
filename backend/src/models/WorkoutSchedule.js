const mongoose = require('mongoose');

const exerciseItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  sets: { type: Number, default: 3 },
  reps: { type: Number, default: 10 },
  durationMinutes: { type: Number },
  restSeconds: { type: Number },
  equipment: { type: String, default: '' },
  instructions: { type: String, default: '' },
  notes: { type: String, default: '' },
  demoImageUrl: { type: String, default: '' },
  demoVideoUrl: { type: String, default: '' },
}, { _id: true });

const workoutScheduleSchema = new mongoose.Schema({
  coach: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  workoutTemplate: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkoutTemplate', required: true },
  weeklyPlan: { type: mongoose.Schema.Types.ObjectId, ref: 'WeeklyWorkoutPlan' },
  dayOfWeek: { type: Number, min: 0, max: 6 },
  /** Day-specific exercises under Workout Title → Day → Exercises */
  exercises: [exerciseItemSchema],
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  fitnessClass: { type: mongoose.Schema.Types.ObjectId, ref: 'FitnessClass' },
  startDateTime: { type: Date, required: true },
  endDateTime: { type: Date, required: true },
  durationMinutes: { type: Number, required: true, min: 5, max: 480 },
  notes: { type: String, default: '', maxlength: 5000 },
  reminderEnabled: { type: Boolean, default: true },
  reminderMinutesBefore: { type: Number, default: 30, min: 0, max: 24 * 60 },
  reminderSent: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'cancelled'],
    default: 'scheduled',
  },
}, { timestamps: true, optimisticConcurrency: true });

workoutScheduleSchema.pre('validate', function requireTargetAndOrder() {
  if (!this.client && !this.fitnessClass) {
    this.invalidate('client', 'Either client or fitnessClass is required');
  }
  if (this.startDateTime && this.endDateTime && this.endDateTime <= this.startDateTime) {
    this.invalidate('endDateTime', 'End time must be after start time');
  }
});

workoutScheduleSchema.index({ coach: 1, startDateTime: 1 });
workoutScheduleSchema.index({ client: 1, startDateTime: 1 });
workoutScheduleSchema.index({ fitnessClass: 1, startDateTime: 1 });
workoutScheduleSchema.index({ workoutTemplate: 1 });
workoutScheduleSchema.index({ weeklyPlan: 1, dayOfWeek: 1 });
workoutScheduleSchema.index({ status: 1, reminderEnabled: 1, reminderSent: 1, startDateTime: 1 });

module.exports = mongoose.model('WorkoutSchedule', workoutScheduleSchema);
