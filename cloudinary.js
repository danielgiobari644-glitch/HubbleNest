/**
 * Cloudinary File Storage Engine
 * Cloud Name: l5inkfvz
 * Upload Preset: LinkRoom
 *
 * Cloudinary is the ONLY file and media storage provider.
 * Strictly NO Firebase Storage is used.
 *
 * Universal file support (v2):
 *  - EVERY file type is accepted — images, video, audio, documents, archives
 *    and any code/project file. No extension whitelist.
 *  - Routing: images → /image/upload, video → /video/upload, audio →
 *    /video/upload (Cloudinary treats audio as video family), EVERYTHING
 *    else (pdf, docx, zip, code files…) → /raw/upload — stored and delivered
 *    as raw bytes, which is the ONLY reliable way a PDF stays downloadable.
 *    (Cloudinary's /auto endpoint routes PDFs to the IMAGE family, where the
 *    account's "PDF delivery" restriction turns every link into 401.)
 *  - Delivery self-check: right after each upload we GET the returned URL
 *    once. If Cloudinary answers 401 "deny / ACL failure" the uploader fails
 *    LOUDLY with the exact one-time console fix instead of leaving the user
 *    a broken attachment to discover later.
 */

const CLOUD_NAME = 'l5inkfvz';
const UPLOAD_PRESET = 'LinkRoom';

const CLOUDINARY_BASE = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;
// Kept for backwards-compatible imports elsewhere
const CLOUDINARY_AUTO_URL = `${CLOUDINARY_BASE}/auto/upload`;

/**
 * Pick the Cloudinary endpoint family for a file.
 * Images stay images; video+audio go to the video family; every other byte
 * stream (pdf, zip, docx, code, unknown) is stored as RAW — honest bytes,
 * always downloadable, no image-pipeline surprises.
 */
