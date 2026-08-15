const mongoose = require('mongoose');

const exerciseItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  sets: { type: Number, required: true, min: 1, max: 100 },
  reps: { type: Number, required: true, min: 1, max: 500 },
  durationMinutes: { type: Number, min: 0, max: 240 },
  restSeconds: { type: Number, min: 0, max: 600 },
  equipment: { type: String, default: '' },
  instructions: { type: String, default: '' },
  notes: { type: String, default: '' },
  demoImageUrl: { type: String, default: '' },
  demoVideoUrl: { type: String, default: '' },
}, { _id: true });

const workoutTemplateSchema = new mongoose.Schema({
  coach: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 5000 },
  level: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], default: 'Beginner' },
  notes: { type: String, default: '', maxlength: 5000 },
  exercises: {
    type: [exerciseItemSchema],
    validate: {
      validator(value) {
        return Array.isArray(value) && value.length > 0;
      },
      message: 'At least one exercise is required',
    },
  },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
}, { timestamps: true, optimisticConcurrency: true });

workoutTemplateSchema.index({ coach: 1, status: 1 });

module.exports = mongoose.model('WorkoutTemplate', workoutTemplateSchema);
