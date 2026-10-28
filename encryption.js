/**
 * HubbleNest Message Encryption Engine
 *
 * AES-256-GCM (256-bit key, 96-bit random IV per message) with a key that is
 * derived deterministically from a per-conversation random seed:
 *
 *   key = SHA-256("hn-dm2|" + conversationId + "|" + keySeed)  → AES-GCM key
 *
 * Why this design (v2):
 *   The previous scheme (v1) used per-device ECDH keypairs: the private key
 *   lived in localStorage while the matching public key was published to the
 *   user's profile. ANY divergence — signing in on a second device, clearing
 *   site data, regenerating the pair on one device only — made the two sides
 *   derive DIFFERENT shared keys, and every message (including the sender's
 *   own) rendered as "[Encrypted message - cannot be decrypted on this
 *   device]" forever. A scheme that breaks silently for real users is worse
 *   than no encryption, so messaging now uses the conversation seed:
 *
 *   - The seed is generated once per conversation (crypto.getRandomValues,
 *     256 bits) and stored ON the conversation document in Firestore.
 *   - Firestore security rules restrict that document (and its messages
 *     subcollection) to conversation participants — so the key material is
 *     exactly as protected as the ciphertext next to it.
 *   - Both participants (and every device they sign in on) always derive the
 *     SAME key, so messages are always readable, including by the sender.
 *   - Plaintext still never reaches Firestore: only ciphertext + IV leave
 *     the browser, and encryption/decryption happen exclusively client-side
 *     with the Web Crypto API (AES-256-GCM is authenticated encryption —
 *     tampered ciphertext fails to decrypt rather than rendering garbage).
 */

const KEY_CACHE = new Map();
const KEY_DOMAIN = 'hn-dm2';

/**
 * Readable placeholder shown for a message whose ciphertext cannot be
 * authenticated with the conversation key (wrong/missing seed or tampered
 * data). Shared by encryption.js and private-chat.js so the wording stays
 * identical everywhere.
 */
export const UNDECRYPTABLE_TEXT = '[Encrypted message - cannot be decrypted on this device]';

export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToBuffer(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generate a fresh 256-bit conversation key seed (base64).
 * Called once when a conversation is created; persisted by private-chat.js.
 */
export function generateConversationSeed() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return bufferToBase64(bytes.buffer);
}

/**
 * Derive (and cache) the AES-GCM 256 key for a conversation.
 * Deterministic: every participant+device converges on the identical key.
 */
export async function getConversationKey(convId, seedB64) {
  const cacheKey = `${convId}::${seedB64}`;
  if (KEY_CACHE.has(cacheKey)) {
    return KEY_CACHE.get(cacheKey);
  }

  const encoder = new TextEncoder();
  const prefix = encoder.encode(`${KEY_DOMAIN}|${convId}|`);
  const seedBytes = new Uint8Array(base64ToBuffer(seedB64));
  const material = new Uint8Array(prefix.length + seedBytes.length);
  material.set(prefix, 0);
  material.set(seedBytes, prefix.length);

  const digest = await window.crypto.subtle.digest('SHA-256', material);
  const key = await window.crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  KEY_CACHE.set(cacheKey, key);
  return key;
}

/**
 * Encrypt a payload object (text, attachments, replies) for a conversation.
 */
export async function encryptPrivateMessage(payloadObj, convId, seedB64) {
  const key = await getConversationKey(convId, seedB64);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payloadObj));

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    plaintextBytes
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv.buffer),
    isEncrypted: true,
    scheme: 'seed'
  };
}

/**
 * Decrypt a message. Never throws — an undecryptable message (missing seed,
 * wrong key, tampered data) comes back with a readable placeholder so the
 * chat keeps working and the failure is visible, not fatal.
 *
 * Deliberately QUIET: a failed attempt is an EXPECTED step of the self-heal
 * loop in private-chat.js (stale seed → re-read the real seed → retry), so
 * this function no longer console-warns per attempt. The caller emits ONE
 * calm warning only when every attempt for a message has failed.
 */