export function cloudinaryEndpointFor(file) {
  const type = (file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if (type.startsWith('image/') && type !== 'image/svg+xml' && ext !== 'pdf') return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'video'; // Cloudinary hosts audio under the video family
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'video';
  return 'raw';
}

/**
 * Determine high-level category of file (kept for UI icon/badge logic)
 */
export function getFileCategory(file) {
  const type = (file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if (type.startsWith('image/')) return 'images';
  if (type.startsWith('video/')) return 'videos';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf' || ext === 'pdf') return 'documents';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'md', 'zip'].includes(ext)) {
    return 'documents';
  }
  return 'other';
}

/**
 * Validate before uploading. EVERY file type is allowed — the only limits
 * are size (per call site) and "must be a real file".
 */
export function validateFile(file, maxFileSizeMB = 100) {
  if (!file) {
    throw new Error('Please choose a file to upload.');
  }

  const maxBytes = maxFileSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is ${maxFileSizeMB} MB.`);
  }

  return true;
}

/**
 * Format bytes to readable string (e.g. 2.4 MB)
 */
export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const DELIVERY_BLOCKED_HINT =
  'Cloudinary is blocking delivery of this file type on your account. ' +
  'One-time fix (takes 10 seconds, unblocks ALL existing files too): open ' +
  'https://console.cloudinary.com/settings/security → "PDF and ZIP files delivery" → ' +
  'tick "Allow delivery of PDF and ZIP files" → Save. Then re-upload this file.';

/**
 * Delivery audit for ALREADY-UPLOADED documents (feed/DM/file cards).
 * Cloudinary accounts ship with "PDF and ZIP files delivery" disabled, so a
 * document link can sit in a chat looking perfectly normal while answering
 * 401 on every open. One cached HEAD per URL classifies it:
 *   'ok'      → delivers (or Cloudinary answered anything but 401/403)
 *   'blocked' → the account-level security setting is denying this file
 *   'unknown' → probe failed (network/CORS) — never used to flag a file
 * The UI turns 'blocked' into an actionable card instead of a dead link.
 */
const docDeliveryStatusCache = new Map();

export async function checkDocumentDelivery(url) {
  if (!url || typeof url !== 'string') return 'unknown';
  if (docDeliveryStatusCache.has(url)) return docDeliveryStatusCache.get(url);

  let status = 'unknown';
  try {
    const res = await fetch(url, { method: 'HEAD', mode: 'cors', cache: 'no-store' });
    if (res.status === 401 || res.status === 403) status = 'blocked';
    else status = 'ok';
  } catch (err) {
    // A CORS/network rejection must NOT mark a file blocked — ambiguous.
    status = 'unknown';
  }

  docDeliveryStatusCache.set(url, status);
  return status;
}

/**
 * Verify the freshly uploaded asset actually DELIVERS (the 401 "deny or ACL
 * failure" case). Runs one GET; a 401 becomes an actionable error, a 404 is
 * tolerated for a moment (CDN lag on brand-new raw assets) and any other
 * response counts as delivered.
 */
async function verifyDelivery(url) {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (res.status === 401) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch (e) { /* ignore */ }
      const err = new Error(DELIVERY_BLOCKED_HINT);
      err.deliveryBlocked = true;
      err.status = 401;
      err.detail = detail;
      throw err;
    }
    // 404 on a just-uploaded raw asset can be CDN propagation — accept.
    return true;
  } catch (err) {
    if (err && err.deliveryBlocked) throw err;
    // Network hiccup during verification must NOT fail a successful upload.
    return true;
  }
}

/**
 * Upload file to Cloudinary with progress callback
 * @param {File} file
 * @param {Function} onProgress (percent: number, statusText: string) => void
 * @param {number} maxFileSizeMB
 * @param {boolean} allowAnyType  DEPRECATED — every type is allowed now.
 *        Kept in the signature so existing call sites stay compatible.
 * @returns {Promise<{url: string, publicId: string, resourceType: string, format: string, bytes: number, originalFilename: string}>}
 */
export async function uploadToCloudinary(file, onProgress = null, maxFileSizeMB = 100, allowAnyType = false) {
  validateFile(file, maxFileSizeMB);

  const family = cloudinaryEndpointFor(file);
  const endpoint = `${CLOUDINARY_BASE}/${family}/upload`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();

    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    // NOTE: access_mode can NOT be set on unsigned uploads (Cloudinary
    // rejects the parameter — the upload preset governs it). Raw assets from
    // an unsigned preset are publicly readable by default.

    if (onProgress) {
      onProgress(0, 'Connecting to Cloudinary...');
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.min(98, Math.round((event.loaded / event.total) * 100));
        onProgress(percent, `Uploading ${percent}%...`);
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          if (onProgress) onProgress(100, 'Checking the file is reachable...');
          const data = JSON.parse(xhr.responseText);
          const result = {
            url: data.secure_url || data.url,
            publicId: data.public_id,
            resourceType: data.resource_type || (family === 'video' ? 'video' : family === 'raw' ? 'raw' : 'image'),
            format: data.format || (file.name.split('.').pop() || '').toLowerCase(),
            bytes: data.bytes || file.size,
            originalFilename: file.name
          };
          // Delivery self-check — fail loud with the fix, never silently.
          if (result.url) {
            try {
              await verifyDelivery(result.url);
            } catch (vErr) {
              reject(vErr);
              return;
            }
          }
          if (onProgress) onProgress(100, 'Done');
          resolve(result);
        } catch (err) {
          reject(new Error('Failed to parse Cloudinary response.'));
        }
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          const msg = errData.error?.message || `Upload failed with status code ${xhr.status}`;
          reject(new Error(msg));
        } catch {
          reject(new Error(`Upload failed with status code ${xhr.status}. Please check your connection.`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during file upload. Please check your internet connection.'));
    };

    xhr.open('POST', endpoint, true);
    xhr.send(formData);
  });
}
