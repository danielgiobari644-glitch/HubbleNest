/**
 * HubbleNest Progressive Web App & Web Push Service Worker
 */

const CACHE_NAME = 'hubblenest-v2';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/firebase.js',
  '/auth.js',
  '/spaces.js',
  '/chat.js',
  '/private-chat.js',
  '/chat-requests.js',
  '/people.js',
  '/profile.js',
  '/files.js',
  '/announcements.js',
  '/members.js',
  '/notifications.js',
  '/cloudinary.js',
  '/qr.js',
  '/search.js',
  '/settings.js',
  '/utils.js',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/apple-touch-icon.png',
  '/manifest.webmanifest'
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
    url.hostname.includes('securetoken.googleapis.com')
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
          return caches.match('/index.html') || caches.match('/');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});

// Web Push Notification Handler (FCM & Web Push Standard)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'HubbleNest Notification', body: event.data.text() };
    }
  }

  const title = data.title || (data.notification && data.notification.title) || 'HubbleNest';
  const options = {
    body: data.body || (data.notification && data.notification.body) || 'You have new activity in HubbleNest',
    icon: data.icon || '/pwa-192x192.png',
    badge: data.badge || '/pwa-192x192.png',
    image: data.image || null,
    tag: data.tag || 'hubblenest-notification',
    data: data.data || {},
    renotify: true,
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Open HubbleNest' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification Click Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