export async function decryptPrivateMessage(ciphertextBase64, ivBase64, convId, seedB64) {
  try {
    if (!ciphertextBase64 || !ivBase64 || !convId || !seedB64) {
      // Missing key material (e.g. the conversation document was not readable
      // YET) — a recoverable state, not a crypto failure.
      return { text: UNDECRYPTABLE_TEXT, isDecryptionError: true, failureReason: 'missing-key-material' };
    }

    const key = await getConversationKey(convId, seedB64);
    const iv = new Uint8Array(base64ToBuffer(ivBase64));
    const ciphertext = base64ToBuffer(ciphertextBase64);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );

    return JSON.parse(new TextDecoder().decode(decryptedBuffer));
  } catch (err) {
    // Silent by design (see docstring); the failure reason is surfaced to
    // the caller via the placeholder object for one-shot diagnostics.
    return {
      text: UNDECRYPTABLE_TEXT,
      isDecryptionError: true,
      failureReason: err?.name || 'DecryptError'
    };
  }
}

/* ========================================================================
   Legacy v1 (ECDH) decryption — kept ONLY so messages sent under the old
   scheme remain readable on devices where the keypair still matches.
   New messages never use this path.
   ======================================================================== */

const LEGACY_STORAGE_PREFIX = 'hubblenest_e2e_privkey_';

/**
 * Ensure a legacy ECDH keypair exists locally (used by the fallback path and
 * by nothing else — new conversations do not depend on it).
 */
export async function ensureUserKeyPair(userId) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('Web Crypto API is required for secure private messaging.');
  }

  const storageKey = LEGACY_STORAGE_PREFIX + userId;
  const storedPrivKey = localStorage.getItem(storageKey);
  const storedPubKey = localStorage.getItem(storageKey + '_pub');

  if (storedPrivKey && storedPubKey) {
    try {
      return {
        publicKeyJwk: JSON.parse(storedPubKey),
        hasPrivateKey: true
      };
    } catch (e) {
      console.warn('Regenerating corrupted keypair', e);
    }
  }

  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const pubJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

  localStorage.setItem(storageKey, JSON.stringify(privJwk));
  localStorage.setItem(storageKey + '_pub', JSON.stringify(pubJwk));

  return {
    publicKeyJwk: pubJwk,
    hasPrivateKey: true
  };
}

async function getLocalPrivateKey(userId) {
  const storageKey = LEGACY_STORAGE_PREFIX + userId;
  let privStr = localStorage.getItem(storageKey);
  if (!privStr) {
    await ensureUserKeyPair(userId);
    privStr = localStorage.getItem(storageKey);
  }
  const privJwk = JSON.parse(privStr);
  return await window.crypto.subtle.importKey(
    'jwk',
    privJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits']
  );
}

/**
 * Legacy v1 decrypt: ECDH between the LOCAL device private key and the
 * peer's published public key. Returns null when the stored keys no longer
 * match the ones this message was written with (device drift) — the caller
 * then falls back to the readable placeholder.
 */
export async function decryptLegacyEcdhMessage(ciphertextBase64, ivBase64, myUserId, peerUserId, peerPubJwk) {
  try {
    if (!peerPubJwk) return null;

    const myPrivateKey = await getLocalPrivateKey(myUserId);
    const peerPublicKey = await window.crypto.subtle.importKey(
      'jwk',
      peerPubJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    const sharedKey = await window.crypto.subtle.deriveKey(
      { name: 'ECDH', public: peerPublicKey },
      myPrivateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    const iv = new Uint8Array(base64ToBuffer(ivBase64));
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      sharedKey,
      base64ToBuffer(ciphertextBase64)
    );

    return JSON.parse(new TextDecoder().decode(decryptedBuffer));
  } catch (err) {
    console.warn('Legacy decryption failed (device keys drifted):', err?.name || err);
    return null;
  }
}

/**
 * Human-readable key fingerprint (legacy diagnostics).
 */
export function getPublicKeyFingerprint(pubJwk) {
  if (!pubJwk || !pubJwk.x) return 'HN-ECDH-UNAVAILABLE';
  return `HN-ECDH-${pubJwk.x.slice(0, 10).toUpperCase()}`;
}
