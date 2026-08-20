const User = require('../models/User');
const Profile = require('../models/Profile');
const CoachApplication = require('../models/CoachApplication');
const { parseWorkingDays, validateWorkingDays } = require('./workingDays');
const { normalizeDayAvailability } = require('./appointmentSlots');
const { buildCoachDataFromApplication } = require('./coachProfile');
const { validatePasswordPolicy, normalizeEmail } = require('./passwordUtils');
const { validateEmail, validateCoachPersonName, resolveCoachPersonName, validatePhone, validateSomaliaRegion, matchSomaliaRegion } = require('./fieldValidation');
const {
  validateSpecializationInput,
  specializationToStorage,
} = require('./coachSpecialization');

class CoachRegistrationError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CERT_ERROR_CODES = [
  'INVALID_CERTIFICATES',
  'TOO_MANY_CERTIFICATES',
  'CERTIFICATE_TOO_LARGE',
  'CERTIFICATES_REQUIRED',
  'INVALID_FILE',
  'CERTIFICATE_NAME_REQUIRED',
  'CERTIFICATE_NAME_MISMATCH',
  'CERTIFICATE_OCR_FAILED',
  'IMAGEKIT_NOT_CONFIGURED',
  'IMAGEKIT_UPLOAD_FAILED',
];

/**
 * Shared coach registration used by:
 * - POST /auth/register-coach (self-registration)
 * - POST /admin/users with role=coach (admin fills the same application)
 *
 * Admin-created coaches are stored with the same Profile + CoachApplication +
 * coachData shape. Because an admin already reviewed the application, they are
 * saved as approved coaches (not pending).
 */
