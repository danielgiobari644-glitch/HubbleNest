/**
 * HubbleNest Private Encrypted Messaging (1-to-1)
 * 
 * Features:
 * - Genuine Client-Side End-to-End Encryption (AES-256-GCM + ECDH)
 * - Plaintext NEVER sent to Firestore.
 * - Cloudinary attachments metadata encrypted within message payload.
 * - Realtime conversation streams.
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
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp, 
  increment 
} from './firebase.js';

import { 
  encryptPrivateMessage, 
  decryptPrivateMessage, 
  ensureUserKeyPair, 
  getPublicKeyFingerprint 
} from './encryption.js';

import { showToast } from './utils.js';
import { sendPushToUser } from './notifications.js';

let activePrivateUnsubscribe = null;

/**
 * Deterministic conversation ID for two user IDs
 */
export function getConversationId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

/**
 * Get or create a 1-to-1 conversation document
 */
export async function getOrCreateConversation(currentUser, peerUser) {
  const convId = getConversationId(currentUser.uid, peerUser.uid);
  const convRef = doc(db, 'conversations', convId);

  // The existence check must NEVER be a hard failure: if the read is denied
  // (stale rules) or the device is briefly offline, we still try to create
  // the conversation — the create rule is the real gatekeeper.
  let snap = null;
  try {
    snap = await getDoc(convRef);
  } catch (readErr) {
    console.warn('Conversation existence check failed — will attempt to create it:', readErr?.code || readErr);
  }

  if (snap && snap.exists()) {
    return snap.data();
  }

  const convData = {
    id: convId,
    participants: [currentUser.uid, peerUser.uid],
    participantData: {
      [currentUser.uid]: {
        displayName: currentUser.displayName || 'Member',
        username: currentUser.username || 'user',
        photoURL: currentUser.photoURL || ''
      },
      [peerUser.uid]: {
        displayName: peerUser.displayName || 'Member',
        username: peerUser.username || 'user',
        photoURL: peerUser.photoURL || ''
      }
    },
    lastMessage: null,
    updatedAt: serverTimestamp()
  };
  await setDoc(convRef, convData);
  return convData;
}

/**
 * Subscribe to the current user's direct conversations list
 */
export function subscribeToUserConversations(userId, onUpdate) {
  const q = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', userId),
    limit(40)
  );

  return onSnapshot(q, (snap) => {
    const convs = [];
    snap.forEach((d) => {
      convs.push({ id: d.id, ...d.data() });
    });

    // Sort in memory by updatedAt descending (no composite index required)
    convs.sort((a, b) => {
      const tA = a.updatedAt?.seconds || 0;
      const tB = b.updatedAt?.seconds || 0;
      return tB - tA;
    });

    onUpdate(convs);
  }, (err) => {
    console.error('Conversations listener error:', err);
  });
}

/**
 * Subscribe to messages in a specific private conversation
 */
export function subscribeToPrivateMessages(convId, currentUser, peerUser, onMessages) {
  if (activePrivateUnsubscribe) {
    activePrivateUnsubscribe();
    activePrivateUnsubscribe = null;
  }

  const q = query(
    collection(db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(100)
  );

  activePrivateUnsubscribe = onSnapshot(q, async (snap) => {
    const decryptedList = [];
    for (const d of snap.docs) {
      const raw = d.data();
      let decryptedContent = { text: raw.ciphertext };

      // Decrypt message if encrypted
      if (raw.isEncrypted && raw.ciphertext && raw.iv) {
        try {
          const peerPubJwk = peerUser.publicKeyJwk;
          if (peerPubJwk) {
            decryptedContent = await decryptPrivateMessage(
              raw.ciphertext,
              raw.iv,
              currentUser.uid,
              peerUser.uid,
              peerPubJwk
            );
          } else {
            decryptedContent = {
              text: '[Waiting for peer encryption handshake]',
              isPendingKey: true
            };
          }
        } catch (e) {
          decryptedContent = {
            text: '[Unable to decrypt on this device]',
            isDecryptionError: true
          };
        }
      }

      decryptedList.push({
        id: d.id,
        ...raw,
        decrypted: decryptedContent
      });
    }
    onMessages(decryptedList);
  });

  return activePrivateUnsubscribe;
}

/**
 * Send an Encrypted Private Message
 */
export async function sendPrivateMessage(currentUser, peerUser, { text, attachments = [], replyTo = null }) {
  if (!currentUser || !peerUser) throw new Error('Invalid participants.');
  if ((!text || !text.trim()) && attachments.length === 0 && !replyTo) {
    throw new Error('Message cannot be empty.');
  }

  const convId = getConversationId(currentUser.uid, peerUser.uid);
  const convRef = doc(db, 'conversations', convId);

  // 1. Ensure current user has keypair
  await ensureUserKeyPair(currentUser.uid);

  // 2. Fetch fresh peer public key if needed
  let peerPubJwk = peerUser.publicKeyJwk;
  if (!peerPubJwk) {
    const peerDoc = await getDoc(doc(db, 'users', peerUser.uid));
    if (peerDoc.exists() && peerDoc.data().publicKeyJwk) {
      peerPubJwk = peerDoc.data().publicKeyJwk;
    }
  }

  if (!peerPubJwk) {
    throw new Error(`${peerUser.displayName || 'This member'} has not set up secure messaging yet. You can chat once they sign in.`);
  }

  // 3. Encrypt payload locally in browser
  const payloadToEncrypt = {
    text: text ? text.trim() : '',
    attachments: attachments,
    replyTo: replyTo,
    timestamp: Date.now()
  };

  const encryptedData = await encryptPrivateMessage(
    payloadToEncrypt,
    currentUser.uid,
    peerUser.uid,
    peerPubJwk
  );

  // 4. Save ciphertext and IV ONLY to Firestore
  const messageDoc = {
    conversationId: convId,
    senderId: currentUser.uid,
    senderName: currentUser.displayName || 'Member',
    ciphertext: encryptedData.ciphertext,
    iv: encryptedData.iv,
    isEncrypted: true,
    createdAt: serverTimestamp()
  };

  await addDoc(collection(db, 'conversations', convId, 'messages'), messageDoc);

  // 5. Update conversation snippet
  await updateDoc(convRef, {
    updatedAt: serverTimestamp(),
    lastMessage: {
      senderId: currentUser.uid,
      senderName: currentUser.displayName,
      isEncrypted: true,
      timestamp: Date.now()
    }
  });

  // 6. Notify peer
  try {
    await addDoc(collection(db, 'notifications'), {
      userId: peerUser.uid,
      type: 'private_message',
      title: 'New Private Message',
      body: `You received a private message from ${currentUser.displayName || 'a member'}.`,
      senderId: currentUser.uid,
      conversationId: convId,
      isRead: false,
      createdAt: serverTimestamp()
    });

    // Deliver a real background push (works even when HubbleNest is closed)
    sendPushToUser(peerUser.uid, {
      title: 'New Private Message',
      body: `You received a private message from ${currentUser.displayName || 'a member'}.`,
      tag: 'private_message'
    }).catch(() => {});
  } catch (e) {
    console.warn('Could not notify recipient', e);
  }

  return messageDoc;
}

/**
 * Delete a Private Message (Sender action)
 */
export async function deletePrivateMessage(convId, messageId) {
  try {
    const msgRef = doc(db, 'conversations', convId, 'messages', messageId);
    await deleteDoc(msgRef);
    showToast('Message deleted', 'info');
  } catch (err) {
    console.error('Delete private message error:', err);
    showToast('Could not delete message', 'error');
  }
}

