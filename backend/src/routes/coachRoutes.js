const express = require('express');
const {
  createFeedback,
  getClientDetail,
  getClients,
  updateClientPlan,
  assignArticle,
  removeArticle,
  deleteAssignment,
  updateAssignment,
  createNotification,
  getNotifications,
  createSchedule,
  getSchedules,
  getExerciseLibrary,
  getPendingActivities,
  updateActivityStatus,
  getPendingWorkoutSubmissions,
  reviewWorkoutSubmission,
  getCoachReports,
  getClasses,
  getClassDetail,
  createClass,
  updateClass,
  deleteClass,
  enrollStudent,
  unenrollStudent,
  changeClientGroup,
  markAttendance,
} = require('../controllers/coachController');
const {
  getCoachRequests,
  getCoachRequestDetail,
  approveCoachRequest,
  rejectCoachRequest,
} = require('../controllers/coachRequestController');
const {
  createWorkoutTemplate,
  getWorkoutTemplates,
  getWorkoutTemplateById,
  updateWorkoutTemplate,
  deleteWorkoutTemplate,
  getWorkoutPresets,
} = require('../controllers/workoutTemplateController');
const {
  createWeeklyWorkoutPlan,
  getCoachWeeklyWorkoutPlans,
  updateWeeklyWorkoutPlan,
  deleteWeeklyWorkoutPlan,
} = require('../controllers/weeklyWorkoutPlanController');
const {
  createWorkoutSchedule,
  getCoachWorkoutSchedules,
  getWorkoutScheduleById,
  updateWorkoutSchedule,
  deleteWorkoutSchedule,
} = require('../controllers/workoutScheduleController');
const {
  createExercisePlan,
  getExercisePlans,
  getGroupExercisePlans,
  getExercisePlanById,
  updateExercisePlan,
  deleteExercisePlan,
  getClientWorkoutProgress,
  getGroupWorkoutProgress,
  sendWorkoutReminder,
} = require('../controllers/workoutPlanController');
const {
  createCoachAppointment,
  getCoachAppointments,
  approveAppointment,
  rejectAppointment,
  rescheduleAppointment,
  completeAppointment,
  updateAppointmentNotes,
  startAppointment,
  updateMeetingLink,
  addAppointmentAttachment,
  createFollowUpAppointment,
  cancelAppointmentByCoach,
} = require('../controllers/appointmentController');
const {
  createOrUpdateDietPlan,
  getCoachDietPlans,
  getDietPlanCompletions,
  getDietPlanById,
  getClientDietPlan,
  getGroupDietPlan,
  getGroupDietProgress,
  updateDietPlanById,
  archiveDietPlan,
  sendDietPlanAgain,
  getClientDietProgress,
  markClientAdherence,
  sendMealReminders,
  sendGroupMealReminders,
} = require('../controllers/dietPlanController');
const {
  getCoachAttendance,
  getCoachAttendanceSummary,
  getAttendanceByClients,
  getAttendanceByGroups,
  getGroupAttendance,
  getClientAttendance,
  updateAttendance,
  createOrMarkAttendance,
} = require('../controllers/attendanceController');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');
const requireApprovedCoach = require('../middleware/requireApprovedCoach');
const { body, param } = require('express-validator');
const { handleValidation } = require('../middleware/validateRequest');

const router = express.Router();

router.use(auth, roles('coach'), requireApprovedCoach);

const objectIdParam = (name, label) =>
  param(name).isMongoId().withMessage(`${label} is invalid`);

