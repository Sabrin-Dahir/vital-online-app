const mongoose = require('mongoose');
const {
  isFileDataUrl,
  isHttpUrl,
  uploadFileDataUrl,
  mimeFromDataUrl,
  extensionFromDataUrl,
  getConfig,
} = require('./imageKit');
const CoachApplication = require('../models/CoachApplication');
const User = require('../models/User');

const MAX_CERTIFICATES = 5;
const MAX_BYTES_PER_FILE = 10 * 1024 * 1024; // 10 MB decoded

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

function estimateBase64Bytes(dataUrl) {
  const raw = String(dataUrl || '');
  const comma = raw.indexOf(',');
  const b64 = comma >= 0 ? raw.slice(comma + 1) : raw;
  // Rough decoded size; padding ignored for limit checks.
  return Math.floor((b64.length * 3) / 4);
}

function imageKitHostAllowed(url) {
  try {
    const { urlEndpoint } = getConfig();
    if (!urlEndpoint) return false;
    const endpointHost = new URL(urlEndpoint).hostname.toLowerCase();
    const fileHost = new URL(url).hostname.toLowerCase();
    return Boolean(endpointHost) && fileHost === endpointHost;
  } catch {
    return false;
  }
}

function isMongoObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value)
    && String(new mongoose.Types.ObjectId(value)) === String(value);
}

/** Safe ImageKit prefix segment (emails / ids → alphanumeric underscore). */
function safeFilePrefix(value) {
  const cleaned = String(value || 'coach')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return cleaned || 'coach';
}

async function ownedCertificateUrls(userId) {
  // New register-coach passes email/username before a User exists — skip ownership lookup.
  if (!userId || !isMongoObjectId(userId)) return new Set();
  try {
    const [application, user] = await Promise.all([
      CoachApplication.findOne({ user: userId }).select('certificateFiles').lean(),
      User.findById(userId).select('coachData.certificateFiles').lean(),
    ]);
    const urls = new Set();
    for (const file of [
      ...(application?.certificateFiles || []),
      ...(user?.coachData?.certificateFiles || []),
    ]) {
      const url = String(file?.url || '').trim();
      if (url) urls.add(url);
    }
    return urls;
  } catch (error) {
    // Never fail registration/re-apply because of ownership lookup issues.
    console.error('[CERT] ownedCertificateUrls:', error.message);
    return new Set();
  }
}

/**
 * Normalize + upload certificate payloads from registration.
 * Accepts:
 * - data URLs (image/pdf) → uploaded to ImageKit
 * - already-owned https URLs (re-apply) or ImageKit CDN URLs for this deployment
 * Returns [{ url, fileName, mimeType, uploadedAt }]
 *
 * New image uploads go to ImageKit first, then OCR checks first + last name
 * on the uploaded file. Unreadable scans are kept for admin review.
 */
async function resolveCertificateFiles(input, { userId, firstName, lastName, expectedName } = {}) {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    const err = new Error('certificateFiles must be an array');
    err.code = 'INVALID_CERTIFICATES';
    throw err;
  }
  if (input.length > MAX_CERTIFICATES) {
    const err = new Error(`You can upload at most ${MAX_CERTIFICATES} certificates`);
    err.code = 'TOO_MANY_CERTIFICATES';
    throw err;
  }

  const {
    isNameValidationEnabled,
    assertCertificateImageShowsName,
  } = require('./certificateNameValidation');
  const nameCheckEnabled = isNameValidationEnabled();

  const ownedUrls = await ownedCertificateUrls(userId);
  const results = [];
  for (let i = 0; i < input.length; i += 1) {
    const item = input[i];
    const dataUrl = typeof item === 'string'
      ? item.trim()
      : String(item?.dataUrl || item?.url || item?.file || '').trim();
    const fileNameHint = typeof item === 'object' && item
      ? String(item.fileName || item.name || '').trim()
      : '';

    if (!dataUrl) {
      const err = new Error(`Certificate #${i + 1} is empty`);
      err.code = 'INVALID_CERTIFICATES';
      throw err;
    }

    if (isHttpUrl(dataUrl)) {
      const allowed = ownedUrls.has(dataUrl) || imageKitHostAllowed(dataUrl);
      if (!allowed) {
        const err = new Error(
          `Certificate #${i + 1} URL is not allowed. Re-upload the file or use a previously saved certificate.`,
        );
        err.code = 'INVALID_CERTIFICATES';
        throw err;
      }
      const urlLooksPdf = dataUrl.toLowerCase().includes('.pdf');
      const mimeType = urlLooksPdf
        ? 'application/pdf'
        : (typeof item === 'object' && item?.mimeType && !String(item.mimeType).includes('pdf')
          ? String(item.mimeType)
          : 'image/jpeg');
      // Already-saved certificates skip OCR. PDFs / unreadable scans go to admin review.
      if (nameCheckEnabled && !ownedUrls.has(dataUrl) && !urlLooksPdf && !String(mimeType).includes('pdf')) {
        await assertCertificateImageShowsName(dataUrl, {
          firstName,
          lastName,
          expectedName,
          index: i + 1,
        });
      }
      results.push({
        url: dataUrl,
        fileName: fileNameHint || `certificate_${i + 1}`,
        mimeType,
        uploadedAt: item?.uploadedAt ? new Date(item.uploadedAt) : new Date(),
      });
      continue;
    }

    if (!isFileDataUrl(dataUrl)) {
      const err = new Error(`Certificate #${i + 1} is invalid`);
      err.code = 'INVALID_CERTIFICATES';
      throw err;
    }

    const mimeType = mimeFromDataUrl(dataUrl) || 'application/octet-stream';
    const normalizedMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;

    const size = estimateBase64Bytes(dataUrl);
    if (size > MAX_BYTES_PER_FILE) {
      const err = new Error(`Certificate #${i + 1} exceeds the 10 MB size limit`);
      err.code = 'CERTIFICATE_TOO_LARGE';
      throw err;
    }

    const ext = extensionFromDataUrl(dataUrl);
    const fileName = fileNameHint || `certificate_${i + 1}.${ext}`;
    // Upload first, then OCR the hosted image (same order as mobile validate endpoint).
    const url = await uploadFileDataUrl(dataUrl, {
      folder: '/vital/certificates',
      fileNamePrefix: `cert_${safeFilePrefix(userId)}_${i + 1}`,
      fileName,
      tags: ['certificate', 'coach'],
    });

    if (nameCheckEnabled && normalizedMime.startsWith('image/')) {
      await assertCertificateImageShowsName(url, {
        firstName,
        lastName,
        expectedName,
        index: i + 1,
      });
    }

    results.push({
      url,
      fileName,
      mimeType: normalizedMime,
      uploadedAt: new Date(),
    });
  }

  return results;
}

function requireCertificateFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    const err = new Error(
      'Upload at least one professional certificate',
    );
    err.code = 'CERTIFICATES_REQUIRED';
    throw err;
  }
}

module.exports = {
  MAX_CERTIFICATES,
  MAX_BYTES_PER_FILE,
  resolveCertificateFiles,
  requireCertificateFiles,
};
