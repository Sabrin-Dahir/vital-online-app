const express = require('express');
const { getProgress, logWeight } = require('../controllers/progressController');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');
const { body } = require('express-validator');
const { handleValidation } = require('../middleware/validateRequest');

const router = express.Router();

router.get('/', auth, roles('user', 'admin'), getProgress);
router.post(
  '/weight',
  auth,
  roles('user', 'admin'),
  [
    body().custom((_, { req }) => {
      const weight = Number(req.body.weightKg ?? req.body.weight);
      if (!Number.isFinite(weight) || weight < 20 || weight > 300) {
        throw new Error('Weight must be between 20 kg and 300 kg.');
      }
      return true;
    }),
    handleValidation,
  ],
  logWeight,
);

module.exports = router;
