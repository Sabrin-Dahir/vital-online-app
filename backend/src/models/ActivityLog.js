const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, default: Date.now },
    activityType: { type: String, required: true, trim: true, maxlength: 120 },
    durationMinutes: { type: Number, required: true, min: [1, 'Duration must be at least 1 minute'], max: [24 * 60, 'Duration looks invalid'] },
    caloriesBurned: { type: Number, default: 0, min: [0, 'Calories burned cannot be negative'], max: 20000 },
    sets: [
      {
        reps: { type: Number },
        weight: { type: Number },
      }
    ],
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true, optimisticConcurrency: true }
);

activityLogSchema.index({ user: 1, date: -1 });
activityLogSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
