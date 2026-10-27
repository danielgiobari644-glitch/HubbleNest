/**
 * HubbleNest Realtime Notifications System & Real Web Push Notifications
 *
 * Architecture (100% Firebase + vanilla JS — zero custom servers):
 *  - IN-APP: Firestore realtime listener below drives the notification
 *    center, badges and toasts while the app is open.
 *  - OFF-APP: FCM registration tokens (via the Firebase Messaging SDK) are
 *    stored in Firestore under `users/{uid}/pushTokens`. Any signed-in member
 *    can then deliver a real background push to another member by calling
 *    FCM HTTP v1 directly from their browser (see fcm-sender.js). The
 *    service worker displays the notification even when HubbleNest is closed.
 *
 *  Owner setup (one-time, ~2 minutes — documented in README.md):
 *    Create the Firestore document `config/push`:
 *      { clientEmail: "...iam.gserviceaccount.com", privateKey: "-----BEGIN PRIVATE KEY-----..." }
 *    using a dedicated service account with only the
 *    "Firebase Cloud Messaging API Admin" role.
 */

import {
  db,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  onSnapshot,
  serverTimestamp,
  getDocs,
  getFcmMessaging,
  getToken
} from './firebase.js';

import { sendFcmMessage } from './fcm-sender.js';
import { showToast } from './utils.js';

let activeNotifUnsubscribe = null;

/**
 * Default Web Push certificate public key (VAPID) used to mint FCM
 * registration tokens for this app. Public information — safe to embed.
 * A project-specific key can optionally override it via `config/push.publicKey`.
 *
 * ⚠️ THIS KEY MUST HAVE BEEN GENERATED IN THE **SAME** FIREBASE PROJECT AS
 * `firebaseConfig` ABOVE (hubblenest). A key from any other project — or a
 * deleted/regenerated certificate — makes FCM's registration endpoint answer
 * 401 "Request is missing required authentication credential"
 * (messaging/token-subscribe-failed) and push notifications cannot work.
 * Fix (2 minutes, see README → Troubleshooting → "Web push notifications return 401"):
 *   Firebase Console → Project Settings → Cloud Messaging → Web Push
 *   certificates → Generate key pair → paste the key here.
 */
const DEFAULT_VAPID_PUBLIC_KEY = 'BLeL1k63W4sqLo4kCVXvK7r1FWEcJl1MJbVjO6lgvkGquVuPlHHHZKYaOzGUOCqp7z--H328TFz0Zpua7xeszYo';

/* ---- Session failure latch --------------------------------------------
   A 401 from fcmregistrations.googleapis.com (FCM API disabled / VAPID key
   mismatch / Web-API-key restriction) is PROJECT-side: retrying it over and
   over in the same session only spams the console with identical errors and
   burns FCM quota. After the first hard failure we stop automatic attempts
   for the rest of the session; explicit user actions (nudge button, the
   Settings "test push" button) pass { force: true } and retry deliberately.
   Saving a new one-time configuration (savePushConfig) resets the latch.  */
let pushSetupHardFailed = false;
let pushInitInflight = null;

/* ========================================================================
   ONE-TIME push configuration (survives every redeploy)
   ------------------------------------------------------------------------
   The Web Push certificate key and the background-push service account live
   in the Firestore document `config/push` — server data, NOT in the zip.
   Configure them once from Profile & Settings → "Off-App Notifications"
   and they persist no matter how many times the app is redeployed.
   Fields: { publicKey, clientEmail, privateKey, ownerUid, configuredAt }
   ======================================================================== */

let pushConfigStatusCache = null;

/**
 * Read the current push configuration status (what the Settings page shows).
 * @returns {{ publicKey: string|null, publicKeyIsEmbedded: boolean,
 *             senderConfigured: boolean, ownerUid: string|null }}
 */
export async function getPushConfigStatus() {
  const status = {
    publicKey: null,
    publicKeyIsEmbedded: true,
    senderConfigured: false,
    ownerUid: null
  };
  try {
    const snap = await getDoc(doc(db, 'config', 'push'));
    if (snap.exists()) {
      const d = snap.data();
      if (d.publicKey && isValidVapidKey(d.publicKey)) {
        status.publicKey = d.publicKey;
        status.publicKeyIsEmbedded = false;
      }
      status.senderConfigured = !!(d.clientEmail && d.privateKey);
      status.ownerUid = d.ownerUid || null;
    }
  } catch (err) {
    console.warn('[HubbleNest Push] config/push unreadable:', err?.code || err);
  }
  pushConfigStatusCache = status;
  return status;
}

