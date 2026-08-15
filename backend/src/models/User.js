const mongoose = require('mongoose');
const { comparePassword, hashPasswordIfNeeded } = require('../utils/passwordUtils');

const adminDataSchema = new mongoose.Schema(
  {
    permissions: { type: String, enum: ['super-admin', 'support-admin'], default: 'super-admin' },
  },
  { _id: false }
);

const coachDataSchema = new mongoose.Schema(
  {
    approval_status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    /** First selected specialization (legacy single-value field). Full list in specialties. */
    primarySpecialization: {
      type: String,
      default: undefined,
    },
    /** Canonical multi-select specializations (validated in application code). */
    specialties: { type: [String], default: [] },
    certifications: { type: [String], default: [] },
    /** Uploaded certificate images/PDFs (CDN URLs) for admin review */
    certificateFiles: {
      type: [
        {
          url: { type: String, required: true },
          fileName: { type: String, default: '' },
          mimeType: { type: String, default: '' },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    bio: { type: String, default: '' },
    experience: { type: String, default: '' },
    location: { type: String, default: '' },
    age: { type: Number, default: null },
    years_experience: { type: Number, default: 0 },
    appointmentDurationMinutes: { type: Number, default: 60 },
    dayAvailability: { type: [mongoose.Schema.Types.Mixed], default: [] },
    availability: {
      workingDays: { type: [String], default: [] },
      appointmentDays: { type: [String], default: [] },
      workingHoursStart: { type: String, default: '09:00' },
      workingHoursEnd: { type: String, default: '17:00' },
    },
    max_clients: { type: Number, default: null },
  },
  { _id: false }
);

const clientDataSchema = new mongoose.Schema(
  {
    assigned_coach_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    age: {
      type: Number,
      default: null,
      validate: {
        validator(value) {
          if (value == null || value === '') return true;
          return Number.isInteger(value) && value >= 18 && value <= 120;
        },
        message: 'Age must be between 18 and 120 years.',
      },
    },
    gender: {
      type: String,
      default: '',
      validate: {
        validator(value) {
          return value === '' || value == null || ['Male', 'Female'].includes(value);
        },
        message: 'Gender must be Male or Female',
      },
    },
    height: {
      type: Number,
      default: null,
      min: [50, 'Height must be between 50 cm and 250 cm.'],
      max: [250, 'Height must be between 50 cm and 250 cm.'],
    },
    weight: {
      type: Number,
      default: null,
      min: [20, 'Weight must be between 20 kg and 300 kg.'],
      max: [300, 'Weight must be between 20 kg and 300 kg.'],
    },
    weight_history: [
      {
        date: { type: Date, default: Date.now },
        // Historical rows may predate the 20–300 rule; new values are validated in controllers.
        weight: { type: Number, required: true },
      },
    ],
    // No schema defaults — only values the member submitted (or later updated) are stored.
    // Canonical goals match coach specializations; legacy lose_weight/gain_muscle/maintain/other kept for existing rows.
    fitness_goal: {
      type: String,
      enum: [
        'lose_weight',
        'gain_muscle',
        'maintain',
        'other',
        'General Fitness',
        'Weight Loss',
        'Weight Gain',
        'Nutrition',
        'Muscle Building',
        'Strength Training',
        'Bodybuilding',
        'Cardio & Endurance',
        'HIIT',
        'Functional Training',
        'Personal Training',
        'Fitness for Beginners',
        "Women's Fitness",
        "Men's Fitness",
        'Senior Fitness',
        'Youth Fitness',
        'Sports Training',
        'Athletic Performance',
        'Flexibility & Mobility',
        'Yoga & Mindfulness',
        'Posture & Corrective Exercise',
        'Injury Prevention',
        'Rehabilitation & Recovery',
        'Pre/Postnatal Fitness',
        'Lifestyle & Wellness',
        'Meal Planning',
        'Healthy Eating',
        'Weight Management',
      ],
    },
    activity_level: { type: String, enum: ['sedentary', 'moderate', 'active'] },
    medical_notes: { type: String },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator(value) {
          if (typeof this.isModified === 'function' && !this.isModified('username')) {
            return true;
          }
          const { validateEmail } = require('../utils/fieldValidation');
          return !validateEmail(value);
        },
        message: 'Please enter a valid email address',
      },
    },
    password: { type: String, required: true, select: false },
    // Admin-readable copy of the current sign-in password (gym staff support).
    // Login still uses the hashed `password` field only.
    admin_password: { type: String, default: '', select: false },
    role: { type: String, enum: ['admin', 'coach', 'user'], required: true },
    status: { type: String, enum: ['active', 'suspended', 'pending', 'deleted'], default: 'active' },
    must_change_password: { type: Boolean, default: true },
    password_reset_code: { type: String, default: '', select: false },
    password_reset_expires: { type: Date, default: null, select: false },
    full_name: {
      type: String,
      required: false,
      default: '',
      trim: true,
      maxlength: [80, 'Full name is too long'],
      validate: {
        validator(value) {
          if (!value) return true;
          if (typeof this.isModified === 'function' && !this.isModified('full_name')) {
            return true;
          }
          const { validateFullName } = require('../utils/fieldValidation');
          return !validateFullName(value);
        },
        message: 'Full name can only contain letters and spaces.',
      },
    },
    phone: {
      type: String,
      default: '',
      validate: {
        validator(value) {
          if (!value) return true;
          const digits = String(value).replace(/\D/g, '');
          return digits.length >= 7 && digits.length <= 15;
        },
        message: 'Please enter a valid phone number',
      },
    },
    avatar: { type: String, default: '' },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    invited_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    last_login_at: { type: Date, default: null },
    login_attempts: { type: Number, default: 0 },
    lock_until: { type: Date, default: null },
    adminData: { type: adminDataSchema, default: null },
    coachData: { type: coachDataSchema, default: null },
    clientData: { type: clientDataSchema, default: null },
    profile: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true, optimisticConcurrency: true, validateModifiedOnly: true }
);

// Display name for API consumers. The schema stores `full_name`/`username`,
// but many client screens read `name`; keep them in sync automatically.
userSchema.virtual('name').get(function displayName() {
  return this.full_name || this.username || '';
});
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) {
    return;
  }
  this.password = await hashPasswordIfNeeded(this.password);
});

userSchema.methods.comparePassword = function comparePasswordCandidate(candidate) {
  return comparePassword(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
