import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import webpush from 'web-push';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Set up VAPID keys for real Web Push Notifications
const VAPID_KEY_FILE = path.join(__dirname, 'vapid-keys.json');
let vapidKeys;

try {
  if (fs.existsSync(VAPID_KEY_FILE)) {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEY_FILE, 'utf-8'));
  } else {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_KEY_FILE, JSON.stringify(vapidKeys, null, 2));
  }
} catch (e) {
  vapidKeys = webpush.generateVAPIDKeys();
}

webpush.setVapidDetails(
  'mailto:support@hubblenest.app',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// API: Get VAPID Public Key for client subscription
app.get('/api/push-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// API: Send Push Notification to device subscription
app.post('/api/send-push', async (req, res) => {
  const { subscription, payload } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Missing push subscription endpoint' });
  }

  const notificationPayload = JSON.stringify({
    title: payload?.title || 'HubbleNest Notification',
    body: payload?.body || 'New activity in HubbleNest',
    icon: payload?.icon || '/pwa-192x192.png',
    badge: payload?.badge || '/pwa-192x192.png',
    data: payload?.data || { url: '/' }
  });

  try {
    await webpush.sendNotification(subscription, notificationPayload);
    res.json({ success: true });
  } catch (err) {
    console.warn('Web push delivery failed:', err.statusCode, err.message);
    res.status(err.statusCode || 500).json({ error: err.message, statusCode: err.statusCode });
  }
});

// API: Batch send push notifications to multiple subscriptions
app.post('/api/send-batch-push', async (req, res) => {
  const { subscriptions = [], payload } = req.body;
  const notificationPayload = JSON.stringify({
    title: payload?.title || 'HubbleNest Notification',
    body: payload?.body || 'New activity in HubbleNest',
    icon: payload?.icon || '/pwa-192x192.png',
    badge: payload?.badge || '/pwa-192x192.png',
    data: payload?.data || { url: '/' }
  });

  let sent = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, notificationPayload);
      sent++;
    } catch (e) {
      failed++;
    }
  }

  res.json({ success: true, sent, failed });
});

// Serve static files from root directory
app.use(express.static(__dirname));

// Fallback to index.html for single page client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`HubbleNest server is running on http://0.0.0.0:${PORT}`);
});
