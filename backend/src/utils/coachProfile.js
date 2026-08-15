const PUBLIC_COACH_SELECT = 'full_name username phone avatar status role coachData';

function asStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/** Normalize uploaded certificate file payloads for API responses. */
function normalizeCertificateFiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((file) => file && typeof file === 'object')
    .map((file) => ({
      url: String(file.url || '').trim(),
      fileName: String(file.fileName || '').trim(),
      mimeType: String(file.mimeType || '').trim(),
      uploadedAt: file.uploadedAt || null,
    }))
    .filter((file) => file.url);
}

function pickCertificateFiles(...sources) {
  for (const source of sources) {
    const files = normalizeCertificateFiles(source);
    if (files.length) return files;
  }
  return [];
}

/** True when a coach account is safe to show/book for members. */
function isApprovedPublicCoach(user) {
  if (!user || user.role !== 'coach') return false;
  if (['suspended', 'pending', 'deleted'].includes(String(user.status || ''))) return false;
  const approval = user.coachData?.approval_status;
  if (approval === 'pending' || approval === 'rejected') return false;
  return true;
}

/**
 * Mongo filter for member-facing coach discovery.
 * Only active, approved coaches (legacy rows without approval_status are allowed).
 */
function approvedPublicCoachFilter(extra = {}) {
  return {
    role: 'coach',
    status: { $nin: ['suspended', 'pending', 'deleted'] },
    $or: [
      { 'coachData.approval_status': 'approved' },
      { 'coachData.approval_status': { $exists: false } },
      { 'coachData.approval_status': null },
      { coachData: null },
      { coachData: { $exists: false } },
    ],
    ...extra,
  };
}

async function getHiddenCoachApplicantIds() {
  const CoachApplication = require('../models/CoachApplication');
  return CoachApplication.distinct('user', {
    status: { $in: ['pending', 'rejected'] },
  });
}

/** Merge approved-coach filter with exclusion of pending/rejected applicants. */
async function buildMemberVisibleCoachFilter(extra = {}) {
  const hiddenIds = await getHiddenCoachApplicantIds();
  const { _id: idFilter, ...restExtra } = extra;
  const filter = approvedPublicCoachFilter(restExtra);
  const and = [];
  if (idFilter != null) {
    and.push({ _id: idFilter });
  }
  if (hiddenIds.length) {
    and.push({ _id: { $nin: hiddenIds } });
  }
  if (and.length) {
    filter.$and = [...(filter.$and || []), ...and];
  }
  return filter;
}

function coachDataToProfile(coachData = {}, phone = '', extras = {}) {
  const data = coachData || {};
  const availability = data.availability || {};
  const certifications = Array.isArray(data.certifications)
    ? data.certifications.join(', ')
    : (data.certifications || extras.certifications || '');

  return {
    age: data.age ?? extras.age ?? null,
    phone: phone || extras.phone || '',
    location: data.location || extras.location || '',
    bio: data.bio || extras.bio || '',
    experience: data.experience || extras.experience || '',
    specialization: (() => {
      const {
        normalizeSpecializationList,
      } = require('./coachSpecialization');
      const fromSpecialties = normalizeSpecializationList(data.specialties);
      if (fromSpecialties.length) return fromSpecialties;
      const fromPrimary = normalizeSpecializationList(data.primarySpecialization);
      if (fromPrimary.length) return fromPrimary;
      return normalizeSpecializationList(
        data.specialization ?? extras.specialization,
      );
    })(),
    primarySpecialization: (() => {
      const {
        normalizeSpecializationList,
        normalizeSpecialization,
      } = require('./coachSpecialization');
      return normalizeSpecializationList(data.specialties)[0]
        || normalizeSpecialization(data.primarySpecialization)
        || normalizeSpecializationList(
          data.specialization ?? extras.specialization,
        )[0]
        || null;
    })(),
    specializations: (() => {
      const { normalizeSpecializationList } = require('./coachSpecialization');
      const fromSpecialties = normalizeSpecializationList(data.specialties);
      if (fromSpecialties.length) return fromSpecialties;
      return normalizeSpecializationList(
        data.primarySpecialization ?? data.specialization ?? extras.specialization,
      );
    })(),
    yearsExperience: data.years_experience ?? data.yearsExperience ?? extras.yearsExperience ?? null,
    certifications,
    workingDays: availability.workingDays ?? data.workingDays ?? extras.workingDays ?? [],
    appointmentDays: availability.appointmentDays ?? data.appointmentDays ?? extras.appointmentDays ?? [],
    workingHoursStart: availability.workingHoursStart || data.workingHoursStart || extras.workingHoursStart || '09:00',
    workingHoursEnd: availability.workingHoursEnd || data.workingHoursEnd || extras.workingHoursEnd || '17:00',
    appointmentDurationMinutes:
      data.appointmentDurationMinutes
      ?? extras.appointmentDurationMinutes
      ?? 60,
    dayAvailability: data.dayAvailability ?? extras.dayAvailability ?? [],
    photoUrl: data.photoUrl || extras.photoUrl || extras.avatar || '',
    certificateFiles: pickCertificateFiles(data.certificateFiles, extras.certificateFiles),
  };
}

