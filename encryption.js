/**
 * HubbleNest End-to-End Cryptography Engine
 * 
 * Standard Web Crypto API (SubtleCrypto):
 * - Key Agreement: ECDH (NIST P-256)
 * - Symmetric Authenticated Encryption: AES-GCM (256-bit key, 96-bit random IV)
 * 
 * Guarantees:
 * - Plaintext is encrypted exclusively in the browser.
 * - Firestore stores only ciphertext and random IV.
 * - Private keys never leave the client's local storage.
 * - Only the conversation participants can decrypt.
 */

const STORAGE_PREFIX = 'hubblenest_e2e_privkey_';
const KEY_CACHE = new Map();

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
 * Ensure user has an ECDH keypair generated and stored locally
 */
export async function ensureUserKeyPair(userId) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('Web Crypto API is required for secure private messaging.');
  }

  const storageKey = STORAGE_PREFIX + userId;
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

  // Generate fresh ECDH P-256 Key Pair
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
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

/**
 * Import local private key into CryptoKey
 */
async function getLocalPrivateKey(userId) {
  const storageKey = STORAGE_PREFIX + userId;
  let privStr = localStorage.getItem(storageKey);
  if (!privStr) {
    await ensureUserKeyPair(userId);
    privStr = localStorage.getItem(storageKey);
  }
  const privJwk = JSON.parse(privStr);
  return await window.crypto.subtle.importKey(
    'jwk',
    privJwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    ['deriveKey', 'deriveBits']
  );
}

/**
 * Import peer public key JWK into CryptoKey
 */
async function importPeerPublicKey(peerPubJwk) {
  return await window.crypto.subtle.importKey(
    'jwk',
    peerPubJwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false,
    []
  );
}

/**
 * Derive shared AES-GCM 256-bit symmetric key
 */
export async function getSharedSecretKey(myUserId, peerUserId, peerPubJwk) {
  const cacheKey = [myUserId, peerUserId].sort().join('::');
  if (KEY_CACHE.has(cacheKey)) {
    return KEY_CACHE.get(cacheKey);
  }

  if (!peerPubJwk) {
    throw new Error('Recipient has not generated a public key yet.');
  }

  const myPrivateKey = await getLocalPrivateKey(myUserId);
  const peerPublicKey = await importPeerPublicKey(peerPubJwk);

  const sharedKey = await window.crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: peerPublicKey
    },
    myPrivateKey,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );

  KEY_CACHE.set(cacheKey, sharedKey);
  return sharedKey;
}

/**
 * Encrypt payload object (text, attachments, replies)
 */
export async function encryptPrivateMessage(payloadObj, myUserId, peerUserId, peerPubJwk) {
  const sharedKey = await getSharedSecretKey(myUserId, peerUserId, peerPubJwk);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(JSON.stringify(payloadObj));

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    sharedKey,
    plaintextBytes
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv.buffer),
    isEncrypted: true
  };
}

/**
 * Decrypt payload object
 */
export async function decryptPrivateMessage(ciphertextBase64, ivBase64, myUserId, peerUserId, peerPubJwk) {
  try {
    const sharedKey = await getSharedSecretKey(myUserId, peerUserId, peerPubJwk);
    const iv = new Uint8Array(base64ToBuffer(ivBase64));
    const ciphertext = base64ToBuffer(ciphertextBase64);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      sharedKey,
      ciphertext
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decryptedBuffer));
  } catch (err) {
    console.warn('Decryption error:', err);
    return {
      text: '[Encrypted message - cannot be decrypted on this device]',
      isDecryptionError: true
    };
  }
}

/**
 * Generate human-readable key fingerprint
 */
export function getPublicKeyFingerprint(pubJwk) {
  if (!pubJwk || !pubJwk.x) return 'HN-ECDH-UNAVAILABLE';
  return `HN-ECDH-${pubJwk.x.slice(0, 10).toUpperCase()}`;
}
