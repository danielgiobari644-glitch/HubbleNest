/**
 * HubbleNest Direct Share — hand files to another member with a code
 *
 * The sender creates a share and gets a 6-character code (e.g. K7QM2P) plus
 * a QR code that encodes a deep link into the app. The receiver types the
 * code — or simply scans the QR with their phone camera, which opens
 * HubbleNest pre-filled — and every file the sender adds appears on their
 * screen in real time. File BYTES go to Cloudinary; Firestore stores only
 * metadata under directShares/{code}.
 *
 * Realtime, real uploads, real downloads. Nothing simulated: if the share
 * does not exist, the app says so; if an upload fails, the error is real.
 */

import {
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  arrayUnion
} from './firebase.js';

import { uploadToCloudinary, validateFile, formatBytes } from './cloudinary.js';
import { generateQrDataUrl } from './qr.js';

import { showToast, escapeHtml, formatTimeAgo, getAvatarUrl } from './utils.js';

import { handlePermissionError } from './firestore-doctor.js';

/* ========================================================================
   State
   ======================================================================== */

let shareUnsubscribe = null;
let activeShareId = null;   // doc id == share code
let activeShareRole = null; // 'sender' | 'receiver'
const MAX_FILES_PER_SHARE = 10;

/* Unambiguous alphabet: no I/O/0/1/L confusion when read aloud or typed. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateShareCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

function shareUrlFor(code) {
  const base = window.location.origin + window.location.pathname;
  return `${base}?share=${code}`;
}

function stopShareListener() {
  shareUnsubscribe?.();
  shareUnsubscribe = null;
  activeShareId = null;
  activeShareRole = null;
}

export function stopDirectShare() {
  stopShareListener();
  setSenderPanelVisible(false);
  setReceiverPanelVisible(false);
  const picker = document.getElementById('ds-mode-picker');
  if (picker) picker.style.display = 'grid';
}

/* ========================================================================
   View plumbing
   ======================================================================== */

export function openDirectShareView(deepLinkCode = null) {
  stopDirectShare();
  if (deepLinkCode) {
    // Arrived via QR deep link — jump straight into receiving mode.
    setMode('receive');
    const input = document.getElementById('ds-code-input');
    if (input) input.value = deepLinkCode.toUpperCase();
    connectToShare(deepLinkCode.toUpperCase());
  }
}

function setSenderPanelVisible(visible) {
  const el = document.getElementById('ds-send-pane');
  if (el) el.style.display = visible ? 'block' : 'none';
  const createZone = document.getElementById('ds-create-zone');
  if (createZone) createZone.style.display = visible ? 'block' : 'none';
}

function setReceiverPanelVisible(visible) {
  const el = document.getElementById('ds-receive-pane');
  if (el) el.style.display = visible ? 'block' : 'none';
  // The code-entry zone re-appears whenever the pane is (re)opened;
  // connectToShare swaps it for the live file body once connected.
  const zone = document.getElementById('ds-receive-zone');
  if (zone) zone.style.display = visible ? 'block' : 'none';
  const body = document.getElementById('ds-receiver-body');
  if (body) body.style.display = 'none';
}

export function setMode(mode) {
  const picker = document.getElementById('ds-mode-picker');
  if (picker) picker.style.display = 'none';
  stopShareListener();
  setSenderPanelVisible(mode === 'send');
  setReceiverPanelVisible(mode === 'receive');
  if (mode === 'send') {
    // Reset the sender pane to its "create" state
    const manage = document.getElementById('ds-send-manage');
    if (manage) manage.style.display = 'none';
  }
}

export function backToSharePicker() {
  stopDirectShare();
}

/* ========================================================================
   Sender
   ======================================================================== */