function isEmbeddedProfile(value) {
  if (!value || typeof value !== 'object') return false;
  if (value._bsontype || Buffer.isBuffer(value) || value.buffer) return false;
  return (
    value.bio !== undefined
    || value.specialization !== undefined
    || value.specialties !== undefined
    || value.heightCm !== undefined
    || value.yearsExperience !== undefined
    || value.location !== undefined
  );
}

function formatPublicCoach(user, application = null) {
  if (!user) return null;

  const extras = application
    ? {
        age: application.age,
        phone: application.phone,
        location: application.location,
        bio: application.bio,
        experience: application.experience,
        specialization: application.specialization,
        yearsExperience: application.yearsExperience,
        certifications: application.certifications,
        workingDays: application.workingDays,
        appointmentDays: application.appointmentDays,
        dayAvailability: application.dayAvailability,
        appointmentDurationMinutes: application.appointmentDurationMinutes,
        photoUrl: application.photoUrl,
        certificateFiles: application.certificateFiles,
      }
    : {};

  const profile = user.coachData
    ? coachDataToProfile(user.coachData, user.phone, {
        ...extras,
        avatar: user.avatar,
        photoUrl: extras.photoUrl || user.avatar || '',
      })
    : (isEmbeddedProfile(user.profile)
      ? {
          ...user.profile,
          phone: user.profile.phone || user.phone || extras.phone || '',
          photoUrl: user.profile.photoUrl || user.avatar || extras.photoUrl || '',
        }
      : coachDataToProfile({}, user.phone, {
          ...extras,
          avatar: user.avatar,
          photoUrl: extras.photoUrl || user.avatar || '',
        }));

  if (!profile.photoUrl && user.avatar) {
    profile.photoUrl = user.avatar;
  }

  return {
    _id: user._id,
    name: user.full_name || user.name || user.username || 'Coach',
    email: user.username || user.email || '',
    username: user.username || '',
    full_name: user.full_name || user.name || '',
    phone: user.phone || extras.phone || profile.phone || '',
    avatar: user.avatar || profile.photoUrl || '',
    status: user.status || 'active',
    approval_status: user.coachData?.approval_status || 'approved',
    profile,
  };
}

function enrichCoachUser(user, application = null) {
  if (!user) return user;

  const formatted = formatPublicCoach(user, application);
  return {
    ...user,
    name: formatted.name,
    email: formatted.email,
    profile: formatted.profile,
  };
}

function buildCoachDataFromApplication({
  approval_status = 'pending',
  phone,
  age,
  location,
  yearsExperience,
  certifications,
  specialization,
  bio,
  experience,
  workingDays = [],
  appointmentDays = [],
  dayAvailability = [],
  appointmentDurationMinutes = 60,
  workingHoursStart = '09:00',
  workingHoursEnd = '17:00',
  certificateFiles = [],
} = {}) {
  const {
    specializationToStorage,
  } = require('./coachSpecialization');
  const stored = specializationToStorage(specialization);
  return {
    approval_status,
    primarySpecialization: stored.primarySpecialization,
    specialties: stored.specialties.length ? stored.specialties : asStringList(specialization),
    certifications: asStringList(certifications),
    certificateFiles: Array.isArray(certificateFiles) ? certificateFiles : [],
    bio: String(bio || '').trim(),
    experience: String(experience || '').trim(),
    location: String(location || '').trim(),
    age: age == null || age === '' ? null : Number(age),
    years_experience: Number(yearsExperience) || 0,
    appointmentDurationMinutes: Number(appointmentDurationMinutes) || 60,
    dayAvailability: Array.isArray(dayAvailability) ? dayAvailability : [],
    availability: {
      workingDays: asStringList(workingDays),
      appointmentDays: asStringList(appointmentDays),
      workingHoursStart: workingHoursStart || '09:00',
      workingHoursEnd: workingHoursEnd || '17:00',
    },
  };
}

module.exports = {
  PUBLIC_COACH_SELECT,
  coachDataToProfile,
  formatPublicCoach,
  enrichCoachUser,
  buildCoachDataFromApplication,
  asStringList,
  normalizeCertificateFiles,
  pickCertificateFiles,
  isApprovedPublicCoach,
  approvedPublicCoachFilter,
  getHiddenCoachApplicantIds,
  buildMemberVisibleCoachFilter,
};
