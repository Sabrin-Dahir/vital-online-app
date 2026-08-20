const { ImageKit, toFile } = require('@imagekit/nodejs');

let _client = null;

function getConfig() {
  const publicKey = String(process.env.IMAGEKIT_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.IMAGEKIT_PRIVATE_KEY || '').trim();
  const urlEndpoint = String(process.env.IMAGEKIT_URL_ENDPOINT || '').trim();
  return { publicKey, privateKey, urlEndpoint };
}

function isImageKitConfigured() {
  const { publicKey, privateKey, urlEndpoint } = getConfig();
  return Boolean(publicKey && privateKey && urlEndpoint);
}

function getImageKit() {
  if (!isImageKitConfigured()) {
    const err = new Error(
      'ImageKit is not configured. Set IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, and IMAGEKIT_URL_ENDPOINT.',
    );
    err.code = 'IMAGEKIT_NOT_CONFIGURED';
    throw err;
  }
  if (!_client) {
    const { privateKey } = getConfig();
    _client = new ImageKit({ privateKey });
  }
  return _client;
}

const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/i;
const FILE_DATA_URL_RE = /^data:([^;]+);base64,/i;
const HTTP_URL_RE = /^https?:\/\//i;

function isDataUrl(value) {
  return DATA_URL_RE.test(String(value || ''));
}

function isFileDataUrl(value) {
  return FILE_DATA_URL_RE.test(String(value || ''));
}

function isHttpUrl(value) {
  return HTTP_URL_RE.test(String(value || '').trim());
}

function extensionFromDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,/i);
  if (!match) return 'bin';
  const mime = match[1].toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) {
    const type = mime.replace('image/', '');
    if (type === 'jpeg' || type === 'jpg') return 'jpg';
    return type;
  }
  const parts = mime.split('/');
  return parts[1] || 'bin';
}

function mimeFromDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,/i);
  return match ? match[1].toLowerCase() : '';
}

function base64FromDataUrl(dataUrl) {
  const raw = String(dataUrl || '');
  const comma = raw.indexOf(',');
  return comma >= 0 ? raw.slice(comma + 1) : raw;
}

/**
 * Upload a base64 data URL to ImageKit and return the CDN URL.
 * If value is already an http(s) URL, return it unchanged.
 * Empty string clears the image (returns '').
 */
async function uploadImageDataUrl(dataUrl, {
  folder = '/vital',
  fileNamePrefix = 'image',
  tags = [],
} = {}) {
  const value = String(dataUrl ?? '').trim();
  if (!value) return '';

  if (isHttpUrl(value)) return value;

  if (!isDataUrl(value)) {
    const err = new Error('Image must be a base64 data URL or an https image URL');
    err.code = 'INVALID_IMAGE';
    throw err;
  }

  return uploadFileDataUrl(value, { folder, fileNamePrefix, tags });
}

/**
 * Upload image or PDF data URL to ImageKit. Returns CDN URL.
 */
async function uploadFileDataUrl(dataUrl, {
  folder = '/vital',
  fileNamePrefix = 'file',
  tags = [],
  fileName,
} = {}) {
  const value = String(dataUrl ?? '').trim();
  if (!value) return '';

  if (isHttpUrl(value)) return value;

  if (!isFileDataUrl(value)) {
    const err = new Error('File must be a base64 data URL, or an https URL');
    err.code = 'INVALID_FILE';
    throw err;
  }

  const client = getImageKit();
  const ext = extensionFromDataUrl(value);
  const resolvedName = fileName
    ? String(fileName).replace(/[^\w.\-]+/g, '_').slice(0, 80)
    : `${fileNamePrefix}_${Date.now()}.${ext}`;
  const finalName = resolvedName.endsWith(`.${ext}`) ? resolvedName : `${resolvedName}.${ext}`;
  const buffer = Buffer.from(base64FromDataUrl(value), 'base64');
  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES) || 10 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    const err = new Error(`File is too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB`);
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }
  const file = await toFile(buffer, finalName);

  const result = await client.files.upload({
    file,
    fileName: finalName,
    folder,
    tags: Array.isArray(tags) ? tags : [],
    useUniqueFileName: true,
  });

  const url = result?.url || result?.thumbnailUrl || '';
  if (!url) {
    const err = new Error('ImageKit upload did not return a URL');
    err.code = 'IMAGEKIT_UPLOAD_FAILED';
    throw err;
  }
  return url;
}

module.exports = {
  getConfig,
  isImageKitConfigured,
  isDataUrl,
  isFileDataUrl,
  isHttpUrl,
  uploadImageDataUrl,
  uploadFileDataUrl,
  extensionFromDataUrl,
  mimeFromDataUrl,
  DATA_URL_RE,
  FILE_DATA_URL_RE,
  HTTP_URL_RE,
};
