<div align="center">

# 🚀 HubbleNest

**Your people. Your space. Everything connected.**

A modern digital space for private groups, classrooms, communities, and teams —
real-time conversations, private messaging, file sharing, QR access and more.

</div>

Pure **HTML + CSS + vanilla JavaScript**. No frameworks, no build step.
**Firebase** is the backend (Auth · Firestore · Cloud Messaging) and **Cloudinary** is the file storage.

---

## Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies (the Express + Web-Push notification server):
   ```bash
   npm install
   ```
2. Start the app:
   ```bash
   npm start
   ```
3. Open **http://localhost:3000**

The same `server.js` serves the static site **and** the push-notification API
(`/api/push-public-key`, `/api/send-push`, `/api/send-batch-push`), so this single
command runs the complete application.

## Configuration

| What | Where |
|------|-------|
| Firebase config (apiKey, projectId, …) | `firebase.js` |
| Cloudinary cloud / upload preset | `cloudinary.js` |
| Firestore security rules | `firestore.rules` → deploy via Firebase Console or CLI |
| VAPID keys (push) | auto-generated into `vapid-keys.json` on first start |

## What's Inside

- **Landing page** with hero, features, use cases and invite-code quick join
- **Email / password + Google authentication**, password recovery, 6-step signup
- **Spaces** — create, join by code or QR, approve join requests, chat with
  reactions, attachments (images via Cloudinary), files, links and announcements
- **People directory** with search, member profiles and private chat requests
- **Realtime private messaging** with E2E-encrypted payloads (Web Crypto)
- **Notification center** + Web Push (FCM) with unread badges
- **PWA** — installable, offline shell via service worker, Firestore local persistence
- **Dark / light theme**, responsive layout with mobile bottom navigation

## Structure (flat — no subfolders)

```
index.html · style.css · app.js · home.js
firebase.js · auth.js · spaces.js · chat.js · private-chat.js · chat-requests.js
people.js · profile.js · files.js · links.js · announcements.js · members.js
notifications.js · cloudinary.js · encryption.js · qr.js · search.js · settings.js · utils.js
service-worker.js · firebase-messaging-sw.js · manifest.webmanifest
server.js · package.json · firestore.rules · generate-icons.js
+ icons & illustrations (PNG / SVG at root)
```

> Re-generate PWA icons anytime with `node generate-icons.js`.
