/**
 * HubbleNest Realtime Notifications System & Real Web Push Notifications
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
  getFcmMessaging,
  getToken
} from './firebase.js';

let activeNotifUnsubscribe = null;

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
 * 100% Firebase / client-side. The VAPID PUBLIC key is read from the
 * Firestore document `config/push` (field: `publicKey`). Anyone can generate
 * a Web Push certificate in Firebase Console → Project settings →
 * Cloud Messaging → Web Push certificates and store the public key there.
 * If the document is absent, the app silently skips background-push
 * registration — in-app (Firestore realtime) notifications always work.
 */
export async function initWebPushNotifications(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push notifications are not supported in this browser.');
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });

    // Check current permission
    if (Notification.permission !== 'granted') {
      return false;
    }

    // Fetch VAPID public key from Firestore (no server required)
    const configSnap = await getDoc(doc(db, 'config', 'push'));
    const publicKey = configSnap.exists() ? configSnap.data().publicKey : null;
    if (!publicKey) {
      console.log('Background push not configured: add the Web Push certificate public key to Firestore at config/push { publicKey }.');
      return false;
    }

    // Check existing or create subscription
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const convertedVapidKey = urlBase64ToUint8Array(publicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });
    }

    // Save subscription in Firestore under users/{userId}/pushSubscriptions
    if (subscription && userId) {
      const subJson = subscription.toJSON();
      const endpointHash = btoa(subscription.endpoint).slice(-30).replace(/[/+=]/g, '_');
      await setDoc(doc(db, 'users', userId, 'pushSubscriptions', endpointHash), {
        subscription: subJson,
        userAgent: navigator.userAgent,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    // Also attempt FCM token registration if supported
    try {
      const messaging = await getFcmMessaging();
      if (messaging) {
        const token = await getToken(messaging, {
          vapidKey: publicKey,
          serviceWorkerRegistration: registration
        });
        if (token && userId) {
          const tokenHash = btoa(token).slice(-30).replace(/[/+=]/g, '_');
          await setDoc(doc(db, 'users', userId, 'pushTokens', tokenHash), {
            token: token,
            userAgent: navigator.userAgent,
            updatedAt: serverTimestamp()
          }, { merge: true });
        }
      }
    } catch (fcmErr) {
      // Standard Web Push already active
    }

    return true;
  } catch (err) {
    console.warn('Web push setup error:', err);
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
    await initWebPushNotifications(userId);
    return true;
  }
  return false;
}

/**
 * Dispatch an off-app background push to a recipient user.
 *
 * Background push delivery requires a TRUSTED SENDER holding the VAPID
 * private key (e.g. Firebase Cloud Functions with the Admin SDK) — it can
 * never be done safely from client code. This app therefore keeps all
 * notification delivery inside Firebase Firestore, which drives the
 * realtime in-app notification center, badges and toasts with zero servers.
 *
 * Kept as a stable no-op so any caller remains safe.
 */
export async function sendPushToUser(recipientUserId, { title, body, icon = '/pwa-192x192.png', url = '/' } = {}) {
  if (!recipientUserId) return;
  // No-op: background push dispatch intentionally removed — pure Firebase
  // architecture. Firestore notifications still reach the recipient live.
  return;
}
