const express = require('express');
const { body } = require('express-validator');
const {
  login,
  adminLogin,
  me,
  register,
  registerCoach,
  validateCoachCertificate,
  logout,
  changePassword,
  forgotPassword,
  resetPassword,
} = require('../controllers/authController');
const auth = require('../middleware/auth');
const { handleValidation } = require('../middleware/validateRequest');
const { MAX_PASSWORD_LENGTH } = require('../utils/passwordUtils');
const { validateEmail, validateFullName } = require('../utils/fieldValidation');

const router = express.Router();

const loginRules = [
  body('password').notEmpty().withMessage('Password is required').isLength({ max: MAX_PASSWORD_LENGTH }).withMessage('Password is too long'),
  body().custom((_, { req }) => {
    const identity = String(req.body.username || req.body.email || '').trim();
    const error = validateEmail(identity);
    if (error) throw new Error(error);
    return true;
  }),
  handleValidation,
];

router.post('/login', loginRules, login);
router.post('/admin/login', loginRules, adminLogin);
router.post('/logout', logout);
router.get('/me', auth, me);

router.post(
  '/change-password',
  auth,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 6, max: MAX_PASSWORD_LENGTH })
      .withMessage('New password must be between 6 and 128 characters'),
    handleValidation,
  ],
  changePassword,
);

router.post('/register', [
  body('full_name').custom((value, { req }) => {
    const error = validateFullName(value || req.body.fullName || req.body.name);
    if (error) throw new Error(error);
    return true;
  }),
  body().custom((_, { req }) => {
    const error = validateEmail(req.body.username || req.body.email);
    if (error) throw new Error(error);
    return true;
  }),
  body('password').isLength({ min: 6, max: MAX_PASSWORD_LENGTH }).withMessage('Password must be between 6 and 128 characters'),
  handleValidation,
], register);

router.post('/register-coach', [
  body().custom((_, { req }) => {
    const nameError = validateFullName(req.body.full_name || req.body.name || req.body.fullName);
    if (nameError) throw new Error(nameError);
    const emailError = validateEmail(req.body.username || req.body.email);
    if (emailError) throw new Error(emailError);
    return true;
  }),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidation,
], registerCoach);

router.post('/validate-coach-certificate', validateCoachCertificate);
router.post('/forgot-password', [
  body().custom((_, { req }) => {
    const error = validateEmail(req.body.username || req.body.email);
    if (error) throw new Error(error);
    return true;
  }),
  handleValidation,
], forgotPassword);
router.post('/reset-password', [
  body('code').notEmpty().withMessage('Reset code is required'),
  body('newPassword').optional(),
  body('password').optional(),
  handleValidation,
], resetPassword);

module.exports = router;
