/**
 * HubbleNest Private Chat Request Service
 * 
 * Enforces privacy-first communication:
 * - Users cannot directly send private messages to someone without an accepted request.
 * - Handles request states: pending, accepted, declined, cancelled.
 * - Respectful rate-limiting and duplicate prevention.
 */

import { 
  db, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp 
} from './firebase.js';

import { getOrCreateConversation, getConversationId } from './private-chat.js';
import { showToast } from './utils.js';
import { sendPushToUser } from './notifications.js';

/**
 * Deterministic Request ID for a pair of users
 */
export function getChatRequestId(senderId, receiverId) {
  return `${senderId}_${receiverId}`;
}

/**
 * Check existing chat request or relationship between two users
 */
export async function getChatRelationship(currentUserId, targetUserId) {
  if (!currentUserId || !targetUserId) return null;

  try {
    // Check 1: Did current user send request to target?
    const req1Ref = doc(db, 'chatRequests', getChatRequestId(currentUserId, targetUserId));
    const snap1 = await getDoc(req1Ref);
    if (snap1.exists()) {
      return { direction: 'sent', data: { id: snap1.id, ...snap1.data() } };
    }

    // Check 2: Did target user send request to current user?
    const req2Ref = doc(db, 'chatRequests', getChatRequestId(targetUserId, currentUserId));
    const snap2 = await getDoc(req2Ref);
    if (snap2.exists()) {
      return { direction: 'received', data: { id: snap2.id, ...snap2.data() } };
    }

    // Check 3: Does an existing conversation already exist?
    const convId = getConversationId(currentUserId, targetUserId);
    const convSnap = await getDoc(doc(db, 'conversations', convId));
    if (convSnap.exists()) {
      return { direction: 'connected', data: { id: convSnap.id, ...convSnap.data(), status: 'accepted' } };
    }

    return null;
  } catch (err) {
    console.error('Error fetching chat relationship:', err);
    return null;
  }
}

/**
 * Send a Private Chat Request
 */
export async function sendChatRequest(senderProfile, receiverUser) {
  if (!senderProfile || !receiverUser) {
    showToast('Unable to send request. Please try again.', 'error');
    return null;
  }

  if (senderProfile.uid === receiverUser.uid) {
    showToast('You cannot send a chat request to yourself.', 'warning');
    return null;
  }

  // Check relationship first
  const existing = await getChatRelationship(senderProfile.uid, receiverUser.uid);
  if (existing) {
    if (existing.data.status === 'accepted') {
      showToast(`You are already connected with ${receiverUser.displayName || 'this member'}.`, 'info');
      return existing.data;
    }
    if (existing.data.status === 'pending') {
      if (existing.direction === 'sent') {
        showToast('Your chat request is already pending.', 'info');
      } else {
        showToast(`${receiverUser.displayName || 'This member'} already sent you a chat request!`, 'info');
      }
      return existing.data;
    }
    if (existing.data.status === 'declined') {
      // Check when declined
      const updatedSeconds = existing.data.updatedAt?.seconds || 0;
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds - updatedSeconds < 86400) { // Within 24 hours
        showToast('This member is not accepting chat requests right now.', 'info');
        return null;
      }
    }
  }

  const requestId = getChatRequestId(senderProfile.uid, receiverUser.uid);
  const requestData = {
    id: requestId,
    senderId: senderProfile.uid,
    senderName: senderProfile.displayName || 'Member',
    senderUsername: senderProfile.username || 'user',
    senderPhoto: senderProfile.photoURL || '',
    senderBio: senderProfile.bio || '',
    receiverId: receiverUser.uid,
    receiverName: receiverUser.displayName || 'Member',
    receiverUsername: receiverUser.username || 'user',
    receiverPhoto: receiverUser.photoURL || '',
    receiverBio: receiverUser.bio || '',
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(doc(db, 'chatRequests', requestId), requestData);

    // Notify the recipient
    await addDoc(collection(db, 'notifications'), {
      userId: receiverUser.uid,
      type: 'chat_request',
      title: 'New Chat Request',
      body: `${senderProfile.displayName || 'A member'} wants to chat with you.`,
      senderId: senderProfile.uid,
      senderName: senderProfile.displayName || 'Member',
      senderPhoto: senderProfile.photoURL || '',
      requestId: requestId,
      isRead: false,
      createdAt: serverTimestamp()
    });

    // Deliver a real background push (works even when HubbleNest is closed)
    sendPushToUser(receiverUser.uid, {
      title: 'New Chat Request',
      body: `${senderProfile.displayName || 'A member'} wants to chat with you.`,
      tag: 'chat_request'
    }).catch(() => {});

    showToast(`Chat request sent to ${receiverUser.displayName || 'member'}.`, 'success');
    return requestData;
  } catch (err) {
    console.error('Failed to send chat request:', err);
    showToast('Could not send chat request. Please try again.', 'error');
    throw err;
  }
}

