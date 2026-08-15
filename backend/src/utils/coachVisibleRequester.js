/**
 * Sanitize member profile fields that coaches may see on incoming coach requests.
 * Never include passwords, tokens, reset codes, or unrelated accounts.
 */

const { withDisplayName } = require('./userDisplay');
const { normalizeFitnessGoal, getClientFitnessGoal } = require('./coachSpecialization');

const REQUESTER_USER_SELECT =
  'full_name username phone avatar role status clientData profile createdAt';

const REQUESTER_PROFILE_SELECT =
  'age heightCm weightKg bmi photoUrl goals experience bio location phone';

function pickClientData(clientData) {
  if (!clientData || typeof clientData !== 'object') return null;
  const fitnessGoal =
    normalizeFitnessGoal(clientData.fitness_goal) || clientData.fitness_goal || null;
  return {
    age: clientData.age ?? null,
    gender: clientData.gender || '',
    height: clientData.height ?? null,
    weight: clientData.weight ?? null,
    fitness_goal: fitnessGoal,
    activity_level: clientData.activity_level || null,
    medical_notes: clientData.medical_notes || '',
  };
}

function pickProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  return {
    age: profile.age ?? null,
    heightCm: profile.heightCm ?? null,
    weightKg: profile.weightKg ?? null,
    bmi: profile.bmi ?? null,
    photoUrl: profile.photoUrl || '',
    goals: Array.isArray(profile.goals) ? profile.goals : [],
    experience: profile.experience || '',
    bio: profile.bio || '',
    location: profile.location || '',
    phone: profile.phone || '',
  };
}

/**
 * Build the coach-visible member object for a pending (or owned) coach request.
 */
function formatCoachVisibleRequester(userDoc) {
  if (!userDoc) return null;
  const base = withDisplayName(userDoc);
  const clientData = pickClientData(base.clientData);
  const profile = pickProfile(base.profile);

  const age = clientData?.age ?? profile?.age ?? null;
  const height = clientData?.height ?? profile?.heightCm ?? null;
  const weight = clientData?.weight ?? profile?.weightKg ?? null;
  const location = profile?.location || '';
  const photo = base.avatar || profile?.photoUrl || '';
  const fitnessGoal =
    (clientData && clientData.fitness_goal) ||
    getClientFitnessGoal({ clientData }) ||
    null;
  const fitnessLevel = clientData?.activity_level || profile?.experience || null;

  return {
    _id: base._id,
    id: base._id,
    full_name: base.full_name || '',
    name: base.name || base.full_name || base.username || '',
    username: base.username || '',
    email: base.email || base.username || '',
    phone: base.phone || profile?.phone || '',
    avatar: photo,
    photoUrl: photo,
    role: base.role,
    status: base.status,
    age,
    gender: clientData?.gender || '',
    location,
    region: location,
    fitness_goal: fitnessGoal,
    fitnessGoal,
    fitness_level: fitnessLevel,
    fitnessLevel,
    activity_level: clientData?.activity_level || null,
    height,
    weight,
    bmi: profile?.bmi ?? null,
    medical_notes: clientData?.medical_notes || '',
    goals: profile?.goals || [],
    experience: profile?.experience || '',
    bio: profile?.bio || '',
    clientData,
    profile,
  };
}

function formatCoachRequestForCoach(requestDoc) {
  if (!requestDoc) return null;
  const raw = typeof requestDoc.toObject === 'function' ? requestDoc.toObject() : { ...requestDoc };
  return {
    _id: raw._id,
    id: raw._id,
    status: raw.status || 'pending',
    message: raw.message || '',
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    reviewedAt: raw.reviewedAt || null,
    fitnessClass: raw.fitnessClass || null,
    user: formatCoachVisibleRequester(raw.user),
  };
}

module.exports = {
  REQUESTER_USER_SELECT,
  REQUESTER_PROFILE_SELECT,
  formatCoachVisibleRequester,
  formatCoachRequestForCoach,
  pickClientData,
  pickProfile,
};
