/**
 * HubbleNest Real-Time Presence (v30)
 *
 * Genuine online/offline status for every member — no simulation, no random
 * values, no hardcoded states.
 *
 * How it works (Firebase Realtime Database is NOT provisioned on the
 * `hubblenest` project — verified 2026-11: the instance returns 404 — so
 * presence runs on the Google-documented Firestore presence pattern):
 *
 *   1. HEARTBEAT — every signed-in device writes
 *        users/{uid}.presence = { online: true, lastActive: serverTimestamp() }
 *      immediately on connect, again on a 60s interval, on every tab-visible
 *      moment and whenever the browser reports the network is back.
 *
 *   2. INSTANT OFFLINE SIGNALS — hiding/minimising the tab (mobile lock
 *      included) and page close/`pagehide` write `online: false` right away,
 *      so the common real-life cases flip a member offline within seconds.
 *
 *   3. STALENESS WINDOW — a reader treats a member as online only while
 *      `online === true` AND `lastActive` is fresher than 165s (2.75 × the
 *      heartbeat). A crashed browser, a dead network or a lost device
 *      therefore ALWAYS decays to offline on its own — nobody can be stuck
 *      "online" indefinitely, and no fake "always green" states exist.
 *
 *   4. REAL-TIME DELIVERY — readers subscribe with Firestore `onSnapshot`
 *      listeners on the peers' user docs, so status flips stream in live;
 *      a 30s local re-check tick also re-evaluates the staleness window so
 *      silent decay is reflected without any server traffic.
 *
 * Everything here writes real documents and reads real documents. When
 * presence data is simply missing (an old profile that never beat), the
 * member is reported offline — never guessed online.
 */

import { db, doc, onSnapshot, serverTimestamp, setDoc } from './firebase.js';

/** A member counts as online only while their last beat is fresher than this. */
const PRESENCE_WINDOW_MS = 165000;       // 2.75 × heartbeat interval
const HEARTBEAT_INTERVAL_MS = 60000;     // 1 genuine write / minute
const RECHECK_TICK_MS = 30000;           // local staleness re-evaluation

let heartbeatTimer = null;
let recheckTimer = null;
let presenceUser = null;                 // { uid } while signed in
let presenceBound = false;

/** uid → { unsub, cbs:Set, value } — shared live listeners on users/{uid}. */
const watchers = new Map();

function presenceRef(uid) {
  return doc(db, 'users', uid);
}

/* ------------------------------------------------------------------ */
/* Writes — the signed-in device keeps its own status truthful          */
/* ------------------------------------------------------------------ */

async function writePresence(online) {
  if (!presenceUser) return;
  try {
    await setDoc(
      presenceRef(presenceUser.uid),
      { presence: { online, lastActive: serverTimestamp() } },
      { merge: true }
    );
  } catch (err) {
    // Never crash the app over a status write; the staleness window keeps
    // other members' view correct regardless.
    console.warn('[HubbleNest] Presence write failed:', err?.code || err?.message || err);
  }
}

function beatOnline() { writePresence(true); }
function beatOffline() { writePresence(false); }

function onVisibilityChange() {
  if (!presenceUser) return;
  // Instant, honest reflection of the device's real state.
  if (document.visibilityState === 'visible') beatOnline();
  else beatOffline();
}

function onPageHide() {
  // Best effort — the staleness window covers the cases where the write
  // cannot finish (browser killed, network gone).
  beatOffline();
}

/** Start heartbeat + lifecycle hooks for this signed-in member. */
export function initPresence(profile) {
  const uid = profile?.uid;
  if (!uid) return;
  presenceUser = { uid };

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (recheckTimer) clearInterval(recheckTimer);

  beatOnline();
  heartbeatTimer = setInterval(beatOnline, HEARTBEAT_INTERVAL_MS);

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('beforeunload', onPageHide);
  window.addEventListener('online', beatOnline);
  window.addEventListener('offline', beatOffline);

  recheckTimer = setInterval(() => broadcastAll(), RECHECK_TICK_MS);
  presenceBound = true;
}

/** Signed out — go offline for real and stop every timer/listener. */
export function stopPresence() {
  if (!presenceBound) { presenceUser = null; return; }
  beatOffline();
  presenceUser = null;
  presenceBound = false;
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (recheckTimer) { clearInterval(recheckTimer); recheckTimer = null; }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('beforeunload', onPageHide);
  window.removeEventListener('online', beatOnline);
  window.removeEventListener('offline', beatOffline);
  for (const w of watchers.values()) { try { w.unsub(); } catch (e) { /* ignore */ } }
  watchers.clear();
}

/* ------------------------------------------------------------------ */
/* Reads — live status for any member, streamed to the UI               */
/* ------------------------------------------------------------------ */

/** Compute the TRUTH from a users/{uid} doc: online only when fresh. */
export function computePresence(data) {
  const p = data?.presence;
  if (!p || typeof p.online !== 'boolean' || !p.lastActive) {
    return { online: false, known: false, lastActive: null };
  }
  const ms = typeof p.lastActive.toMillis === 'function'
    ? p.lastActive.toMillis()
    : Number(p.lastActive) || 0;
  const online = p.online === true && (Date.now() - ms) < PRESENCE_WINDOW_MS;
  return { online, known: true, lastActive: ms || null };
}

/** Human label for the current state ("Online" / "Offline" / last seen). */
export function presenceLabel(state) {
  if (!state || !state.known) return 'Offline';
  if (state.online) return 'Online';
  if (state.lastActive) {
    const mins = Math.floor((Date.now() - state.lastActive) / 60000);
    if (mins < 1) return 'Last seen just now';
    if (mins < 60) return `Last seen ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Last seen ${hrs}h ago`;
    return 'Offline';
  }
  return 'Offline';
}

function emit(w) {
  const val = computePresence(w.lastData);
  w.value = val;
  w.cbs.forEach((cb) => { try { cb(val); } catch (e) { /* ignore */ } });
}

function broadcastAll() {
  for (const w of watchers.values()) {
    // Only re-emit when the staleness window actually flips the answer.
    const val = computePresence(w.lastData);
    if (val.online !== (w.value && w.value.online)) emit(w);
  }
}

/**
 * Subscribe to a member's live presence. Returns an unsubscribe function.
 * Listeners are shared per uid (one Firestore listener for any number of
 * UI subscribers — the conversation list and the chat header share it).
 */
export function watchUserPresence(uid, cb) {
  if (!uid || typeof cb !== 'function') return () => {};
  let w = watchers.get(uid);
  if (!w) {
    w = { unsub: null, cbs: new Set(), lastData: null, value: { online: false, known: false, lastActive: null } };
    w.unsub = onSnapshot(presenceRef(uid), (snap) => {
      w.lastData = snap.exists() ? snap.data() : null;
      emit(w);
    }, (err) => {
      console.warn('[HubbleNest] Presence listener error:', err?.code || err);
    });
    watchers.set(uid, w);
  }
  w.cbs.add(cb);
  // Deliver the current snapshot immediately when we already have one.
  if (w.lastData !== null) cb(computePresence(w.lastData));
  return () => {
    w.cbs.delete(cb);
    if (w.cbs.size === 0) {
      try { w.unsub(); } catch (e) { /* ignore */ }
      watchers.delete(uid);
    }
  };
}