/**
 * Save the one-time push configuration to Firestore `config/push`.
 * Empty/blank fields leave the stored value untouched.
 * @param {{ publicKey?: string, clientEmail?: string, privateKey?: string }} cfg
 * @param {object} profile  signed-in user (becomes the config owner)
 */
export async function savePushConfig(cfg, profile) {
  const uid = profile?.uid || window.HubbleNest?._state?.currentUser?.uid;
  if (!uid) throw new Error('Sign in first.');

  const patch = {
    ownerUid: uid,
    configuredAt: serverTimestamp()
  };
  if (cfg.publicKey !== undefined) {
    const key = String(cfg.publicKey || '').trim();
    if (key && !isValidVapidKey(key)) {
      throw new Error('That Web Push certificate key is malformed — it must be 87 base64url characters starting with "B".');
    }
    patch.publicKey = key || DEFAULT_VAPID_PUBLIC_KEY;
  }
  if (cfg.clientEmail !== undefined) patch.clientEmail = String(cfg.clientEmail || '').trim();
  if (cfg.privateKey !== undefined) patch.privateKey = String(cfg.privateKey || '').trim();

  await setDoc(doc(db, 'config', 'push'), patch, { merge: true });

  // Invalidate this session's caches so the new values take effect at once.
  try {
    const sender = await import('./fcm-sender.js');
    sender.invalidatePushConfigCache();
  } catch (e) { /* module already loaded or unavailable — non-fatal */ }
  pushConfigStatusCache = null;
  // A new configuration gives this session a fresh chance to activate push.
  pushSetupHardFailed = false;

  return getPushConfigStatus();
}

/**
 * A valid P-256 Web Push public key is 87 base64url characters starting
 * with "B" (an uncompressed EC point: 65 bytes → 87 unpadded base64url chars).
 * Anything else can only fail at the FCM endpoint, so we bail out with a
 * clear message before even trying.
 */
function isValidVapidKey(key) {
  return typeof key === 'string' && /^B[A-Za-z0-9_-]{86}$/.test(key.trim());
}

/**
 * Subscribe to user's notifications in Firestore
 */
export function subscribeToNotifications(userId, onNotificationsUpdate) {
  if (activeNotifUnsubscribe) {
    activeNotifUnsubscribe();
    activeNotifUnsubscribe = null;
  }

  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    limit(50)
  );

  activeNotifUnsubscribe = onSnapshot(q, (snapshot) => {
    const notifs = [];
    let unreadCount = 0;

    snapshot.forEach((d) => {
      const item = { id: d.id, ...d.data() };
      notifs.push(item);
      if (!item.isRead) unreadCount++;
    });

    // Sort descending by timestamp in memory (no composite index required)
    notifs.sort((a, b) => {
      const tA = a.createdAt?.seconds || (a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0);
      const tB = b.createdAt?.seconds || (b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0);
      return tB - tA;
    });

    onNotificationsUpdate(notifs, unreadCount);
  }, (err) => {
    console.error('Notifications error:', err);
  });

  return activeNotifUnsubscribe;
}

/**
 * Mark a single notification as read
 */
export async function markNotificationAsRead(notificationId) {
  try {
    const ref = doc(db, 'notifications', notificationId);
    await updateDoc(ref, { isRead: true });
  } catch (err) {
    console.error('Failed to mark notification as read:', err);
  }
}

/**
 * Mark all user notifications as read
 */
export async function markAllNotificationsAsRead(notifications) {
  const unread = notifications.filter(n => !n.isRead);
  for (const n of unread) {
    try {
      await updateDoc(doc(db, 'notifications', n.id), { isRead: true });
    } catch (e) {
      console.warn(e);
    }
  }
}

