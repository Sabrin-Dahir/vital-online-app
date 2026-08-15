const User = require('../models/User');
const { normalizeEmail } = require('./passwordUtils');
const {
  validateMemberRegistration,
} = require('./fieldValidation');

class MemberRegistrationError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function buildClientDataFromBody(body = {}) {
  const clientData = { assigned_coach_id: null };
  const { age, gender, height, weight, fitness_goal, activity_level } = body;
  if (age !== undefined && age !== null && String(age).trim() !== '') {
    const parsedAge = Number(age);
    if (!Number.isNaN(parsedAge)) clientData.age = parsedAge;
  }
  if (gender === 'Female' || gender === 'Male') {
    clientData.gender = gender;
  } else if (typeof gender === 'string' && gender.trim()) {
    clientData.gender = gender.trim();
  }
  if (height !== undefined && height !== null && String(height).trim() !== '') {
    const parsedHeight = Number(height);
    if (!Number.isNaN(parsedHeight)) clientData.height = parsedHeight;
  }
  if (weight !== undefined && weight !== null && String(weight).trim() !== '') {
    const parsedWeight = Number(weight);
    if (!Number.isNaN(parsedWeight)) clientData.weight = parsedWeight;
  }
  if (fitness_goal !== undefined && fitness_goal !== null && String(fitness_goal).trim() !== '') {
    const { normalizeFitnessGoal } = require('./coachSpecialization');
    const normalized = normalizeFitnessGoal(fitness_goal);
    if (normalized) clientData.fitness_goal = normalized;
  }
  if (['sedentary', 'moderate', 'active'].includes(activity_level)) {
    clientData.activity_level = activity_level;
  }
  return clientData;
}

/**
 * Shared member (client) registration used by:
 * - POST /auth/register (self-registration)
 * - POST /admin/users with role=user (admin fills the same form)
 *
 * Always creates role: 'user'. Never creates coach or admin accounts.
 */
async function createMemberRegistration(body = {}, options = {}) {
  const initiatedByAdmin = Boolean(options.initiatedByAdmin);
  const createdBy = options.createdBy || null;

  const identity = normalizeEmail(body.username || body.email);
  const fullName = String(body.full_name || body.fullName || body.name || '').trim();
  const password = body.password;

  const fieldError = validateMemberRegistration({
    ...body,
    full_name: fullName,
    username: identity,
    password,
  });
  if (fieldError) {
    throw new MemberRegistrationError(fieldError);
  }

  const requestedRole = body.role != null ? String(body.role).trim().toLowerCase() : '';
  if (requestedRole && requestedRole !== 'user') {
    throw new MemberRegistrationError(
      initiatedByAdmin
        ? 'Admin user registration only creates member (client) accounts.'
        : 'Public registration only creates member accounts.',
      400,
      'ROLE_NOT_ALLOWED',
    );
  }

  const exists = await User.exists({ username: identity });
  if (exists) {
    throw new MemberRegistrationError('Username already exists', 409);
  }

  const InviteCode = require('../models/InviteCode');
  const Notification = require('../models/Notification');
  const rawInvite = String(body.invite_code || body.ref || '').trim().toUpperCase();
  let inviterId = null;
  let inviteDoc = null;
  if (rawInvite) {
    inviteDoc = await InviteCode.findOne({ code: rawInvite });
    if (!inviteDoc) {
      throw new MemberRegistrationError('Invalid invite code');
    }
    if (inviteDoc.max_uses != null && inviteDoc.uses >= inviteDoc.max_uses) {
      throw new MemberRegistrationError('This invite code has reached its limit');
    }
    inviterId = inviteDoc.owner_id;
  }

  const user = await User.create({
    username: identity,
    password,
    full_name: fullName,
    phone: String(body.phone || '').trim(),
    role: 'user',
    status: 'active',
    must_change_password: false,
    created_by: createdBy,
    invited_by: inviterId,
    clientData: buildClientDataFromBody(body),
  });

  if (inviteDoc) {
    inviteDoc.uses = (inviteDoc.uses || 0) + 1;
    await inviteDoc.save();
    try {
      const friendName = user.full_name?.split(/\s+/)[0] || user.username;
      await Notification.create({
        user: inviteDoc.owner_id,
        recipient_id: inviteDoc.owner_id,
        type: 'update',
        message: `${friendName} joined Vital Fitness using your invite. Nice work spreading the momentum!`,
        data: { invited_user_id: String(user._id) },
        read: false,
      });
    } catch (notifyError) {
      console.error('[AUTH] Invite notification:', notifyError.message);
    }
  }

  return { user, initiatedByAdmin };
}

function mapMemberRegistrationError(error, res) {
  if (error instanceof MemberRegistrationError) {
    return res.status(error.status).json({
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  if (error?.code === 11000) {
    return res.status(409).json({ message: 'Username already exists' });
  }
  if (error?.name === 'ValidationError') {
    const first = Object.values(error.errors || {})[0];
    return res.status(400).json({ message: first?.message || 'Invalid registration data' });
  }
  return null;
}

module.exports = {
  MemberRegistrationError,
  buildClientDataFromBody,
  createMemberRegistration,
  mapMemberRegistrationError,
};
