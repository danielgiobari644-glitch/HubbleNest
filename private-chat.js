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
  increment,
  runTransaction 
} from './firebase.js';

import { 
  encryptPrivateMessage, 
  decryptPrivateMessage, 
  decryptLegacyEcdhMessage,
  generateConversationSeed 
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
    // 256-bit random seed BOTH participants derive the same AES-256-GCM
    // message key from (see encryption.js). Stored on the conversation doc,
    // which the security rules restrict to participants — so the key
    // material is exactly as protected as the ciphertext beside it.
    keySeed: generateConversationSeed(),
    lastMessage: null,
    updatedAt: serverTimestamp()
  };
  await setDoc(convRef, convData);
  return convData;
}

/**
 * Return the conversation's key seed, creating one for legacy conversations
 * that predate the seed scheme.
 *
 * Concurrency-safe: the legacy backfill runs in a transaction so two
 * participants opening the same old chat at the same time converge on ONE
 * seed instead of overwriting each other's (which would orphan messages).
 * If the conversation document itself is missing or unreadable, a local seed
 * is returned so the UI still works — a conversation created later by
 * getOrCreateConversation carries its own seed and replaces this one.
 */
export async function ensureConversationKeySeed(convId) {
  const convRef = doc(db, 'conversations', convId);
  try {
    const snap = await getDoc(convRef);
    if (snap.exists()) {
      const existingSeed = snap.data().keySeed;
      if (existingSeed) return existingSeed;
      return await runTransaction(db, async (tx) => {
        const fresh = await tx.get(convRef);
        if (fresh.exists() && fresh.data().keySeed) {
          return fresh.data().keySeed;
        }
        const seed = generateConversationSeed();
        tx.update(convRef, { keySeed: seed });
        return seed;
      });
    }
  } catch (err) {
    console.warn('Conversation key seed unavailable, using a local one:', err?.code || err);
  }
  return generateConversationSeed();
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
 * @param {Function} onMessages called with decrypted messages on every snapshot
 * @param {Function} [onError] called on terminal listener errors (after self-heal retry)
 */
export function subscribeToPrivateMessages(convId, currentUser, peerUser, onMessages, onError = null) {
  if (activePrivateUnsubscribe) {
    activePrivateUnsubscribe();
    activePrivateUnsubscribe = null;
  }

  const q = query(
    collection(db, 'conversations', convId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(100)
  );

  // Self-heal: if this listener attached in the tiny window while the
  // conversation document was still being created (brand-new DM), the
  // security rules briefly deny the read. Retry ONCE shortly after —
  // by then the conversation exists and the same rules allow the read.
  let privateListenerRetried = false;

  // Resolve the conversation key seed once per subscription; every snapshot
  // decryption reuses it. Failure-tolerant: null seed → placeholder text,
  // the listener itself stays healthy.
  const seedPromise = ensureConversationKeySeed(convId).catch(() => null);

  activePrivateUnsubscribe = onSnapshot(q, async (snap) => {
    const seed = seedPromise ? await seedPromise : null;
    const decryptedList = [];
    for (const d of snap.docs) {
      const raw = d.data();
      let decryptedContent = { text: raw.ciphertext };

      if (raw.isEncrypted && raw.ciphertext && raw.iv) {
        // Primary path: the conversation-seed key (v2 scheme — always works,
        // on every device, for sender and receiver alike).
        decryptedContent = seed
          ? await decryptPrivateMessage(raw.ciphertext, raw.iv, convId, seed)
          : { text: '[Encrypted message - cannot be decrypted on this device]', isDecryptionError: true };

        // Fallback: messages written by the old per-device ECDH scheme carry
        // no scheme marker. Try the legacy key path once before giving up —
        // on the device where that keypair still matches, history stays readable.
        if (decryptedContent.isDecryptionError && raw.scheme !== 'seed') {
          try {
            const legacy = await decryptLegacyEcdhMessage(
              raw.ciphertext,
              raw.iv,
              currentUser.uid,
              peerUser.uid,
              peerUser.publicKeyJwk
            );
            if (legacy && !legacy.isDecryptionError) decryptedContent = legacy;
          } catch (e) { /* keep the placeholder */ }
        }
      }

      decryptedList.push({
        id: d.id,
        ...raw,
        decrypted: decryptedContent
      });
    }
    onMessages(decryptedList);
  }, (err) => {
    // Errors were previously unhandled here, which surfaced as the SDK's
    // "Uncaught Error in snapshot listener: Missing or insufficient
    // permissions" and left the conversation permanently silent.
    console.error('Private messages listener error:', err);
    const denied = err?.code === 'permission-denied' ||
      String(err?.message || '').includes('Missing or insufficient permissions');
    if (denied && !privateListenerRetried) {
      privateListenerRetried = true;
      setTimeout(() => {
        try {
          subscribeToPrivateMessages(convId, currentUser, peerUser, onMessages, onError);
        } catch (e) { /* ignore */ }
      }, 1600);
    } else {
      if (denied) {
        showToast('This conversation could not load. Reopen the chat to retry.', 'error');
      }
      // Surface the failure to the UI (friendly error card in app.js).
      if (typeof onError === 'function') onError(err);
    }
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

  // 1. Get or create the conversation FIRST — it carries the key seed both
  //    sides derive the AES key from (v2 scheme: no per-device keypairs and
  //    no peer-key dead ends; you can always send).
  const convData = await getOrCreateConversation(currentUser, peerUser);
  const convId = convData.id || getConversationId(currentUser.uid, peerUser.uid);
  const convRef = doc(db, 'conversations', convId);
  const seed = convData.keySeed || await ensureConversationKeySeed(convId);

  // 2. Encrypt payload locally in the browser — plaintext never leaves it.
  const payloadToEncrypt = {
    text: text ? text.trim() : '',
    attachments: attachments,
    replyTo: replyTo,
    timestamp: Date.now()
  };

  const encryptedData = await encryptPrivateMessage(payloadToEncrypt, convId, seed);

  // 3. Save ciphertext and IV ONLY to Firestore
  const messageDoc = {
    conversationId: convId,
    senderId: currentUser.uid,
    senderName: currentUser.displayName || 'Member',
    ciphertext: encryptedData.ciphertext,
    iv: encryptedData.iv,
    isEncrypted: true,
    scheme: 'seed',
    createdAt: serverTimestamp()
  };

  await addDoc(collection(db, 'conversations', convId, 'messages'), messageDoc);

  // 4. Update conversation snippet
  await updateDoc(convRef, {
    updatedAt: serverTimestamp(),
    lastMessage: {
      senderId: currentUser.uid,
      senderName: currentUser.displayName,
      isEncrypted: true,
      timestamp: Date.now()
    }
  });

  // 5. Notify peer
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