// Convert VAPID key URL base64 to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Initialize Web Push Notifications & Register Service Worker
 *
 * Registers the service worker (relative path — works on any static host,
 * including GitHub Pages project sites), then mints an FCM registration
 * token for this browser and stores it in Firestore so other members can
 * deliver pushes to this user even when the app is closed.
 *
 * @param {string} userId
 * @param {{silent?: boolean, force?: boolean}} [opts]
 *        silent (default true): never surface UI toasts for background token
 *        refreshes — only user-initiated opt-ins (nudge/settings) pass
 *        { silent: false }.
 *        force (default false): retry even after a hard failure earlier in
 *        this session (used by explicit user actions only).
 * @returns {Promise<boolean>} true when a token was minted and stored.
 */
export async function initWebPushNotifications(userId, opts = {}) {
  const silent = opts.silent !== false;
  const force = opts.force === true;

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    console.log('Push notifications are not supported in this browser.');
    return false;
  }

  // One hard failure per session is enough — silent background retries
  // (auth refreshes, view switches) must not re-spam FCM and the console.
  if (pushSetupHardFailed && !force) {
    return false;
  }
  // Concurrent calls share one attempt (boot can trigger several at once).
  if (pushInitInflight && !force) {
    return pushInitInflight;
  }

  const attempt = (async () => {
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js');

    // Never nag silently — permission prompts are user-initiated (nudge / settings).
    if (Notification.permission !== 'granted') {
      return false;
    }

    const messaging = await getFcmMessaging();
    if (!messaging) {
      console.log('Firebase Messaging is not supported in this environment.');
      return false;
    }

    // Prefer the owner's one-time configuration (config/push in Firestore —
    // survives redeploys) and fall back to the embedded certificate key.
    let vapidKey = DEFAULT_VAPID_PUBLIC_KEY;
    try {
      const configSnap = await getDoc(doc(db, 'config', 'push'));
      if (configSnap.exists() && configSnap.data().publicKey) {
        vapidKey = configSnap.data().publicKey;
      }
    } catch (e) {
      /* config/push is optional; fall back to the embedded key */
    }

    if (!isValidVapidKey(vapidKey)) {
      const err = new Error('The configured VAPID/Web Push public key is malformed (expected 87 base64url chars starting with "B").');
      err.code = 'messaging/invalid-vapid-key';
      throw err;
    }

    // Fingerprint diagnostic: makes it easy to VERIFY which Web Push
    // certificate the RUNNING app uses. After you paste a new key into this
    // file and redeploy, this line must show the NEW key's suffix — if it
    // still shows the old one, the browser is running a stale cached copy
    // (one hard refresh clears it) or the edit never reached the deploy.
    console.info(
      `[HubbleNest] Web Push: using VAPID key ${vapidKey.slice(0, 10)}…${vapidKey.slice(-6)} ` +
      `(source: ${vapidKey === DEFAULT_VAPID_PUBLIC_KEY ? 'embedded constant' : 'config/push doc'})`
    );

    const token = await getToken(messaging, {
      vapidKey: vapidKey.trim(),
      serviceWorkerRegistration: registration
    });

    if (!token) {
      console.warn('FCM token was not issued.');
      return false;
    }

    // Store the FCM token so senders can reach this browser.
    if (userId) {
      const tokenHash = btoa(token).slice(-30).replace(/[/+=]/g, '_');
      await setDoc(doc(db, 'users', userId, 'pushTokens', tokenHash), {
        token: token,
        userAgent: navigator.userAgent,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    return true;
    } catch (err) {
    console.warn('Web push setup error:', err);
    const code = err?.code || '';
    const msg = String(err?.message || '');
    const authProblem =
      code === 'messaging/token-subscribe-failed' ||
      code === 'messaging/invalid-vapid-key' ||
      msg.includes('token-subscribe-failed') ||
      msg.includes('missing required authentication credential') ||
      msg.includes('Requested entity was not found');

    if (authProblem) {
      // 401 on fcmregistrations.googleapis.com — the receiving side of push
      // needs PROJECT-side configuration that only the owner can do. The
      // latch stops every further automatic attempt this session; explicit
      // user actions (nudge / Settings test) retry via { force: true }.
      pushSetupHardFailed = true;
      console.warn(
        '[HubbleNest] Push notifications cannot activate — project configuration required (further automatic attempts paused for this session).\n' +
        '  1. Google Cloud Console → select the \'hubblenest\' project → APIs & Services → Library → enable "Firebase Cloud Messaging API":\n' +
        '     https://console.developers.google.com/apis/api/fcm.googleapis.com/overview?project=hubblenest\n' +
        '  2. Firebase Console → Project Settings (gear) → Cloud Messaging → Web Push certificates → "Generate key pair" and copy it.\n' +
        '  3. Open the app → Profile & Settings → "Off-App Push Notifications" → paste the key → Save (stored in Firestore config/push — one-time, survives redeploys).\n' +
        '  4. If the Web API key has HTTP-referrer/API restrictions (Google Cloud Console → Credentials), allow this site or remove the restriction.\n' +
        '  Full walkthrough: README → Troubleshooting → "Web push notifications return 401".'
      );
      if (!silent) {
        showToast('Push could not be activated: this Firebase project needs its Cloud Messaging API enabled and a matching Web Push certificate (VAPID). The project owner can fix it in ~2 minutes — see README → Troubleshooting → "Web push notifications return 401".', 'error', 10000);
      }
    }
    return false;
  }
})();

  pushInitInflight = attempt;
  try {
    return await attempt;
  } finally {
    if (pushInitInflight === attempt) pushInitInflight = null;
  }
}

/**
 * Prompt user for Push Notification Permission
 */
export async function requestPushPermission(userId) {
  if (!('Notification' in window)) {
    throw new Error('This browser does not support notifications.');
  }

  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    // User-initiated — surface setup problems with a visible toast, and
    // deliberately RETRY even if an automatic attempt failed earlier
    // (the failure latch only pauses background attempts).
    const ok = await initWebPushNotifications(userId, { silent: false, force: true });
    return ok;
  }
  return false;
}

