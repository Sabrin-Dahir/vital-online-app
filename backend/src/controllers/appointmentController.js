const Appointment = require('../models/Appointment');
const CoachAssignment = require('../models/CoachAssignment');
const CoachClientAssignment = require('../models/CoachClientAssignment');
const FitnessClass = require('../models/FitnessClass');
const Notification = require('../models/Notification');
const User = require('../models/User');
const {
  DEFAULT_WORK_START,
  DEFAULT_WORK_END,
  DEFAULT_DURATION,
  getDayName,
  getDayNameFromDateStr,
  generateSlotTimes,
  parseSlotDateTime,
  parseSlotDateTimeInOffset,
  parseTimezoneOffsetMinutes,
  isValidSlotTime,
  getHoursForDay,
  hhmmToMinutes,
  wallClockHHMM,
} = require('../utils/appointmentSlots');
const { isApprovedPublicCoach } = require('../utils/coachProfile');
const { respondWithCaughtError } = require('../utils/httpErrors');
const { validateDurationMinutes, validateObjectId } = require('../utils/fieldValidation');

function formatDateTime(date) {
  return new Date(date).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getEndTime(dateTime, durationMinutes) {
  return new Date(new Date(dateTime).getTime() + (durationMinutes || 60) * 60000);
}

const BLOCKING_APPOINTMENT_STATUSES = ['pending', 'approved', 'rescheduled', 'confirmed', 'in_progress'];

function coachFilter(coachId) {
  return { $or: [{ coach: coachId }, { coach_id: coachId }] };
}

function clientFilter(clientId) {
  return { $or: [{ client: clientId }, { user_id: clientId }] };
}

function isCoachOwner(appointment, coachId) {
  return String(appointment.coach || appointment.coach_id) === String(coachId);
}

function populateAppointmentQuery(query) {
  return query
    .populate('client', 'username full_name phone avatar')
    .populate('coach', 'username full_name phone avatar')
    .populate('fitnessClass', 'title category')
    .populate('followUpOf', 'dateTime status durationMinutes');
}

async function loadAppointment(id) {
  return populateAppointmentQuery(Appointment.findById(id));
}

function appointmentStart(appt) {
  const raw = appt?.dateTime || appt?.datetime;
  if (!raw) return null;
  const start = new Date(raw);
  return Number.isNaN(start.getTime()) ? null : start;
}

function appointmentDuration(appt, fallback = DEFAULT_DURATION) {
  const duration = appt?.durationMinutes ?? appt?.duration ?? fallback;
  return Number(duration) > 0 ? Number(duration) : fallback;
}

function slotsOverlap(startA, durationA, startB, durationB) {
  const endA = getEndTime(startA, durationA);
  const endB = getEndTime(startB, durationB);
  return startA < endB && startB < endA;
}

async function fetchBlockingAppointments(coachId, { dayBegin, dayEnd } = {}) {
  const query = {
    ...coachFilter(coachId),
    status: { $in: BLOCKING_APPOINTMENT_STATUSES },
  };

  if (dayBegin && dayEnd) {
    query.$and = [
      {
        $or: [
          { dateTime: { $gte: dayBegin, $lte: dayEnd } },
          { datetime: { $gte: dayBegin, $lte: dayEnd } },
        ],
      },
    ];
  }

  return Appointment.find(query)
    .select('dateTime datetime durationMinutes duration')
    .lean();
}

async function hasOverlap(coachId, dateTime, durationMinutes, excludeId = null) {
  const start = new Date(dateTime);
  const existing = await fetchBlockingAppointments(coachId);

  return existing.some((appt) => {
    if (excludeId && String(appt._id) === String(excludeId)) return false;
    const otherStart = appointmentStart(appt);
    if (!otherStart) return false;
    return slotsOverlap(
      start,
      durationMinutes,
      otherStart,
      appointmentDuration(appt, durationMinutes),
    );
  });
}

async function verifyActiveAssignment(clientId, coachId) {
  const [legacy, modern] = await Promise.all([
    CoachAssignment.findOne({ user: clientId, coach: coachId, status: 'active' }),
    CoachClientAssignment.findOne({ user_id: clientId, coach_id: coachId, status: 'active' }),
  ]);
  return legacy || modern || null;
}

async function getActiveCoachIdForClient(clientId) {
  const legacy = await CoachAssignment.findOne({ user: clientId, status: 'active' })
    .select('coach')
    .lean();
  if (legacy?.coach) return legacy.coach;
  const modern = await CoachClientAssignment.findOne({ user_id: clientId, status: 'active' })
    .select('coach_id')
    .lean();
  return modern?.coach_id || null;
}

async function notifyUser(userId, message, type = 'reminder') {
  await Notification.create({ user: userId, message, type });
}

async function requestAppointment(req, res) {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ message: 'Only members can request appointments' });
    }

    const { dateTime, durationMinutes, notes } = req.body;
    if (!dateTime) {
      return res.status(400).json({ message: 'Date and time are required' });
    }

    const coachId = await getActiveCoachIdForClient(req.user._id);
    if (!coachId) {
      return res.status(403).json({ message: 'You need an assigned coach to request an appointment' });
    }

    const parsedDate = new Date(dateTime);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
      return res.status(400).json({ message: 'Appointment must be scheduled in the future' });
    }

    const durationError = validateDurationMinutes(durationMinutes ?? 60);
    if (durationError) return res.status(400).json({ message: durationError });
    const duration = Number(durationMinutes) || 60;

    const availabilityError = await assertWithinCoachAvailability(
      coachId,
      parsedDate,
      duration,
      req.body.timezoneOffsetMinutes,
    );
    if (availabilityError) {
      return res.status(400).json({ message: availabilityError });
    }

    const overlap = await hasOverlap(coachId, parsedDate, duration);
    if (overlap) {
      return res.status(409).json({ message: 'That time slot is already booked. Please choose another time.' });
    }

    const appointment = await Appointment.create({
      client: req.user._id,
      user_id: req.user._id,
      coach: coachId,
      coach_id: coachId,
      dateTime: parsedDate,
      datetime: parsedDate,
      durationMinutes: duration,
      duration,
      notes: String(notes || '').trim(),
      type: 'user_request',
      status: 'pending',
    });

    await notifyUser(
      coachId,
      `${req.user.full_name || req.user.username} requested an appointment for ${formatDateTime(parsedDate)}.`,
      'update',
    );

    const populated = await Appointment.findById(appointment._id)
      .populate('client', 'username full_name phone')
      .populate('coach', 'username full_name phone');
    return res.status(201).json(populated);
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function createCoachAppointment(req, res) {
  try {
    const { enforceCoachSpecialization } = require('../utils/coachSpecialization');
    if (!enforceCoachSpecialization(req, res, { resourceType: 'appointment' })) return;

    const {
      clientId,
      fitnessClassId,
      dateTime,
      durationMinutes,
      notes,
      coachNotes,
      sessionMode,
      meetingLink,
    } = req.body;
    if (!dateTime) {
      return res.status(400).json({ message: 'Date and time are required' });
    }
    if (!clientId && !fitnessClassId) {
      return res.status(400).json({ message: 'Select a user or a group' });
    }
    if (clientId && fitnessClassId) {
      return res.status(400).json({ message: 'Select either a user or a group, not both' });
    }

    const parsedDate = new Date(dateTime);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
      return res.status(400).json({ message: 'Appointment must be scheduled in the future' });
    }

    const durationError = validateDurationMinutes(durationMinutes ?? 60);
    if (durationError) return res.status(400).json({ message: durationError });
    const duration = Number(durationMinutes) || 60;

    if (clientId) {
      const idError = validateObjectId(clientId, 'Client');
      if (idError) return res.status(400).json({ message: idError });
    }
    if (fitnessClassId) {
      const idError = validateObjectId(fitnessClassId, 'Group');
      if (idError) return res.status(400).json({ message: idError });
    }

    const availabilityError = await assertWithinCoachAvailability(
      req.user._id,
      parsedDate,
      duration,
      req.body.timezoneOffsetMinutes,
    );
    if (availabilityError) {
      return res.status(400).json({ message: availabilityError });
    }

    const overlap = await hasOverlap(req.user._id, parsedDate, duration);
    if (overlap) {
      return res.status(409).json({ message: 'That time slot overlaps with another appointment.' });
    }

    const mode = sessionMode === 'online' ? 'online' : 'in_person';
    const link = String(meetingLink || '').trim();
    if (mode === 'online' && link && !/^https?:\/\//i.test(link)) {
      return res.status(400).json({ message: 'Meeting link must be a valid http(s) URL' });
    }

    const baseFields = {
      coach: req.user._id,
      coach_id: req.user._id,
      dateTime: parsedDate,
      datetime: parsedDate,
      durationMinutes: duration,
      duration,
      notes: String(notes || '').trim(),
      coachNotes: String(coachNotes || '').trim(),
      type: 'coach_created',
      status: 'approved',
      sessionMode: mode,
      meetingLink: mode === 'online' ? link : '',
      reminderSent: false,
    };

    if (fitnessClassId) {
      const fitnessClass = await FitnessClass.findOne({
        _id: fitnessClassId,
        coach: req.user._id,
      });
      if (!fitnessClass) {
        return res.status(404).json({ message: 'Group not found' });
      }

      const studentIds = (fitnessClass.enrolledStudents || []).map((id) => String(id));
      if (!studentIds.length) {
        return res.status(400).json({ message: 'This group has no enrolled members' });
      }

      const when = formatDateTime(parsedDate);
      const groupTitle = fitnessClass.title;
      const created = await Appointment.insertMany(
        studentIds.map((studentId) => ({
          ...baseFields,
          client: studentId,
          user_id: studentId,
          fitnessClass: fitnessClassId,
        })),
      );

      try {
        const {
          ensureSessionAttendance,
          ensureGroupAttendance,
        } = require('../utils/attendanceService');
        await Promise.all(
          created.map(async (appt) => {
            await ensureSessionAttendance({
              coachId: req.user._id,
              userId: appt.client,
              appointmentId: appt._id,
              scheduledStart: parsedDate,
              durationMinutes: duration,
            });
            await ensureGroupAttendance({
              coachId: req.user._id,
              userId: appt.client,
              fitnessClassId,
              scheduledStart: parsedDate,
              durationMinutes: duration,
            });
          }),
        );
      } catch (attErr) {
        console.warn('group appointment attendance:', attErr.message);
      }

      await Promise.all(
        studentIds.map((studentId) =>
          notifyUser(
            studentId,
            `Your coach scheduled a group appointment "${groupTitle}" for ${when}.`,
            'reminder',
          ),
        ),
      );

      const populated = await Appointment.find({ _id: { $in: created.map((a) => a._id) } })
        .populate('client', 'username full_name phone')
        .populate('coach', 'username full_name phone')
        .populate('fitnessClass', 'title category');

      return res.status(201).json({
        created: populated.length,
        fitnessClass: { _id: fitnessClass._id, title: fitnessClass.title },
        appointments: populated,
      });
    }

    const assignment = await verifyActiveAssignment(clientId, req.user._id);
    if (!assignment) {
      return res.status(403).json({ message: 'Client is not actively assigned to you' });
    }

    const appointment = await Appointment.create({
      ...baseFields,
      client: clientId,
      user_id: clientId,
    });

    try {
      const { ensureSessionAttendance } = require('../utils/attendanceService');
      await ensureSessionAttendance({
        coachId: req.user._id,
        userId: clientId,
        appointmentId: appointment._id,
        scheduledStart: appointment.dateTime || appointment.datetime || parsedDate,
        durationMinutes: appointment.durationMinutes,
      });
    } catch (attErr) {
      console.warn('appointment attendance:', attErr.message);
    }

    await notifyUser(
      clientId,
      `Your coach scheduled an appointment for ${formatDateTime(parsedDate)}.`,
      'reminder',
    );

    return res.status(201).json(await loadAppointment(appointment._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function getCoachAppointments(req, res) {
  try {
    const appointments = await populateAppointmentQuery(
      Appointment.find(coachFilter(req.user._id)),
    ).sort({ dateTime: -1 });
    return res.json(appointments);
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function getUserAppointments(req, res) {
  try {
    const appointments = await populateAppointmentQuery(
      Appointment.find(clientFilter(req.user._id)),
    ).sort({ dateTime: -1 });
    return res.json(appointments);
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function approveAppointment(req, res) {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!isCoachOwner(appointment, req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (appointment.status !== 'pending' && appointment.status !== 'rescheduled') {
      return res.status(400).json({ message: 'Only pending or rescheduled appointments can be approved' });
    }

    const overlap = await hasOverlap(req.user._id, appointment.dateTime, appointment.durationMinutes, appointment._id);
    if (overlap) {
      return res.status(409).json({ message: 'Cannot approve — time slot overlaps with another appointment.' });
    }

    const { coachNotes, meetingLink, sessionMode } = req.body;
    appointment.status = 'approved';
    if (coachNotes !== undefined) appointment.coachNotes = String(coachNotes).trim();
    if (sessionMode === 'online' || sessionMode === 'in_person') {
      appointment.sessionMode = sessionMode;
    }
    if (meetingLink !== undefined) {
      const link = String(meetingLink || '').trim();
      if (link && !/^https?:\/\//i.test(link)) {
        return res.status(400).json({ message: 'Meeting link must be a valid http(s) URL' });
      }
      appointment.meetingLink = link;
    }
    appointment.reminderSent = false;
    await appointment.save();

    await notifyUser(
      appointment.client,
      `Your appointment on ${formatDateTime(appointment.dateTime)} has been approved.`,
      'update',
    );

    return res.json(await loadAppointment(appointment._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function rejectAppointment(req, res) {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!isCoachOwner(appointment, req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const { coachNotes, rejectionReason } = req.body;
    if (!['pending', 'rescheduled'].includes(appointment.status)) {
      return res.status(400).json({ message: 'Only pending or rescheduled appointments can be rejected' });
    }
    appointment.status = 'rejected';
    if (coachNotes !== undefined) appointment.coachNotes = String(coachNotes).trim();
    if (rejectionReason !== undefined) {
      appointment.rejectionReason = String(rejectionReason || '').trim();
    }
    await appointment.save();

    await notifyUser(
      appointment.client,
      `Your appointment request for ${formatDateTime(appointment.dateTime)} was declined.`,
      'update',
    );

    return res.json(await loadAppointment(appointment._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function rescheduleAppointment(req, res) {
  try {
    const { dateTime, coachNotes, durationMinutes } = req.body;
    if (!dateTime) {
      return res.status(400).json({ message: 'New date and time are required' });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!isCoachOwner(appointment, req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (['completed', 'cancelled', 'rejected'].includes(appointment.status)) {
      return res.status(400).json({ message: 'Cannot reschedule a closed appointment' });
    }

    const parsedDate = new Date(dateTime);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
      return res.status(400).json({ message: 'New appointment time must be in the future' });
    }

    const nextDuration = Number(durationMinutes) > 0
      ? Number(durationMinutes)
      : appointment.durationMinutes || 60;

    const overlap = await hasOverlap(req.user._id, parsedDate, nextDuration, appointment._id);
    if (overlap) {
      return res.status(409).json({ message: 'That time slot overlaps with another appointment.' });
    }

    appointment.rescheduledFrom = appointment.dateTime;
    appointment.dateTime = parsedDate;
    appointment.datetime = parsedDate;
    appointment.durationMinutes = nextDuration;
    appointment.duration = nextDuration;
    appointment.status = 'rescheduled';
    if (coachNotes !== undefined) appointment.coachNotes = String(coachNotes).trim();
    appointment.reminderSent = false;
    appointment.startedAt = null;
    await appointment.save();

    await notifyUser(
      appointment.client,
      `Your appointment has been rescheduled to ${formatDateTime(parsedDate)}.`,
      'update',
    );

    return res.json(await loadAppointment(appointment._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function completeAppointment(req, res) {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!isCoachOwner(appointment, req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (!['approved', 'rescheduled', 'in_progress', 'confirmed'].includes(appointment.status)) {
      return res.status(400).json({
        message: 'Only approved, in-progress, or rescheduled appointments can be completed',
      });
    }

    const start = appointmentStart(appointment);
    if (!start) {
      return res.status(400).json({ message: 'Appointment has no scheduled time' });
    }
    const end = getEndTime(start, appointmentDuration(appointment));
    if (Date.now() < end.getTime()) {
      return res.status(400).json({
        message: 'Cannot complete an appointment before its scheduled end time',
        code: 'APPOINTMENT_NOT_ENDED_YET',
      });
    }

    const { coachNotes } = req.body;
    appointment.status = 'completed';
    appointment.completedAt = new Date();
    if (coachNotes !== undefined) appointment.coachNotes = String(coachNotes).trim();
    await appointment.save();

    try {
      const { syncLinkedSessionAttendance } = require('../utils/attendanceService');
      await syncLinkedSessionAttendance({
        appointmentId: appointment._id,
        status: 'completed',
        markedBy: req.user._id,
      });
    } catch (attErr) {
      console.warn('complete appointment attendance:', attErr.message);
    }

    await notifyUser(
      appointment.client,
      `Your appointment on ${formatDateTime(appointment.dateTime)} has been marked completed.`,
      'update',
    );

    return res.json(await loadAppointment(appointment._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function updateAppointmentNotes(req, res) {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!isCoachOwner(appointment, req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const { coachNotes } = req.body;
    appointment.coachNotes = String(coachNotes || '').trim();
    await appointment.save();

    return res.json(await loadAppointment(appointment._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function startAppointment(req, res) {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!isCoachOwner(appointment, req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (!['approved', 'rescheduled', 'confirmed'].includes(appointment.status)) {
      return res.status(400).json({ message: 'Only approved appointments can be started' });
    }

    const start = appointmentStart(appointment);
    if (!start) {
      return res.status(400).json({ message: 'Appointment has no scheduled time' });
    }
    if (Date.now() < start.getTime()) {
      return res.status(400).json({
        message: 'Cannot start an appointment before its scheduled start time',
        code: 'APPOINTMENT_NOT_STARTED_YET',
      });
    }

    const { meetingLink, sessionMode } = req.body || {};
    if (sessionMode === 'online' || sessionMode === 'in_person') {
      appointment.sessionMode = sessionMode;
    }
    if (meetingLink !== undefined) {
      const link = String(meetingLink || '').trim();
      if (link && !/^https?:\/\//i.test(link)) {
        return res.status(400).json({ message: 'Meeting link must be a valid http(s) URL' });
      }
      appointment.meetingLink = link;
    }
    if (appointment.sessionMode === 'online' && !appointment.meetingLink) {
      return res.status(400).json({ message: 'Add a meeting link before starting an online session' });
    }

    appointment.status = 'in_progress';
    appointment.startedAt = new Date();
    await appointment.save();

    await notifyUser(
      appointment.client,
      appointment.sessionMode === 'online' && appointment.meetingLink
        ? `Your session has started. Join here: ${appointment.meetingLink}`
        : `Your appointment on ${formatDateTime(appointment.dateTime)} is now in progress.`,
      'update',
    );

    return res.json(await loadAppointment(appointment._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function updateMeetingLink(req, res) {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!isCoachOwner(appointment, req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const { meetingLink, sessionMode } = req.body || {};
    if (sessionMode === 'online' || sessionMode === 'in_person') {
      appointment.sessionMode = sessionMode;
    }
    if (meetingLink !== undefined) {
      const link = String(meetingLink || '').trim();
      if (link && !/^https?:\/\//i.test(link)) {
        return res.status(400).json({ message: 'Meeting link must be a valid http(s) URL' });
      }
      appointment.meetingLink = link;
    }
    if (appointment.sessionMode === 'in_person') {
      // Keep link optional for in-person; clear if switching away from online intentionally
      if (sessionMode === 'in_person' && meetingLink === '') {
        appointment.meetingLink = '';
      }
    }
    await appointment.save();

    if (appointment.meetingLink && appointment.client) {
      await notifyUser(
        appointment.client,
        `Meeting link updated for your appointment on ${formatDateTime(appointment.dateTime)}: ${appointment.meetingLink}`,
        'update',
      );
    }

    return res.json(await loadAppointment(appointment._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function addAppointmentAttachment(req, res) {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!isCoachOwner(appointment, req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const { file, name } = req.body || {};
    if (!file) {
      return res.status(400).json({ message: 'Attachment file is required' });
    }

    const { uploadImageDataUrl, isHttpUrl } = require('../utils/imageKit');
    let url = String(file).trim();
    if (!isHttpUrl(url)) {
      url = await uploadImageDataUrl(url, {
        folder: '/vital/appointment-attachments',
        fileNamePrefix: `appt_${appointment._id}`,
        tags: ['appointment', 'attachment'],
      });
    }

    appointment.attachments = appointment.attachments || [];
    appointment.attachments.push({
      url,
      name: String(name || 'Attachment').trim() || 'Attachment',
      uploadedAt: new Date(),
    });
    await appointment.save();

    return res.json(await loadAppointment(appointment._id));
  } catch (error) {
    console.error('addAppointmentAttachment:', error.message);
    if (error.code === 'IMAGEKIT_NOT_CONFIGURED') {
      return res.status(503).json({ message: error.message, code: error.code });
    }
    return res.status(500).json({ message: error.message || 'Unable to upload attachment' });
  }
}

async function createFollowUpAppointment(req, res) {
  try {
    const parent = await Appointment.findById(req.params.id);
    if (!parent) return res.status(404).json({ message: 'Appointment not found' });
    if (!isCoachOwner(parent, req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (!parent.client) {
      return res.status(400).json({ message: 'Follow-up requires a 1-on-1 client appointment' });
    }

    const { dateTime, durationMinutes, notes, coachNotes, sessionMode, meetingLink } = req.body || {};
    if (!dateTime) {
      return res.status(400).json({ message: 'Follow-up date and time are required' });
    }
    const parsedDate = new Date(dateTime);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
      return res.status(400).json({ message: 'Follow-up must be scheduled in the future' });
    }

    const duration = Number(durationMinutes) > 0
      ? Number(durationMinutes)
      : parent.durationMinutes || 60;
    const overlap = await hasOverlap(req.user._id, parsedDate, duration);
    if (overlap) {
      return res.status(409).json({ message: 'That time slot overlaps with another appointment.' });
    }

    const mode = sessionMode === 'online'
      ? 'online'
      : (sessionMode === 'in_person' ? 'in_person' : (parent.sessionMode || 'in_person'));
    const link = meetingLink !== undefined
      ? String(meetingLink || '').trim()
      : (mode === 'online' ? (parent.meetingLink || '') : '');

    const followUp = await Appointment.create({
      coach: req.user._id,
      coach_id: req.user._id,
      client: parent.client,
      user_id: parent.client,
      dateTime: parsedDate,
      datetime: parsedDate,
      durationMinutes: duration,
      duration,
      notes: String(notes || '').trim() || `Follow-up for ${formatDateTime(parent.dateTime)}`,
      coachNotes: String(coachNotes || '').trim(),
      type: 'coach_created',
      status: 'approved',
      sessionMode: mode,
      meetingLink: mode === 'online' ? link : '',
      followUpOf: parent._id,
      reminderSent: false,
    });

    await notifyUser(
      parent.client,
      `Your coach scheduled a follow-up appointment for ${formatDateTime(parsedDate)}.`,
      'reminder',
    );

    return res.status(201).json(await loadAppointment(followUp._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

function effectiveAppointmentDays(profile = {}) {
  const appointmentDays = Array.isArray(profile.appointmentDays) ? profile.appointmentDays : [];
  if (appointmentDays.length > 0) {
    return appointmentDays;
  }
  // Legacy coaches registered before appointmentDays existed.
  return Array.isArray(profile.workingDays) ? profile.workingDays : [];
}

async function getCoachSettings(coachId) {
  const coach = await User.findById(coachId)
    .populate(
      'profile',
      'workingDays appointmentDays workingHoursStart workingHoursEnd appointmentDurationMinutes dayAvailability',
    )
    .lean();
  const profile = coach?.profile || {};
  const dayAvailability = Array.isArray(profile.dayAvailability) ? profile.dayAvailability : [];
  const appointmentDays = effectiveAppointmentDays(profile);
  const synthesizedDayAvailability = dayAvailability.length
    ? dayAvailability
    : appointmentDays.map((day) => ({
        day,
        start: profile.workingHoursStart || DEFAULT_WORK_START,
        end: profile.workingHoursEnd || DEFAULT_WORK_END,
      }));
  return {
    workingDays: Array.isArray(profile.workingDays) ? profile.workingDays : [],
    appointmentDays,
    dayAvailability: synthesizedDayAvailability,
    start: profile.workingHoursStart || DEFAULT_WORK_START,
    end: profile.workingHoursEnd || DEFAULT_WORK_END,
    duration: profile.appointmentDurationMinutes || DEFAULT_DURATION,
  };
}

function hoursForDayName(settings, dayName) {
  return getHoursForDay(settings.dayAvailability, dayName, settings.start, settings.end);
}

function dateStrInOffset(dateTime, timezoneOffsetMinutes = 0) {
  const offset = parseTimezoneOffsetMinutes(timezoneOffsetMinutes) ?? 0;
  const shifted = new Date(new Date(dateTime).getTime() + offset * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

async function assertWithinCoachAvailability(coachId, dateTime, durationMinutes, timezoneOffsetMinutes = 0) {
  const settings = await getCoachSettings(coachId);
  if (!Array.isArray(settings.appointmentDays) || !settings.appointmentDays.length) {
    // Legacy coaches without configured appointment days — skip hours gate.
    return null;
  }
  const dateStr = dateStrInOffset(dateTime, timezoneOffsetMinutes);
  const dayName = getDayNameFromDateStr(dateStr) || getDayName(dateTime);
  if (!settings.appointmentDays.includes(dayName)) {
    return `The coach does not accept appointments on ${dayName}.`;
  }
  const { start, end } = hoursForDayName(settings, dayName);
  const time = wallClockHHMM(dateTime, timezoneOffsetMinutes);
  const startM = hhmmToMinutes(start);
  const endM = hhmmToMinutes(end);
  const slotM = hhmmToMinutes(time);
  const duration = Number(durationMinutes) || settings.duration || DEFAULT_DURATION;
  if (startM == null || endM == null || slotM == null) {
    return 'Appointment time is invalid';
  }
  if (slotM < startM || slotM + duration > endM) {
    return "That time is outside the coach's working hours.";
  }
  return null;
}

// GET available slots for a coach on a specific date (member only).
async function getCoachAvailability(req, res) {
  try {
    const coachId = req.query.coachId || req.params.coachId;
    const dateStr = req.query.date;
    if (!coachId || !dateStr) {
      return res.status(400).json({ message: 'coachId and date are required' });
    }

    const coach = await User.findById(coachId);
    if (!coach || !isApprovedPublicCoach(coach)) {
      return res.status(404).json({ message: 'Coach not found' });
    }

    // Only an actively-assigned client can view a coach's availability.
    const assignment = await verifyActiveAssignment(req.user._id, coachId);
    if (!assignment) {
      return res.status(403).json({ message: 'You can only book with your assigned coach.' });
    }

    const dayStart = parseSlotDateTime(dateStr, '00:00');
    if (!dayStart) {
      return res.status(400).json({ message: 'Invalid date' });
    }

    const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(req.query.timezoneOffsetMinutes) ?? 0;

    const settings = await getCoachSettings(coachId);
    const { appointmentDays } = settings;
    const dayName = getDayNameFromDateStr(dateStr);
    const isWorkingDay = appointmentDays.includes(dayName);

    if (!isWorkingDay) {
      return res.json({
        date: dateStr,
        dayName,
        isWorkingDay: false,
        appointmentDays,
        workingDays: settings.workingDays,
        dayAvailability: settings.dayAvailability,
        workingHoursStart: settings.start,
        workingHoursEnd: settings.end,
        appointmentDurationMinutes: settings.duration,
        slots: [],
      });
    }

    const { start, end } = hoursForDayName(settings, dayName);

    const dayEnd = parseSlotDateTimeInOffset(dateStr, '23:59', timezoneOffsetMinutes);
    const dayBegin = parseSlotDateTimeInOffset(dateStr, '00:00', timezoneOffsetMinutes);
    const booked = await fetchBlockingAppointments(coachId, { dayBegin, dayEnd });

    const now = new Date();
    const slots = generateSlotTimes(start, end, settings.duration).map((time) => {
      const slotDate = parseSlotDateTimeInOffset(dateStr, time, timezoneOffsetMinutes);
      const isPast = slotDate <= now;
      const isBooked = booked.some((appt) => {
        const otherStart = appointmentStart(appt);
        if (!otherStart) return false;
        return slotsOverlap(
          slotDate,
          settings.duration,
          otherStart,
          appointmentDuration(appt, settings.duration),
        );
      });
      return { time, available: !isPast && !isBooked, booked: isBooked, past: isPast };
    });

    const availableSlots = slots.filter((slot) => slot.available);

    return res.json({
      date: dateStr,
      dayName,
      isWorkingDay: true,
      appointmentDays,
      workingDays: settings.workingDays,
      dayAvailability: settings.dayAvailability,
      workingHoursStart: start,
      workingHoursEnd: end,
      appointmentDurationMinutes: settings.duration,
      slots,
      availableCount: availableSlots.length,
    });
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

// POST book a slot-based appointment (member only).
async function bookAppointment(req, res) {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ message: 'Only members can book appointments' });
    }

    const { coachId, date, time, notes, timezoneOffsetMinutes: bodyOffset } = req.body;
    if (!coachId || !date || !time) {
      return res.status(400).json({ message: 'Coach, date and time are required' });
    }

    const coach = await User.findById(coachId);
    if (!coach || !isApprovedPublicCoach(coach)) {
      return res.status(404).json({ message: 'Coach not found' });
    }

    const assignment = await verifyActiveAssignment(req.user._id, coachId);
    if (!assignment) {
      return res.status(403).json({ message: 'You can only book with your assigned coach.' });
    }

    const settings = await getCoachSettings(coachId);
    const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(bodyOffset) ?? 0;

    const slotDate = parseSlotDateTimeInOffset(date, time, timezoneOffsetMinutes);
    if (!slotDate) {
      return res.status(400).json({ message: 'Invalid date or time' });
    }
    if (slotDate <= new Date()) {
      return res.status(400).json({ message: 'You cannot book an appointment in the past.' });
    }

    const { appointmentDays } = settings;
    const dayName = getDayNameFromDateStr(date);
    if (!appointmentDays.includes(dayName)) {
      return res.status(400).json({ message: `The coach does not accept appointments on ${dayName}.` });
    }

    const { start, end } = hoursForDayName(settings, dayName);
    if (!isValidSlotTime(time, start, end, settings.duration)) {
      return res.status(400).json({ message: "That time is outside the coach's working hours." });
    }

    // Prevent the same client booking the same coach + slot twice.
    const duplicate = await Appointment.findOne({
      client: req.user._id,
      coach: coachId,
      dateTime: slotDate,
      status: { $in: ['pending', 'approved', 'rescheduled'] },
    });
    if (duplicate) {
      return res.status(409).json({ message: 'You already have a booking for this time.' });
    }

    // Prevent double booking the coach (overlap with any client's appointment).
    const overlap = await hasOverlap(coachId, slotDate, settings.duration);
    if (overlap) {
      return res.status(409).json({ message: 'That time slot has already been booked. Please choose another.' });
    }

    let appointment;
    try {
      appointment = await Appointment.create({
        client: req.user._id,
        user_id: req.user._id,
        coach: coachId,
        coach_id: coachId,
        dateTime: slotDate,
        datetime: slotDate,
        durationMinutes: settings.duration,
        duration: settings.duration,
        notes: String(notes || '').trim(),
        type: 'user_request',
        status: 'pending',
      });
    } catch (createError) {
      if (createError?.code === 11000) {
        return res.status(409).json({ message: 'That time slot has already been booked. Please choose another.' });
      }
      throw createError;
    }

    await notifyUser(
      coachId,
      `${req.user.full_name || req.user.username || 'A client'} booked an appointment for ${formatDateTime(slotDate)}.`,
      'update',
    );

    const populated = await Appointment.findById(appointment._id)
      .populate('client', 'username full_name phone')
      .populate('coach', 'username full_name phone');
    return res.status(201).json(populated);
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

// PATCH member cancels their own appointment.
async function cancelAppointmentByUser(req, res) {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    const isOwner =
      String(appointment.client || '') === String(req.user._id) ||
      String(appointment.user_id || '') === String(req.user._id);
    if (!isOwner) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (!['pending', 'approved', 'confirmed', 'rescheduled'].includes(appointment.status)) {
      return res.status(400).json({ message: 'This appointment can no longer be cancelled.' });
    }

    appointment.status = 'cancelled';
    await appointment.save();

    try {
      const { syncLinkedSessionAttendance } = require('../utils/attendanceService');
      await syncLinkedSessionAttendance({
        appointmentId: appointment._id,
        status: 'cancelled',
        markedBy: req.user._id,
        force: true,
      });
    } catch (attErr) {
      console.warn('user cancel appointment attendance:', attErr.message);
    }

    await notifyUser(
      appointment.coach || appointment.coach_id,
      `${req.user.full_name || req.user.username || 'A client'} cancelled their appointment on ${formatDateTime(appointment.dateTime)}.`,
      'update',
    );

    return res.json(await loadAppointment(appointment._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

// PATCH coach cancels an appointment.
async function cancelAppointmentByCoach(req, res) {
  try {
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!isCoachOwner(appointment, req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    if (['completed', 'cancelled', 'rejected'].includes(appointment.status)) {
      return res.status(400).json({ message: 'This appointment can no longer be cancelled.' });
    }

    const { coachNotes } = req.body || {};
    appointment.status = 'cancelled';
    if (coachNotes !== undefined) appointment.coachNotes = String(coachNotes).trim();
    await appointment.save();

    try {
      const { syncLinkedSessionAttendance } = require('../utils/attendanceService');
      await syncLinkedSessionAttendance({
        appointmentId: appointment._id,
        status: 'cancelled',
        markedBy: req.user._id,
        force: true,
      });
    } catch (attErr) {
      console.warn('coach cancel appointment attendance:', attErr.message);
    }

    await notifyUser(
      appointment.client,
      `Your appointment on ${formatDateTime(appointment.dateTime)} was cancelled by your coach.`,
      'update',
    );

    return res.json(await loadAppointment(appointment._id));
  } catch (error) {
    return respondWithCaughtError(res, error);
  }
}

async function processAppointmentReminders() {
  try {
    const now = new Date();
    const appointments = await Appointment.find({
      status: { $in: ['approved', 'rescheduled', 'confirmed'] },
      $or: [{ reminderSent: false }, { reminderSent: { $exists: false } }],
      dateTime: { $gt: now },
    }).select('client coach dateTime reminderMinutesBefore reminderSent');

    for (const appt of appointments) {
      const reminderAt = new Date(
        appt.dateTime.getTime() - (appt.reminderMinutesBefore || 30) * 60000,
      );
      if (now >= reminderAt) {
        const when = formatDateTime(appt.dateTime);
        const mins = appt.reminderMinutesBefore || 30;
        await notifyUser(
          appt.client,
          `Reminder: Your appointment starts in ${mins} minutes (${when}).`,
          'reminder',
        );
        await notifyUser(
          appt.coach,
          `Reminder: You have an appointment in ${mins} minutes (${when}).`,
          'reminder',
        );
        appt.reminderSent = true;
        await appt.save();
      }
    }
  } catch (error) {
    console.error('processAppointmentReminders:', error.message);
  }
}

module.exports = {
  requestAppointment,
  createCoachAppointment,
  getCoachAppointments,
  getUserAppointments,
  approveAppointment,
  rejectAppointment,
  rescheduleAppointment,
  completeAppointment,
  updateAppointmentNotes,
  startAppointment,
  updateMeetingLink,
  addAppointmentAttachment,
  createFollowUpAppointment,
  processAppointmentReminders,
  getCoachAvailability,
  bookAppointment,
  cancelAppointmentByUser,
  cancelAppointmentByCoach,
};
