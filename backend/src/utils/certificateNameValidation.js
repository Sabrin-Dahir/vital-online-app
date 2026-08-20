/**
 * Certificate identity check for coach registration.
 *
 * Uses ONLY the applicant's First Name + Last Name from the registration form.
 * Extra text on the certificate (title, course name, dates) is allowed.
 *
 * OCR uses existing tesseract.js in-process — no new backend/service/database.
 * Disable with CERTIFICATE_NAME_VALIDATION=off when needed.
 */

function isNameValidationEnabled() {
  const raw = String(process.env.CERTIFICATE_NAME_VALIDATION || 'on').trim().toLowerCase();
  return !['0', 'false', 'off', 'no', 'disabled'].includes(raw);
}

function normalizeOcrText(raw) {
  if (!raw) return '';
  return String(raw)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics/accents
    .toLowerCase()
    .replace(/[\r\n\t]+/g, ' ')     // replace line breaks & tabs with spaces
    .replace(/[^a-z0-9\s]/g, ' ')   // replace punctuation/symbols with spaces
    .replace(/\s+/g, ' ')           // collapse multiple spaces
    .trim();
}

function normalizeNameToken(value) {
  if (!value) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function certificateContainsFirstAndLast(ocrText, firstName, lastName) {
  const normText = normalizeOcrText(ocrText);
  const first = normalizeNameToken(firstName);
  const last = normalizeNameToken(lastName);

  if (!first || !last) return false;

  const firstFound = normText.includes(first) || normText.replace(/\s+/g, '').includes(first);
  const lastFound = normText.includes(last) || normText.replace(/\s+/g, '').includes(last);

  return firstFound && lastFound;
}

/**
 * Validate OCR text against First Name + Last Name only.
 * @returns {{ ok: true, matchedName?: string, unverified?: boolean, verified?: boolean }
 *   | { ok: false, code: string, message: string }}
 */
function evaluateCertificateNameText(ocrText, {
  firstName,
  lastName,
  expectedName,
  index = 1,
  fileName = '',
} = {}) {
  const { resolveCoachPersonName } = require('./fieldValidation');
  const identity = resolveCoachPersonName({
    firstName,
    lastName,
    expectedName,
  });
  const first = identity.firstName;
  const last = identity.lastName;

  if (!first || !last) {
    return {
      ok: false,
      code: 'CERTIFICATE_NAME_REQUIRED',
      message: 'Enter your first name and last name first, then upload a certificate that shows that name.',
    };
  }

  const rawText = String(ocrText || '').trim();
  const normalizedText = normalizeOcrText(rawText);
  const normFirst = normalizeNameToken(first);
  const normLast = normalizeNameToken(last);

  const firstNameFound = Boolean(normFirst) && (normalizedText.includes(normFirst) || normalizedText.replace(/\s+/g, '').includes(normFirst));
  const lastNameFound = Boolean(normLast) && (normalizedText.includes(normLast) || normalizedText.replace(/\s+/g, '').includes(normLast));

  console.log('[CERT OCR VERIFICATION]', {
    fileName: fileName || `certificate_${index}`,
    rawOcrTextLength: rawText.length,
    rawOcrTextSnippet: rawText.slice(0, 150),
    normalizedOcrText: normalizedText.slice(0, 150),
    normalizedFirstName: normFirst,
    normalizedLastName: normLast,
    firstNameFound,
    lastNameFound,
    resultStatus: (firstNameFound && lastNameFound) ? 'VERIFIED' : 'MANUAL_REVIEW_REQUIRED',
  });

  if (firstNameFound && lastNameFound) {
    return { ok: true, verified: true, matchedName: `${first} ${last}` };
  }

  // OCR unreadable or name not detected -> mark as Manual Review Required for Admin (do not auto-reject)
  return {
    ok: true,
    unverified: true,
    matchedName: `${first} ${last}`,
    message: `Certificate #${index}: Pending manual admin review.`,
  };
}

let _workerPromise = null;

async function getOcrWorker() {
  if (!_workerPromise) {
    _workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker('eng');
      return worker;
    })().catch((error) => {
      _workerPromise = null;
      throw error;
    });
  }
  return _workerPromise;
}

async function recognizeCertificateText(imageSource) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(imageSource);
  return String(data?.text || '');
}

/**
 * Validate a certificate image shows first + last name.
 * OCR failure / unreadable scans → unverified (admin review), not a hard reject.
 */
async function assertCertificateImageShowsName(imageSource, {
  firstName,
  lastName,
  expectedName,
  index = 1,
  fileName = '',
} = {}) {
  if (!isNameValidationEnabled()) {
    return { ok: true, skipped: true };
  }

  const source = String(imageSource || '').trim();
  if (!source) {
    return {
      ok: true,
      unverified: true,
      matchedName: null,
    };
  }

  let text = '';
  try {
    text = await recognizeCertificateText(source);
  } catch (error) {
    console.error('[CERT OCR ERROR]', error.message);
    return {
      ok: true,
      unverified: true,
      matchedName: null,
    };
  }

  const result = evaluateCertificateNameText(text, {
    firstName,
    lastName,
    expectedName,
    index,
    fileName,
  });

  return result;
}

module.exports = {
  isNameValidationEnabled,
  evaluateCertificateNameText,
  certificateContainsFirstAndLast,
  assertCertificateImageShowsName,
};