/**
 * Accept a Chat Request
 */
export async function acceptChatRequest(requestId, currentUserProfile) {
  try {
    const reqRef = doc(db, 'chatRequests', requestId);
    const snap = await getDoc(reqRef);
    if (!snap.exists()) {
      showToast('Request not found.', 'error');
      return null;
    }

    const reqData = snap.data();
    await updateDoc(reqRef, {
      status: 'accepted',
      updatedAt: serverTimestamp()
    });

    // Create the conversation document
    const peerUser = {
      uid: reqData.senderId,
      displayName: reqData.senderName,
      username: reqData.senderUsername,
      photoURL: reqData.senderPhoto
    };

    const conv = await getOrCreateConversation(currentUserProfile, peerUser);

    // Notify sender that their request was accepted
    try {
      await addDoc(collection(db, 'notifications'), {
        userId: reqData.senderId,
        type: 'chat_request_accepted',
        title: 'Chat Request Accepted',
        body: `${currentUserProfile.displayName || 'A member'} accepted your chat request. You can now chat!`,
        senderId: currentUserProfile.uid,
        senderName: currentUserProfile.displayName || 'Member',
        senderPhoto: currentUserProfile.photoURL || '',
        conversationId: conv.id,
        isRead: false,
        createdAt: serverTimestamp()
      });

      // Deliver a real background push (works even when HubbleNest is closed)
      sendPushToUser(reqData.senderId, {
        title: 'Chat Request Accepted',
        body: `${currentUserProfile.displayName || 'A member'} accepted your chat request. You can now chat!`,
        tag: 'chat_request_accepted'
      }).catch(() => {});
    } catch (notifErr) {
      console.warn('Could not send acceptance notification:', notifErr);
    }

    showToast(`You can now chat with ${reqData.senderName}.`, 'success');
    return { conversation: conv, peer: peerUser };
  } catch (err) {
    console.error('Failed to accept chat request:', err);
    showToast('Could not accept request. Please try again.', 'error');
    throw err;
  }
}

/**
 * Decline a Chat Request
 */
export async function declineChatRequest(requestId) {
  try {
    const reqRef = doc(db, 'chatRequests', requestId);
    await updateDoc(reqRef, {
      status: 'declined',
      updatedAt: serverTimestamp()
    });
    showToast('Chat request declined.', 'info');
    return true;
  } catch (err) {
    console.error('Failed to decline chat request:', err);
    showToast('Could not decline request. Please try again.', 'error');
    return false;
  }
}

/**
 * Cancel a Chat Request (Sender Action)
 */
export async function cancelChatRequest(requestId) {
  try {
    const reqRef = doc(db, 'chatRequests', requestId);
    await deleteDoc(reqRef);
    showToast('Chat request cancelled.', 'info');
    return true;
  } catch (err) {
    console.error('Failed to cancel request:', err);
    return false;
  }
}

/**
 * Subscribe to Pending Incoming Chat Requests
 */
export function subscribeToIncomingRequests(userId, onUpdate) {
  const q = query(
    collection(db, 'chatRequests'),
    where('receiverId', '==', userId),
    where('status', '==', 'pending')
  );

  return onSnapshot(q, (snap) => {
    const list = [];
    snap.forEach((d) => {
      list.push({ id: d.id, ...d.data() });
    });
    // Sort in memory by createdAt descending
    list.sort((a, b) => {
      const tA = a.createdAt?.seconds || 0;
      const tB = b.createdAt?.seconds || 0;
      return tB - tA;
    });
    onUpdate(list);
  }, (err) => {
    console.error('Incoming requests listener error:', err);
  });
}

/**
 * Subscribe to All Chat Requests for User (Sent & Received)
 */
export function subscribeToUserChatRequests(userId, onUpdate) {
  // Query incoming
  const qIn = query(
    collection(db, 'chatRequests'),
    where('receiverId', '==', userId)
  );

  // Query sent
  const qOut = query(
    collection(db, 'chatRequests'),
    where('senderId', '==', userId)
  );

  let inList = [];
  let outList = [];

  const updateMerged = () => {
    const merged = [...inList, ...outList];
    onUpdate(merged);
  };

  const unsub1 = onSnapshot(qIn, (snap) => {
    inList = [];
    snap.forEach(d => inList.push({ id: d.id, ...d.data(), direction: 'received' }));
    updateMerged();
  }, (err) => console.warn('Requests listener in:', err));

  const unsub2 = onSnapshot(qOut, (snap) => {
    outList = [];
    snap.forEach(d => outList.push({ id: d.id, ...d.data(), direction: 'sent' }));
    updateMerged();
  }, (err) => console.warn('Requests listener out:', err));

  return () => {
    unsub1();
    unsub2();
  };
}
