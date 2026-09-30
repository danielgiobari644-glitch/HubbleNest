/**
 * HubbleNest Realtime Public Space Chat
 * 
 * Supports:
 * - Realtime Firestore listener (onSnapshot)
 * - Cloudinary attachments (Images, Videos, Audio, Documents)
 * - Reply threading
 * - Emoji reactions (toggle on/off)
 * - Link extraction
 * - Message deletion (own or admin)
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
  limit, 
  onSnapshot, 
  serverTimestamp, 
  arrayUnion, 
  arrayRemove 
} from './firebase.js';

import { extractUrls, showToast } from './utils.js';

let activeUnsubscribe = null;

/**
 * Subscribe to space messages in realtime
 */
export function subscribeToSpaceMessages(spaceId, onMessagesUpdate, onError) {
  if (activeUnsubscribe) {
    activeUnsubscribe();
    activeUnsubscribe = null;
  }

  const q = query(
    collection(db, 'spaces', spaceId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(150)
  );

  activeUnsubscribe = onSnapshot(q, (snapshot) => {
    const messages = [];
    snapshot.forEach((docSnap) => {
      messages.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });
    onMessagesUpdate(messages);
  }, (err) => {
    console.error('Space chat listener error:', err);
    if (onError) onError(err);
  });

  return activeUnsubscribe;
}

/**
 * Unsubscribe from active chat
 */
export function unsubscribeFromChat() {
  if (activeUnsubscribe) {
    activeUnsubscribe();
    activeUnsubscribe = null;
  }
}

/**
 * Send a message to the Space chat
 */
export async function sendSpaceMessage(spaceId, userProfile, { text, attachments = [], replyTo = null }) {
  if (!userProfile) throw new Error('Must be signed in to send messages.');
  if ((!text || !text.trim()) && attachments.length === 0 && !replyTo) {
    throw new Error('Message cannot be empty.');
  }

  const cleanText = text ? text.trim() : '';
  const detectedLinks = extractUrls(cleanText);

  const messageDoc = {
    spaceId: spaceId,
    senderId: userProfile.uid,
    senderName: userProfile.displayName || 'Member',
    senderUsername: userProfile.username || 'user',
    senderPhoto: userProfile.photoURL || '',
    text: cleanText,
    attachments: attachments, // Cloudinary URLs and metadata
    replyTo: replyTo ? {
      id: replyTo.id || null,
      text: replyTo.text ? (replyTo.text.length > 100 ? replyTo.text.slice(0, 100) + '...' : replyTo.text) : (replyTo.fileName || 'Attachment'),
      senderName: replyTo.senderName || 'File',
      fileName: replyTo.fileName || null,
      fileUrl: replyTo.fileUrl || null,
      fileType: replyTo.fileType || null,
      isFileReply: !!replyTo.isFileReply
    } : null,
    reactions: {},
    links: detectedLinks,
    createdAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, 'spaces', spaceId, 'messages'), messageDoc);

  // Automatically catalog any links found in the message
  if (detectedLinks.length > 0) {
    for (const linkItem of detectedLinks) {
      try {
        await addDoc(collection(db, 'spaces', spaceId, 'links'), {
          spaceId: spaceId,
          url: linkItem.url,
          domain: linkItem.domain,
          senderName: userProfile.displayName || 'Member',
          senderId: userProfile.uid,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        console.warn('Could not auto-catalog link:', e);
      }
    }
  }

  return { id: docRef.id, ...messageDoc };
}

/**
 * Toggle an emoji reaction on a message
 */
export async function toggleMessageReaction(spaceId, messageId, emoji, userId) {
  const msgRef = doc(db, 'spaces', spaceId, 'messages', messageId);
  try {
    const key = `reactions.${emoji}`;
    // Read and update reaction map
    const snap = await import('./firebase.js').then(f => f.getDoc(msgRef));
    if (!snap.exists()) return;

    const currentReactions = snap.data().reactions || {};
    const usersList = currentReactions[emoji] || [];

    if (usersList.includes(userId)) {
      await updateDoc(msgRef, {
        [key]: arrayRemove(userId)
      });
    } else {
      await updateDoc(msgRef, {
        [key]: arrayUnion(userId)
      });
    }
  } catch (err) {
    console.error('Failed to toggle reaction:', err);
  }
}

/**
 * Delete a message from Space chat
 */
export async function deleteSpaceMessage(spaceId, messageId) {
  try {
    const msgRef = doc(db, 'spaces', spaceId, 'messages', messageId);
    await deleteDoc(msgRef);
    showToast('Message deleted', 'info');
  } catch (err) {
    console.error('Delete message error:', err);
    showToast('Could not delete message', 'error');
  }
}
