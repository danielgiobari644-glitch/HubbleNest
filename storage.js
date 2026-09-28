/* =============================================================
   LinkRoom — Smart File Upload Router
   -------------------------------------------------------------
   Decides where each file goes based on MIME type, size, and
   capabilities of the two storage providers:
     • Cloudinary (unsigned upload preset)
       — best for images, videos, audio, small documents (≤100 MB)
     • Supabase Storage (private bucket)
       — fallback for large files, exotic MIME types, or when
         Cloudinary is unavailable.

   The user never knows which provider is used; metadata is
   standardized in the `files` table for both.
   ============================================================= */

window.StorageRouter = (function () {
  'use strict';

  const cfg = window.LINKROOM_CONFIG.cloudinary;
  const MAX_CLOUDINARY_BYTES = 100 * 1024 * 1024; // 100 MB cloudinary limit for unsigned
  const CLOUDINARY_OK = new Set([
    'image/png','image/jpeg','image/webp','image/gif','image/heic','image/avif','image/svg+xml',
    'video/mp4','video/webm','video/quicktime','video/mpeg',
    'audio/mpeg','audio/wav','audio/ogg','audio/m4a','audio/aac','audio/flac',
    'application/pdf','text/plain','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]);

  function shouldUseCloudinary(file) {
    if (!cfg.cloudName || !cfg.uploadPreset) return false;
    if (cfg.cloudName === 'YOUR_CLOUD_NAME') return false;
    if (file.size > MAX_CLOUDINARY_BYTES) return false;
    if (file.type && CLOUDINARY_OK.has(file.type)) return true;
    // Fallbacks by extension
    const ext = Utils.fileExt(file.name);
    if (['png','jpg','jpeg','webp','gif','heic','avif','svg'].includes(ext)) return true;
    if (['mp4','webm','mov','mpeg'].includes(ext)) return true;
    if (['mp3','wav','ogg','m4a','aac','flac'].includes(ext)) return true;
    if (['pdf','doc','docx','xls','xlsx','ppt','pptx','txt'].includes(ext)) return true;
    return false;
  }

  // ---------- Cloudinary unsigned upload ----------
  function uploadCloudinary(file, onProgress) {
    return new Promise((resolve, reject) => {
      const url = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/auto/upload`;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', cfg.uploadPreset);
      fd.append('resource_type', 'auto');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);

      xhr.upload.onprogress = (e) => {
        if (e.total && onProgress) onProgress((e.loaded / e.total) * 100);
      };

      xhr.onload = () => {
        try {
          const res = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && res.public_id) {
            resolve({
              provider: 'cloudinary',
              public_id: res.public_id,
              url: res.secure_url,
              thumbnail_url: res.thumbnail_url || (res.url ? res.url.replace('/upload/','/upload/c_fill,w_200,h_150/') : null),
              bytes: res.bytes || file.size,
              resource_type: res.resource_type,
              format: res.format
            });
          } else {
            reject(new Error(res.error && res.error.message || 'Cloudinary upload failed'));
          }
        } catch (e) {
          reject(new Error('Cloudinary parse error'));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during Cloudinary upload'));
      xhr.send(fd);
    });
  }

  // ---------- Master upload function ----------
  // Returns metadata that fits the `files` table.
  async function uploadFile(file, roomId, opts) {
    opts = opts || {};
    const onProgress = opts.onProgress || (() => {});
    const useCloudinary = shouldUseCloudinary(file);

    let provider, stored_path, url, thumbnail_url, public_id, bytes;
    try {
      if (useCloudinary) {
        const r = await uploadCloudinary(file, onProgress);
        provider = 'cloudinary';
        stored_path = r.public_id;
        url = r.url;
        thumbnail_url = r.thumbnail_url;
        public_id = r.public_id;
        bytes = r.bytes;
      } else {
        // Fallback: Supabase Storage
        onProgress(5);
        const r = await LR.uploadToSupabaseStorage(roomId, file, (p) => onProgress(p));
        provider = 'supabase';
        stored_path = r.stored_path;
        url = r.url;
        thumbnail_url = null;
        public_id = null;
        bytes = file.size;
      }
    } catch (err) {
      // Final fallback: if Cloudinary failed, try Supabase Storage
      if (useCloudinary) {
        console.warn('Cloudinary upload failed, falling back to Supabase Storage:', err.message);
        onProgress(5);
        const r = await LR.uploadToSupabaseStorage(roomId, file, (p) => onProgress(p));
        provider = 'supabase';
        stored_path = r.stored_path;
        url = r.url;
        thumbnail_url = null;
        public_id = null;
        bytes = file.size;
      } else {
        throw err;
      }
    }

    onProgress(100);

    return {
      original_name: file.name,
      stored_path,
      mime_type: file.type || 'application/octet-stream',
      extension: Utils.fileExt(file.name),
      size_bytes: bytes,
      storage_provider: provider,
      storage_path: stored_path,
      url,
      thumbnail_url,
      public_id
    };
  }

  // ---------- Image upload helper (for avatars / room images / announcement images) ----------
  // Always Cloudinary (since these need to be public). Returns a secure_url.
  async function uploadImage(imageFile, onProgress) {
    if (!shouldUseCloudinary(imageFile)) {
      // Allow images even if extension-unknown
    }
    const r = await uploadCloudinary(imageFile, onProgress);
    return r.url;
  }

  return { uploadFile, uploadImage, shouldUseCloudinary };
})();
