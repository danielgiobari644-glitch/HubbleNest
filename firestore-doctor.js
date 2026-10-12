/**
 * HubbleNest Firestore Connection Doctor
 *
 * Answers the question that "Missing or insufficient permissions" never
 * answers on its own: WHICH rule on the LIVE project is blocking me, and
 * what exactly should I do about it?
 *
 * The doctor fires a series of harmless, read-mostly probes against every
 * collection the private-chat flow (and the community feed) depends on,
 * then renders a verdict panel:
 *
 *   - Probes that fail with permission-denied while the shipped rules allow
 *     them  →  the project is NOT running the HubbleNest rules. The panel
 *     offers one-click "Copy rules" (fetches ./firestore.rules from the
 *     deployed app itself, so the copied text ALWAYS matches this build)
 *     and a deep link straight into the Firebase Console rules editor.
 *
 *   - Probes that all pass  →  rules are live and correct; the failure the
 *     user saw came from a stale cached app bundle. One click repairs the
 *     cache (unregisters service workers, clears Cache Storage, reloads).
 *
 *   - Not signed in / offline  →  says so plainly instead of probing.
 *
 * Zero placeholders: every probe is a real Firestore round-trip using the
 * signed-in user's real credentials.
 */

import {
  db,
  auth,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  limit,
  serverTimestamp
} from './firebase.js';

import { escapeHtml } from './utils.js';

const CONSOLE_RULES_URL = 'https://console.firebase.google.com/project/hubblenest/firestore/rules';

/* Fallback rules excerpt (used only if ./firestore.rules cannot be fetched).
   The primary source is always the deployed firestore.rules file itself. */
const RULES_FALLBACK = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function fieldStr(data, key) {
      return data.get(key, '') is string ? data.get(key, '') : '';
    }
    match /users/{userId} {
      allow read: if true;
      allow create, update: if request.auth != null && request.auth.uid == userId;
    }
    match /chatRequests/{requestId} {
      allow get: if request.auth != null && (
        !exists(/databases/$(database)/documents/chatRequests/$(requestId)) ||
        get(/databases/$(database)/documents/chatRequests/$(requestId)).data.get('senderId', '') == request.auth.uid ||
        get(/databases/$(database)/documents/chatRequests/$(requestId)).data.get('receiverId', '') == request.auth.uid);
      allow list: if request.auth != null && (
        resource.data.get('senderId', '') == request.auth.uid ||
        resource.data.get('receiverId', '') == request.auth.uid);
      allow create: if request.auth != null && request.resource.data.get('senderId', '') == request.auth.uid;
      allow update: if request.auth != null && (
        resource.data.get('receiverId', '') == request.auth.uid ||
        resource.data.get('senderId', '') == request.auth.uid);
      allow delete: if request.auth != null && (
        !exists(/databases/$(database)/documents/chatRequests/$(requestId)) ||
        resource.data.get('senderId', '') == request.auth.uid ||
        resource.data.get('receiverId', '') == request.auth.uid);
    }
    match /conversations/{conversationId} {
      allow get: if request.auth != null && (
        !exists(/databases/$(database)/documents/conversations/$(conversationId)) ||
        request.auth.uid in get(/databases/$(database)/documents/conversations/$(conversationId)).data.get('participants', []));
      allow list: if request.auth != null && request.auth.uid in resource.data.get('participants', []);
      allow create: if request.auth != null && request.auth.uid in request.resource.data.get('participants', []);
      allow update: if request.auth != null && request.auth.uid in resource.data.get('participants', []);
      match /messages/{messageId} {
        allow read: if request.auth != null && (
          !exists(/databases/$(database)/documents/conversations/$(conversationId)) ||
          request.auth.uid in get(/databases/$(database)/documents/conversations/$(conversationId)).data.get('participants', []));
        allow create: if request.auth != null &&
          request.auth.uid in get(/databases/$(database)/documents/conversations/$(conversationId)).data.get('participants', []) &&
          request.resource.data.get('senderId', '') == request.auth.uid;
        allow delete: if request.auth != null && resource.data.get('senderId', '') == request.auth.uid;
      }
    }
    match /notifications/{notificationId} {
      allow read, update, delete: if request.auth != null && resource.data.get('userId', '') == request.auth.uid;
      allow create: if request.auth != null;
    }
    match /feedPosts/{postId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.get('authorId', '') == request.auth.uid;
      allow update: if request.auth != null && (
        resource.data.get('authorId', '') == request.auth.uid ||
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['likeCount', 'commentCount', 'likedBy']));
      allow delete: if request.auth != null && resource.data.get('authorId', '') == request.auth.uid;
      match /comments/{commentId} {
        allow read: if request.auth != null;
        allow create: if request.auth != null && request.resource.data.get('authorId', '') == request.auth.uid;
        allow update, delete: if request.auth != null && resource.data.get('authorId', '') == request.auth.uid;
      }
    }
    match /games/{gameId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.get('authorId', '') == request.auth.uid;
      allow update: if request.auth != null && (
        resource.data.get('authorId', '') == request.auth.uid ||
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['plays', 'likedBy']));
      allow delete: if request.auth != null && resource.data.get('authorId', '') == request.auth.uid;
    }
    match /directShares/{shareId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.get('ownerId', '') == request.auth.uid;
      allow update, delete: if request.auth != null && resource.data.get('ownerId', '') == request.auth.uid;
    }
  }
}`;

const DOCTOR_STYLES = `
#hn-doctor-overlay { position: fixed; inset: 0; z-index: 99998; background: rgba(4, 7, 14, 0.72);
  backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: hnDocFade 200ms ease; font-family: 'Inter', -apple-system, sans-serif; }
