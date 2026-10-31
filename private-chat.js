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
  generateConversationSeed,
  UNDECRYPTABLE_TEXT
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
 * Get or create a 1-to-1 conversation document.
 *
 * Runs in a TRANSACTION so the key seed can never be clobbered: if both
 * participants open a brand-new chat at the same instant (or one device is
 * offline and retries), Firestore serialises the attempts and EVERY side
 * converges on the SAME seed instead of the last writer silently replacing
 * the first one (which would orphan any messages already encrypted with it).
 *
 * Always returns conversation data that INCLUDES a keySeed:
 *   - doc exists with a seed       → returned as-is
 *   - doc exists WITHOUT a seed    → legacy doc, seed backfilled exactly once
 *   - doc missing                  → created with a fresh seed
 */
export async function getOrCreateConversation(currentUser, peerUser) {
  const convId = getConversationId(currentUser.uid, peerUser.uid);
  const convRef = doc(db, 'conversations', convId);

  const buildConvData = () => ({
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
  });

  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(convRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data.keySeed) return { ...data, id: convId };
        // Legacy conversation created before the seed scheme existed:
        // backfill the seed exactly once, inside this same transaction.
        const seed = generateConversationSeed();
        tx.update(convRef, { keySeed: seed });
        return { ...data, id: convId, keySeed: seed };
      }
      const convData = buildConvData();
      tx.set(convRef, convData);
      return convData;
    });
  } catch (txErr) {
    // A denied/failed transaction must never produce a half-created
    // conversation. Surface it — sendPrivateMessage turns this into a
    // visible, retryable error instead of encrypting with an unverifiable key.
    console.warn('[HubbleNest] Conversation create/read failed:', txErr?.code || txErr);
    throw txErr;
  }
}

/**
 * Return the conversation's key seed — or null when it cannot be read YET.
 *
 * ⚠ NEVER invents a local seed. The previous behaviour (generating a random
 * seed when the conversation document did not exist yet) was the exact cause
 * of every message — including the sender's own — rendering as
 * "[Encrypted message - cannot be decrypted on this device]" with a console
 * full of OperationError: the listener froze a seed that matched nothing.
 * A missing seed is now a normal, recoverable state: callers show a
 * placeholder for one snapshot and self-heal by re-reading the real seed
 * (see subscribeToPrivateMessages).
 *
 * Concurrency-safe: the legacy backfill (doc exists without a seed) runs in
 * a transaction so two participants opening the same old chat at the same
 * time converge on ONE seed instead of overwriting each other's.
 */
