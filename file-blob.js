/**
 * HubbleNest Universal File Storage — Cloudinary first, Firestore fallback
 *
 * WHY THIS EXISTS
 * Cloudinary accounts ship with "PDF and ZIP files delivery" BLOCKED. The
 * toggle lives in console.cloudinary.com/settings/security and on some
 * accounts it does not take effect (or is missed), which turned every PDF/ZIP
 * link into a 401 "deny or ACL failure" — even though the UPLOAD succeeded.
 * Client code cannot change that account setting, so instead of failing we
 * store the file's real bytes on the app's OWN backend (Firestore — the
 * project's only backend by architecture) and serve them from there.
 *
 * HOW IT WORKS
 *  - uploadFileAnywhere() tries Cloudinary first (images/video/audio always
 *    deliver fine). If Cloudinary accepts the upload but BLOCKS delivery
 *    (401), the file bytes are stored in Firestore `fileBlobs` documents and
 *    the attachment carries { blobId } instead of a dead URL.
 *  - Firestore caps a document at ~1 MiB, so bytes are base64-encoded and
 *    split into ~525 KB chunks under fileBlobs/{id}/chunks/{i}. The fallback
 *    cap is 20 MB — larger files keep the loud, actionable Cloudinary hint
 *    because only the account owner can unblock that family there.
 *  - downloadStoredFile() / openStoredFile() reassemble the bytes on the
 *    receiver's device and hand them to the browser as a real file.
 *
 * NOTHING is simulated: the bytes written are the bytes downloaded.
 */

import {
  db,
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection,
  query,
  orderBy,
  serverTimestamp
} from './firebase.js';

import { uploadToCloudinary, cloudinaryEndpointFor, formatBytes } from './cloudinary.js';
import { showToast } from './utils.js';

/** Files above this size are not stored on Firestore — the Cloudinary card explains the fix instead. */
export const FALLBACK_MAX_BYTES = 20 * 1024 * 1024;

/** Base64 chars per chunk document: 700,000 chars ≈ 525 KB raw, safely under Firestore's 1 MiB doc limit. */
const CHUNK_B64_CHARS = 700000;

/* ------------------------------------------------------------------ */
/* base64 helpers (stack-safe for multi-MB buffers)                    */
/* ------------------------------------------------------------------ */

function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// Exported for the E2E byte-perfect round-trip probe (and any future
// consumer that needs the exact wire format).
export { bytesToBase64, base64ToBytes };

/* ------------------------------------------------------------------ */
/* Store / load                                                        */
/* ------------------------------------------------------------------ */

function myUid() {
  return window.HubbleNest?._state?.currentUser?.uid || null;
}

/**
 * Store a file's real bytes on Firestore (fileBlobs/{id} + chunks).
 * @returns {Promise<{blobId: string, name: string, mime: string, size: number}>}
 */
