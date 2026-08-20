const User = require('../models/User');
const Profile = require('../models/Profile');
const CoachAssignment = require('../models/CoachAssignment');
const CoachRequest = require('../models/CoachRequest');
const CoachApplication = require('../models/CoachApplication');
const FitnessClass = require('../models/FitnessClass');
const WorkoutSchedule = require('../models/WorkoutSchedule');
const Notification = require('../models/Notification');
const { validationResult } = require('express-validator');
const {
  validatePhone,
  validateFullName,
  validateMemberProfileFields,
  validateFitnessGoal,
} = require('../utils/fieldValidation');
const { sendValidationError } = require('../middleware/validateRequest');
const onboardingAgent = require('../agents/onboardingAgent');
const { getCoachRatingSummary } = require('./reviewController');
const { pickDefined, UPDATE_OPTIONS } = require('../utils/safeUpdate');
const {
  PUBLIC_COACH_SELECT,
  formatPublicCoach,
  isApprovedPublicCoach,
  buildMemberVisibleCoachFilter,
  pickCertificateFiles,
} = require('../utils/coachProfile');
const { USER_DISPLAY_SELECT } = require('../utils/userDisplay');
const { backfillGroupPlanAccess } = require('../utils/backfillGroupPlanAccess');
const { hasActiveAssignment } = require('../utils/coachVisibility');

/**
 * Prefer coachData.certificateFiles; fall back to the approved CoachApplication
 * so members still see certificates after approval even if coachData was empty.
 */
async function withPublicCertificateFiles(trainers) {
  const list = (Array.isArray(trainers) ? trainers : [trainers]).filter(Boolean);
  if (!list.length) return trainers;

  const missingIds = list
    .filter((coach) => !pickCertificateFiles(coach.coachData?.certificateFiles).length)
    .map((coach) => coach._id)
    .filter(Boolean);

  let byUserId = new Map();
  if (missingIds.length) {
    const apps = await CoachApplication.find({
      user: { $in: missingIds },
      status: 'approved',
    })
      .select('user certificateFiles')
      .lean();
    byUserId = new Map(
      apps.map((app) => [String(app.user), pickCertificateFiles(app.certificateFiles)]),
    );
  }

  const attach = (coach) => {
    const fromCoach = pickCertificateFiles(coach.coachData?.certificateFiles);
    const fromApp = byUserId.get(String(coach._id)) || [];
    const certificateFiles = fromCoach.length ? fromCoach : fromApp;
    if (!certificateFiles.length) return coach;
    return {
      ...coach,
      coachData: {
        ...(coach.coachData || {}),
        certificateFiles,
      },
    };
  };

  if (Array.isArray(trainers)) return list.map(attach);
  return attach(trainers);
}

const PROFILE_UPDATE_FIELDS = [
  'age',
  'heightCm',
  'weightKg',
  'goals',
  'experience',
  'specialization',
  'bio',
  'phone',
  'location',
  'yearsExperience',
  'certifications',
  'workingDays',
  'appointmentDays',
  'workingHoursStart',
  'workingHoursEnd',
  'appointmentDurationMinutes',
  'dayAvailability',
];

async function getProfile(req, res) {
  try {
    const user = await User.findById(req.user._id)
      .populate('clientData.assigned_coach_id', 'username full_name phone')
      .lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { enrichCoachUser } = require('../utils/coachProfile');
    const calcBmi = require('../utils/calcBmi');
    const { bmiCategory } = require('../utils/calcBmi');
    const CoachApplication = require('../models/CoachApplication');
    let profile;
    if (user.role === 'coach' || user.coachData) {
      const application = await CoachApplication.findOne({ user: user._id }).lean();
      profile = enrichCoachUser(user, application).profile;
    } else {
      const client = user.clientData || {};
      const assigned = client.assigned_coach_id;
      const heightCm = client.height ?? null;
      const weightKg = client.weight ?? null;
      const bmi = calcBmi(heightCm, weightKg);
      profile = {
        age: client.age ?? null,
        heightCm,
        weightKg,
        bmi,
        bmiCategory: bmiCategory(bmi),
        gender: client.gender || '',
        fitness_goal: client.fitness_goal || '',
        activity_level: client.activity_level || '',
        medical_notes: client.medical_notes || '',
        phone: user.phone || '',
        photoUrl: user.avatar || '',
        goals: client.fitness_goal
          ? [String(client.fitness_goal) === 'other'
              ? 'General'
              : String(client.fitness_goal).replace(/_/g, ' ')]
          : [],
        assignedCoachName: assigned
          ? (assigned.full_name || assigned.username || '')
          : '',
        assignedCoachId: assigned?._id || assigned || null,
      };
    }

    return res.json({
      profile: {
        ...profile,
        isComplete: Boolean(
          user.role === 'coach'
            ? (profile.bio || (profile.specialization || []).length)
            : (profile.age || profile.heightCm || profile.weightKg),
        ),
      },
      user: {
        id: user._id,
        full_name: user.full_name,
        username: user.username,
        role: user.role,
        phone: user.phone,
        status: user.status,
        avatar: user.avatar,
        clientData: user.clientData,
        coachData: user.coachData,
      },
    });
  } catch (error) {
    console.error('[USER] getProfile error:', error.message);
    return res.status(500).json({ message: 'Unable to load profile right now' });
  }
}

