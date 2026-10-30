/**
 * HubbleNest Progressive Web App & Web Push Service Worker
 * Uses relative asset paths so the app works when hosted from ANY base path
 * (domain root, GitHub Pages project subpath, Firebase Hosting, etc.)
 *
 * CACHING STRATEGY (v14 — "the module graph can NEVER mix deploy versions"):
 * - App navigations:            network-first with cache:'reload' (revalidates
 *                               the HTML shell, never trusting the browser's
 *                               max-age=600 HTTP cache) → cache → cached shell
 * - Same-origin JS + CSS:       NETWORK-FIRST with cache:'no-cache'. A module
 *                               graph (app.js → spaces.js → …) must always
 *                               come from ONE deploy: serving any cached
 *                               module stale-while-revalidate let a fresh
 *                               app.js?v=13 link against a STALE spaces.js
 *                               ("does not provide an export named …") during
 *                               a deploy window. Offline falls back to cache.
 * - Other same-origin assets:   STALE-WHILE-REVALIDATE with no-cache
 *                               revalidation — served instantly from cache
 *                               while a freshly-validated copy replaces it.
 *                               Matching ignores the ?v= deploy-version query,
 *                               so versioned asset URLs hit the canonical
 *                               precached entries.
 * - Precache install:           every asset is fetched with cache:'reload' so
 *                               the precache can NEVER store stale HTTP-cache
 *                               bytes during a deploy window.
 * - Deploys:                    index.html references ?v=N asset URLs; on each
 *                               release N bumps, the SW version bumps, and the
 *                               page auto-reloads once when the new worker
 *                               claims (see app.js controllerchange).
 * - Firebase SDK (gstatic):     stale-while-revalidate (immutable URLs —
 *                               background refresh is a cheap no-op hit)
 * - Google Fonts:               stale-while-revalidate
 * - Cloudinary images:          stale-while-revalidate + 220-entry FIFO cap
 * - Firestore/Auth/FCM APIs:    NEVER intercepted (SDK handles persistence)
 */

const CACHE_NAME = 'hubblenest-v16';
const IMAGE_CACHE = 'hubblenest-images-v16';
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
  './community.js',
  './games.js',
  './ai-game-builder.js',
  './direct-share.js',
  './firestore-doctor.js',
  './format.js',
  './contacts.js',
  './icons.js',
  './public-game-builder.js',
  './public.css',
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

// Install: Pre-cache core shell.
// CRITICAL: each asset is fetched with cache:'reload'. cache.addAll() would
// use the default HTTP cache — and GitHub Pages serves assets with
// Cache-Control: max-age=600, so during a deploy window addAll() could copy
// STALE bytes into the brand-new cache version, keeping users on old code
// even after the version bump. cache:'reload' bypasses the HTTP cache.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_ASSETS.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (isCacheableResponse(response)) await cache.put(url, response);
      } catch (e) {
        // Offline during install — keep whatever this cache already holds.
      }
    }));
    await self.skipWaiting();
  })());
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

// Stale-while-revalidate: respond INSTANTLY from cache (or network on first
// miss) and refresh the cached copy in the background.
// - matchOpts.ignoreSearch lets versioned deploy URLs (app.js?v=12) resolve to
//   the canonical precached entry (./app.js).
// - revalidate=true fetches the network leg with cache:'no-cache' so the
//   revalidation never copies stale bytes from the browser HTTP cache
//   (GitHub Pages max-age=600) — fixed deploys reach the very next load.
async function staleWhileRevalidate(request, cacheName = CACHE_NAME, matchOpts = {}, revalidate = false) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, matchOpts);

  const networkUpdate = (async () => {
    try {
      const response = revalidate
        ? await fetch(request, { cache: 'no-cache' })
        : await fetch(request);
      if (isCacheableResponse(response)) {
        await cache.put(request, response.clone());
        // The same-origin branch matches with ignoreSearch — when this request
        // carried a deploy-version query (app.js?v=12), ALSO refresh the
        // canonical query-stripped entry (./app.js). Otherwise a stale/poisoned
        // canonical entry would keep winning the ignoreSearch match forever
        // while only the versioned key healed.
        if (revalidate) {
          const canonical = new URL(request.url);
          if (canonical.search) {
            canonical.search = '';
            await cache.put(new Request(canonical.href), response.clone());
          }
        }
      }
      return response;
    } catch (networkError) {
      return null; // offline — cached copy (if any) keeps serving
    }
  })();

  if (cached) return cached;

  const fresh = await networkUpdate;
  if (fresh) return fresh;
  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

// NETWORK-FIRST for same-origin JS/CSS — the module-graph consistency fix.
// Every stylesheet/script of the app shell is fetched from the network
// (bypassing BOTH the SW cache and the max-age=600 HTTP cache) whenever the
// device is online; the cache copy is only used when offline. This makes a
// mixed-version module graph (fresh app.js + stale spaces.js →
// "SyntaxError: does not provide an export named …") impossible while
// online, and still boots instantly from the precache when offline.
// On success, BOTH the exact request URL and the canonical query-stripped
// entry are refreshed so the precache self-heals too.
async function networkFirstCode(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (isCacheableResponse(response)) {
      cache.put(request, response.clone()).catch(() => {});
      const canonical = new URL(request.url);
      if (canonical.search) {
        canonical.search = '';
        cache.put(new Request(canonical.href), response.clone()).catch(() => {});
      }
    }
    return response;
  } catch (networkError) {
    // Offline (or the request failed): exact match first, then any version
    // of the same file, then give up.
    const exact = await cache.match(request).catch(() => null);
    if (exact) return exact;
    const anyVersion = await cache.match(request, { ignoreSearch: true }).catch(() => null);
    if (anyVersion) return anyVersion;
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
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Google Fonts stylesheets + font files: stable URLs → SWR.
  if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Cloudinary images (avatars, attachments, covers): SWR with a cap.
  // Only image responses are stored — videos/raw files stay network-only.
  if (host.endsWith('.cloudinary.com') || host.includes('cloudinary.com')) {
    event.respondWith((async () => {
      const response = await staleWhileRevalidate(request, IMAGE_CACHE);
      try {
        const contentType = response && response.headers ? response.headers.get('content-type') || '' : '';
        if (contentType.startsWith('image/')) trimImageCache();
      } catch (e) { /* best effort */ }
      return response;
    })());
    return;
  }

  // App navigations: network-first with cache:'reload' (fresh deploys arrive
  // immediately, never from the max-age=600 HTTP cache), with robust cache
  // fallback for offline / flaky networks.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request, { cache: 'reload' });
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

  // Everything else on our own origin:
  // - JS + CSS: NETWORK-FIRST (see networkFirstCode — module graphs must
  //   never mix deploy versions during a deploy window).
  // - Everything else (images, manifest, fonts we host…):
  //   stale-while-revalidate with no-cache revalidation — zero perceived
  //   latency AND deploy freshness on the next load. ignoreSearch makes
  //   versioned URLs (app.js?v=12) hit canonical entries.
  if (url.origin === self.location.origin) {
    const isCodeAsset =
      request.destination === 'script' ||
      request.destination === 'style' ||
      /\.(m?js|css)(?:[?#]|$)/i.test(url.pathname);
    if (isCodeAsset) {
      event.respondWith(networkFirstCode(request));
    } else {
      event.respondWith(staleWhileRevalidate(request, CACHE_NAME, { ignoreSearch: true }, true));
    }
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
