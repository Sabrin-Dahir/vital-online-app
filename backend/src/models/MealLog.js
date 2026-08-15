const mongoose = require('mongoose');

const mealLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, default: Date.now },
    mealName: { type: String, required: true, trim: true, maxlength: 200 },
    calories: { type: Number, required: true, min: [0, 'Calories cannot be negative'], max: 20000 },
    protein: { type: Number, default: 0, min: [0, 'Protein cannot be negative'], max: 20000 },
    carbs: { type: Number, default: 0, min: [0, 'Carbohydrates cannot be negative'], max: 20000 },
    fats: { type: Number, default: 0, min: [0, 'Fat cannot be negative'], max: 20000 },
  },
  { timestamps: true, optimisticConcurrency: true }
);

mealLogSchema.index({ user: 1, date: -1 });

module.exports = mongoose.model('MealLog', mealLogSchema);