export async function createDirectShare() {
  const me = window.HubbleNest?._state?.userProfile;
  const uid = window.HubbleNest?._state?.currentUser?.uid;
  if (!me || !uid) { showToast('Sign in to start a share.', 'error'); return; }

  const btn = document.getElementById('ds-create-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

  // Collision-safe: retry with fresh codes until one is free (3 tries max —
  // 31^6 space makes collisions practically impossible).
  let created = false;
  let code = null;
  try {
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      code = generateShareCode();
      const ref = doc(db, 'directShares', code);
      const existing = await getDoc(ref);
      if (existing.exists()) continue;
      await setDoc(ref, {
        code,
        ownerId: uid,
        ownerName: me.displayName || 'Member',
        ownerPhoto: me.photoURL || '',
        files: [],
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      created = true;
    }
  } catch (err) {
    console.error('Share creation failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'Rules on your Firebase project block Direct Share — run Connection Doctor.'
      : (err.message || 'Could not create the share.'), 'error');
    if (err?.code === 'permission-denied') handlePermissionError('direct share create');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create a share code'; }
  }

  if (!created) { showToast('Could not allocate a free code — try again.', 'error'); return; }

  enterSenderMode(code);
}

function enterSenderMode(code) {
  activeShareId = code;
  activeShareRole = 'sender';

  const createZone = document.getElementById('ds-create-zone');
  const manage = document.getElementById('ds-send-manage');
  if (createZone) createZone.style.display = 'none';
  if (manage) manage.style.display = 'block';

  const codeEl = document.getElementById('ds-code-display');
  if (codeEl) codeEl.textContent = code.split('').join(' ');

  const qrImg = document.getElementById('ds-qr-img');
  if (qrImg) {
    generateQrDataUrl(shareUrlFor(code), 240).then(dataUrl => {
      qrImg.src = dataUrl;
      qrImg.alt = `QR code for share ${code}`;
    }).catch(err => {
      console.warn('QR render failed:', err);
      const box = document.getElementById('ds-qr-box');
      if (box) box.innerHTML = `<div class="ds-qr-fallback">QR unavailable — share the code itself.</div>`;
    });
  }

  // Live mirror of the share (own doc) so file list updates instantly.
  subscribeShareDoc(code, renderSenderShare);
}

export async function addFilesToShare(fileList) {
  const files = Array.from(fileList || []);
  if (!activeShareId || activeShareRole !== 'sender' || files.length === 0) return;

  const statusEl = document.getElementById('ds-upload-status');
  const currentCount = document.querySelectorAll('.ds-file-card').length;

  if (currentCount + files.length > MAX_FILES_PER_SHARE) {
    showToast(`A share holds up to ${MAX_FILES_PER_SHARE} files.`, 'warning');
    return;
  }

  for (const file of files) {
    try {
      validateFile(file, 100);
    } catch (err) {
      showToast(err.message, 'error');
      continue;
    }
    if (statusEl) statusEl.textContent = `Uploading ${file.name}…`;
    try {
      const res = await uploadToCloudinary(file, (percent) => {
        if (statusEl) statusEl.textContent = `Uploading ${file.name}… ${Math.round(percent)}%`;
      }, 100);
      await updateDoc(doc(db, 'directShares', activeShareId), {
        files: arrayUnion({
          url: res.url,
          resourceType: res.resourceType,
          originalFilename: res.originalFilename || file.name,
          size: res.bytes || file.size,
          addedAt: Date.now()
        }),
        updatedAt: serverTimestamp()
      });
      if (statusEl) statusEl.textContent = '';
    } catch (err) {
      console.error('Upload to share failed:', err);
      if (statusEl) statusEl.textContent = '';
      showToast(`Upload failed for ${file.name}: ${err.message || 'error'}`, 'error');
    }
  }

  if (statusEl) statusEl.textContent = '';
  const input = document.getElementById('ds-file-input');
  if (input) input.value = '';
}

export async function copyShareLink() {
  if (!activeShareId) return;
  const url = shareUrlFor(activeShareId);
  try {
    await navigator.clipboard.writeText(url);
    showToast('Share link copied — anyone with it can receive these files.', 'success');
  } catch (e) {
    // Fallback for blocked clipboard
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Share link copied.', 'success');
    } catch (err) {
      showToast(`Copy blocked by the browser — the code is ${activeShareId}.`, 'warning');
    }
    ta.remove();
  }
}

export async function closeDirectShare() {
  if (!activeShareId || activeShareRole !== 'sender') return;
  const code = activeShareId;
  if (!window.confirm(`Close share ${code}? Nobody will be able to receive its files anymore.`)) return;
  try {
    await deleteDoc(doc(db, 'directShares', code));
    showToast('Share closed.', 'info');
    stopDirectShare();
  } catch (err) {
    console.error('Share close failed:', err);
    showToast('Could not close the share.', 'error');
  }
}

function renderSenderShare(share) {
  if (!share || activeShareRole !== 'sender') return;
  const list = document.getElementById('ds-send-files-list');
  if (!list) return;
  list.innerHTML = renderFileCards(share, true);
  const count = document.getElementById('ds-file-count');
  if (count) count.textContent = `${(share.files || []).length} / ${MAX_FILES_PER_SHARE} files`;
}

/* ========================================================================
   Receiver
   ======================================================================== */

export async function connectToShare(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  const errEl = document.getElementById('ds-error');
  const body = document.getElementById('ds-receiver-body');

  const showErr = (msg) => {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = msg; }
  };

  if (!window.HubbleNest?._state?.currentUser) {
    showErr('Sign in to HubbleNest first — shares are members-only.');
    return;
  }

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    showErr('Share codes are 6 letters/digits — check and try again.');
    return;
  }

  if (errEl) errEl.style.display = 'none';
  const connectBtn = document.getElementById('ds-connect-btn');
  if (connectBtn) { connectBtn.disabled = true; connectBtn.textContent = 'Connecting…'; }

  try {
    const snap = await getDoc(doc(db, 'directShares', code));
    if (connectBtn) { connectBtn.disabled = false; connectBtn.textContent = 'Connect'; }
    if (!snap.exists()) {
      showErr(`No share with code ${code} exists. It may have been closed — ask the sender for a fresh code.`);
      return;
    }
    activeShareId = code;
    activeShareRole = 'receiver';
    // Hide the code-entry zone, reveal the live body
    const zone = document.getElementById('ds-receive-zone');
    if (zone) zone.style.display = 'none';
    if (body) { body.style.display = 'block'; body.innerHTML = `<div class="ds-connecting">Connected — waiting for files…</div>`; }
    subscribeShareDoc(code, renderReceiverShare);
  } catch (err) {
    if (connectBtn) { connectBtn.disabled = false; connectBtn.textContent = 'Connect'; }
    console.error('Share connect failed:', err);
    showErr(err?.code === 'permission-denied'
      ? 'Rules on your Firebase project block Direct Share — run Connection Doctor.'
      : `Could not reach the share: ${err?.message || 'unknown error'}`);
    if (err?.code === 'permission-denied') handlePermissionError('direct share connect');
  }
}

