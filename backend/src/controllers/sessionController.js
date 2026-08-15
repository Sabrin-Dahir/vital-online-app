const Session = require('../models/Session');
const CoachAssignment = require('../models/CoachAssignment');
const CoachClientAssignment = require('../models/CoachClientAssignment');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { isApprovedPublicCoach } = require('../utils/coachProfile');
const { USER_DISPLAY_SELECT, withDisplayName } = require('../utils/userDisplay');

function userId(user) {
  return user?._id || user?.id;
}

function formatWhen(date) {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function verifyActiveAssignment(clientId, coachId) {
  const [legacy, modern] = await Promise.all([
    CoachAssignment.findOne({ user: clientId, coach: coachId, status: 'active' }),
    CoachClientAssignment.findOne({ user_id: clientId, coach_id: coachId, status: 'active' }),
  ]);
  return legacy || modern || null;
}

async function notify(userIdValue, message, type = 'update') {
  if (!userIdValue) return;
  await Notification.create({ user: userIdValue, message, type });
}

function populateSession(query) {
  return query.populate('client', USER_DISPLAY_SELECT).populate('coach', USER_DISPLAY_SELECT);
}

async function loadSession(id) {
  const session = await populateSession(Session.findById(id));
  if (!session) return null;
  const obj = session.toObject();
  obj.client = withDisplayName(obj.client);
  obj.coach = withDisplayName(obj.coach);
  return obj;
}

function isCoachOwner(session, coachId) {
  return String(session.coach) === String(coachId);
}

function isClientOwner(session, clientId) {
  return String(session.client) === String(clientId);
}

function validateMeetingLink(link) {
  const value = String(link || '').trim();
  if (value && !/^https?:\/\//i.test(value)) {
    return { ok: false, message: 'Meeting link must be a valid http(s) URL' };
  }
  return { ok: true, value };
}

async function hasSessionOverlap(coachId, date, durationMinutes, excludeId = null) {
  const start = new Date(date);
  if (Number.isNaN(start.getTime())) return false;
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : 60;
  const end = new Date(start.getTime() + duration * 60000);
  const existing = await Session.find({
    coach: coachId,
    status: { $in: ['pending', 'confirmed', 'rescheduled', 'in_progress'] },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).select('date durationMinutes');

  return existing.some((row) => {
    const otherStart = new Date(row.date);
    if (Number.isNaN(otherStart.getTime())) return false;
    const otherEnd = new Date(
      otherStart.getTime() + (Number(row.durationMinutes) > 0 ? Number(row.durationMinutes) : 60) * 60000,
    );
    return start < otherEnd && otherStart < end;
  });
}

/** POST /api/session — coach creates 1-on-1; user may request (legacy). */
exports.bookSession = async (req, res) => {
  try {
    if (req.user.role === 'coach') {
      const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
      if (!enforceCoachSpecialization(req, res, { resourceType: 'session' })) return;
    }

    const {
      coachId,
      clientId,
      date,
      durationMinutes,
      notes,
      coachNotes,
      sessionMode,
      meetingLink,
    } = req.body || {};

    if (req.user.role === 'user' && !coachId) {
      return res.status(400).json({ message: 'Coach ID and date are required' });
    }
    if (req.user.role === 'coach' && !clientId) {
      return res.status(400).json({ message: 'Client ID and date are required' });
    }
    if (!date) {
      return res.status(400).json({ message: 'Date is required' });
    }

    const me = userId(req.user);
    const client = req.user.role === 'coach' ? clientId : me;
    const coach = req.user.role === 'coach' ? me : coachId;
    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
      return res.status(400).json({ message: 'Session must be scheduled in the future' });
    }

    if (req.user.role === 'user') {
      const coachUser = await User.findById(coach);
      if (!coachUser || !isApprovedPublicCoach(coachUser)) {
        return res.status(404).json({ message: 'Coach not found' });
      }
    }

    const assignment = await verifyActiveAssignment(client, coach);
    if (!assignment) {
      return res.status(403).json({ message: 'Sessions are only available with your assigned coach' });
    }

    const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : 60;
    if (await hasSessionOverlap(coach, parsedDate, duration)) {
      return res.status(409).json({ message: 'That time overlaps with another 1-on-1 session.' });
    }

    const mode = sessionMode === 'online' ? 'online' : 'in_person';
    const linkCheck = validateMeetingLink(meetingLink);
    if (!linkCheck.ok) return res.status(400).json({ message: linkCheck.message });

    // Coach-created sessions are confirmed immediately; user requests stay pending.
    const status = req.user.role === 'coach' ? 'confirmed' : 'pending';

    const session = await Session.create({
      client,
      coach,
      date: parsedDate,
      durationMinutes: duration,
      notes: String(notes || '').trim(),
      coachNotes: String(coachNotes || '').trim(),
      sessionMode: mode,
      meetingLink: mode === 'online' ? linkCheck.value : '',
      status,
    });

    try {
      const { ensureSessionAttendance } = require('../utils/attendanceService');
      await ensureSessionAttendance({
        coachId: coach,
        userId: client,
        sessionId: session._id,
        scheduledStart: parsedDate,
        durationMinutes: duration,
      });
    } catch (attErr) {
      console.warn('session attendance:', attErr.message);
    }

    if (req.user.role === 'coach') {
      await notify(
        client,
        `Your coach scheduled a 1-on-1 session for ${formatWhen(parsedDate)}.`,
        'reminder',
      );
    } else {
      await notify(
        coach,
        `${req.user.full_name || req.user.username || 'A client'} requested a 1-on-1 session for ${formatWhen(parsedDate)}.`,
        'update',
      );
    }

    return res.status(201).json(await loadSession(session._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/** GET /api/session — coach sees own sessions; user sees own sessions. */
exports.getSessions = async (req, res) => {
  try {
    const me = userId(req.user);
    const query = {};
    if (req.user.role === 'coach') {
      query.coach = me;
    } else if (req.user.role === 'user') {
      query.client = me;
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const sessions = await populateSession(Session.find(query)).sort({ date: -1 });
    const isMember = req.user.role === 'user';
    return res.json(
      sessions.map((row) => {
        const obj = row.toObject();
        obj.client = withDisplayName(obj.client);
        obj.coach = withDisplayName(obj.coach);
        if (isMember && obj.status !== 'completed') {
          delete obj.coachNotes;
        }
        return obj;
      }),
    );
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/** PATCH /api/session/:id/status — legacy status update (kept). */
exports.updateSessionStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    const allowed = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled', 'no_show'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid session status' });
    }

    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const me = String(userId(req.user));
    if (
      req.user.role !== 'admin' &&
      String(session.coach) !== me &&
      String(session.client) !== me
    ) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Clients may only cancel; coaches/admins manage the rest.
    if (req.user.role === 'user' && status !== 'cancelled') {
      return res.status(403).json({ message: 'Members can only cancel their sessions' });
    }
    if (req.user.role === 'user' && status === 'cancelled' && session.status === 'in_progress') {
      return res.status(400).json({ message: 'Cannot cancel a session that is already in progress' });
    }
    if (status === 'completed' || status === 'in_progress') {
      if (req.user.role === 'user') {
        return res.status(403).json({ message: 'Only coaches can start or complete sessions' });
      }
      if (status === 'in_progress' && !sessionStartReached(session)) {
        return res.status(400).json({
          message: 'Cannot start a 1-on-1 session before its scheduled start time',
          code: 'SESSION_NOT_STARTED_YET',
        });
      }
      if (status === 'completed' && !sessionEndReached(session)) {
        return res.status(400).json({
          message: 'Cannot complete a 1-on-1 session before its scheduled end time',
          code: 'SESSION_NOT_ENDED_YET',
        });
      }
      if (status === 'completed' && !['confirmed', 'rescheduled', 'in_progress'].includes(session.status)) {
        return res.status(400).json({ message: 'Only active sessions can be completed' });
      }
      if (status === 'in_progress' && !['confirmed', 'rescheduled'].includes(session.status)) {
        return res.status(400).json({ message: 'Only confirmed sessions can be started' });
      }
    }

    session.status = status;
    if (status === 'in_progress' && !session.startedAt) session.startedAt = new Date();
    if (status === 'completed') session.completedAt = new Date();
    await session.save();

    if (['completed', 'cancelled', 'no_show'].includes(status)) {
      try {
        const { syncLinkedSessionAttendance } = require('../utils/attendanceService');
        await syncLinkedSessionAttendance({
          sessionId: session._id,
          status,
          markedBy: req.user._id,
        });
      } catch (attErr) {
        console.warn('session status attendance sync:', attErr.message);
      }
    }

    const other = String(session.coach) === me ? session.client : session.coach;
    await notify(other, `1-on-1 session on ${formatWhen(session.date)} is now ${status.replace('_', ' ')}.`, 'update');

    return res.json(await loadSession(session._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.confirmSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!isCoachOwner(session, userId(req.user))) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (!['pending', 'rescheduled'].includes(session.status)) {
      return res.status(400).json({ message: 'Only pending or rescheduled sessions can be confirmed' });
    }

    const { coachNotes, sessionMode, meetingLink } = req.body || {};
    session.status = 'confirmed';
    if (coachNotes !== undefined) session.coachNotes = String(coachNotes).trim();
    if (sessionMode === 'online' || sessionMode === 'in_person') session.sessionMode = sessionMode;
    if (meetingLink !== undefined) {
      const linkCheck = validateMeetingLink(meetingLink);
      if (!linkCheck.ok) return res.status(400).json({ message: linkCheck.message });
      session.meetingLink = linkCheck.value;
    }
    await session.save();
    await notify(session.client, `Your 1-on-1 session on ${formatWhen(session.date)} was confirmed.`, 'update');
    return res.json(await loadSession(session._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.rescheduleSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!isCoachOwner(session, userId(req.user))) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (['completed', 'cancelled', 'no_show'].includes(session.status)) {
      return res.status(400).json({ message: 'This session can no longer be rescheduled' });
    }

    const { date, coachNotes } = req.body || {};
    if (!date) return res.status(400).json({ message: 'New date/time is required' });
    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
      return res.status(400).json({ message: 'Reschedule time must be in the future' });
    }
    if (await hasSessionOverlap(userId(req.user), parsedDate, session.durationMinutes, session._id)) {
      return res.status(409).json({ message: 'That time overlaps with another 1-on-1 session.' });
    }

    session.rescheduledFrom = session.date;
    session.date = parsedDate;
    session.status = 'rescheduled';
    if (coachNotes !== undefined) session.coachNotes = String(coachNotes).trim();
    await session.save();
    await notify(
      session.client,
      `Your 1-on-1 session was rescheduled to ${formatWhen(parsedDate)}.`,
      'update',
    );
    return res.json(await loadSession(session._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

function sessionStartReached(session, now = new Date()) {
  const start = new Date(session.date);
  if (Number.isNaN(start.getTime())) return false;
  return now.getTime() >= start.getTime();
}

function sessionEndReached(session, now = new Date()) {
  const start = new Date(session.date);
  if (Number.isNaN(start.getTime())) return false;
  const duration = Number(session.durationMinutes);
  const minutes = Number.isFinite(duration) && duration > 0 ? duration : 60;
  const end = new Date(start.getTime() + minutes * 60 * 1000);
  return now.getTime() >= end.getTime();
}

exports.startSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!isCoachOwner(session, userId(req.user))) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (!['confirmed', 'rescheduled'].includes(session.status)) {
      return res.status(400).json({ message: 'Only confirmed sessions can be started' });
    }
    if (!sessionStartReached(session)) {
      return res.status(400).json({
        message: 'Cannot start a 1-on-1 session before its scheduled start time',
        code: 'SESSION_NOT_STARTED_YET',
      });
    }

    const { meetingLink, sessionMode } = req.body || {};
    if (sessionMode === 'online' || sessionMode === 'in_person') session.sessionMode = sessionMode;
    if (meetingLink !== undefined) {
      const linkCheck = validateMeetingLink(meetingLink);
      if (!linkCheck.ok) return res.status(400).json({ message: linkCheck.message });
      session.meetingLink = linkCheck.value;
    }
    if (session.sessionMode === 'online' && !session.meetingLink) {
      return res.status(400).json({ message: 'Add a meeting link before starting an online session' });
    }

    session.status = 'in_progress';
    session.startedAt = new Date();
    await session.save();

    await notify(
      session.client,
      session.sessionMode === 'online' && session.meetingLink
        ? `Your 1-on-1 session has started. Join here: ${session.meetingLink}`
        : `Your 1-on-1 session on ${formatWhen(session.date)} is now in progress.`,
      'update',
    );
    return res.json(await loadSession(session._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateMeetingLink = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!isCoachOwner(session, userId(req.user))) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const { meetingLink, sessionMode } = req.body || {};
    if (sessionMode === 'online' || sessionMode === 'in_person') session.sessionMode = sessionMode;
    if (meetingLink !== undefined) {
      const linkCheck = validateMeetingLink(meetingLink);
      if (!linkCheck.ok) return res.status(400).json({ message: linkCheck.message });
      session.meetingLink = linkCheck.value;
    }
    await session.save();

    if (session.meetingLink) {
      await notify(
        session.client,
        `Meeting link updated for your 1-on-1 on ${formatWhen(session.date)}: ${session.meetingLink}`,
        'update',
      );
    }
    return res.json(await loadSession(session._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.completeSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!isCoachOwner(session, userId(req.user))) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (!['confirmed', 'rescheduled', 'in_progress'].includes(session.status)) {
      return res.status(400).json({ message: 'Only active sessions can be completed' });
    }
    if (!sessionEndReached(session)) {
      return res.status(400).json({
        message: 'Cannot complete a 1-on-1 session before its scheduled end time',
        code: 'SESSION_NOT_ENDED_YET',
      });
    }

    const { coachNotes } = req.body || {};
    session.status = 'completed';
    session.completedAt = new Date();
    if (coachNotes !== undefined) session.coachNotes = String(coachNotes).trim();
    await session.save();
    try {
      const { syncLinkedSessionAttendance } = require('../utils/attendanceService');
      await syncLinkedSessionAttendance({
        sessionId: session._id,
        status: 'completed',
        markedBy: req.user._id,
      });
    } catch (attErr) {
      console.warn('complete session attendance:', attErr.message);
    }
    await notify(session.client, `Your 1-on-1 session on ${formatWhen(session.date)} was marked completed.`, 'update');
    return res.json(await loadSession(session._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.cancelSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const me = userId(req.user);
    const coachOwned = isCoachOwner(session, me);
    const clientOwned = isClientOwner(session, me);
    if (!coachOwned && !clientOwned && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (['completed', 'cancelled', 'no_show'].includes(session.status)) {
      return res.status(400).json({ message: 'This session is already closed' });
    }
    if (clientOwned && !coachOwned && session.status === 'in_progress') {
      return res.status(400).json({ message: 'Cannot cancel a session that is already in progress' });
    }

    const { coachNotes } = req.body || {};
    session.status = 'cancelled';
    if (coachOwned && coachNotes !== undefined) session.coachNotes = String(coachNotes).trim();
    await session.save();

    try {
      const { syncLinkedSessionAttendance } = require('../utils/attendanceService');
      await syncLinkedSessionAttendance({
        sessionId: session._id,
        status: 'cancelled',
        markedBy: req.user._id,
        force: true,
      });
    } catch (attErr) {
      console.warn('cancel session attendance:', attErr.message);
    }

    const other = coachOwned ? session.client : session.coach;
    await notify(
      other,
      `The 1-on-1 session on ${formatWhen(session.date)} was cancelled.`,
      'update',
    );
    return res.json(await loadSession(session._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateSessionNotes = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!isCoachOwner(session, userId(req.user))) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    const { coachNotes, notes } = req.body || {};
    if (coachNotes !== undefined) session.coachNotes = String(coachNotes).trim();
    if (notes !== undefined) session.notes = String(notes).trim();
    await session.save();
    return res.json(await loadSession(session._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/** PATCH /api/session/:id — edit session details without changing status flow. */
exports.updateSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!isCoachOwner(session, userId(req.user))) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (['cancelled', 'no_show'].includes(session.status)) {
      return res.status(400).json({ message: 'Cancelled sessions cannot be edited' });
    }

    const {
      date,
      durationMinutes,
      notes,
      coachNotes,
      sessionMode,
      meetingLink,
    } = req.body || {};

    if (date !== undefined) {
      const parsedDate = new Date(date);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: 'Invalid date/time' });
      }
      if (parsedDate.getTime() !== new Date(session.date).getTime()) {
        if (parsedDate <= new Date() && session.status !== 'in_progress' && session.status !== 'completed') {
          return res.status(400).json({ message: 'Session time must be in the future' });
        }
        const duration = Number(durationMinutes) > 0
          ? Number(durationMinutes)
          : session.durationMinutes || 60;
        if (await hasSessionOverlap(userId(req.user), parsedDate, duration, session._id)) {
          return res.status(409).json({ message: 'That time overlaps with another 1-on-1 session.' });
        }
        session.date = parsedDate;
      }
    }

    if (durationMinutes !== undefined) {
      const duration = Number(durationMinutes);
      if (!(duration > 0)) {
        return res.status(400).json({ message: 'Duration must be a positive number' });
      }
      session.durationMinutes = duration;
    }
    if (notes !== undefined) session.notes = String(notes).trim();
    if (coachNotes !== undefined) session.coachNotes = String(coachNotes).trim();
    if (sessionMode === 'online' || sessionMode === 'in_person') {
      session.sessionMode = sessionMode;
    }
    if (meetingLink !== undefined) {
      const linkCheck = validateMeetingLink(meetingLink);
      if (!linkCheck.ok) return res.status(400).json({ message: linkCheck.message });
      session.meetingLink = session.sessionMode === 'online' ? linkCheck.value : (linkCheck.value || '');
    }
    if (session.sessionMode === 'in_person' && meetingLink === '') {
      session.meetingLink = '';
    }

    await session.save();
    await notify(
      session.client,
      `Your coach updated the 1-on-1 session on ${formatWhen(session.date)}.`,
      'update',
    );
    return res.json(await loadSession(session._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/** DELETE /api/session/:id — coach removes a closed session, or cancels an open one. */
exports.deleteSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!isCoachOwner(session, userId(req.user)) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    if (['pending', 'confirmed', 'rescheduled', 'in_progress'].includes(session.status)) {
      session.status = 'cancelled';
      await session.save();
      await notify(
        session.client,
        `The 1-on-1 session on ${formatWhen(session.date)} was cancelled.`,
        'update',
      );
      return res.json(await loadSession(session._id));
    }

    await Session.deleteOne({ _id: session._id });
    return res.json({ message: 'Session deleted', id: String(session._id) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.addSessionAttachment = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!isCoachOwner(session, userId(req.user))) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const { file, name } = req.body || {};
    if (!file) return res.status(400).json({ message: 'Attachment file is required' });

    const { uploadImageDataUrl, isHttpUrl } = require('../utils/imageKit');
    let url = String(file).trim();
    if (!isHttpUrl(url)) {
      url = await uploadImageDataUrl(url, {
        folder: '/vital/session-attachments',
        fileNamePrefix: `session_${session._id}`,
        tags: ['session', 'attachment'],
      });
    }

    session.attachments = session.attachments || [];
    session.attachments.push({
      url,
      name: String(name || 'Attachment').trim() || 'Attachment',
      uploadedAt: new Date(),
    });
    await session.save();
    return res.json(await loadSession(session._id));
  } catch (error) {
    console.error('addSessionAttachment:', error.message);
    if (error.code === 'IMAGEKIT_NOT_CONFIGURED') {
      return res.status(503).json({ message: error.message, code: error.code });
    }
    return res.status(500).json({ message: error.message || 'Unable to upload attachment' });
  }
};

exports.createFollowUpSession = async (req, res) => {
  try {
    const parent = await Session.findById(req.params.id);
    if (!parent) return res.status(404).json({ message: 'Session not found' });
    if (!isCoachOwner(parent, userId(req.user))) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    const stillAssigned = await verifyActiveAssignment(parent.client, parent.coach);
    if (!stillAssigned) {
      return res.status(400).json({ message: 'This client is no longer assigned to you' });
    }

    const { date, durationMinutes, notes, coachNotes, sessionMode, meetingLink } = req.body || {};
    if (!date) return res.status(400).json({ message: 'Follow-up date/time is required' });
    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
      return res.status(400).json({ message: 'Follow-up must be scheduled in the future' });
    }

    const duration = Number(durationMinutes) > 0
      ? Number(durationMinutes)
      : parent.durationMinutes || 60;
    if (await hasSessionOverlap(userId(req.user), parsedDate, duration)) {
      return res.status(409).json({ message: 'That time overlaps with another 1-on-1 session.' });
    }

    const mode = sessionMode === 'online'
      ? 'online'
      : (sessionMode === 'in_person' ? 'in_person' : (parent.sessionMode || 'in_person'));
    const linkCheck = validateMeetingLink(
      meetingLink !== undefined ? meetingLink : (mode === 'online' ? parent.meetingLink : ''),
    );
    if (!linkCheck.ok) return res.status(400).json({ message: linkCheck.message });

    const followUp = await Session.create({
      client: parent.client,
      coach: parent.coach,
      date: parsedDate,
      durationMinutes: duration,
      notes: String(notes || '').trim() || `Follow-up for ${formatWhen(parent.date)}`,
      coachNotes: String(coachNotes || '').trim(),
      sessionMode: mode,
      meetingLink: mode === 'online' ? linkCheck.value : '',
      status: 'confirmed',
      followUpOf: parent._id,
    });

    await notify(
      parent.client,
      `Your coach scheduled a follow-up 1-on-1 for ${formatWhen(parsedDate)}.`,
      'reminder',
    );
    return res.status(201).json(await loadSession(followUp._id));
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