router.get('/appointments', getCoachAppointments);
router.post(
  '/appointments',
  [
    body('dateTime').notEmpty().withMessage('Date and time are required'),
    body('durationMinutes').optional().isInt({ min: 5, max: 240 }).withMessage('Appointment duration must be between 5 and 240 minutes'),
    body('clientId').optional().isMongoId().withMessage('Client is invalid'),
    body('fitnessClassId').optional().isMongoId().withMessage('Group is invalid'),
    handleValidation,
  ],
  createCoachAppointment,
);
router.patch('/appointments/:id/approve', approveAppointment);
router.patch('/appointments/:id/reject', rejectAppointment);
router.patch('/appointments/:id/reschedule', rescheduleAppointment);
router.patch('/appointments/:id/start', startAppointment);
router.patch('/appointments/:id/meeting-link', updateMeetingLink);
router.patch('/appointments/:id/complete', completeAppointment);
router.patch('/appointments/:id/cancel', cancelAppointmentByCoach);
router.patch('/appointments/:id/notes', updateAppointmentNotes);
router.post('/appointments/:id/attachments', addAppointmentAttachment);
router.post('/appointments/:id/follow-up', createFollowUpAppointment);

router.get('/requests', getCoachRequests);
router.get('/requests/:id', [
  objectIdParam('id', 'Request'),
  handleValidation,
], getCoachRequestDetail);
router.patch('/requests/:id/approve', approveCoachRequest);
router.patch('/requests/:id/reject', rejectCoachRequest);
router.get('/clients', getClients);
router.get('/clients/:id', getClientDetail);
router.patch('/clients/:id', updateAssignment);
router.patch('/clients/:id/group', changeClientGroup);
router.delete('/clients/:id', deleteAssignment);
router.post('/feedback', createFeedback);
router.put('/clients/plan', updateClientPlan);
router.post('/clients/assign-article', assignArticle);
router.post('/clients/remove-article', removeArticle);

router.get('/workout-templates', getWorkoutTemplates);
router.get('/workout-presets', getWorkoutPresets);
router.post('/workout-templates', [
  body('title').trim().notEmpty().withMessage('Workout title is required'),
  body('exercises').isArray({ min: 1 }).withMessage('At least one exercise is required'),
  handleValidation,
], createWorkoutTemplate);
router.get('/workout-templates/:id', getWorkoutTemplateById);
router.put('/workout-templates/:id', updateWorkoutTemplate);
router.delete('/workout-templates/:id', deleteWorkoutTemplate);

router.get('/weekly-workout-plans', getCoachWeeklyWorkoutPlans);
router.post('/weekly-workout-plans', createWeeklyWorkoutPlan);
router.put('/weekly-workout-plans/:id', updateWeeklyWorkoutPlan);
router.delete('/weekly-workout-plans/:id', deleteWeeklyWorkoutPlan);

router.post('/workout-schedules', [
  body('workoutTemplateId').isMongoId().withMessage('Workout template is required'),
  body('startDateTime').notEmpty().withMessage('Start time is required'),
  body('endDateTime').notEmpty().withMessage('End time is required'),
  handleValidation,
], createWorkoutSchedule);
router.get('/workout-schedules', getCoachWorkoutSchedules);
router.get('/workout-schedules/:id', getWorkoutScheduleById);
router.put('/workout-schedules/:id', updateWorkoutSchedule);
router.delete('/workout-schedules/:id', deleteWorkoutSchedule);

router.post('/exercise-plans', [
  body('exercises').isArray({ min: 1 }).withMessage('At least one exercise is required'),
  body('title').optional().isLength({ max: 120 }).withMessage('Workout title is too long'),
  handleValidation,
], createExercisePlan);
router.get('/exercise-plans/groups/:classId/progress', getGroupWorkoutProgress);
router.get('/exercise-plans/groups/:classId', getGroupExercisePlans);
router.get('/exercise-plans/client/:clientId/progress', getClientWorkoutProgress);
router.get('/exercise-plans/client/:clientId', getExercisePlans);
router.get('/exercise-plans/:clientId', getExercisePlans);
router.get('/exercise-plans/detail/:planId', getExercisePlanById);
router.put('/exercise-plans/:planId', updateExercisePlan);
router.delete('/exercise-plans/:planId', deleteExercisePlan);
router.post('/exercise-plans/:planId/reminder', sendWorkoutReminder);