async function updateProfile(req, res) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const body = req.body || {};

    // BMI is derived from height + weight — never accept client overrides.
    if (body.bmi !== undefined || body.bmiCategory !== undefined) {
      return sendValidationError(
        res,
        'BMI is calculated automatically from height and weight.',
      );
    }

    // Clients must never escalate their own role via profile updates.
    if (body.role !== undefined) {
      return res.status(400).json({
        message: 'Role cannot be changed from this endpoint.',
        code: 'ROLE_IMMUTABLE',
      });
    }

    if (body.full_name !== undefined || body.fullName !== undefined || body.name !== undefined) {
      const nextName = String(body.full_name ?? body.fullName ?? body.name ?? '').trim();
      if (nextName) {
        const nameError = validateFullName(nextName);
        if (nameError) return sendValidationError(res, nameError);
      }
    }
    if (body.phone !== undefined) {
      const phoneError = validatePhone(body.phone, { required: false });
      if (phoneError) return sendValidationError(res, phoneError);
    }
    const profileFieldError = validateMemberProfileFields(body);
    if (profileFieldError) return sendValidationError(res, profileFieldError);
    if (body.fitness_goal !== undefined || body.fitnessGoal !== undefined) {
      const goalError = validateFitnessGoal(body.fitness_goal ?? body.fitnessGoal);
      if (goalError) return sendValidationError(res, goalError);
    }

    // Display name — allowed for all roles (does not change login username/email).
    if (body.full_name !== undefined || body.fullName !== undefined || body.name !== undefined) {
      const nextName = String(body.full_name ?? body.fullName ?? body.name ?? '').trim();
      if (nextName) user.full_name = nextName;
    }

    if (user.role === 'coach') {
      if (!user.coachData) user.coachData = {};
      if (body.bio !== undefined) user.coachData.bio = String(body.bio || '');
      if (body.experience !== undefined) user.coachData.experience = String(body.experience || '');
      if (body.location !== undefined) {
        const { validateSomaliaRegion, matchSomaliaRegion } = require('../utils/fieldValidation');
        const locationError = validateSomaliaRegion(body.location);
        if (locationError) return sendValidationError(res, locationError);
        user.coachData.location = matchSomaliaRegion(body.location);
      }
      // Coaches cannot change their own specialization — Admin sets it at registration/approval.
      if (body.specialization !== undefined || body.primarySpecialization !== undefined) {
        return sendValidationError(
          res,
          'Specialization can only be set by an admin. Contact support if you need it changed.',
        );
      }
      if (body.yearsExperience !== undefined || body.years_experience !== undefined) {
        const years = body.yearsExperience ?? body.years_experience;
        user.coachData.years_experience = years === '' || years == null ? 0 : Number(years);
      }
      if (body.appointmentDurationMinutes !== undefined) {
        user.coachData.appointmentDurationMinutes = Number(body.appointmentDurationMinutes) || 60;
      }
      if (body.certifications !== undefined) {
        user.coachData.certifications = Array.isArray(body.certifications)
          ? body.certifications.map((c) => String(c).trim()).filter(Boolean)
          : String(body.certifications || '')
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);
      }
      if (body.phone !== undefined) user.phone = String(body.phone || '').trim();
      user.markModified('coachData');
    } else {
      if (!user.clientData) user.clientData = {};
      if (body.age !== undefined) {
        user.clientData.age = body.age === '' || body.age == null ? null : Number(body.age);
      }
      if (body.heightCm !== undefined || body.height !== undefined) {
        const height = body.heightCm ?? body.height;
        user.clientData.height = height === '' || height == null ? null : Number(height);
      }
      if (body.weightKg !== undefined || body.weight !== undefined) {
        const weight = body.weightKg ?? body.weight;
        user.clientData.weight = weight === '' || weight == null ? null : Number(weight);
      }
      if (body.gender !== undefined) user.clientData.gender = String(body.gender || '');
      if (body.activity_level !== undefined || body.activityLevel !== undefined) {
        user.clientData.activity_level = String(body.activity_level ?? body.activityLevel ?? 'moderate');
      }
      if (body.medical_notes !== undefined || body.medicalNotes !== undefined) {
        user.clientData.medical_notes = String(body.medical_notes ?? body.medicalNotes ?? '');
      }
      if (body.fitness_goal !== undefined || body.fitnessGoal !== undefined || body.goals !== undefined) {
        const {
          normalizeFitnessGoal,
          coachMatchesFitnessGoal,
        } = require('../utils/coachSpecialization');
        let goal = body.fitness_goal ?? body.fitnessGoal;
        if (!goal && Array.isArray(body.goals) && body.goals.length) {
          goal = body.goals[0];
        }
        const normalized = normalizeFitnessGoal(goal);
        if (normalized) {
          const previousGoal = normalizeFitnessGoal(user.clientData.fitness_goal);
          user.clientData.fitness_goal = normalized;

          // Cancel pending requests that no longer match the new goal (keep active assignments).
          if (previousGoal !== normalized) {
            const pending = await CoachRequest.findOne({
              user: user._id,
              status: 'pending',
            }).populate('coach', 'coachData profile specialization');
            if (pending?.coach && !coachMatchesFitnessGoal(pending.coach, normalized)) {
              pending.status = 'cancelled';
              pending.reviewedAt = new Date();
              await pending.save();
              Notification.create({
                user: pending.coach._id || pending.coach,
                message: `${user.full_name || user.username} withdrew their coaching request after changing their fitness goal.`,
                type: 'update',
              }).catch((err) => console.warn('goal-change cancel notify:', err.message));
            }
          }
        }
      }
      if (body.phone !== undefined) user.phone = String(body.phone || '').trim();
      user.markModified('clientData');
    }

    await user.save({ validateModifiedOnly: true });

    const fresh = await User.findById(user._id)
      .populate('clientData.assigned_coach_id', 'username full_name phone')
      .lean();
    req.user = { ...req.user, ...fresh, _id: fresh._id };
    return getProfile(req, res);
  } catch (error) {
    console.error('[USER] updateProfile error:', error.message);
    const { respondWithCaughtError } = require('../utils/httpErrors');
    return respondWithCaughtError(res, error, 'Unable to update profile');
  }
}

