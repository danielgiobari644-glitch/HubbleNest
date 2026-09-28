/**
 * Cloudinary File Storage Engine
 * Cloud Name: l5inkfvz
 * Upload Preset: LinkRoom
 * 
 * Cloudinary is the ONLY file and media storage provider.
 * Strictly NO Firebase Storage is used.
 */

const CLOUD_NAME = 'l5inkfvz';
const UPLOAD_PRESET = 'LinkRoom';
const CLOUDINARY_AUTO_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`;

const SUPPORTED_EXTENSIONS = new Set([
  // Images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'heic',
  // Videos
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'flv',
  // Audio
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'rtf', 'zip', 'tar', 'gz', 'json'
]);

/**
 * Determine high-level category of file
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
 * Validate file before uploading
 */
export function validateFile(file, maxFileSizeMB = 100) {
  if (!file) {
    throw new Error('Please choose a file to upload.');
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`This file type (.${ext || 'unknown'}) isn't currently supported by HubbleNest.`);
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
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Upload file to Cloudinary with progress callback
 * @param {File} file
 * @param {Function} onProgress (percent: number, statusText: string) => void
 * @param {number} maxFileSizeMB
 * @returns {Promise<{url: string, publicId: string, resourceType: string, format: string, bytes: number, originalFilename: string}>}
 */
export async function uploadToCloudinary(file, onProgress = null, maxFileSizeMB = 100) {
  validateFile(file, maxFileSizeMB);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();

    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);

    if (onProgress) {
      onProgress(0, 'Connecting to Cloudinary...');
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.min(98, Math.round((event.loaded / event.total) * 100));
        onProgress(percent, `Uploading ${percent}%...`);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          if (onProgress) onProgress(100, 'Processing...');
          const data = JSON.parse(xhr.responseText);
          resolve({
            url: data.secure_url || data.url,
            publicId: data.public_id,
            resourceType: data.resource_type || getFileCategory(file),
            format: data.format || (file.name.split('.').pop() || '').toLowerCase(),
            bytes: data.bytes || file.size,
            originalFilename: file.name
          });
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

    xhr.open('POST', CLOUDINARY_AUTO_URL, true);
    xhr.send(formData);
  });
}
