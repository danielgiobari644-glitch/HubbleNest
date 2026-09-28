/**
 * HubbleNest Realtime Notifications System
 */

import { 
  db, 
  collection, 
  doc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot 
} from './firebase.js';

let activeNotifUnsubscribe = null;

/**
 * Subscribe to user's notifications
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