async function updateProfilePhoto(req, res) {
  try {
    const { photo } = req.body;

    if (photo === undefined) {
      return res.status(400).json({ message: 'No photo provided' });
    }

    const { uploadImageDataUrl, isDataUrl, isHttpUrl } = require('../utils/imageKit');
    const raw = photo === null || photo === undefined ? '' : String(photo).trim();

    // Allow clearing the photo with an empty string.
    if (raw !== '' && !isDataUrl(raw) && !isHttpUrl(raw)) {
      return res.status(400).json({ message: 'Photo must be a base64 image data URL or https URL' });
    }

    let storedPhoto = '';
    if (raw) {
      storedPhoto = await uploadImageDataUrl(raw, {
        folder: '/vital/avatars',
        fileNamePrefix: `avatar_${req.user._id}`,
        tags: ['avatar', String(req.user.role || 'user')],
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { avatar: storedPhoto } },
      { new: true },
    ).lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      profile: {
        photoUrl: user.avatar || '',
      },
    });
  } catch (error) {
    console.error('[USER] updateProfilePhoto error:', error.message);
    if (error.code === 'IMAGEKIT_NOT_CONFIGURED') {
      return res.status(503).json({ message: error.message, code: error.code });
    }
    if (error.code === 'INVALID_IMAGE') {
      return res.status(400).json({ message: error.message, code: error.code });
    }
    return res.status(500).json({ message: 'Unable to update photo right now' });
  }
}

