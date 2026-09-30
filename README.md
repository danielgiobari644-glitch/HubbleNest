<div align="center">

# 🚀 HubbleNest

**Your people. Your space. Everything connected.**

A modern digital space for private groups, classrooms, communities, and teams —
real-time conversations, private messaging, file sharing, QR access and more.

</div>

Pure **HTML + CSS + vanilla JavaScript** — no frameworks, no build step, no server.
**Firebase** is the backend (Auth · Firestore · Cloud Messaging) and **Cloudinary** is the file storage.

Every file sits at the root — deploy the folder as-is to any static host.

---

## Run Locally

Any tiny static server works (this is a plain static site):

```bash
# Python (built-in, no install)
python3 -m http.server 3000
```

Then open **http://localhost:3000**

Or skip the server entirely and host it online:

### Deploy to Firebase Hosting (recommended — same backend)

```bash
npm i -g firebase-tools
firebase login
firebase init hosting     # choose your Firebase project, public root = this folder, SPA rewrite = Yes
firebase deploy
```

`firebase init hosting` with **single-page app rewrite = Yes** also enables the
pretty deep links (`/join/CODE`). Without a rewrite, share invite links using the
query-string form instead: `https://your-site/?join=CODE` — both work.

## Configuration

| What | Where |
|------|-------|
| Firebase config (apiKey, projectId, …) | `firebase.js` |
| Cloudinary cloud / upload preset | `cloudinary.js` |
| Firestore security rules | `firestore.rules` → paste into Firebase Console → Firestore → Rules |
| Background push (optional) | Firebase Console → Cloud Messaging → Web Push certificate → save the public key in Firestore at `config/push` (`publicKey` field) |

## Notifications

- **In-app notifications, badges and toasts** run entirely on Firestore realtime
  listeners — they work out of the box, with zero servers.
- **Background push** (device notifications while the tab is closed) is optional:
  register subscriptions client-side once the `config/push` public key exists in
  Firestore. *Sending* pushes to devices requires a trusted sender holding the
  private key — e.g. a small Firebase Cloud Function — which is intentionally not
  part of this pure front-end package.

## What's Inside

- **Landing page** with hero, features, use cases and invite-code quick join
- **Email / password + Google authentication**, password recovery, 6-step signup
- **Spaces** — create, join by code or QR, approve join requests, chat with
  reactions, attachments (images via Cloudinary), files, links and announcements
- **People directory** with search, member profiles and private chat requests
- **Realtime private messaging** with E2E-encrypted payloads (Web Crypto)
- **Notification center** with unread badges (Firestore realtime)
- **PWA** — installable, offline shell via service worker, Firestore local persistence
- **Dark / light theme**, responsive layout with mobile bottom navigation

## Structure (flat — no subfolders)

```
index.html · style.css · app.js · home.js
firebase.js · auth.js · spaces.js · chat.js · private-chat.js · chat-requests.js
people.js · profile.js · files.js · links.js · announcements.js · members.js
notifications.js · cloudinary.js · encryption.js · qr.js · search.js · settings.js · utils.js
service-worker.js · firebase-messaging-sw.js · manifest.webmanifest · firestore.rules
+ icons & illustrations (PNG / SVG at root)
```
