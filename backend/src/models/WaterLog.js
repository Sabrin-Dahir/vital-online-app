const mongoose = require('mongoose');

const waterLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, default: Date.now },
    amountMl: { type: Number, required: true, min: [1, 'Water amount must be at least 1 ml'], max: [20000, 'Water amount is unrealistically high'] },
  },
  { timestamps: true, optimisticConcurrency: true }
);

waterLogSchema.index({ user: 1, date: -1 });

module.exports = mongoose.model('WaterLog', waterLogSchema);