async function getCoachingAssignment(req, res) {
  try {
    const CoachAssignment = require('../models/CoachAssignment');
    const CoachClientAssignment = require('../models/CoachClientAssignment');
    const { ensureLegacyCoachAssignment } = require('../utils/coachVisibility');

    let assignment = await CoachAssignment.findOne({ user: req.user._id, status: 'active' })
      .populate({
        path: 'coach',
        select: PUBLIC_COACH_SELECT,
      })
      .populate({
        path: 'assignedArticles',
        select: 'title summary body category createdAt',
      })
      .lean();

    if (!assignment) {
      const modern = await CoachClientAssignment.findOne({
        user_id: req.user._id,
        status: 'active',
      }).select('coach_id').lean();

      if (modern?.coach_id) {
        const legacy = await ensureLegacyCoachAssignment(modern.coach_id, req.user._id);
        assignment = await CoachAssignment.findById(legacy._id)
          .populate({
            path: 'coach',
            select: PUBLIC_COACH_SELECT,
          })
          .populate({
            path: 'assignedArticles',
            select: 'title summary body category createdAt',
          })
          .lean();
      }
    }

    if (!assignment) {
      return res.json(null);
    }

    const coachWithCerts = assignment.coach
      ? await withPublicCertificateFiles(assignment.coach)
      : null;
    let publicCoach = coachWithCerts ? formatPublicCoach(coachWithCerts) : null;
    // Only expose certificates for approved, publicly safe coaches.
    if (publicCoach && !isApprovedPublicCoach(coachWithCerts)) {
      if (publicCoach.profile) {
        publicCoach = {
          ...publicCoach,
          profile: { ...publicCoach.profile, certificateFiles: [] },
        };
      }
    }

    return res.json({
      ...assignment,
      coach: publicCoach,
    });
  } catch (error) {
    console.error('[USER] getCoachingAssignment error:', error.message);
    return res.status(500).json({ message: 'Unable to fetch coaching status' });
  }
}

function parseSpecialization(value) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function getUserSelectedCoachId(userId) {
  const assignment = await CoachAssignment.findOne({
    user: userId,
    status: 'active',
  }).select('coach');
  if (assignment) return assignment.coach;

  const request = await CoachRequest.findOne({
    user: userId,
    status: 'pending',
  }).select('coach');
  if (request) return request.coach;

  return null;
}

async function getTrainers(req, res) {
  try {
    if (req.user.role === 'coach') {
      return res.status(403).json({ message: 'Coach profiles are not visible to other coaches' });
    }

    const {
      getClientFitnessGoal,
      coachMatchesFitnessGoal,
    } = require('../utils/coachSpecialization');

    if (req.user.role === 'user') {
      const selectedCoachId = await getUserSelectedCoachId(req.user._id);
      if (selectedCoachId) {
        const coachFilter = await buildMemberVisibleCoachFilter({ _id: selectedCoachId });
        const trainer = await User.findOne(coachFilter)
          .select(PUBLIC_COACH_SELECT)
          .lean();
        const withCerts = await withPublicCertificateFiles(trainer);
        return res.json(withCerts && isApprovedPublicCoach(withCerts) ? [formatPublicCoach(withCerts)] : []);
      }

      const member = await User.findById(req.user._id).select('clientData').lean();
      const fitnessGoal = getClientFitnessGoal(member);
      if (!fitnessGoal) {
        return res.json([]);
      }

      const coachFilter = await buildMemberVisibleCoachFilter();
      const trainers = await User.find(coachFilter)
        .select(PUBLIC_COACH_SELECT)
        .sort({ full_name: 1, username: 1 })
        .lean();

      const withCerts = await withPublicCertificateFiles(trainers);
      const matched = withCerts
        .filter(isApprovedPublicCoach)
        .filter((coach) => coachMatchesFitnessGoal(coach, fitnessGoal))
        .map(formatPublicCoach)
        .filter(Boolean);

      return res.json(matched);
    }

    const coachFilter = await buildMemberVisibleCoachFilter();
    const trainers = await User.find(coachFilter)
      .select(PUBLIC_COACH_SELECT)
      .sort({ full_name: 1, username: 1 })
      .lean();

    const withCerts = await withPublicCertificateFiles(trainers);
    return res.json(
      withCerts
        .filter(isApprovedPublicCoach)
        .map(formatPublicCoach)
        .filter(Boolean),
    );
  } catch (error) {
    console.error('[USER] getTrainers error:', error.message);
    return res.status(500).json({ message: 'Unable to load trainers' });
  }
}

