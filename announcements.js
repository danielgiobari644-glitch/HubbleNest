/**
 * HubbleNest Announcements Engine
 * 
 * Space administrators can publish, edit, pin, and delete announcements.
 * Optional banner images use Cloudinary.
 */

import { 
  db, 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp 
} from './firebase.js';

import { showToast } from './utils.js';
import { sendPushToUser } from './notifications.js';

let activeAnnouncementsUnsubscribe = null;

/**
 * Subscribe to space announcements
 */
export function subscribeToAnnouncements(spaceId, onUpdate) {
  if (activeAnnouncementsUnsubscribe) {
    activeAnnouncementsUnsubscribe();
    activeAnnouncementsUnsubscribe = null;
  }

  const q = query(
    collection(db, 'spaces', spaceId, 'announcements'),
    orderBy('createdAt', 'desc')
  );

  activeAnnouncementsUnsubscribe = onSnapshot(q, (snapshot) => {
    const list = [];
    snapshot.forEach((d) => {
      list.push({ id: d.id, ...d.data() });
    });
    // Sort pinned to top, then by date
    list.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });
    onUpdate(list);
  }, (err) => {
    console.error('Announcements error:', err);
  });

  return activeAnnouncementsUnsubscribe;
}

/**
 * Publish a new announcement (Admin Action)
 */
export async function createAnnouncement(spaceId, userProfile, { title, content, imageURL = null, isPinned = false }) {
  if (!title || !title.trim()) throw new Error('Announcement title is required.');
  if (!content || !content.trim()) throw new Error('Announcement content is required.');

  const annData = {
    spaceId: spaceId,
    title: title.trim(),
    content: content.trim(),
    imageURL: imageURL || null,
    isPinned: Boolean(isPinned),
    authorId: userProfile.uid,
    authorName: userProfile.displayName || 'Space Admin',
    authorPhoto: userProfile.photoURL || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, 'spaces', spaceId, 'announcements'), annData);

  // Notify members
  try {
    const membersSnap = await import('./firebase.js').then(f => f.getDocs(f.collection(db, 'spaces', spaceId, 'members')));
    membersSnap.forEach(async (mDoc) => {
      const memId = mDoc.id;
      if (memId !== userProfile.uid) {
        await addDoc(collection(db, 'notifications'), {
          userId: memId,
          type: 'announcement',
          title: 'New Announcement',
          body: `Admin posted: "${title}"`,
          spaceId: spaceId,
          isRead: false,
          createdAt: serverTimestamp()
        });

        // Deliver a real background push (works even when HubbleNest is closed)
        sendPushToUser(memId, {
          title: 'New Announcement',
          body: `Admin posted: "${title}"`,
          tag: 'announcement'
        }).catch(() => {});
      }
    });
  } catch (e) {
    console.warn('Could not dispatch announcement notifications', e);
  }

  showToast('Announcement published successfully.', 'success');
  return { id: docRef.id, ...annData };
}

/**
 * Pin or Unpin Announcement
 */
export async function togglePinAnnouncement(spaceId, announcementId, currentPinnedState) {
  const annRef = doc(db, 'spaces', spaceId, 'announcements', announcementId);
  await updateDoc(annRef, {
    isPinned: !currentPinnedState,
    updatedAt: serverTimestamp()
  });
  showToast(!currentPinnedState ? 'Announcement pinned.' : 'Announcement unpinned.', 'info');
}

/**
 * Delete Announcement
 */
export async function deleteAnnouncement(spaceId, announcementId) {
  await deleteDoc(doc(db, 'spaces', spaceId, 'announcements', announcementId));
  showToast('Announcement removed.', 'info');
}
