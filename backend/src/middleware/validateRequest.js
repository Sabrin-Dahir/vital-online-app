const { validationResult } = require('express-validator');

function formatExpressErrors(errors) {
  return errors.array({ onlyFirstError: true }).map((item) => ({
    field: item.path || item.param || '',
    message: item.msg,
  }));
}

function sendValidationError(res, message, fields = []) {
  const list = Array.isArray(fields) ? fields.filter((item) => item && item.message) : [];
  return res.status(400).json({
    message: message || list[0]?.message || 'Please fix the highlighted fields',
    errors: list.length ? list : [{ field: '', message: message || 'Invalid request' }],
  });
}

function handleValidation(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const errors = formatExpressErrors(result);
  return sendValidationError(res, errors[0]?.message, errors);
}

function rejectIfInvalid(res, error) {
  if (!error) return false;
  sendValidationError(res, error);
  return true;
}

module.exports = {
  handleValidation,
  sendValidationError,
  rejectIfInvalid,
  formatExpressErrors,
};
