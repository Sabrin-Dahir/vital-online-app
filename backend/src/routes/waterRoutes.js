const express = require('express');
const { createWaterLog, getWaterHistory } = require('../controllers/waterController');
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
      const amount = Number(req.body.amountMl ?? req.body.amount_ml);
      if (!Number.isFinite(amount) || amount < 1 || amount > 20000) {
        throw new Error('Enter a valid water amount in ml (1–20000)');
      }
      return true;
    }),
    handleValidation,
  ],
  createWaterLog,
);
router.get('/history', auth, roles('user', 'admin'), getWaterHistory);

module.exports = router;
