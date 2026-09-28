/* =============================================================
   LinkRoom — End-to-End Encryption (Web Crypto API)
   -------------------------------------------------------------
   Architecture:
   - Each user generates an ECDH keypair (P-256) on first login.
   - Public key (SPKI, base64) is stored in `profiles.public_key`.
   - Private key NEVER leaves the browser. It is stored in IndexedDB,
     encrypted at rest with an AES-GCM key derived from a randomly
     generated "vault key" persisted separately in localStorage.
     (For a stronger design, see README.md — you may switch to a
     password-derived key derivation; the API surface stays the same.)
   - Sending a private message:
       1. Recipient's public_key → import as CryptoKey
       2. ECDH derive shared AES-GCM key
       3. Encrypt plaintext + attachment metadata → ciphertext + IV
       4. Insert row into private_messages (ciphertext only).
   - Receiving:
       1. Use stored private key + sender's public key to derive same shared key.
       2. Decrypt locally. Plaintext never touches the server.
   - Supabase only stores ciphertext + IV — server cannot read messages.
   ============================================================= */

window.LinkRoomCrypto = (function () {
  'use strict';

  const DB_NAME = 'linkroom_crypto';
  const STORE = 'keys';
  const DB_VERSION = 1;

  // ---------- IndexedDB helpers ----------
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const st = tx.objectStore(STORE);
      const r = st.get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      const r = st.put(value, key);
      r.onsuccess = () => resolve(true);
      r.onerror = () => reject(r.error);
    });
  }

  async function idbDel(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- Vault key (protects private key in IndexedDB) ----------
  function getVaultKey() {
    let k = Utils.ls.get('vault_key');
    if (!k) {
      const arr = new Uint8Array(32);
      crypto.getRandomValues(arr);
      k = b64Url(new Uint8Array(arr));
      Utils.ls.set('vault_key', k);
    }
    return k;
  }

  async function deriveVaultKey() {
    const raw = getVaultKey();
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(raw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('linkroom-salt-v1'), iterations: 100000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ---------- Base64 helpers ----------
  function b64Url(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBuf(b64) {
    const s = atob(b64);
    const arr = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i);
    return arr.buffer;
  }

  // ---------- Identity keypair (ECDH P-256) ----------
  async function generateIdentity() {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const pubSpki  = await crypto.subtle.exportKey('spki', pair.publicKey);
    const privPkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);

    // Encrypt private key before storing
    const vault = await deriveVaultKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encPriv = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vault, privPkcs8);

    const payload = {
      pub_b64: b64Url(pubSpki),
      enc_priv: b64Url(encPriv),
      iv: b64Url(iv)
    };

    await idbSet('identity', payload);
    return payload;
  }

  async function getPrivateKey() {
    const payload = await idbGet('identity');
    if (!payload) return null;
    const vault = await deriveVaultKey();
    const encBuf = b64ToBuf(payload.enc_priv);
    const iv = new Uint8Array(b64ToBuf(payload.iv));
    const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, vault, encBuf);
    return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
  }

  async function getPublicB64() {
    const payload = await idbGet('identity');
    return payload ? payload.pub_b64 : null;
  }

  async function importPublicFromB64(b64) {
    const spki = b64ToBuf(b64);
    return crypto.subtle.importKey('spki', spki, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  }

  async function importPublicJwkIfAvailable(jwk) {
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  }

  // ---------- Shared secret derivation ----------
  async function deriveSharedKey(myPriv, theirPub) {
    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: theirPub },
      myPriv,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ---------- Encrypt / decrypt message (and optional meta) ----------
  async function encryptMessage(plaintext, sharedKey, meta) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, enc.encode(plaintext));
    let encMeta = null, metaIv = null;
    if (meta) {
      const mIv = crypto.getRandomValues(new Uint8Array(12));
      const mCt = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: mIv }, sharedKey, enc.encode(JSON.stringify(meta)));
      encMeta = b64Url(mCt);
      metaIv = b64Url(mIv);
    }
    return { ciphertext: b64Url(ct), iv: b64Url(iv), encrypted_meta: encMeta, meta_iv: metaIv };
  }

  async function decryptMessage(ciphertext, ivB64, sharedKey, encMeta, metaIvB64) {
    try {
      const iv = new Uint8Array(b64ToBuf(ivB64));
      const ct = b64ToBuf(ciphertext);
      const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKey, ct);
      const plaintext = new TextDecoder().decode(ptBuf);
      let meta = null;
      if (encMeta && metaIvB64) {
        const mIv = new Uint8Array(b64ToBuf(metaIvB64));
        const mCt = b64ToBuf(encMeta);
        const mBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: mIv }, sharedKey, mCt);
        try { meta = JSON.parse(new TextDecoder().decode(mBuf)); } catch { meta = null; }
      }
      return { plaintext, meta };
    } catch (e) {
      console.warn('Decrypt failed:', e);
      return null;
    }
  }

  // ---------- Cache shared keys per conversation (memory only) ----------
  const sharedKeyCache = new Map();

  function cacheKey(userId) { return 'shared:' + userId; }

  async function getSharedKeyFor(theirPubB64, theirUserId) {
    const ck = cacheKey(theirUserId);
    if (sharedKeyCache.has(ck)) return sharedKeyCache.get(ck);

    const myPriv = await getPrivateKey();
    if (!myPriv) throw new Error('No local private key');
    const theirPub = await importPublicFromB64(theirPubB64);
    const shared = await deriveSharedKey(myPriv, theirPub);
    sharedKeyCache.set(ck, shared);
    return shared;
  }

  function invalidateShared(theirUserId) {
    sharedKeyCache.delete(cacheKey(theirUserId));
  }

  // ---------- Bootstrap on first login ----------
  async function ensureIdentity() {
    const existing = await idbGet('identity');
    if (existing && existing.pub_b64) return existing.pub_b64;
    const newId = await generateIdentity();
    return newId.pub_b64;
  }

  async function hasIdentity() {
    const existing = await idbGet('identity');
    return !!(existing && existing.pub_b64);
  }

  // ---------- Public fingerprint (for verification, optional) ----------
  async function fingerprint() {
    const pub = await getPublicB64();
    if (!pub) return null;
    const buf = b64ToBuf(pub);
    const h = await crypto.subtle.digest('SHA-256', buf);
    const hex = Array.from(new Uint8Array(h)).slice(0,16).map(b => b.toString(16).padStart(2,'0')).join(' ');
    return hex;
  }

  return {
    ensureIdentity,
    getPublicB64,
    hasIdentity,
    generateIdentity,
    getSharedKeyFor,
    invalidateShared,
    encryptMessage,
    decryptMessage,
    importPublicFromB64,
    fingerprint,
    b64Url,
    b64ToBuf,
    _idbSet: idbSet,
    _idbGet: idbGet
  };
})();
