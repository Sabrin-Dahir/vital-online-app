const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');
const { handleValidation } = require('../middleware/validateRequest');
const { validateEmail, validateFullName } = require('../utils/fieldValidation');
const {
  getDashboardStats,
  getUsers, getUserDetail, getCoachDetail, getAdminMe, createUser, deleteUser, updateUserRole, updateUser, updateUserStatus,
  getTrainers, deleteCoach, updateCoachSpecialization,
  getWorkoutStats,
  getExerciseTypes, approveExercise, rejectExercise, rejectExerciseType, deleteExerciseType,
  getMealStats,
  getSchedule, createAssignment, updateAssignmentStatus, deleteAssignment,
  getClasses, createClass, updateClass, deleteClass,
  getStatistics,
  sendAnnouncement,
  getCoachApplications,
  getCoachApplication,
  approveCoachApplication,
  rejectCoachApplication,
  getAppointments,
  getCoachingProgress,
  getAdminDietPlans,
  getAdminDietAdherence,
  getAdminWorkouts,
  getReports,
  regeneratePassword,
  getAuditLogs,
} = require('../controllers/adminController');

// All admin routes require auth + admin role
router.use(auth, roles('admin'));

router.get('/me', getAdminMe);
router.get('/dashboard', getDashboardStats);
router.get('/statistics', getStatistics);
router.get('/reports', getReports);
router.get('/audit-logs', getAuditLogs);
router.get('/users', getUsers);
router.get('/users/:id/detail', getUserDetail);
router.post('/users/:id/regenerate-password', regeneratePassword);
router.post('/users', [
  body('password').notEmpty().withMessage('Password is required'),
  body().custom((_, { req }) => {
    const nameError = validateFullName(req.body.full_name || req.body.name || req.body.fullName);
    if (nameError) throw new Error(nameError);
    const emailError = validateEmail(req.body.username || req.body.email);
    if (emailError) throw new Error(emailError);
    return true;
  }),
  handleValidation,
], createUser);
router.delete('/users/:id', deleteUser);
router.patch('/users/:id/role', [
  body('role').isIn(['user', 'coach']).withMessage('Role can only be changed to client (user) or coach.'),
  handleValidation,
], updateUserRole);
router.patch('/users/:id', updateUser);
router.patch('/users/:id/status', updateUserStatus);
router.post('/notifications', sendAnnouncement);
router.get('/coach-applications', getCoachApplications);
router.get('/coach-applications/:id', getCoachApplication);
router.patch('/coach-applications/:id/approve', approveCoachApplication);
router.patch('/coach-applications/:id/reject', rejectCoachApplication);
router.get('/trainers', getTrainers);
router.get('/trainers/:id/detail', getCoachDetail);
router.patch('/trainers/:id/specialization', [
  body().custom((_, { req }) => {
    const incoming = req.body.specializations
      ?? req.body.specialties
      ?? req.body.specialization
      ?? req.body.primarySpecialization;
    if (
      incoming == null
      || (Array.isArray(incoming) && !incoming.length)
      || (typeof incoming === 'string' && !incoming.trim())
    ) {
      throw new Error('Please select at least one specialization.');
    }
    return true;
  }),
  handleValidation,
], updateCoachSpecialization);
router.delete('/trainers/:id', deleteCoach);
router.get('/appointments', getAppointments);
router.get('/coaching-progress', getCoachingProgress);
router.get('/diet-plans', getAdminDietPlans);
router.get('/diet-adherence', getAdminDietAdherence);
router.get('/workouts', getWorkoutStats);
router.get('/workouts/overview', getAdminWorkouts);
router.get('/exercises', getExerciseTypes);
router.patch('/exercises/:id/approve', approveExercise);
router.patch('/exercises/:id/reject', rejectExercise);
router.patch('/exercises/type/:type/reject', rejectExerciseType);
router.delete('/exercises/type/:type', deleteExerciseType);
router.get('/meals', getMealStats);
router.get('/schedule', getSchedule);
router.post('/schedule', createAssignment);
router.patch('/schedule/:id/status', updateAssignmentStatus);
router.patch('/schedule/:id', updateAssignmentStatus);
router.delete('/schedule/:id', deleteAssignment);
router.get('/classes', getClasses);
router.post('/classes', createClass);
router.put('/classes/:id', updateClass);
router.delete('/classes/:id', deleteClass);

module.exports = router;
