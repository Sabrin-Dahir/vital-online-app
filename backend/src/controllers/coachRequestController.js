const CoachRequest = require('../models/CoachRequest');
const CoachAssignment = require('../models/CoachAssignment');
const CoachClientAssignment = require('../models/CoachClientAssignment');
const FitnessClass = require('../models/FitnessClass');
const Notification = require('../models/Notification');
const User = require('../models/User');
const {
  PUBLIC_COACH_SELECT,
  formatPublicCoach,
  isApprovedPublicCoach,
  buildMemberVisibleCoachFilter,
} = require('../utils/coachProfile');
const { backfillGroupPlanAccess } = require('../utils/backfillGroupPlanAccess');
const {
  REQUESTER_USER_SELECT,
  REQUESTER_PROFILE_SELECT,
  formatCoachRequestForCoach,
} = require('../utils/coachVisibleRequester');

const USER_DISPLAY_SELECT = 'full_name username phone role status';

async function submitCoachRequest(req, res) {
  try {
    if (req.user.role !== 'user') {
      return res.status(400).json({ message: 'Only members can request a coach' });
    }

    const { coachId, message } = req.body;
    if (!coachId) {
      return res.status(400).json({ message: 'Coach ID is required' });
    }

    // Same visibility rules as GET /user/trainers — block pending/rejected applicants by ID.
    const coachFilter = await buildMemberVisibleCoachFilter({ _id: coachId });
    const coach = await User.findOne(coachFilter).select(PUBLIC_COACH_SELECT);
    if (!coach || !isApprovedPublicCoach(coach)) {
      return res.status(404).json({ message: 'Coach not found' });
    }

    const {
      assertCoachMatchesClientGoal,
    } = require('../utils/coachSpecialization');
    const member = await User.findById(req.user._id).select('clientData full_name username').lean();
    const match = assertCoachMatchesClientGoal(member, coach);
    if (!match.ok) {
      return res.status(match.status).json({
        message: match.message,
        code: match.code,
        fitnessGoal: match.fitnessGoal,
        coachSpecializations: match.coachSpecializations,
      });
    }

    const [legacyAssignment, modernAssignment] = await Promise.all([
      CoachAssignment.findOne({ user: req.user._id, status: 'active' }).select('_id'),
      CoachClientAssignment.findOne({ user_id: req.user._id, status: 'active' }).select('_id'),
    ]);
    if (legacyAssignment || modernAssignment) {
      return res.status(400).json({ message: 'You already have an assigned coach' });
    }

    const existingPending = await CoachRequest.findOne({
      user: req.user._id,
      status: 'pending',
    });
    if (existingPending) {
      if (String(existingPending.coach) === String(coachId)) {
        return res.status(400).json({ message: 'You have already requested this coach' });
      }
      return res.status(400).json({
        message: 'You already have a pending request with another coach. Cancel or wait for a response before choosing a different coach.',
      });
    }

    const request = await CoachRequest.create({
      user: req.user._id,
      coach: coachId,
      message: String(message || '').trim(),
      status: 'pending',
    });

    // Notify coach without delaying the member's response.
    Notification.create({
      user: coachId,
      message: `${req.user.full_name || req.user.username} requested you as their coach.`,
      type: 'update',
    }).catch((err) => console.warn('coach request notify:', err.message));

    const populated = await CoachRequest.findById(request._id)
      .populate('coach', PUBLIC_COACH_SELECT)
      .populate('user', USER_DISPLAY_SELECT)
      .lean();

    return res.status(201).json({
      ...populated,
      coach: populated.coach ? formatPublicCoach(populated.coach) : null,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to submit coach request' });
  }
}

async function cancelCoachRequest(req, res) {
  try {
    const request = await CoachRequest.findOne({
      user: req.user._id,
      status: 'pending',
    });

    if (!request) {
      return res.status(404).json({ message: 'No pending coach request to cancel' });
    }

    const coachId = request.coach;
    request.status = 'cancelled';
    request.reviewedAt = new Date();
    await request.save();

    Notification.create({
      user: coachId,
      message: `${req.user.full_name || req.user.username} withdrew their coaching request.`,
      type: 'update',
    }).catch((err) => console.warn('coach withdraw notify:', err.message));

    return res.json({ message: 'Coach request cancelled', cancelled: true });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to cancel coach request' });
  }
}

async function getMyCoachRequest(req, res) {
  try {
    let request = await CoachRequest.findOne({
      user: req.user._id,
      status: { $in: ['pending', 'approved'] },
    })
      .sort({ createdAt: -1 })
      .populate('coach', PUBLIC_COACH_SELECT)
      .populate('fitnessClass', 'title date category')
      .lean();

    // Surface the latest rejection so clients can show "choose another coach"
    // until the member sends a new request.
    if (!request) {
      request = await CoachRequest.findOne({
        user: req.user._id,
        status: 'rejected',
      })
        .sort({ reviewedAt: -1, createdAt: -1 })
        .populate('coach', PUBLIC_COACH_SELECT)
        .populate('fitnessClass', 'title date category')
        .lean();
    }

    if (!request) {
      return res.json(null);
    }

    return res.json({
      ...request,
      coach: request.coach ? formatPublicCoach(request.coach) : null,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load coach request' });
  }
}

async function loadCoachOwnedRequest(requestId, coachId, { pendingOnly = false } = {}) {
  const filter = {
    _id: requestId,
    coach: coachId,
  };
  if (pendingOnly) filter.status = 'pending';

  return CoachRequest.findOne(filter)
    .populate({
      path: 'user',
      select: REQUESTER_USER_SELECT,
      populate: {
        path: 'profile',
        select: REQUESTER_PROFILE_SELECT,
      },
    })
    .populate('fitnessClass', 'title date category')
    .lean();
}

async function getCoachRequests(req, res) {
  try {
    const requests = await CoachRequest.find({
      coach: req.user._id,
      status: 'pending',
    })
      .populate({
        path: 'user',
        select: REQUESTER_USER_SELECT,
        populate: {
          path: 'profile',
          select: REQUESTER_PROFILE_SELECT,
        },
      })
      .sort({ createdAt: -1 })
      .lean();

    return res.json(requests.map(formatCoachRequestForCoach));
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load coach requests' });
  }
}

/**
 * Detailed requester profile for a single incoming request.
 * Authorization: only the coach who owns the request may view it.
 * Opening this endpoint does NOT approve the request.
 */
async function getCoachRequestDetail(req, res) {
  try {
    const request = await loadCoachOwnedRequest(req.params.id, req.user._id);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }
    return res.json(formatCoachRequestForCoach(request));
  } catch (error) {
    return res.status(500).json({ message: 'Unable to load coach request details' });
  }
}

async function approveCoachRequest(req, res) {
  try {
    const { classId } = req.body || {};

    const request = await CoachRequest.findOne({
      _id: req.params.id,
      coach: req.user._id,
      status: 'pending',
    }).populate('user', USER_DISPLAY_SELECT);

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const {
      assertCoachMatchesClientGoal,
    } = require('../utils/coachSpecialization');
    const member = await User.findById(request.user._id || request.user)
      .select('clientData full_name username')
      .lean();
    const coachDoc = await User.findById(req.user._id).select(PUBLIC_COACH_SELECT).lean();
    const match = assertCoachMatchesClientGoal(member, coachDoc);
    if (!match.ok) {
      return res.status(match.status).json({
        message: match.message,
        code: match.code,
      });
    }

    // Validate optional class enrollment BEFORE creating assignments so a bad
    // classId cannot leave a half-committed coach link.
    let fitnessClass = null;
    if (classId) {
      fitnessClass = await FitnessClass.findOne({
        _id: classId,
        coach: req.user._id,
        status: { $in: ['scheduled', 'active'] },
      });
      if (!fitnessClass) {
        return res.status(404).json({ message: 'Group class not found' });
      }
      if (fitnessClass.enrolledStudents.length >= fitnessClass.capacity) {
        return res.status(400).json({ message: 'Selected group is at full capacity' });
      }
    }

    // End any other active assignments for this client (only one active coach)
    await CoachClientAssignment.updateMany(
      { user_id: request.user._id, status: 'active' },
      { $set: { status: 'ended' } }
    );
    await CoachAssignment.updateMany(
      { user: request.user._id, status: 'active' },
      { $set: { status: 'ended' } }
    );

    // Update clientData.assigned_coach_id on client User object
    const clientUser = await User.findById(request.user._id);
    if (clientUser) {
      if (!clientUser.clientData) clientUser.clientData = {};
      clientUser.clientData.assigned_coach_id = req.user._id;
      await clientUser.save();
    }

    // Create/update active assignments in both collections
    const existingAssignment = await CoachAssignment.findOne({
      coach: req.user._id,
      user: request.user._id,
    });
    if (existingAssignment) {
      existingAssignment.status = 'active';
      await existingAssignment.save();
    } else {
      try {
        await CoachAssignment.create({
          coach: req.user._id,
          user: request.user._id,
          status: 'active',
        });
      } catch (createErr) {
        if (createErr?.code !== 11000) throw createErr;
      }
    }

    const existingClientAssignment = await CoachClientAssignment.findOne({
      coach_id: req.user._id,
      user_id: request.user._id,
    });
    if (existingClientAssignment) {
      existingClientAssignment.status = 'active';
      await existingClientAssignment.save();
    } else {
      try {
        await CoachClientAssignment.create({
          coach_id: req.user._id,
          user_id: request.user._id,
          status: 'active',
        });
      } catch (createErr) {
        if (createErr?.code !== 11000) throw createErr;
      }
    }

    if (fitnessClass) {
      const alreadyEnrolled = fitnessClass.enrolledStudents.some(
        (id) => String(id) === String(request.user._id),
      );
      if (!alreadyEnrolled) {
        fitnessClass.enrolledStudents.push(request.user._id);
        await fitnessClass.save();
        await backfillGroupPlanAccess(request.user._id, fitnessClass._id).catch((err) => {
          console.error('backfillGroupPlanAccess approveCoachRequest:', err.message);
        });
      }
      request.fitnessClass = fitnessClass._id;
    }

    request.status = 'approved';
    request.reviewedAt = new Date();
    await request.save();

    // Cancel any other pending coach requests for this client
    await CoachRequest.updateMany(
      { user: request.user._id, status: 'pending', _id: { $ne: request._id } },
      { $set: { status: 'cancelled', reviewedAt: new Date() } }
    );

    await Notification.create({
      user: request.user._id,
      message: fitnessClass
        ? `Your coach request was approved! You are now linked with your coach and have been added to "${fitnessClass.title}".`
        : 'Your coach request was approved! You are now linked with your coach.',
      type: 'coach_assigned',
      data: { coach_id: String(req.user._id), request_id: String(request._id) },
    });

    const populated = await CoachRequest.findById(request._id)
      .populate('user', USER_DISPLAY_SELECT)
      .populate('fitnessClass', 'title date category')
      .lean();

    return res.json(populated);
  } catch (error) {
    console.error('approveCoachRequest:', error.message);
    return res.status(500).json({ message: 'Unable to approve coach request' });
  }
}

async function rejectCoachRequest(req, res) {
  try {
    const request = await CoachRequest.findOne({
      _id: req.params.id,
      coach: req.user._id,
      status: 'pending',
    }).populate('user', USER_DISPLAY_SELECT);

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    request.status = 'rejected';
    request.reviewedAt = new Date();
    await request.save();

    await Notification.create({
      user: request.user._id,
      message: 'Your coach request was not accepted at this time. You may choose another active coach.',
      type: 'coach_request_rejected',
      data: { coach_id: String(req.user._id), request_id: String(request._id) },
    });

    return res.json(request);
  } catch (error) {
    return res.status(500).json({ message: 'Unable to reject coach request' });
  }
}

module.exports = {
  submitCoachRequest,
  cancelCoachRequest,
  getMyCoachRequest,
  getCoachRequests,
  getCoachRequestDetail,
  approveCoachRequest,
  rejectCoachRequest,
};