function renderReceiverShare(share) {
  if (!share || activeShareRole !== 'receiver') return;
  const body = document.getElementById('ds-receiver-body');
  if (!body) return;

  const files = share.files || [];
  body.innerHTML = `
    <div class="ds-peer-card">
      <img src="${getAvatarUrl(share.ownerPhoto, share.ownerName)}" alt="" />
      <div>
        <div class="ds-peer-name">${escapeHtml(share.ownerName || 'Member')}</div>
        <div class="ds-peer-sub">is sharing ${files.length} file${files.length === 1 ? '' : 's'} with you · live</div>
      </div>
    </div>
    ${files.length === 0
      ? `<div class="ds-connecting">No files yet — they appear here the moment the sender adds them.</div>`
      : renderFileCards(share, false)}`;
}

/* ========================================================================
   Shared render bits
   ======================================================================== */

function renderFileCards(share, senderView) {
  const files = share.files || [];
  if (files.length === 0) {
    return senderView
      ? `<div class="ds-connecting">Add files below — anyone with code <b>${escapeHtml(share.code || '')}</b> sees them instantly.</div>`
      : `<div class="ds-connecting">No files yet.</div>`;
  }

  return `<div class="ds-files-list">` + files.map((f, idx) => {
    const isImg = (f.resourceType || '').startsWith('image');
    const isVid = (f.resourceType || '').startsWith('video');
    let preview = '';
    if (isImg) {
      preview = `<a href="${f.url}" target="_blank" rel="noopener noreferrer" class="ds-file-preview"><img src="${f.url}" alt="${escapeHtml(f.originalFilename || '')}" loading="lazy" decoding="async" /></a>`;
    } else if (isVid) {
      preview = `<video src="${f.url}" controls preload="metadata" class="ds-file-video"></video>`;
    }
    return `
      <div class="ds-file-card">
        ${preview}
        <div class="ds-file-info">
          <div class="ds-file-name" title="${escapeHtml(f.originalFilename || '')}">${escapeHtml(f.originalFilename || 'File')}</div>
          <div class="ds-file-meta">${formatBytes(f.size || 0)} · ${escapeHtml(f.resourceType || 'file')} · ${formatTimeAgo(f.addedAt)}</div>
        </div>
        <a class="btn btn-primary btn-sm" href="${f.url}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(f.originalFilename || 'file')}">Download</a>
      </div>`;
  }).join('') + `</div>`;
}

function subscribeShareDoc(code, renderFn) {
  stopShareListener();
  activeShareId = code;
  shareUnsubscribe = onSnapshot(doc(db, 'directShares', code), (snap) => {
    if (!snap.exists()) {
      showToast(activeShareRole === 'receiver'
        ? 'The sender closed this share.'
        : 'This share was removed.', 'info');
      stopDirectShare();
      return;
    }
    renderFn({ id: snap.id, ...snap.data() });
  }, (err) => {
    console.error('Share listener error:', err);
    if (err?.code === 'permission-denied') handlePermissionError('direct share listener');
    const errEl = document.getElementById('ds-error');
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = `Live connection lost (${err.code || 'error'}). Reconnect with the code.`; }
  });
}
