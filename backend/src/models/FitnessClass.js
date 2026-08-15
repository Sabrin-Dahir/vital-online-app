const mongoose = require('mongoose');

const fitnessClassSchema = new mongoose.Schema(
  {
    coach: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'General' },
    date: { type: Date, required: true },
    durationMinutes: { type: Number, default: 60 },
    capacity: { type: Number, default: 20 },
    enrolledStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    attendance: [
      {
        student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        present: { type: Boolean, default: true },
        markedAt: { type: Date, default: Date.now },
      },
    ],
    status: {
      type: String,
      enum: ['scheduled', 'active', 'completed', 'cancelled'],
      default: 'scheduled',
    },
  },
  { timestamps: true, optimisticConcurrency: true }
);

fitnessClassSchema.path('title').validate(function titleRequired(value) {
  return Boolean(String(value || '').trim());
}, 'Class title is required');

fitnessClassSchema.path('durationMinutes').validate(function durationOk(value) {
  return value == null || (Number(value) >= 5 && Number(value) <= 480);
}, 'Duration must be between 5 and 480 minutes');

fitnessClassSchema.path('capacity').validate(function capacityOk(value) {
  return value == null || (Number(value) >= 1 && Number(value) <= 500);
}, 'Capacity must be between 1 and 500');

fitnessClassSchema.index({ coach: 1, status: 1 });
fitnessClassSchema.index({ enrolledStudents: 1 });
fitnessClassSchema.index({ coach: 1, date: 1 });

module.exports = mongoose.model('FitnessClass', fitnessClassSchema);