async function createCoachRegistration(body = {}, options = {}) {
  const initiatedByAdmin = Boolean(options.initiatedByAdmin);
  const createdBy = options.createdBy || null;

  const {
    name,
    full_name,
    firstName,
    first_name,
    lastName,
    last_name,
    email,
    username,
    password,
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
    dayAvailability,
    appointmentDurationMinutes,
    certificateFiles,
    certificates,
  } = body;
  const rawCertificates = certificateFiles || certificates;

  const identity = normalizeEmail(username || email);
  const person = resolveCoachPersonName({
    firstName,
    first_name,
    lastName,
    last_name,
    name,
    full_name,
  });
  const fullName = person.fullName;

  const nameError = validateCoachPersonName(person);
  if (nameError) throw new CoachRegistrationError(nameError);
  const emailError = validateEmail(identity);
  if (emailError) throw new CoachRegistrationError(emailError);
  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    throw new CoachRegistrationError(policyError);
  }
  const phoneError = validatePhone(phone, { required: true });
  if (phoneError) throw new CoachRegistrationError(phoneError);

  const specializationError = validateSpecializationInput(specialization);
  if (specializationError) throw new CoachRegistrationError(specializationError);
  const specializationStored = specializationToStorage(specialization);

  const locationError = validateSomaliaRegion(location);
  if (locationError) throw new CoachRegistrationError(locationError);
  const locationStored = matchSomaliaRegion(location);

  const requiredFields = [
    ['phone', phone],
    ['age', age],
    ['yearsExperience', yearsExperience],
    ['certifications', certifications],
  ];
  for (const [field, value] of requiredFields) {
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new CoachRegistrationError(`${field} is required`);
    }
  }

  const parsedAge = Number(age);
  if (!Number.isFinite(parsedAge) || parsedAge < 18 || parsedAge > 120 || !Number.isInteger(parsedAge)) {
    throw new CoachRegistrationError('Age must be between 18 and 120 years.');
  }

  const { resolveCertificateFiles, requireCertificateFiles } = require('./certificateUpload');
  let uploadedCertificates = [];
  try {
    requireCertificateFiles(rawCertificates);
    uploadedCertificates = await resolveCertificateFiles(rawCertificates, {
      userId: identity,
      firstName: person.firstName,
      lastName: person.lastName,
      expectedName: fullName,
    });
  } catch (certError) {
    throw new CoachRegistrationError(
      certError.message,
      certError.code === 'IMAGEKIT_NOT_CONFIGURED' ? 503 : 400,
      certError.code,
    );
  }

  const workingDaysError = validateWorkingDays(workingDays);
  if (workingDaysError) {
    throw new CoachRegistrationError(workingDaysError);
  }
  const appointmentDaysError = validateWorkingDays(appointmentDays);
  if (appointmentDaysError) {
    throw new CoachRegistrationError(
      appointmentDaysError.replace('working day', 'appointment day'),
    );
  }

  const availability = normalizeDayAvailability(
    appointmentDays,
    dayAvailability,
    appointmentDurationMinutes,
  );
  if (availability.error) {
    throw new CoachRegistrationError(availability.error);
  }

  const exists = await User.exists({ username: identity });
  if (exists) {
    throw new CoachRegistrationError('Username already exists', 409);
  }

  const parsedWorkingDays = parseWorkingDays(workingDays) || [];
  const parsedAppointmentDays = parseWorkingDays(appointmentDays) || [];
  const duration = Number(appointmentDurationMinutes) || 60;
  const daySlots = availability.value || [];
  const approvalStatus = initiatedByAdmin ? 'approved' : 'pending';

  const profileData = {
    age: parsedAge,
    phone: String(phone).trim(),
    location: locationStored,
    yearsExperience: Number(yearsExperience) || 0,
    certifications: String(certifications).trim(),
    specialization: [specializationStored.label],
    bio: String(bio || '').trim(),
    experience: String(experience || '').trim(),
    workingDays: parsedWorkingDays,
    appointmentDays: parsedAppointmentDays,
    appointmentDurationMinutes: duration,
    dayAvailability: daySlots,
  };
  const profile = await Profile.create(profileData);

  const coachData = buildCoachDataFromApplication({
    approval_status: approvalStatus,
    phone: String(phone).trim(),
    age: parsedAge,
    location: locationStored,
    yearsExperience: Number(yearsExperience),
    certifications: String(certifications).trim(),
    specialization: specializationStored.label,
    bio: String(bio || '').trim(),
    experience: String(experience || '').trim(),
    workingDays: parsedWorkingDays,
    appointmentDays: parsedAppointmentDays,
    dayAvailability: daySlots,
    appointmentDurationMinutes: duration,
    workingHoursStart: daySlots[0]?.start || '09:00',
    workingHoursEnd: daySlots[0]?.end || '17:00',
    certificateFiles: uploadedCertificates,
  });

  const user = await User.create({
    username: identity,
    password,
    admin_password: password,
    full_name: fullName,
    phone: String(phone).trim(),
    role: initiatedByAdmin ? 'coach' : 'user',
    status: 'active',
    must_change_password: false,
    created_by: createdBy,
    profile: profile._id,
    clientData: {
      age: parsedAge,
    },
    coachData,
  });

  const application = await CoachApplication.create({
    user: user._id,
    phone: String(phone).trim(),
    age: parsedAge,
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
    dayAvailability: daySlots,
    appointmentDurationMinutes: duration,
    status: approvalStatus,
    reviewedAt: initiatedByAdmin ? new Date() : undefined,
  });

  return { user, application, initiatedByAdmin };
}

function mapCoachRegistrationError(error, res) {
  if (error instanceof CoachRegistrationError) {
    return res.status(error.status).json({
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  if (error?.code === 11000) {
    return res.status(409).json({ message: 'Username already exists' });
  }
  if (CERT_ERROR_CODES.includes(error.code)) {
    const status = error.code === 'IMAGEKIT_NOT_CONFIGURED' ? 503 : 400;
    return res.status(status).json({ message: error.message, code: error.code });
  }
  return null;
}

module.exports = {
  CoachRegistrationError,
  createCoachRegistration,
  mapCoachRegistrationError,
};