async function getTrainerById(req, res) {
  try {
    if (req.user.role === 'coach') {
      return res.status(403).json({ message: 'Coach profiles are not visible to other coaches' });
    }

    if (req.user.role === 'user') {
      const selectedCoachId = await getUserSelectedCoachId(req.user._id);
      if (selectedCoachId && String(selectedCoachId) !== String(req.params.id)) {
        return res.status(403).json({ message: 'You can only view your selected coach' });
      }
    }

    const coachFilter = await buildMemberVisibleCoachFilter({ _id: req.params.id });
    const trainer = await User.findOne(coachFilter)
      .select(PUBLIC_COACH_SELECT)
      .lean();

    const withCerts = await withPublicCertificateFiles(trainer);
    if (!withCerts || !isApprovedPublicCoach(withCerts)) {
      return res.status(404).json({ message: 'Coach not found' });
    }

    if (req.user.role === 'user') {
      const selectedCoachId = await getUserSelectedCoachId(req.user._id);
      if (!selectedCoachId || String(selectedCoachId) !== String(req.params.id)) {
        const {
          assertCoachMatchesClientGoal,
        } = require('../utils/coachSpecialization');
        const member = await User.findById(req.user._id).select('clientData').lean();
        const match = assertCoachMatchesClientGoal(member, withCerts);
        if (!match.ok) {
          return res.status(match.status).json({
            message: match.message,
            code: match.code,
          });
        }
      }
    }

    const summary = await getCoachRatingSummary(withCerts._id);
    return res.json({ ...formatPublicCoach(withCerts), ...summary });
  } catch (error) {
    console.error('[USER] getTrainerById error:', error.message);
    return res.status(500).json({ message: 'Unable to load coach profile' });
  }
}

async function getPublicSchedule(req, res) {
  try {
    const query = { status: 'active' };
    if (req.user.role === 'coach') {
      query.coach = req.user._id;
    } else if (req.user.role === 'user') {
      query.user = req.user._id;
    }

    const assignments = await CoachAssignment.find(query)
      .populate('coach', USER_DISPLAY_SELECT)
      .populate('user', USER_DISPLAY_SELECT)
      .lean();
    return res.json(assignments);
  } catch (error) {
    return res.status(500).json({ message: 'Unable to fetch public schedule' });
  }
}

function formatUserClass(cls, userId) {
  const attendance = cls.attendance || [];
  const hasJoined = attendance.some(
    (entry) => String(entry.student) === String(userId) && entry.present !== false,
  );
  const start = new Date(cls.date);
  const end = new Date(start.getTime() + (cls.durationMinutes || 60) * 60000);
  const openAt = new Date(start.getTime() - 30 * 60000);
  const now = new Date();

  return {
    ...cls,
    enrolledCount: cls.enrolledStudents?.length ?? 0,
    hasJoined,
    sessionOpen: now >= openAt && now <= end,
    sessionOpensAt: openAt,
  };
}

async function getMyClasses(req, res) {
  try {
    const classes = await FitnessClass.find({ enrolledStudents: req.user._id })
      .populate('coach', USER_DISPLAY_SELECT)
      .populate('enrolledStudents', USER_DISPLAY_SELECT)
      .sort({ date: 1 })
      .lean();

    return res.json(classes.map((cls) => formatUserClass(cls, req.user._id)));
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load your classes' });
  }
}

async function getAvailableClasses(req, res) {
  try {
    const { getAuthorizedCoachIdsForUser } = require('../utils/coachVisibility');
    const coachIds = await getAuthorizedCoachIdsForUser(req.user._id);
    if (!coachIds.length) {
      return res.json([]);
    }

    const classes = await FitnessClass.find({
      coach: { $in: coachIds },
      status: { $in: ['scheduled', 'active'] },
      enrolledStudents: { $ne: req.user._id },
      $expr: { $lt: [{ $size: '$enrolledStudents' }, '$capacity'] },
    })
      .populate('coach', USER_DISPLAY_SELECT)
      .sort({ date: 1 })
      .lean();

    return res.json(classes.map((cls) => formatUserClass(cls, req.user._id)));
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load available classes' });
  }
}

