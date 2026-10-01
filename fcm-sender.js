/**
 * HubbleNest — Direct Firebase Cloud Messaging (HTTP v1) Sender
 * ---------------------------------------------------------------
 * Sends real Web Push notifications from inside the app itself, with ZERO
 * custom servers. 100% Firebase + vanilla JS (WebCrypto).
 *
 * How it works (all verified CORS-safe for browser callers):
 *   1. A service-account private key (Firebase Console → Project settings →
 *      Service accounts) is stored by the app owner in Firestore at
 *      `config/push` as { clientEmail, privateKey }.
 *   2. This module signs an RS256 JWT with WebCrypto and exchanges it at
 *      https://oauth2.googleapis.com/token for a short-lived OAuth access token.
 *   3. The access token authorizes POSTs to
 *      https://fcm.googleapis.com/v1/projects/{projectId}/messages:send
 *      which delivers the push through Firebase Cloud Messaging to every
 *      recipient's browser — even when HubbleNest is completely closed.
 *
 * SECURITY NOTE: the service account key is visible to signed-in members of
 * this app. Create a DEDICATED service account granted only the
 * "Firebase Cloud Messaging API Admin" role and rotate it if ever needed.
 */

import { app } from './firebase.js';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

let cachedAccessToken = null; // { token, expiresAtMs }

/* ----------------------------- helpers ---------------------------------- */

function base64UrlFromBytes(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonToBase64Url(obj) {
  return base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(obj)));
}

function pemToPkcs8Bytes(pem) {
  const normalized = String(pem)
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importSigningKey(privateKeyPem) {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8Bytes(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/* --------------------------- OAuth2 (JWT Bearer) ------------------------- */

async function fetchAccessToken(clientEmail, privateKeyPem) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: FCM_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600
  };
  const unsigned = `${jsonToBase64Url(header)}.${jsonToBase64Url(claims)}`;

  const key = await importSigningKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const resp = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`OAuth token exchange failed (${resp.status}): ${text.slice(0, 180)}`);
  }
  const data = await resp.json();
  if (!data.access_token) throw new Error('OAuth response missing access_token');

  return {
    token: data.access_token,
    expiresAtMs: Date.now() + (Number(data.expires_in) || 3600) * 1000
  };
}

async function getAccessToken(clientEmail, privateKeyPem) {
  if (cachedAccessToken && cachedAccessToken.expiresAtMs - 60000 > Date.now()) {
    return cachedAccessToken.token;
  }
  cachedAccessToken = await fetchAccessToken(clientEmail, privateKeyPem);
  return cachedAccessToken.token;
}

/* ----------------------------- FCM v1 send ------------------------------- */

/**
 * Send one message to one FCM registration token.
 * @returns {Promise<{ok: boolean, deadToken?: boolean, error?: string}>}
 */
export async function sendFcmMessage(registrationToken, { title, body, icon, link, dataFields = {} }) {
  const projectId = app.options && app.options.projectId;
  if (!projectId) return { ok: false, error: 'Missing Firebase projectId' };

  const config = await getConfigCredentials();
  if (!config) return { ok: false, error: 'not-configured' };
  const accessToken = await getAccessToken(config.clientEmail, config.privateKey);

  const message = {
    token: registrationToken,
    notification: { title, body },
    webpush: {
      headers: { TTL: '86400', Urgency: 'high' },
      data: dataFields
    }
  };
  if (icon) message.notification.icon = icon;
  if (link) message.webpush.fcmOptions = { link };
  if (dataFields && dataFields.image) message.notification.image = dataFields.image;

  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({ message })
  });

  if (resp.ok) return { ok: true };

  const text = await resp.text().catch(() => '');
  const dead = resp.status === 404 || resp.status === 410 ||
    /UNREGISTERED|INVALID_ARGUMENT.*token|Requested entity was not found/i.test(text);
  return { ok: false, deadToken: dead, error: `FCM ${resp.status}: ${text.slice(0, 180)}` };
}

/* --------------------- Firestore-sourced credentials --------------------- */

let configCache = { value: null, fetchedAtMs: 0 };

/**
 * Read { clientEmail, privateKey } from Firestore `config/push`.
 * Cached for 10 minutes. Returns null when not configured (graceful no-op).
 */
export async function getConfigCredentials() {
  if (configCache.value && Date.now() - configCache.fetchedAtMs < 10 * 60 * 1000) {
    return configCache.value;
  }
  try {
    const { db, doc, getDoc } = await import('./firebase.js');
    const snap = await getDoc(doc(db, 'config', 'push'));
    if (snap.exists()) {
      const d = snap.data();
      if (d.clientEmail && d.privateKey) {
        configCache = { value: { clientEmail: d.clientEmail, privateKey: d.privateKey }, fetchedAtMs: Date.now() };
        return configCache.value;
      }
    }
  } catch (err) {
    console.warn('[HubbleNest Push] Could not read config/push:', err && err.code ? err.code : err);
  }
  return null;
}

export function invalidatePushConfigCache() {
  configCache = { value: null, fetchedAtMs: 0 };
  cachedAccessToken = null;
}
