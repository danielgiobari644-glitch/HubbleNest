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

// Universal uploads with the Firestore byte-store fallback (blocked families).
import { uploadFileAnywhere, isStoredAttachment } from './file-blob.js';

import { showToast, escapeHtml, formatTimeAgo, getAvatarUrl } from './utils.js';

import { handlePermissionError } from './firestore-doctor.js';

/* ========================================================================
   State
   ======================================================================== */

let shareUnsubscribe = null;
let activeShareId = null;   // doc id == share code
let activeShareRole = null; // 'sender' | 'receiver'
const MAX_FILES_PER_SHARE = 10;

/* Files already rendered — only NEW ones get the entrance animation. */
let seenShareFiles = new Set();

function fileKey(f) {
  return `${f.url || ''}|${f.originalFilename || ''}|${f.addedAt || 0}`;
}

function markSeenFiles(files) {
  (files || []).forEach((f) => seenShareFiles.add(fileKey(f)));
}

function freshFileKey(file) {
  return !seenShareFiles.has(fileKey(file));
}

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
  seenShareFiles = new Set();
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
    try {
      // generateQrDataUrl is SYNCHRONOUS (returns a PNG data URL string).
      // The old code chained .then() on it, which threw
      // "TypeError: generateQrDataUrl(...).then is not a function" and —
      // because the throw happened mid-function — silently killed the live
      // file-list subscription below, making the whole share look dead.
      qrImg.src = generateQrDataUrl(shareUrlFor(code), 240);
      qrImg.alt = `QR code for share ${code}`;
    } catch (err) {
      console.warn('QR render failed:', err);
      const box = document.getElementById('ds-qr-box');
      if (box) box.innerHTML = `<div class="ds-qr-fallback">QR unavailable — share the code itself.</div>`;
    }
  }

  // Live mirror of the share (own doc) so file list updates instantly.
  subscribeShareDoc(code, renderSenderShare);

  // Radar sweep around the QR while the share is open — eye-catching,
  // modern, and it doubles as the "this share is live" indicator.
  const qrBox = document.getElementById('ds-qr-box');
  if (qrBox && !qrBox.querySelector('.ds-qr-sweep')) {
    qrBox.classList.add('ds-qr-live');
    qrBox.insertAdjacentHTML('beforeend', '<span class="ds-qr-sweep" aria-hidden="true"></span><span class="ds-qr-sweep ds-qr-sweep-delay" aria-hidden="true"></span>');
  }

  const beam = document.getElementById('ds-transfer-beam');
  if (beam) beam.classList.remove('ds-beam-active');
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

  const beam = document.getElementById('ds-transfer-beam');
  if (beam) beam.classList.add('ds-beam-active');

  for (const file of files) {
    try {
      // Direct Share accepts EVERY file type — code, archives, anything.
      validateFile(file, 100, true);
    } catch (err) {
      showToast(err.message, 'error');
      continue;
    }

    // Animated per-file transfer card (eye-catching progress with shimmer).
    if (statusEl) {
      statusEl.style.display = 'flex';
      statusEl.innerHTML = `
        <div class="ds-transfer">
          <span class="ds-transfer-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </span>
          <div class="ds-transfer-info">
            <div class="ds-transfer-name">${escapeHtml(file.name)}</div>
            <div class="ds-transfer-bar"><span class="ds-transfer-fill" style="width:0%"></span></div>
          </div>
          <span class="ds-transfer-pct" id="ds-transfer-pct">0%</span>
        </div>`;
    }

    try {
      const res = await uploadFileAnywhere(file, (percent) => {
        const fill = statusEl?.querySelector('.ds-transfer-fill');
        const pct = document.getElementById('ds-transfer-pct');
        const p = Math.round(percent);
        if (fill) fill.style.width = `${p}%`;
        if (pct) pct.textContent = `${p}%`;
      }, 100);
      await updateDoc(doc(db, 'directShares', activeShareId), {
        files: arrayUnion({
          url: res.url || '',
          blobId: res.blobId || null,
          fallbackStored: !!res.fallbackStored,
          mime: file.type || 'application/octet-stream',
          resourceType: res.resourceType,
          originalFilename: res.originalFilename || file.name,
          size: res.bytes || file.size,
          addedAt: Date.now()
        }),
        updatedAt: serverTimestamp()
      });
      // Success flash on the transfer card before it clears.
      if (statusEl) {
        statusEl.classList.add('ds-transfer-done');
        const pct = document.getElementById('ds-transfer-pct');
        if (pct) pct.textContent = '✓';
        setTimeout(() => { statusEl.classList.remove('ds-transfer-done'); }, 700);
      }
    } catch (err) {
      console.error('Upload to share failed:', err);
      showToast(`Upload failed for ${file.name}: ${err.message || 'error'}`, 'error');
    }
  }

  if (statusEl) {
    setTimeout(() => {
      statusEl.style.display = 'none';
      statusEl.innerHTML = '';
    }, 650);
  }
  if (beam) setTimeout(() => beam.classList.remove('ds-beam-active'), 900);

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
  markSeenFiles(share.files || []);
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
  const incoming = files.filter(freshFileKey).length;
  body.innerHTML = `
    <div class="ds-peer-card ${incoming > 0 ? 'ds-peer-receiving' : ''}">
      <span class="ds-peer-rings" aria-hidden="true"></span>
      <img src="${getAvatarUrl(share.ownerPhoto, share.ownerName)}" alt="" />
      <div>
        <div class="ds-peer-name">${escapeHtml(share.ownerName || 'Member')}</div>
        <div class="ds-peer-sub"><span class="ds-live-dot"></span>is sharing ${files.length} file${files.length === 1 ? '' : 's'} with you · live</div>
      </div>
    </div>
    ${files.length === 0
      ? `<div class="ds-connecting">No files yet — they appear here the moment the sender adds them.</div>`
      : renderFileCards(share, false)}`;
  markSeenFiles(files);
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
    if (isStoredAttachment(f)) {
      // Stored on HubbleNest's secure store — no remote URL to preview.
      preview = '';
    } else if (isImg) {
      preview = `<a href="${f.url}" target="_blank" rel="noopener noreferrer" class="ds-file-preview"><img src="${f.url}" alt="${escapeHtml(f.originalFilename || '')}" loading="lazy" decoding="async" /></a>`;
    } else if (isVid) {
      preview = `<video src="${f.url}" controls preload="metadata" class="ds-file-video"></video>`;
    }
    // Brand-new files (just arrived on this snapshot) slide in with a glow;
    // older ones render without re-animating.
    const isNew = freshFileKey(f);
    const name = escapeHtml(f.originalFilename || 'file');
    const downloadAction = isStoredAttachment(f)
      ? `<button type="button" class="btn btn-primary btn-sm ds-download-btn" onclick="window.HubbleNest.downloadStoredFile('${escapeHtml(f.blobId)}', '${name}')">Download</button>`
      : `<a class="btn btn-primary btn-sm ds-download-btn" href="${f.url}" target="_blank" rel="noopener noreferrer" download="${name}">Download</a>`;
    return `
      <div class="ds-file-card ${isNew ? 'ds-file-card-in' : ''}">
        ${preview}
        <div class="ds-file-info">
          <div class="ds-file-name" title="${name}">${name}</div>
          <div class="ds-file-meta">${formatBytes(f.size || 0)} · ${escapeHtml(f.resourceType || 'file')} · ${formatTimeAgo(f.addedAt)}${isStoredAttachment(f) ? ' · secured on HubbleNest' : ''}</div>
        </div>
        ${downloadAction}
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
