const mongoose = require('mongoose');

const exerciseItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  sets: { type: Number, required: true, min: 1, max: 100 },
  reps: { type: Number, required: true, min: 1, max: 500 },
  durationMinutes: { type: Number, min: 0, max: 240 },
  restSeconds: { type: Number, min: 0, max: 600 },
  equipment: { type: String, default: '' },
  instructions: { type: String, default: '' },
  demoImageUrl: { type: String, default: '' },
  demoVideoUrl: { type: String, default: '' },
  notes: { type: String, default: '' },
}, { _id: true });

const exercisePlanSchema = new mongoose.Schema({
  coach: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  fitnessClass: { type: mongoose.Schema.Types.ObjectId, ref: 'FitnessClass' },
  title: { type: String, default: 'Workout Plan', trim: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 5000 },
  instructions: { type: String, default: '', maxlength: 5000 },
  level: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], default: 'Beginner' },
  dueDate: { type: Date },
  exercises: {
    type: [exerciseItemSchema],
    validate: {
      validator(value) {
        return Array.isArray(value) && value.length > 0;
      },
      message: 'At least one exercise is required',
    },
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active',
  },
}, { timestamps: true, optimisticConcurrency: true });

exercisePlanSchema.pre('validate', function requireTarget() {
  if (!this.client && !this.fitnessClass) {
    this.invalidate('client', 'Either client or fitnessClass is required');
  }
});

exercisePlanSchema.index({ coach: 1, client: 1, status: 1 });
exercisePlanSchema.index({ coach: 1, fitnessClass: 1, status: 1 });

module.exports = mongoose.model('ExercisePlan', exercisePlanSchema);
