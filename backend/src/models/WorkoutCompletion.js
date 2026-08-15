const mongoose = require('mongoose');

const workoutCompletionSchema = new mongoose.Schema({
  exercisePlan: { type: mongoose.Schema.Types.ObjectId, ref: 'ExercisePlan', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  coach: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['pending', 'pending_review', 'completed', 'missed'],
    default: 'pending',
  },
  completedAt: { type: Date },
  dueDate: { type: Date },
  durationMinutes: { type: Number, min: [1, 'Workout duration must be at least 1 minute'], max: [24 * 60, 'Duration looks invalid'] },
  notes: { type: String, default: '', maxlength: 5000 },
  proofPhoto: { type: String, default: '' },
  submittedAt: { type: Date },
  reviewedAt: { type: Date },
  coachFeedback: { type: String, default: '' },
}, { timestamps: true, optimisticConcurrency: true });

workoutCompletionSchema.index({ exercisePlan: 1, user: 1 }, { unique: true });
workoutCompletionSchema.index({ user: 1, status: 1 });
workoutCompletionSchema.index({ coach: 1, createdAt: -1 });
workoutCompletionSchema.index({ coach: 1, status: 1 });

module.exports = mongoose.model('WorkoutCompletion', workoutCompletionSchema);