@keyframes hnDocFade { from { opacity: 0; } to { opacity: 1; } }
.hn-doctor { width: min(680px, 100%); max-height: min(84vh, 780px); overflow: hidden auto;
  background: var(--bg-surface-elevated, #121b30); border: 1px solid var(--border-subtle, rgba(148,163,184,.12));
  border-radius: var(--radius-xl, 22px); box-shadow: var(--shadow-lg, 0 24px 60px rgba(2,6,16,.6)); }
.hn-doctor-head { display: flex; align-items: center; gap: 14px; padding: 22px 26px 16px; }
.hn-doctor-glyph { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; flex-shrink: 0;
  background: var(--accent-subtle, rgba(108,111,245,.14)); color: var(--accent-primary, #6c6ff5); }
.hn-doctor-head h2 { margin: 0; font-size: 1.12rem; color: var(--text-primary, #edf1f9); font-weight: 700; }
.hn-doctor-head p { margin: 3px 0 0; font-size: .82rem; color: var(--text-muted, #64748b); }
.hn-doctor-close { margin-left: auto; border: 0; background: transparent; color: var(--text-muted, #64748b);
  font-size: 20px; cursor: pointer; padding: 6px 10px; border-radius: 10px; line-height: 1; }
.hn-doctor-close:hover { background: var(--bg-hover, rgba(255,255,255,.05)); color: var(--text-primary, #edf1f9); }
.hn-doctor-body { padding: 4px 26px 8px; }
.hn-doctor-probes { display: flex; flex-direction: column; gap: 8px; }
.hn-probe { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 12px;
  background: var(--bg-surface, #0d1424); border: 1px solid var(--border-subtle, rgba(148,163,184,.09)); }
.hn-probe-ico { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; flex-shrink: 0;
  font-size: 12px; font-weight: 800; }
.hn-probe.ok .hn-probe-ico { background: rgba(52, 211, 153, .14); color: var(--status-success, #34d399); }
.hn-probe.fail .hn-probe-ico { background: rgba(248, 113, 113, .14); color: var(--status-danger, #f87171); }
.hn-probe.busy .hn-probe-ico { background: var(--accent-subtle, rgba(108,111,245,.14)); color: var(--accent-primary, #6c6ff5); }
.hn-probe-name { font-size: .88rem; font-weight: 600; color: var(--text-primary, #edf1f9); }
.hn-probe-desc { font-size: .74rem; color: var(--text-muted, #64748b); margin-top: 2px; }
.hn-probe-state { margin-left: auto; font-size: .74rem; font-weight: 700; letter-spacing: .02em; }
.hn-probe.ok .hn-probe-state { color: var(--status-success, #34d399); }
.hn-probe.fail .hn-probe-state { color: var(--status-danger, #f87171); }
.hn-probe.busy .hn-probe-state { color: var(--accent-primary, #6c6ff5); }
.hn-doctor-verdict { margin-top: 18px; border-radius: 14px; padding: 16px 18px; font-size: .86rem;
  line-height: 1.55; border: 1px solid var(--border-subtle, rgba(148,163,184,.1)); }
.hn-doctor-verdict.bad { background: rgba(248, 113, 113, .07); border-color: rgba(248, 113, 113, .25); }
.hn-doctor-verdict.good { background: rgba(52, 211, 153, .07); border-color: rgba(52, 211, 153, .25); }
.hn-doctor-verdict.warn { background: rgba(251, 191, 36, .06); border-color: rgba(251, 191, 36, .25); }
.hn-doctor-verdict b { color: var(--text-primary, #edf1f9); }
.hn-doctor-verdict ol { margin: 8px 0 0; padding-left: 20px; color: var(--text-secondary, #9aa7bd); }
.hn-doctor-verdict ol li { margin-bottom: 4px; }
.hn-doctor-actions { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px 26px 24px; }
.hn-doctor-btn { border: 0; cursor: pointer; font-weight: 600; font-size: .84rem; padding: 10px 16px;
  border-radius: 12px; display: inline-flex; align-items: center; gap: 8px; transition: all 160ms ease; }
.hn-doctor-btn.primary { background: var(--accent-gradient, linear-gradient(135deg,#5a5df0,#8b5cf6)); color: #fff;
  box-shadow: var(--shadow-glow, 0 8px 28px rgba(108,111,245,.35)); }
.hn-doctor-btn.primary:hover { transform: translateY(-1px); }
.hn-doctor-btn.ghost { background: var(--bg-hover, rgba(255,255,255,.05)); color: var(--text-secondary, #9aa7bd); }
.hn-doctor-btn.ghost:hover { color: var(--text-primary, #edf1f9); }
.hn-doctor-btn:disabled { opacity: .55; cursor: wait; transform: none !important; }
`;

let doctorOverlay = null;
let lastAutoOpen = 0;
const AUTO_OPEN_COOLDOWN_MS = 10 * 60 * 1000;

function ensureDoctorStyles() {
  if (!document.getElementById('hn-doctor-styles')) {
    const tag = document.createElement('style');
    tag.id = 'hn-doctor-styles';
    tag.textContent = DOCTOR_STYLES;
    document.head.appendChild(tag);
  }
}

function errCode(err) {
  return err?.code?.replace('firestore/', '') || err?.code || 'unknown';
}

/**
 * Run one probe. Returns { ok, code } — ok=false always carries the code so
 * the verdict can be precise instead of hand-wavy.
 */
async function probe(label, description, fn) {
  try {
    await fn();
    return { label, description, ok: true, code: null };
  } catch (err) {
    return { label, description, ok: false, code: errCode(err) };
  }
}

/**
 * The probe battery. Each entry maps 1:1 to a rule that the shipped
 * firestore.rules file explicitly grants to any signed-in member.
 */
export async function runPermissionProbes() {
  const uid = auth.currentUser?.uid;
  if (!uid) return { signedIn: false, probes: [] };

  const rand = Math.random().toString(36).slice(2, 8);
  const probeReqId = `__doctor__${uid.slice(0, 6)}__${rand}`;
  const probes = [];

  // 1. Own profile document — the foundation of everything.
  probes.push(await probe(
    'Read my profile',
    'users/{your uid} — needed to load the app at all',
    () => getDoc(doc(db, 'users', uid))
  ));

  // 2. chatRequests GET on a NON-existent id — proves the null-safe
  //    existence-check rule is live (this exact read used to hard-fail).
  probes.push(await probe(
    'Check chat-request existence',
    'chatRequests/{new id} — the "does a request already exist" check',
    () => getDoc(doc(db, 'chatRequests', `__doctor_missing__${rand}`))
  ));

  // 3 & 4. chatRequests LIST in both directions.
  probes.push(await probe(
    'List requests I sent',
    'chatRequests where senderId == you',
    () => getDocs(query(collection(db, 'chatRequests'), where('senderId', '==', uid), limit(1)))
  ));
  probes.push(await probe(
    'List requests I received',
    'chatRequests where receiverId == you',
    () => getDocs(query(collection(db, 'chatRequests'), where('receiverId', '==', uid), limit(1)))
  ));

  // 5. chatRequests CREATE + DELETE with a self-addressed doctor document.
  const reqRef = doc(db, 'chatRequests', probeReqId);
  probes.push(await probe(
    'Create & remove a chat request',
    'chatRequests create → delete (self-addressed, cleaned up instantly)',
    async () => {
      await setDoc(reqRef, {
        senderId: uid,
        receiverId: uid,
        senderName: 'Connection Doctor',
        status: 'doctor-probe',
        createdAt: serverTimestamp()
      });
      await deleteDoc(reqRef);
    }
  ));

  // 6. conversations GET on a non-existent id.
  probes.push(await probe(
    'Check conversation existence',
    'conversations/{new id} — the "does this DM already exist" check',
    () => getDoc(doc(db, 'conversations', `__doctor_missing__${rand}`))
  ));

  // 7. conversations LIST (array-contains).
  probes.push(await probe(
    'List my conversations',
    'conversations where participants contains you',
    () => getDocs(query(collection(db, 'conversations'), where('participants', 'array-contains', uid), limit(1)))
  ));

  // 8. messages READ on a not-yet-created conversation — proves the
  //    null-safe messages rule that brand-new DMs depend on.
  probes.push(await probe(
    'Open a brand-new chat',
    'conversations/{new}/messages — listener attach on a fresh conversation',
    () => getDocs(query(collection(db, 'conversations', `__doctor_missing__${rand}`, 'messages'), limit(1)))
  ));

  // 9. notifications LIST.
  probes.push(await probe(
    'List my notifications',
    'notifications where userId == you',
    () => getDocs(query(collection(db, 'notifications'), where('userId', '==', uid), limit(1)))
  ));

  // 10. feedPosts READ (the new community feed collection).
  probes.push(await probe(
    'Load community feed',
    'feedPosts — the Home community feed collection',
    () => getDocs(query(collection(db, 'feedPosts'), limit(1)))
  ));

  return { signedIn: true, probes };
}

function verdictFor(results) {
  const failed = results.probes.filter(p => !p.ok);
  const chatCoreFailed = failed.some(p =>
    ['Check chat-request existence', 'List requests I sent', 'List requests I received',
     'Create & remove a chat request', 'Check conversation existence',
     'List my conversations', 'Open a brand-new chat'].includes(p.label));

  if (failed.length === 0) {
    return {
      tone: 'good',
      html: `<b>Everything passed — your rules are live and correct.</b><br>
        If a screen still said "Missing or insufficient permissions", your browser was almost certainly
        running an older cached copy of HubbleNest. Use <b>Repair app cache</b> below, then sign in again —
        that forces one clean reload of every file.`
    };
  }

  if (chatCoreFailed) {
    return {
      tone: 'bad',
      html: `<b>Your Firebase project is not running the HubbleNest rules yet.</b>
        The reads and writes above are explicitly granted by the firestore.rules file shipped with this
        build — if they are denied, the rules editor in your console still holds different (older) text.
        Fix it in under a minute:<br>
        <ol>
          <li>Click <b>Copy rules</b> below — this copies the exact rules file that ships with this build.</li>
          <li>Open the <b>Rules editor</b> (button below), select <b>all existing text</b> and delete it, then paste.</li>
          <li>Press <b>Publish</b> and wait for the confirmation banner.</li>
          <li>Come back here and press <b>Run again</b> — every row must turn green.</li>
        </ol>`
    };
  }

  if (failed.every(p => p.code === 'unavailable' || p.code === 'failed-precondition')) {
    return {
      tone: 'warn',
      html: `<b>Firestore could not be reached (${failed.map(p => p.code).join(', ')}).</b>
        You appear to be offline or the network blocked the request. Reconnect and run the doctor again.`
    };
  }

  return {
    tone: 'bad',
    html: `<b>${failed.length} check${failed.length === 1 ? '' : 's'} failed</b> — the live rules differ from this build for:
      ${failed.map(p => `<b>${escapeHtml(p.label)}</b> (${escapeHtml(p.code)})`).join(', ')}. Republish the shipped
      firestore.rules with <b>Copy rules</b> below, then run the doctor again.`
  };
}

/**
 * Render + open the doctor panel. Safe to call repeatedly (re-uses overlay).
 */
export function runFirestoreDoctor() {
  ensureDoctorStyles();
  closeDoctor();

  const overlay = document.createElement('div');
  overlay.id = 'hn-doctor-overlay';
  overlay.innerHTML = `
    <div class="hn-doctor" role="dialog" aria-modal="true" aria-label="Connection Doctor">
      <div class="hn-doctor-head">
        <div class="hn-doctor-glyph">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        </div>
        <div>
          <h2>Connection Doctor</h2>
          <p>Live permission checks against your Firebase project — real reads, no guesses.</p>
        </div>
        <button type="button" class="hn-doctor-close" title="Close" aria-label="Close">✕</button>
      </div>
      <div class="hn-doctor-body">
        <div class="hn-doctor-probes" id="hn-doctor-probes"></div>
        <div class="hn-doctor-verdict warn" id="hn-doctor-verdict" style="display:none;"></div>
      </div>
      <div class="hn-doctor-actions">
        <button type="button" class="hn-doctor-btn primary" id="hn-doctor-copy">Copy rules</button>
        <button type="button" class="hn-doctor-btn ghost" id="hn-doctor-console">Open Rules editor</button>
        <button type="button" class="hn-doctor-btn ghost" id="hn-doctor-repair">Repair app cache</button>
        <button type="button" class="hn-doctor-btn ghost" id="hn-doctor-rerun">Run again</button>
      </div>
    </div>`;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDoctor();
  });
  overlay.querySelector('.hn-doctor-close').addEventListener('click', closeDoctor);
  overlay.querySelector('#hn-doctor-rerun').addEventListener('click', () => runFirestoreDoctor());
  overlay.querySelector('#hn-doctor-console').addEventListener('click', () => {
    window.open(CONSOLE_RULES_URL, '_blank', 'noopener');
  });
  overlay.querySelector('#hn-doctor-copy').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    let rulesText = '';
    try {
      const res = await fetch('./firestore.rules?v=' + Date.now(), { cache: 'no-store' });
      if (res.ok) rulesText = await res.text();
    } catch (e) { /* fall through to embedded excerpt */ }
    if (!rulesText) rulesText = RULES_FALLBACK;
    try {
      await navigator.clipboard.writeText(rulesText);
      btn.textContent = 'Copied ✓';
    } catch (e) {
      // Clipboard API can be blocked (non-secure context / iframe). Fall back to a selection copy.
      const ta = document.createElement('textarea');
      ta.value = rulesText;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); btn.textContent = 'Copied ✓'; }
      catch (err) { btn.textContent = 'Copy failed'; }
      ta.remove();
    }
    setTimeout(() => { btn.textContent = 'Copy rules'; btn.disabled = false; }, 2600);
  });
  overlay.querySelector('#hn-doctor-repair').addEventListener('click', async () => {
    const btn = overlay.querySelector('#hn-doctor-repair');
    btn.disabled = true;
    btn.textContent = 'Repairing…';
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches?.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) { /* best-effort cleanup */ }
    setTimeout(() => window.location.reload(), 400);
  });

  document.body.appendChild(overlay);
  doctorOverlay = overlay;
  executeDoctorRun();
}

async function executeDoctorRun() {
  const listEl = document.getElementById('hn-doctor-probes');
  const verdictEl = document.getElementById('hn-doctor-verdict');
  if (!listEl || !verdictEl) return;

  if (!auth.currentUser) {
    listEl.innerHTML = `<div class="hn-probe busy"><div class="hn-probe-ico">i</div>
      <div><div class="hn-probe-name">Not signed in yet</div>
      <div class="hn-doctor-desc">Sign in to HubbleNest first — the doctor tests permissions with your real account.</div></div></div>`;
    verdictEl.style.display = 'block';
    verdictEl.className = 'hn-doctor-verdict warn';
    verdictEl.innerHTML = `<b>Sign in first.</b> The doctor probes Firestore with your credentials, so it needs an active session.`;
    return;
  }

  listEl.innerHTML = '';
  verdictEl.style.display = 'none';

  const results = await runPermissionProbes();

  if (!results.signedIn) {
    listEl.innerHTML = `<div class="hn-probe busy"><div class="hn-probe-ico">i</div>
      <div><div class="hn-probe-name">Signed out during the check</div></div></div>`;
    return;
  }

  listEl.innerHTML = results.probes.map(p => `
    <div class="hn-probe ${p.ok ? 'ok' : 'fail'}">
      <div class="hn-probe-ico">${p.ok ? '✓' : '✕'}</div>
      <div>
        <div class="hn-probe-name">${escapeHtml(p.label)}</div>
        <div class="hn-probe-desc">${escapeHtml(p.description)}${p.ok ? '' : ` — denied with <b>${escapeHtml(p.code)}</b>`}</div>
      </div>
      <div class="hn-probe-state">${p.ok ? 'ALLOWED' : 'DENIED'}</div>
    </div>`).join('');

  const verdict = verdictFor(results);
  verdictEl.style.display = 'block';
  verdictEl.className = `hn-doctor-verdict ${verdict.tone}`;
  verdictEl.innerHTML = verdict.html;
}

export function closeDoctor() {
  doctorOverlay?.remove();
  doctorOverlay = null;
}

/**
 * Hook for chat/listener error callbacks: open the doctor automatically the
 * first time a permission-denied appears in a session, then stay quiet for
 * 10 minutes (manual runs via the menu are never throttled).
 */
export function handlePermissionError(source) {
  const now = Date.now();
  if (now - lastAutoOpen < AUTO_OPEN_COOLDOWN_MS) return;
  lastAutoOpen = now;
  console.warn(`[ConnectionDoctor] permission-denied in ${source} — opening diagnosis.`);
  try { runFirestoreDoctor(); } catch (e) { /* never break the caller */ }
}