export async function storeFileBlob(file, onProgress = null) {
  const uid = myUid();
  if (!uid) throw new Error('Sign in to upload files.');
  if (file.size > FALLBACK_MAX_BYTES) {
    const err = new Error(
      `"${file.name}" is ${formatBytes(file.size)} — larger than the ${formatBytes(FALLBACK_MAX_BYTES)} secure in-app store, and Cloudinary is currently blocking this file type on your account. ` +
      'Fix (10 seconds, unblocks all sizes): console.cloudinary.com/settings/security → "PDF and ZIP files delivery" → tick "Allow delivery of PDF and ZIP files" → Save.'
    );
    err.deliveryBlocked = true;
    throw err;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const b64 = bytesToBase64(bytes);
  const chunks = [];
  for (let i = 0; i < b64.length; i += CHUNK_B64_CHARS) chunks.push(b64.slice(i, i + CHUNK_B64_CHARS));

  const ref = doc(collection(db, 'fileBlobs'));
  const meta = {
    ownerId: uid,
    ownerName: window.HubbleNest?._state?.userProfile?.displayName || 'Member',
    name: file.name || 'file',
    mime: file.type || 'application/octet-stream',
    size: file.size,
    chunkCount: chunks.length,
    createdAt: serverTimestamp()
  };

  // Parent + all chunk documents in ONE atomic batch (≤ 500 ops: 20 MB ≈ 40 chunks).
  const { writeBatch } = await import('./firebase.js');
  const batch = writeBatch(db);
  batch.set(ref, meta);
  chunks.forEach((data, i) => {
    batch.set(doc(db, 'fileBlobs', ref.id, 'chunks', String(i)), {
      ownerId: uid,
      i,
      data
    });
  });
  try {
    await batch.commit();
  } catch (err) {
    if (err?.code === 'permission-denied') {
      throw new Error(
        'The secure file store is not unlocked on your Firebase project yet — republish firestore.rules (adds the fileBlobs collection; README → Setup → step "Publish Firestore rules"). One-time, ~10 seconds.'
      );
    }
    throw err;
  }
  onProgress && onProgress(100, 'Stored securely');

  return { blobId: ref.id, name: meta.name, mime: meta.mime, size: meta.size };
}

/**
 * Load a stored file's bytes back out.
 * @returns {Promise<{bytes: Uint8Array, mime: string, name: string, size: number}>}
 */
export async function loadFileBlob(blobId, onProgress = null) {
  const parentSnap = await getDoc(doc(db, 'fileBlobs', blobId));
  if (!parentSnap.exists()) throw new Error('This file is no longer stored on HubbleNest.');
  const meta = parentSnap.data();

  const snap = await getDocs(query(collection(db, 'fileBlobs', blobId, 'chunks'), orderBy('i')));
  if (snap.empty) throw new Error('This file\'s data is missing.');

  const parts = [];
  let loaded = 0;
  snap.forEach((d) => parts.push(d.data()));
  parts.sort((a, b) => (a.i || 0) - (b.i || 0));

  let binary = '';
  const b64parts = parts.map((p) => String(p.data || ''));
  for (const part of b64parts) {
    binary += part;
    loaded += part.length;
    onProgress && onProgress(Math.min(99, Math.round((loaded / (meta.chunkCount * CHUNK_B64_CHARS)) * 100)));
  }
  const bytes = base64ToBytes(binary);
  return { bytes, mime: meta.mime || 'application/octet-stream', name: meta.name || 'file', size: meta.size || bytes.length };
}

/* ------------------------------------------------------------------ */
/* Receiver-side actions (user gesture)                                */
/* ------------------------------------------------------------------ */

/**
 * Download a stored file under its original name.
 * Exported to window.HubbleNest for inline onclick handlers.
 */
export async function downloadStoredFile(blobId, filename = null) {
  if (!blobId) return;
  try {
    showToast('Preparing your download…', 'info', 1800);
    const { bytes, mime, name } = await loadFileBlob(blobId);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || name || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    showToast('Download ready ✓', 'success', 2200);
  } catch (err) {
    console.warn('[HubbleNest] Stored-file download failed:', err?.code || err?.message || err);
    showToast(err.message || 'Could not download this file.', 'error', 6000);
  }
}

/**
 * Open a stored file in a new tab (PDFs/images display inline there).
 * Exported to window.HubbleNest for inline onclick handlers.
 */
export async function openStoredFile(blobId, filename = null) {
  if (!blobId) return;
  try {
    showToast('Opening…', 'info', 1500);
    const { bytes, mime, name } = await loadFileBlob(blobId);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const win = window.open(url, '_blank', 'noopener');
    if (!win) {
      // Popup blocked → fall back to a download with the real name.
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || name || 'file';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    console.warn('[HubbleNest] Stored-file open failed:', err?.code || err?.message || err);
    showToast(err.message || 'Could not open this file.', 'error', 6000);
  }
}

/* ------------------------------------------------------------------ */
/* The universal uploader every send path uses                         */
/* ------------------------------------------------------------------ */

/**
 * Upload a file ANYWHERE it will actually work:
 *  1. Cloudinary (images/video/audio always deliver; raw families too when
 *     the account unblocks them).
 *  2. If Cloudinary accepts the bytes but blocks DELIVERY (401 deny/ACL),
 *     store the file on Firestore instead — the attachment keeps working
 *     TODAY, no account setting required.
 * The returned shape is a superset of uploadToCloudinary's, so call sites
 * only need to carry { blobId, fallbackStored, mime } into the attachment.
 */
export async function uploadFileAnywhere(file, onProgress = null, maxFileSizeMB = 100) {
  try {
    return await uploadToCloudinary(file, onProgress, maxFileSizeMB);
  } catch (err) {
    if (err && err.deliveryBlocked) {
      const stored = await storeFileBlob(file, onProgress);
      return {
        url: '',
        blobId: stored.blobId,
        fallbackStored: true,
        resourceType: 'raw',
        format: (file.name.split('.').pop() || '').toLowerCase(),
        bytes: file.size,
        mime: stored.mime,
        originalFilename: file.name
      };
    }
    throw err;
  }
}

/** True when an attachment was served from the Firestore store. */
export function isStoredAttachment(att) {
  return !!att && typeof att.blobId === 'string' && att.blobId.length > 0;
}

/** Route family helper kept for callers that label attachments. */
export { cloudinaryEndpointFor };
