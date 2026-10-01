/**
 * HubbleNest Progressive Web App & Web Push Service Worker
 * Uses relative asset paths so the app works when hosted from ANY base path
 * (domain root, GitHub Pages project subpath, Firebase Hosting, etc.)
 */

const CACHE_NAME = 'hubblenest-v5';
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
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network first with Cache fallback for app shell and assets
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Ignore non-GET, chrome-extension, or Cloudinary/Firestore API calls (handled by SDK persistence)
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Firestore / Cloudinary / Firebase API calls should not be intercepted by SW cache
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('cloudinary.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('fcm.googleapis.com')
  ) {
    return;
  }

  // Network-First with cache fallback for app navigation and local assets
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && url.origin === self.location.origin) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }
        // Fallback to index.html for navigation requests when offline
        if (request.mode === 'navigate') {
          return caches.match('./index.html') || caches.match('./');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});

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