router.get('/diet-plans/completions', getDietPlanCompletions);
router.get('/diet-plans/groups/:classId/progress', getGroupDietProgress);
router.get('/diet-plans/groups/:classId', getGroupDietPlan);
router.get('/diet-plans', getCoachDietPlans);
router.get('/diet-plans/client/:clientId', getClientDietPlan);
router.get('/diet-plans/client/:clientId/progress', getClientDietProgress);
router.post('/diet-plans/client/:clientId/adherence', markClientAdherence);
router.post('/diet-plans/client/:clientId/reminders', sendMealReminders);
router.get('/diet-plans/:id', getDietPlanById);
router.post('/diet-plans/:id/send', sendDietPlanAgain);
router.post('/diet-plans', [
  body('dailyCalories').notEmpty().withMessage('Daily calories are required'),
  body('title').optional().isLength({ max: 120 }).withMessage('Diet plan title is too long'),
  body('goal').optional().isIn(['weight_loss', 'muscle_gain', 'maintenance']).withMessage('Select a valid diet goal'),
  body('clientId').optional().isMongoId().withMessage('Client is invalid'),
  body('fitnessClassId').optional().isMongoId().withMessage('Group is invalid'),
  handleValidation,
], createOrUpdateDietPlan);
router.put('/diet-plans/:id', updateDietPlanById);
router.delete('/diet-plans/:id', archiveDietPlan);
router.post('/diet-plans/groups/:classId/reminders', sendGroupMealReminders);

router.post('/notifications', createNotification);
router.get('/notifications', getNotifications);

router.post('/schedules', createSchedule);
router.get('/schedules', getSchedules);

router.get('/exercises', getExerciseLibrary);
router.get('/activities/pending', getPendingActivities);
router.patch('/activities/:id/status', updateActivityStatus);
router.get('/workout-submissions/pending', getPendingWorkoutSubmissions);
router.patch('/workout-submissions/:id/review', reviewWorkoutSubmission);
router.get('/reports', getCoachReports);

router.get('/classes', getClasses);
router.get('/classes/:id', getClassDetail);
router.post('/classes', [
  body('title').trim().notEmpty().withMessage('Class title is required'),
  body('date').notEmpty().withMessage('Class date is required'),
  body('capacity').optional().isInt({ min: 1, max: 500 }).withMessage('Capacity must be between 1 and 500'),
  body('durationMinutes').optional().isInt({ min: 5, max: 480 }).withMessage('Duration must be between 5 and 480 minutes'),
  handleValidation,
], createClass);
router.put('/classes/:id', updateClass);
router.delete('/classes/:id', deleteClass);
router.post('/classes/:id/enroll', enrollStudent);
router.delete('/classes/:id/enroll/:userId', unenrollStudent);
router.patch('/classes/:id/attendance', [
  objectIdParam('id', 'Class'),
  body('studentId').isMongoId().withMessage('User is required'),
  body('present').optional().isBoolean().withMessage('Attendance status must be true or false'),
  handleValidation,
], markAttendance);

router.get('/attendance', getCoachAttendance);
router.get('/attendance/summary', getCoachAttendanceSummary);
router.get('/attendance/clients', getAttendanceByClients);
router.get('/attendance/groups', getAttendanceByGroups);
router.get('/attendance/groups/:classId', [
  objectIdParam('classId', 'Group'),
  handleValidation,
], getGroupAttendance);
router.get('/attendance/clients/:clientId', [
  objectIdParam('clientId', 'Client'),
  handleValidation,
], getClientAttendance);
router.patch('/attendance/:id', [
  objectIdParam('id', 'Attendance'),
  body('status').notEmpty().withMessage('Attendance status is required'),
  handleValidation,
], updateAttendance);
router.post('/attendance', [
  body('type').notEmpty().withMessage('Attendance type is required'),
  body('status').notEmpty().withMessage('Attendance status is required'),
  handleValidation,
], createOrMarkAttendance);

module.exports = router;
