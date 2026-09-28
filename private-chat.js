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
  const snap = await getDoc(convRef);

  if (!snap.exists()) {
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

  return snap.data();
}

/**
 * Subscribe to the current user's direct conversations list
 */
export function subscribeToUserConversations(userId, onUpdate) {
  const q = query(
    collection(db, 'conversations'),
    where('participants', 'array-contains', userId),
    orderBy('updatedAt', 'desc'),
    limit(30)
  );

  return onSnapshot(q, (snap) => {
    const convs = [];
    snap.forEach((d) => {
      convs.push({ id: d.id, ...d.data() });
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
  if ((!text || !text.trim()) && attachments.length === 0) {
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
    throw new Error(`${peerUser.displayName || 'This member'} has not yet generated their encryption keys. Once they sign in, you can message them securely.`);
  }

  // 3. Encrypt payload locally in browser
  const payloadToEncrypt = {
    text: text ? text.trim() : '',
    attachments: attachments, // Cloudinary URLs
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
      title: 'New Encrypted Message',
      body: `You received an encrypted message from ${currentUser.displayName}.`,
      senderId: currentUser.uid,
      conversationId: convId,
      isRead: false,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.warn('Could not notify recipient', e);
  }

  return messageDoc;
}