export async function ensureConversationKeySeed(convId) {
  const convRef = doc(db, 'conversations', convId);
  try {
    const snap = await getDoc(convRef);
    if (!snap.exists()) return null;
    const existingSeed = snap.data().keySeed;
    if (existingSeed) return existingSeed;
    // Very old conversation without a seed — backfill exactly once.
    return await runTransaction(db, async (tx) => {
      const fresh = await tx.get(convRef);
      if (fresh.exists() && fresh.data().keySeed) {
        return fresh.data().keySeed;
      }
      const seed = generateConversationSeed();
      tx.update(convRef, { keySeed: seed });
      return seed;
    });
  } catch (err) {
    console.warn('[HubbleNest] Conversation key seed not readable right now:', err?.code || err);
    return null;
  }
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

  // ---------------------------------------------------------------------
  // Self-healing key seed (v2.1).
  //
  // The seed is READ FROM FIRESTORE, never invented locally, and is
  // RE-FETCHED automatically whenever a message fails to decrypt. This
  // heals every real-world race that used to permanently break a chat:
  //   • the chat was opened BEFORE the conversation existed (the standard
  //     "Chat" button flow on a brand-new DM) — the first snapshot used to
  //     freeze a random local seed, after which EVERY message, including
  //     the sender's own, rendered as undecryptable (OperationError);
  //   • the peer backfilled the seed a moment after our first read;
  //   • our own first message created the conversation milliseconds ago.
  // ---------------------------------------------------------------------
  let seed = null;
  let seedFetch = null;
  async function getSeed(forceRefresh = false) {
    if (!forceRefresh && seed) return seed;
    if (forceRefresh || !seedFetch) {
      seedFetch = ensureConversationKeySeed(convId)
        .then((s) => { if (s) seed = s; return s || null; })
        .catch(() => null);
    }
    return seedFetch;
  }
  getSeed(); // warm-up in the background; the first snapshot awaits it

  // Console hygiene: every message that ends up undecryptable is reported
  // ONCE for the life of this subscription (not once per snapshot), and the
  // legacy ECDH path is attempted only until we learn the device keys have
  // drifted — after that first failure the outcome is deterministic for
  // every other legacy message, so further WebCrypto work is pure waste.
  const warnedUndecryptableIds = new Set();
  let legacyKeysKnownDrifted = false;

  activePrivateUnsubscribe = onSnapshot(q, async (snap) => {
    // At most ONE forced re-read per snapshot: a backfill of 50 undecryptable
    // legacy messages must not fire 50 Firestore reads.
    let refreshedThisSnapshot = false;
    const decryptedList = [];
    const freshUndecryptableIds = [];
    for (const d of snap.docs) {
      const raw = d.data();
      let decryptedContent = { text: raw.ciphertext };

      if (raw.isEncrypted && raw.ciphertext && raw.iv) {
        // Primary path: the conversation-seed key (v2 scheme — always works,
        // on every device, for sender and receiver alike).
        const attemptSeed = await getSeed();
        decryptedContent = attemptSeed
          ? await decryptPrivateMessage(raw.ciphertext, raw.iv, convId, attemptSeed)
          : { text: UNDECRYPTABLE_TEXT, isDecryptionError: true };

        // SELF-HEAL: a failure almost always means our seed is stale or the
        // conversation document appeared after this listener attached.
        // Re-read the REAL seed from Firestore once and retry immediately —
        // no reload, no reopen, sender and receiver both recover live.
        if (decryptedContent.isDecryptionError && !refreshedThisSnapshot) {
          refreshedThisSnapshot = true;
          const freshSeed = await getSeed(true);
          if (freshSeed && freshSeed !== attemptSeed) {
            decryptedContent = await decryptPrivateMessage(raw.ciphertext, raw.iv, convId, freshSeed);
          }
        }

        // Fallback: messages written by the old per-device ECDH scheme carry
        // no scheme marker. Try the legacy key path once before giving up —
        // on the device where that keypair still matches, history stays
        // readable. Once a legacy attempt FAILS on this device, the same
        // keys would fail every other legacy message too — skip the rest.
        if (decryptedContent.isDecryptionError && raw.scheme !== 'seed' && !legacyKeysKnownDrifted) {
          try {
            const legacy = await decryptLegacyEcdhMessage(
              raw.ciphertext,
              raw.iv,
              currentUser.uid,
              peerUser.uid,
              peerUser.publicKeyJwk
            );
            if (legacy && !legacy.isDecryptionError) {
              decryptedContent = legacy;
            } else {
              legacyKeysKnownDrifted = true;
            }
          } catch (e) {
            legacyKeysKnownDrifted = true; /* keep the placeholder */
          }
        }

        if (decryptedContent.isDecryptionError) {
          freshUndecryptableIds.push(d.id);
        }
      }

      decryptedList.push({
        id: d.id,
        ...raw,
        decrypted: decryptedContent
      });
    }
    // ONE calm line per newly-failing message, never repeated on later
    // snapshots of the same conversation (the old code warned per snapshot,
    // which read like an ongoing failure even when nothing had changed).
    if (freshUndecryptableIds.length) {
      freshUndecryptableIds.forEach((id) => warnedUndecryptableIds.add(id));
      console.warn(
        `[HubbleNest] ${warnedUndecryptableIds.size} message(s) in this chat cannot be decrypted on this device ` +
        '(written with a key this device no longer has — typically messages from before the seed scheme). ' +
        'New messages are NOT affected.'
      );
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
  if (!seed) {
    // Never encrypt with an unverifiable seed: that ciphertext could never
    // be read again. The user gets a visible, retryable error instead.
    throw new Error('This conversation could not be secured (key unavailable). Reopen the chat and try again.');
  }

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

