/**
 * Map Mongoose / request failures to consistent API responses.
 * Prefer specific validation messages over generic 500s.
 */

function mongooseValidationMessage(error) {
  if (!error || error.name !== 'ValidationError') return null;
  const first = Object.values(error.errors || {})[0];
  return first?.message || error.message || 'Invalid data';
}

function respondWithCaughtError(res, error, fallback = 'Unable to complete this request') {
  const validation = mongooseValidationMessage(error);
  if (validation) {
    return res.status(400).json({ message: validation, errors: [{ field: '', message: validation }] });
  }
  if (error?.name === 'CastError') {
    const message = `${error.path || 'ID'} is invalid`;
    return res.status(400).json({ message, errors: [{ field: error.path || '', message }] });
  }
  if (error?.code === 11000) {
    const message = 'This record already exists';
    return res.status(409).json({ message, errors: [{ field: '', message }] });
  }
  if (error?.status && Number(error.status) >= 400 && Number(error.status) < 500) {
    return res.status(error.status).json({
      message: error.message || fallback,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  if (error?.code === 'INVALID_IMAGE' || error?.code === 'INVALID_FILE' || error?.code === 'FILE_TOO_LARGE') {
    return res.status(400).json({ message: error.message, code: error.code });
  }
  console.error(error);
  return res.status(500).json({ message: fallback });
}

module.exports = {
  mongooseValidationMessage,
  respondWithCaughtError,
};
