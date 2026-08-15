const express = require('express');
const { createActivityLog, getActivityHistory } = require('../controllers/activityController');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');
const { body } = require('express-validator');
const { handleValidation } = require('../middleware/validateRequest');

const router = express.Router();

router.post(
  '/log',
  auth,
  roles('user', 'admin'),
  [
    body().custom((_, { req }) => {
      const activityType = String(req.body.activityType || req.body.type || '').trim();
      if (!activityType) throw new Error('Activity type is required');
      const minutes = Number(req.body.durationMinutes ?? req.body.duration_minutes);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
        throw new Error('Duration must be between 1 and 1440 minutes');
      }
      const calories = req.body.caloriesBurned ?? req.body.calories;
      if (calories !== undefined && calories !== null && String(calories).trim() !== '') {
        const parsed = Number(calories);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error('Calories burned cannot be negative');
        }
      }
      return true;
    }),
    handleValidation,
  ],
  createActivityLog,
);
router.get('/history', auth, roles('user', 'admin'), getActivityHistory);

module.exports = router;
