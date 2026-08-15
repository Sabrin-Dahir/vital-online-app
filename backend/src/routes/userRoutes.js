const express = require('express');
const { body } = require('express-validator');
const {
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
} = require('../controllers/userController');
const {
  submitCoachRequest,
  cancelCoachRequest,
  getMyCoachRequest,
} = require('../controllers/coachRequestController');
const { getUserNotifications, markNotificationRead } = require('../controllers/notificationController');
const { submitReview, getCoachReviews, deleteMyReview } = require('../controllers/reviewController');
const {
  getUserExercisePlans,
  completeWorkout,
  getUserWorkoutProgress,
} = require('../controllers/workoutPlanController');
const { getUserWorkoutSchedules, completeWorkoutSchedule } = require('../controllers/workoutScheduleController');
const {
  requestAppointment,
  getUserAppointments,
  getCoachAvailability,
  bookAppointment,
  cancelAppointmentByUser,
} = require('../controllers/appointmentController');
const { getUserWeeklySchedule } = require('../controllers/weeklyWorkoutPlanController');
const {
  getMyAttendance,
  getMyAttendanceSummary,
} = require('../controllers/attendanceController');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');
const { handleValidation } = require('../middleware/validateRequest');
const { FITNESS_GOALS, GENDERS, ACTIVITY_LEVELS, validateFullName } = require('../utils/fieldValidation');

const router = express.Router();

const validateProfileUpdate = [
  body('full_name').optional({ checkFalsy: true }).custom((value) => {
    const error = validateFullName(value);
    if (error) throw new Error(error);
    return true;
  }),
  body('fullName').optional({ checkFalsy: true }).custom((value) => {
    const error = validateFullName(value);
    if (error) throw new Error(error);
    return true;
  }),
  body('name').optional({ checkFalsy: true }).custom((value) => {
    const error = validateFullName(value);
    if (error) throw new Error(error);
    return true;
  }),
  body('phone').optional({ checkFalsy: true }).isLength({ min: 7, max: 20 }).withMessage('Please enter a valid phone number'),
  body('age').optional({ checkFalsy: true }).custom((value) => {
    const { validateAge } = require('../utils/fieldValidation');
    const error = validateAge(value);
    if (error) throw new Error(error);
    return true;
  }),
  body('heightCm').optional({ checkFalsy: true }).custom((value) => {
    const { validateHeight } = require('../utils/fieldValidation');
    const error = validateHeight(value);
    if (error) throw new Error(error);
    return true;
  }),
  body('height').optional({ checkFalsy: true }).custom((value) => {
    const { validateHeight } = require('../utils/fieldValidation');
    const error = validateHeight(value);
    if (error) throw new Error(error);
    return true;
  }),
  body('weightKg').optional({ checkFalsy: true }).custom((value) => {
    const { validateWeight } = require('../utils/fieldValidation');
    const error = validateWeight(value);
    if (error) throw new Error(error);
    return true;
  }),
  body('weight').optional({ checkFalsy: true }).custom((value) => {
    const { validateWeight } = require('../utils/fieldValidation');
    const error = validateWeight(value);
    if (error) throw new Error(error);
    return true;
  }),
  body('bmi').not().exists().withMessage('BMI is calculated automatically from height and weight.'),
  body('bmiCategory').not().exists().withMessage('BMI category is calculated automatically.'),
  body('gender').optional({ checkFalsy: true }).isIn(GENDERS).withMessage('Gender must be Male or Female'),
  body('fitness_goal').optional({ checkFalsy: true }).isIn(FITNESS_GOALS).withMessage('Select a valid fitness goal'),
  body('activity_level').optional({ checkFalsy: true }).isIn(ACTIVITY_LEVELS).withMessage('Select a valid activity level'),
  body('goals').optional().isArray(),
  body('goals.*').optional().isString().trim(),
  body('experience').optional().isString().trim(),
  body('specialization').optional().isArray(),
  body('specialization.*').optional().isString().trim(),
  body('role').not().exists().withMessage('Role cannot be changed from this endpoint.'),
  handleValidation,
];

router.get('/profile', auth, roles('user', 'coach'), getProfile);
router.put('/profile', auth, roles('user', 'coach'), validateProfileUpdate, updateProfile);
router.put('/profile/photo', auth, roles('user', 'coach'), updateProfilePhoto);
router.get('/coaching', auth, roles('user', 'coach'), getCoachingAssignment);
router.get('/schedule/all', auth, roles('user', 'coach', 'admin'), getPublicSchedule);
router.get('/classes', auth, roles('user'), getMyClasses);
router.get('/classes/available', auth, roles('user'), getAvailableClasses);
router.get('/classes/:id', auth, roles('user'), getClassById);
router.post('/classes/:id/join', auth, roles('user'), joinClass);
router.get('/trainers', auth, roles('user', 'admin'), getTrainers);
router.get('/trainers/:id', auth, roles('user', 'admin'), getTrainerById);
router.get('/trainers/:coachId/reviews', auth, roles('user', 'admin'), getCoachReviews);
router.post('/trainers/:coachId/reviews', auth, roles('user'), [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be a whole number between 1 and 5'),
  body('comment').optional().isLength({ max: 1000 }).withMessage('Comment is too long'),
  handleValidation,
], submitReview);
router.delete('/trainers/:coachId/reviews', auth, roles('user'), deleteMyReview);
router.get('/workout-schedules/weekly', auth, roles('user'), getUserWeeklySchedule);
router.get('/workout-schedules', auth, roles('user'), getUserWorkoutSchedules);
router.patch('/workout-schedules/:scheduleId/complete', auth, roles('user'), completeWorkoutSchedule);
router.get('/workouts', auth, roles('user'), getUserExercisePlans);
router.get('/workouts/progress', auth, roles('user'), getUserWorkoutProgress);
router.patch('/workouts/:planId/complete', auth, roles('user'), completeWorkout);
router.get('/notifications', auth, roles('user', 'coach'), getUserNotifications);
router.patch('/notifications/:id/read', auth, roles('user', 'coach'), markNotificationRead);
router.post('/coach-application', auth, roles('user'), submitCoachApplication);
router.get('/coach-application', auth, roles('user', 'coach'), getMyCoachApplication);
router.get('/appointments', auth, roles('user'), getUserAppointments);
router.get('/appointments/availability', auth, roles('user'), getCoachAvailability);
router.post('/appointments/request', auth, roles('user'), [
  body('dateTime').notEmpty().withMessage('Date and time are required'),
  body('durationMinutes').optional().isInt({ min: 5, max: 240 }).withMessage('Appointment duration must be between 5 and 240 minutes'),
  handleValidation,
], requestAppointment);
router.post('/appointments/book', auth, roles('user'), [
  body('coachId').isMongoId().withMessage('Coach is required'),
  body('date').notEmpty().withMessage('Date is required'),
  body('time').notEmpty().withMessage('Time is required'),
  handleValidation,
], bookAppointment);
router.patch('/appointments/:id/cancel', auth, roles('user'), cancelAppointmentByUser);

router.get('/attendance', auth, roles('user'), getMyAttendance);
router.get('/attendance/summary', auth, roles('user'), getMyAttendanceSummary);

router.post('/coach-request', auth, roles('user'), submitCoachRequest);
router.delete('/coach-request', auth, roles('user'), cancelCoachRequest);
router.get('/coach-request', auth, roles('user'), getMyCoachRequest);

module.exports = router;