async function getClassById(req, res) {
  try {
    const fitnessClass = await FitnessClass.findById(req.params.id)
      .populate('coach', USER_DISPLAY_SELECT)
      .populate('enrolledStudents', USER_DISPLAY_SELECT)
      .lean();

    if (!fitnessClass) {
      return res.status(404).json({ message: 'Class not found' });
    }

    const coachId = fitnessClass.coach?._id || fitnessClass.coach;
    const isEnrolled = (fitnessClass.enrolledStudents || []).some(
      (student) => String(student._id || student) === String(req.user._id),
    );

    if (!isEnrolled) {
      const assigned = await hasActiveAssignment(coachId, req.user._id);
      if (!assigned) {
        return res.status(403).json({ message: 'You do not have access to this class' });
      }

      if (fitnessClass.status === 'cancelled' || fitnessClass.status === 'completed') {
        return res.status(400).json({ message: 'This class is no longer available' });
      }
    }

    const workoutSchedules = await WorkoutSchedule.find({
      fitnessClass: fitnessClass._id,
      status: { $in: ['scheduled', 'completed'] },
    })
      .populate('workoutTemplate', 'title description exercises')
      .populate('weeklyPlan', 'title weekStartDate')
      .sort({ startDateTime: 1 })
      .lean();

    return res.json({
      ...formatUserClass(fitnessClass, req.user._id),
      isEnrolled,
      workoutSchedules: workoutSchedules.map((s) => ({
        ...s,
        title: s.workoutTemplate?.title || 'Workout',
        type: 'workout_schedule',
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load class details' });
  }
}

async function joinClass(req, res) {
  try {
    const fitnessClass = await FitnessClass.findById(req.params.id);
    if (!fitnessClass) {
      return res.status(404).json({ message: 'Class not found' });
    }

    if (fitnessClass.status === 'cancelled' || fitnessClass.status === 'completed') {
      return res.status(400).json({ message: 'This class is no longer available' });
    }

    const isEnrolled = fitnessClass.enrolledStudents.some(
      (id) => String(id) === String(req.user._id),
    );

    if (!isEnrolled) {
      const assigned = await hasActiveAssignment(fitnessClass.coach, req.user._id);
      if (!assigned) {
        return res.status(403).json({ message: 'You can only join classes from your assigned coach' });
      }

      if (fitnessClass.enrolledStudents.length >= fitnessClass.capacity) {
        return res.status(400).json({ message: 'This class is at full capacity' });
      }

      fitnessClass.enrolledStudents.push(req.user._id);
    }

    const start = new Date(fitnessClass.date);
    const end = new Date(start.getTime() + (fitnessClass.durationMinutes || 60) * 60000);
    const openAt = new Date(start.getTime() - 30 * 60000);
    const now = new Date();
    const inSessionWindow = now >= openAt && now <= end;

    if (inSessionWindow) {
      const existing = fitnessClass.attendance.find(
        (entry) => String(entry.student) === String(req.user._id),
      );
      if (existing) {
        existing.present = true;
        existing.markedAt = new Date();
      } else {
        fitnessClass.attendance.push({
          student: req.user._id,
          present: true,
          markedAt: new Date(),
        });
      }

      if (fitnessClass.status === 'scheduled') {
        fitnessClass.status = 'active';
      }
    }

    await fitnessClass.save();

    if (!isEnrolled) {
      await backfillGroupPlanAccess(req.user._id, fitnessClass._id).catch((err) => {
        console.error('backfillGroupPlanAccess joinClass:', err.message);
      });
    }

    if (inSessionWindow) {
      await Notification.create({
        user: fitnessClass.coach,
        message: `${req.user.name} joined "${fitnessClass.title}".`,
        type: 'update',
      });
    }

    const populated = await FitnessClass.findById(fitnessClass._id)
      .populate('coach', USER_DISPLAY_SELECT)
      .populate('enrolledStudents', USER_DISPLAY_SELECT)
      .lean();

    return res.json({
      ...formatUserClass(populated, req.user._id),
      isEnrolled: true,
      message: inSessionWindow
        ? 'You have joined the class session.'
        : 'You have been enrolled in this class. Join the live session when it opens.',
    });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to join class' });
  }
}

const { parseWorkingDays, validateWorkingDays } = require('../utils/workingDays');
const { normalizeWorkingHours, normalizeDayAvailability } = require('../utils/appointmentSlots');

function validateCoachApplicationPayload(body) {
  const requiredFields = [
    'phone',
    'age',
    'location',
    'yearsExperience',
    'certifications',
    'specialization',
  ];

  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
      return `${field} is required`;
    }
  }

  // bio, experience, and message are optional and may be any length.

  const workingDaysError = validateWorkingDays(body.workingDays);
  if (workingDaysError) {
    return workingDaysError;
  }

  const appointmentDaysError = validateWorkingDays(body.appointmentDays);
  if (appointmentDaysError) {
    return appointmentDaysError.replace('working day', 'appointment day');
  }

  return null;
}

async function submitCoachApplication(req, res) {
  try {
    if (req.user.role !== 'user') {
      return res.status(400).json({ message: 'Only members can apply to become a coach' });
    }

    const validationError = validateCoachApplicationPayload(req.body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    // Block pending/approved before uploads so we never mutate coachData then 400.
    const existingEarly = await CoachApplication.findOne({ user: req.user._id });
    if (existingEarly) {
      if (existingEarly.status === 'pending') {
        return res.status(400).json({ message: 'You already have a pending application' });
      }
      if (existingEarly.status === 'approved') {
        return res.status(400).json({ message: 'Your application has already been approved' });
      }
    }

    const {
      phone,
      age,
      location,
      yearsExperience,
      certifications,
      specialization,
      bio,
      experience,
      message,
      workingDays,
      appointmentDays,
      workingHoursStart,
      workingHoursEnd,
      appointmentDurationMinutes,
      dayAvailability,
      certificateFiles,
    } = req.body;

    const {
      validateSpecializationInput,
      specializationToStorage,
    } = require('../utils/coachSpecialization');
    const specializationError = validateSpecializationInput(specialization);
    if (specializationError) {
      return res.status(400).json({ message: specializationError });
    }
    const specializationStored = specializationToStorage(specialization);

    const { validateSomaliaRegion, matchSomaliaRegion } = require('../utils/fieldValidation');
    const locationError = validateSomaliaRegion(location);
    if (locationError) {
      return res.status(400).json({ message: locationError });
    }
    const locationStored = matchSomaliaRegion(location);

    const { resolveCertificateFiles, requireCertificateFiles } = require('../utils/certificateUpload');
    const { resolveCoachPersonName } = require('../utils/fieldValidation');
    let uploadedCertificates = [];
    try {
      requireCertificateFiles(certificateFiles);
      const person = resolveCoachPersonName({
        firstName: req.body.firstName || req.body.first_name,
        lastName: req.body.lastName || req.body.last_name,
        full_name: req.user.full_name,
        name: req.user.full_name || req.user.name,
      });
      uploadedCertificates = await resolveCertificateFiles(certificateFiles, {
        userId: String(req.user._id),
        firstName: person.firstName,
        lastName: person.lastName,
        expectedName: person.fullName,
      });
    } catch (certError) {
      return res.status(400).json({ message: certError.message, code: certError.code });
    }

    const availability = normalizeDayAvailability(
      appointmentDays,
      dayAvailability,
      appointmentDurationMinutes,
    );
    if (availability.error) {
      return res.status(400).json({ message: availability.error });
    }

    const firstDay = availability.value[0];

    const parsedWorkingDays = parseWorkingDays(workingDays);
    const parsedAppointmentDays = parseWorkingDays(appointmentDays);
    const specArray = specializationStored.specialties;

    // Legacy Profile sync is best-effort — current User model stores coach
    // details on coachData / CoachApplication instead.
    try {
      let profileId = req.user.profile;
      if (!profileId) {
        const created = await Profile.create({});
        profileId = created._id;
        // Ignore if User schema does not persist a profile ref.
        try {
          req.user.profile = profileId;
          await req.user.save();
        } catch (_) {}
      }
      if (profileId) {
        await Profile.findByIdAndUpdate(
          profileId,
          {
            $set: {
              age: Number(age),
              phone: String(phone).trim(),
              location: locationStored,
              yearsExperience: Number(yearsExperience),
              certifications: String(certifications).trim(),
              specialization: specArray,
              bio: String(bio || '').trim(),
              experience: String(experience || '').trim(),
              workingDays: parsedWorkingDays,
              appointmentDays: parsedAppointmentDays,
              dayAvailability: availability.value,
              workingHoursStart: firstDay?.start || '09:00',
              workingHoursEnd: firstDay?.end || '17:00',
              appointmentDurationMinutes: availability.durationMinutes,
            },
          },
          UPDATE_OPTIONS,
        );
      }
    } catch (profileError) {
      console.error('[USER] coach application profile sync:', profileError.message);
    }

    // Keep pending coach metadata on the user record for admin visibility.
    try {
      req.user.phone = String(phone).trim();
      req.user.coachData = {
        ...(req.user.coachData?.toObject?.() || req.user.coachData || {}),
        approval_status: 'pending',
        primarySpecialization: specializationStored.primarySpecialization,
        specialties: specArray,
        certifications: String(certifications)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        certificateFiles: uploadedCertificates,
        bio: String(bio || '').trim(),
        experience: String(experience || '').trim(),
        location: locationStored,
        age: Number(age) || null,
        years_experience: Number(yearsExperience) || 0,
        appointmentDurationMinutes: availability.durationMinutes || 60,
        dayAvailability: availability.value || [],
        availability: {
          workingDays: parsedWorkingDays || [],
          appointmentDays: parsedAppointmentDays || [],
          workingHoursStart: firstDay?.start || '09:00',
          workingHoursEnd: firstDay?.end || '17:00',
        },
      };
      await req.user.save();
    } catch (userError) {
      console.error('[USER] coach application user sync:', userError.message);
    }

    const applicationData = {
      phone: String(phone).trim(),
      age: Number(age),
      location: locationStored,
      yearsExperience: Number(yearsExperience),
      certifications: String(certifications).trim(),
      certificateFiles: uploadedCertificates,
      specialization: specializationStored.label,
      bio: String(bio || '').trim(),
      experience: String(experience || '').trim(),
      message: String(message || '').trim(),
      workingDays: parsedWorkingDays,
      appointmentDays: parsedAppointmentDays,
      dayAvailability: availability.value || [],
      appointmentDurationMinutes: availability.durationMinutes || 60,
      status: 'pending',
      rejectionReason: '',
    };

    const existing = await CoachApplication.findOne({ user: req.user._id });
    if (existing) {
      // Rejected → pending resubmit (pending/approved already blocked above).
      await CoachApplication.updateOne(
        { _id: existing._id },
        {
          $set: applicationData,
          $unset: { reviewedAt: 1 },
        },
      );
      await User.findByIdAndUpdate(req.user._id, {
        $set: { 'coachData.approval_status': 'pending' },
      });
      const refreshed = await CoachApplication.findById(existing._id);
      return res.json(refreshed);
    }

    const application = await CoachApplication.create({
      user: req.user._id,
      ...applicationData,
    });

    return res.status(201).json(application);
  } catch (error) {
    console.error('[USER] submitCoachApplication:', error.message);
    if (error.code === 'IMAGEKIT_NOT_CONFIGURED') {
      return res.status(503).json({ message: error.message, code: error.code });
    }
    if ([
      'INVALID_CERTIFICATES',
      'TOO_MANY_CERTIFICATES',
      'CERTIFICATE_TOO_LARGE',
      'CERTIFICATES_REQUIRED',
      'INVALID_FILE',
      'CERTIFICATE_NAME_REQUIRED',
      'CERTIFICATE_NAME_MISMATCH',
      'CERTIFICATE_OCR_FAILED',
    ].includes(error.code)) {
      return res.status(400).json({ message: error.message, code: error.code });
    }
    return res.status(500).json({ message: 'Unable to submit coach application' });
  }
}

async function getMyCoachApplication(req, res) {
  try {
    const application = await CoachApplication.findOne({ user: req.user._id }).lean();
    return res.json(application);
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load coach application' });
  }
}

module.exports = {
  getProfile,
  updateProfile,
  updateProfilePhoto,
  getCoachingAssignment,
  getTrainers,
  getTrainerById,
  getPublicSchedule,
  getMyClasses,
  getAvailableClasses,
  getClassById,
  joinClass,
  submitCoachApplication,
  getMyCoachApplication,
};
