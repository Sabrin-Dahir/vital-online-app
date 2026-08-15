const mongoose = require('mongoose');
const calcBmi = require('../utils/calcBmi');
const { bmiCategory } = require('../utils/calcBmi');

const profileSchema = new mongoose.Schema(
  {
    age: {
      type: Number,
      validate: {
        validator(value) {
          if (value == null || value === '') return true;
          return Number.isInteger(value) && value >= 18 && value <= 120;
        },
        message: 'Age must be between 18 and 120 years.',
      },
    },
    heightCm: {
      type: Number,
      min: [50, 'Height must be between 50 cm and 250 cm.'],
      max: [250, 'Height must be between 50 cm and 250 cm.'],
    },
    weightKg: {
      type: Number,
      min: [20, 'Weight must be between 20 kg and 300 kg.'],
      max: [300, 'Weight must be between 20 kg and 300 kg.'],
    },
    /** Always derived from heightCm + weightKg in pre-save — never trust client input. */
    bmi: { type: Number },
    photoUrl: { type: String, default: '' },
    goals: [String],
    experience: String,
    specialization: [String],
    bio: { type: String, maxlength: 5000 },
    phone: {
      type: String,
      validate: {
        validator(value) {
          if (!value) return true;
          const digits = String(value).replace(/\D/g, '');
          return digits.length >= 7 && digits.length <= 15;
        },
        message: 'Please enter a valid phone number',
      },
    },
    location: String,
    yearsExperience: { type: Number, min: 0, max: 80 },
    certifications: String,
    workingDays: {
      type: [String],
      default: [],
    },
    appointmentDays: {
      type: [String],
      default: [],
    },
    workingHoursStart: { type: String, default: '09:00' },
    workingHoursEnd: { type: String, default: '17:00' },
    appointmentDurationMinutes: { type: Number, default: 60, min: 5, max: 240 },
    dayAvailability: [
      {
        day: { type: String, required: true },
        start: { type: String, required: true },
        end: { type: String, required: true },
      },
    ],
  },
  { timestamps: true, optimisticConcurrency: true, validateModifiedOnly: true }
);

profileSchema.pre('save', async function saveBmi() {
  this.bmi = calcBmi(this.heightCm, this.weightKg);
});

profileSchema.virtual('bmiCategoryLabel').get(function categoryLabel() {
  return bmiCategory(this.bmi);
});

module.exports = mongoose.model('Profile', profileSchema);
