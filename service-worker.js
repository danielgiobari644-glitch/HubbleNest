/**
 * HubbleNest Progressive Web App & Web Push Service Worker
 * Uses relative asset paths so the app works when hosted from ANY base path
 * (domain root, GitHub Pages project subpath, Firebase Hosting, etc.)
 *
 * CACHING STRATEGY (v7 — "fast loads"):
 * - App navigations:            network-first → cache → cached shell
 * - Same-origin shell assets:   cache-first (all assets are precached; the
 *                               cache version is bumped on every deploy,
 *                               which evicts the old cache atomically)
 * - Firebase SDK (gstatic):     cache-first (immutable, version-pinned URLs)
 * - Google Fonts:               cache-first
 * - Cloudinary images:          cache-first with a 220-entry FIFO cap
 * - Firestore/Auth/FCM APIs:    NEVER intercepted (SDK handles persistence)
 */

const CACHE_NAME = 'hubblenest-v7';
const IMAGE_CACHE = 'hubblenest-images-v7';
const IMAGE_CACHE_CAP = 220;
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase.js',
  './auth.js',
  './spaces.js',
  './chat.js',
  './private-chat.js',
  './chat-requests.js',
  './people.js',
  './profile.js',
  './files.js',
  './announcements.js',
  './members.js',
  './notifications.js',
  './fcm-sender.js',
  './cloudinary.js',
  './encryption.js',
  './qr.js',
  './search.js',
  './settings.js',
  './utils.js',
  './home.js',
  './icon.svg',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './apple-touch-icon.png',
  './manifest.webmanifest',
  './hero-cosmic.png',
  './usecase-school.png',
  './usecase-team.png',
  './usecase-faith.png',
  './usecase-community.png',
  './welcome-scenic.svg'
];

// Install: Pre-cache core shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('Some precache assets failed:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== IMAGE_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

/* ---------------------------------- helpers ---------------------------------- */

function isCacheableResponse(response) {
  return !!response && (response.ok || response.type === 'opaque');
}

// Cache-first: instant from cache, network only on miss (immutable resources
// and precached shell assets — freshness is guaranteed by the CACHE_NAME bump
// on every deploy, which evicts the previous cache at activation).
async function cacheFirst(request, cacheName = CACHE_NAME) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (networkError) {
    return new Response('Offline', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// Keep the Cloudinary image cache bounded (FIFO trim)
async function trimImageCache() {
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const keys = await cache.keys();
    if (keys.length <= IMAGE_CACHE_CAP) return;
    const excess = keys.length - IMAGE_CACHE_CAP;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  } catch (e) { /* trimming is best-effort */ }
}

/* ---------------------------------- fetch ---------------------------------- */

// CRITICAL CONTRACT: event.respondWith() must ALWAYS settle with a valid
// Response object (never undefined) — resolving to a non-Response throws
// "TypeError: Failed to convert value to 'Response'" and surfaces as a
// network error for the whole FetchEvent.
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Ignore non-GET and byte-range requests
  if (request.method !== 'GET' || request.headers.has('range')) return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  const host = url.hostname;

  // Firestore / Auth / FCM API calls must never be intercepted by the SW —
  // the Firebase SDK owns their caching/persistence.
  if (
    host.includes('firestore.googleapis.com') ||
    host.includes('identitytoolkit.googleapis.com') ||
    host.includes('securetoken.googleapis.com') ||
    host.includes('fcm.googleapis.com') ||
    host.includes('fcmregistrations.googleapis.com')
  ) {
    return;
  }

  // Firebase SDK chunks on www.gstatic.com are immutable (version-pinned URL).
  // Cache them so repeat loads (and offline boots) don't re-download ~1MB.
  if (host === 'www.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Google Fonts stylesheets + font files: stable URLs → cache-first.
  if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Cloudinary images (avatars, attachments, covers): cache-first with a cap.
  // Only image responses are stored — videos/raw files stay network-only.
  if (host.endsWith('.cloudinary.com') || host.includes('cloudinary.com')) {
    event.respondWith((async () => {
      const response = await cacheFirst(request, IMAGE_CACHE);
      try {
        const contentType = response && response.headers ? response.headers.get('content-type') || '' : '';
        if (contentType.startsWith('image/')) await trimImageCache();
      } catch (e) { /* best effort */ }
      return response;
    })());
    return;
  }

  // App navigations: network-first (fresh deploys arrive immediately),
  // with robust cache fallback for offline / flaky networks.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone()).catch(() => {});
        }
        return networkResponse;
      } catch (networkError) {
        const cached = await caches.match(request, { ignoreSearch: true }).catch(() => null);
        if (cached) return cached;
        const shell =
          (await caches.match('./index.html')) ||
          (await caches.match('./')) ||
          (await caches.match('./', { ignoreSearch: true }));
        if (shell) return shell;
        return new Response('Offline', {
          status: 503,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // Everything else on our own origin (css/js/png/svg/webmanifest):
  // cache-first — zero round trips on repeat loads (all precached;
  // deploy freshness via the cache-version bump).
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});

/* ------------------------------ Web Push (FCM v1) ------------------------------ */

// Web Push Notification Handler
// Receives messages sent through Firebase Cloud Messaging (FCM HTTP v1),
// whether the app is open in a tab or fully closed.
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'HubbleNest', body: event.data.text() };
    }
  }

  // FCM v1 delivers { notification: {...}, data: {...}, fcmMessageId }
  const payloadNotification = data.notification || {};
  const payloadData = data.data || {};

  const title = data.title || payloadNotification.title || 'HubbleNest';
  const body = data.body || payloadNotification.body || 'You have new activity in HubbleNest';
  const icon = payloadNotification.icon || data.icon || './pwa-192x192.png';
  const image = payloadNotification.image || data.image || null;
  const targetUrl = payloadData.url || data.url || './index.html';

  const options = {
    body,
    icon,
    badge: './pwa-192x192.png',
    image,
    tag: payloadData.tag || data.tag || 'hubblenest-notification',
    data: { url: targetUrl },
    renotify: true,
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Open HubbleNest' }
    ]
  };

  event.waitUntil(
    (async () => {
      // If a window of this app is currently focused, forward the message to
      // the page instead of raising a system notification (avoids duplicates —
      // the in-app Firestore listener already renders live toasts).
      try {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const focused = clientList.filter(
          (c) => c.url.startsWith(self.location.origin) && c.visibilityState === 'visible'
        );
        if (focused.length > 0) {
          focused.forEach((client) => client.postMessage({ type: 'push-received', payload: data }));
          return;
        }
      } catch (e) { /* fall through to system notification */ }

      await self.registration.showNotification(title, options);
    })()
  );
});

// Notification Click Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  let targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : './index.html';
  // Resolve relative URLs against the service worker location (works on any base path)
  targetUrl = new URL(targetUrl, self.serviceWorker.scriptURL).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.focus();
          return client.navigate(targetUrl).catch(() => client.focus());
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
