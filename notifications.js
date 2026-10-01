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
 */
const DEFAULT_VAPID_PUBLIC_KEY = 'BLeL1k63W4sqLo4kCVXvK7r1FWEcJl1MJbVjO6lgvkGquVuPlHHHZKYaOzGUOCqp7z--H328TFz0Zpua7xeszYo';

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
 */
export async function initWebPushNotifications(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    console.log('Push notifications are not supported in this browser.');
    return false;
  }

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

    // Prefer a project-specific Web Push certificate if the owner configured one.
    let vapidKey = DEFAULT_VAPID_PUBLIC_KEY;
    try {
      const configSnap = await getDoc(doc(db, 'config', 'push'));
      if (configSnap.exists() && configSnap.data().publicKey) {
        vapidKey = configSnap.data().publicKey;
      }
    } catch (e) {
      /* config/push is optional; fall back to the embedded key */
    }

    const token = await getToken(messaging, {
      vapidKey,
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
    if (code === 'messaging/token-subscribe-failed' ||
        code === 'messaging/failed-service-worker-registration' ||
        msg.includes('token-subscribe-failed') ||
        msg.includes('missing required authentication credential') ||
        msg.includes('Requested entity was not found')) {
      // 401 on fcmregistrations.googleapis.com = the project's Firebase Cloud
      // Messaging API is disabled (or the VAPID key belongs to another
      // project). Nothing the app can do — this needs project-side config.
      showToast('Push could not be activated: the Firebase Cloud Messaging API is not enabled for this Firebase project. The project owner must enable it in Google Cloud Console → APIs & Services → “Firebase Cloud Messaging API” (see README → Troubleshooting).', 'error', 10000);
    }
    return false;
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
    const ok = await initWebPushNotifications(userId);
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