/**
 * Dispatch an off-app background push to a recipient user.
 *
 * Reads the recipient's FCM tokens from Firestore and delivers each through
 * Firebase Cloud Messaging (HTTP v1) straight from this browser — no server.
 * Fire-and-forget safe: never throws; failures are logged only.
 *
 * Requires the owner to have configured `config/push` { clientEmail,
 * privateKey } (see fcm-sender.js / README). Without it, in-app Firestore
 * notifications still reach the recipient live.
 *
 * @param {string} recipientUserId
 * @param {{title: string, body: string, url?: string, tag?: string, image?: string}} payload
 */
export async function sendPushToUser(recipientUserId, { title, body, url = './index.html', tag = 'hubblenest-notification', image = null } = {}) {
  if (!recipientUserId || !title) return { ok: false, sent: 0 };

  try {
    // Recipient's registered devices
    const tokensSnap = await getDocs(collection(db, 'users', recipientUserId, 'pushTokens'));
    if (tokensSnap.empty) return { ok: false, sent: 0, reason: 'no-devices' };

    // Absolute icon/link URLs (sender's origin) for reliable delivery
    let absoluteIcon, absoluteUrl;
    try {
      absoluteIcon = new URL('./pwa-192x192.png', window.location.href).href;
      absoluteUrl = new URL(url, window.location.href).href;
    } catch (e) {
      absoluteIcon = '/pwa-192x192.png';
      absoluteUrl = '/';
    }

    let sent = 0;
    const deadTokenDocs = [];

    for (const tokenDoc of tokensSnap.docs) {
      const fcmToken = tokenDoc.data().token;
      if (!fcmToken) continue;
      try {
        const result = await sendFcmMessage(fcmToken, {
          title,
          body,
          icon: absoluteIcon,
          link: absoluteUrl,
          dataFields: { url: url, tag, ...(image ? { image } : {}) }
        });
        if (result.ok) {
          sent++;
        } else if (result.deadToken) {
          deadTokenDocs.push(tokenDoc.ref);
        } else {
          console.warn('[HubbleNest Push]', result.error || 'send failed');
          if (result.error === 'not-configured') return { ok: false, sent, reason: 'not-configured' };
        }
      } catch (sendErr) {
        console.warn('[HubbleNest Push] send error:', sendErr);
      }
    }

    // Clean up devices that uninstalled / revoked the app
    for (const ref of deadTokenDocs) {
      deleteDoc(ref).catch(() => {});
    }

    return { ok: sent > 0, sent };
  } catch (err) {
    console.warn('[HubbleNest Push] dispatch failed:', err);
    return { ok: false, sent: 0, error: err };
  }
}
