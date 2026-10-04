<div align="center">

# 🚀 HubbleNest

**Your people. Your space. Everything connected.**

A modern digital space for private groups, classrooms, communities, and teams —
real-time conversations, private messaging, file sharing, QR access and more.

</div>

Pure **HTML + CSS + vanilla JavaScript** — no frameworks, no build step, no server.
**Firebase** is the backend (Auth · Firestore · Cloud Messaging) and **Cloudinary** is the file storage.

Every file sits at the root — deploy the folder as-is to any static host
(domain root, **GitHub Pages project sites**, Firebase Hosting, Netlify, …).
All asset references are relative, so the app works from any base path.

---

## Run Locally

Any tiny static server works (this is a plain static site):

```bash
# Python (built-in, no install)
python3 -m http.server 3000
```

Then open **http://localhost:3000**

## Deploy

### GitHub Pages (project site)

1. Push this folder to a repo and enable Pages (Deploy from branch → root or /docs).
2. In **Firebase Console → Authentication → Settings → Authorized domains**,
   add `your-username.github.io` (required for Google sign-in).
3. Done — invite links are shared as `https://your-username.github.io/repo/#join=CODE`.

### Firebase Hosting (recommended — same backend)

```bash
npm i -g firebase-tools
firebase login
firebase init hosting     # choose your Firebase project, public root = this folder, SPA rewrite = Yes
firebase deploy
```

## Configuration

| What | Where |
|------|-------|
| Firebase config (apiKey, projectId, …) | `firebase.js` |
| Cloudinary cloud / upload preset | `cloudinary.js` |
| Firestore security rules | `firestore.rules` → paste into Firebase Console → Firestore → Rules → Publish (**re-publish every time this file changes**) |
| Background push sender (optional, see below) | Firestore document `config/push` |

## Notifications

**In-app (always on, zero setup):** the notification center, unread badges and
toasts run on Firestore realtime listeners.

**Off-app background push (real device notifications while HubbleNest is
closed)** — delivered through **Firebase Cloud Messaging**, sent directly from
members' browsers (no server needed). One-time setup by the project owner:

1. **Generate a push sender key:**
   Firebase Console → ⚙️ Project settings → **Service accounts** →
   *Generate new private key* → download the JSON.
   Recommended: first create a dedicated service account
   (IAM & Admin → Service Accounts) with **only** the
   *Firebase Cloud Messaging API Admin* role, and use ITS key.
2. **Create the Firestore document** `config` (collection) → `push` (ID) with:
   ```
   clientEmail : "firebase-adminsdk-xxxx@hubblenest.iam.gserviceaccount.com"
   privateKey  : "-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
   ```
   (Paste the `client_email` and `private_key` values from the JSON. Keep the
   `\n` escapes exactly as they appear in the JSON.)
3. **Publish the updated Firestore rules** (see `firestore.rules`) so members
   can read `config/push` and manage their device tokens in
   `users/{uid}/pushTokens`.
4. Members then press **Turn on notifications** in the app (or the browser
   prompt) — their device registers an FCM token and every new private
   message, chat request, join request and announcement reaches them even when
   the app is fully closed.

> Without step 2, everything else still works — you simply stay on in-app
> notifications only. To remove a test/old account: Firebase Console →
> Authentication → delete the user, and Firestore → `users` → delete its
> profile document.

## Troubleshooting

**"Missing or insufficient permissions" when sending / accepting chat requests
(`chat-requests.js`, `app.js — Failed to accept request`):**
the published Firestore rules are older than the ones shipped in this package.
The app checks `getDoc()` on `chatRequests/{uidA_uidB}` and
`conversations/{id}` to see whether one already exists between two members —
when the document **does not exist yet**, the old rules dereference
`resource.data` on a null resource and deny the read, which surfaces as
"Missing or insufficient permissions" and blocks the whole flow. Fix (2
minutes, owner only):

1. Open **Firebase Console → Firestore Database → Rules**.
2. Replace the full contents with the current `firestore.rules` file from
   this package (the `chatRequests` and `conversations` blocks now allow
   reading non-existent documents — they carry no data, so nothing is
   exposed).
3. Click **Publish**. The request → accept → private-chat flow works
   immediately, no reload needed.

**After deploying a new build, an old service worker keeps serving stale
files (or logs "Failed to convert value to 'Response'"):**
open the site, DevTools → Application → Service Workers → **Unregister**,
then hard-refresh (**Ctrl+Shift+R**) once. New builds bump the cache version
(`hubblenest-v6`), so this is only needed once per migration. The fetch
handler now always resolves to a real `Response`, so the
"Failed to convert value to 'Response'" error can no longer occur.

**Push activation fails with a 401 / "token-subscribe-failed" /
"Request is missing required authentication credential"
(`fcmregistrations.googleapis.com`):**
the project's **Firebase Cloud Messaging API** is not enabled. This is
project-side config, not an app bug. Fix (2 minutes, owner only):

1. Open <https://console.cloud.google.com/apis/library/fcm.googleapis.com>
   (select the **hubblenest** project).
2. Click **Enable** on *Firebase Cloud Messaging API*.
3. While there, also enable *Firebase Installations API* if it isn't already
   (<https://console.cloud.google.com/apis/library/firebaseinstallations.googleapis.com>).
4. In the app, press **Turn on notifications** again — the device now registers
   successfully.

If it still fails after enabling the API, the Web Push certificate (VAPID key)
may belong to a different project: Firebase Console → Project settings →
**Cloud Messaging** → Web Push certificates, and either set that key in the
Firestore `config/push` document as `publicKey` or use the embedded default.

**Google Sign-In popup closes instantly or logs
"Cross-Origin-Opener-Policy policy would block the window.closed call":**
GitHub Pages (and some hosts) send restrictive COOP headers. HubbleNest
automatically falls back to the full-page redirect sign-in, so this is handled.
Also make sure your domain is authorized: Firebase Console → Authentication →
Settings → **Authorized domains** → add `danielgiobari644-glitch.github.io`.

**"Banner not shown: beforeinstallpromptevent.preventDefault() called"
in the console:** this is Chrome's standard informational note for sites with a
custom install button (Twitter, Spotify and GitHub show it too). It is not an
error — the native install banner appears when the **Download App** button in
the hero is clicked, which calls `prompt()` on the captured event.

## What's Inside

- **Landing page** with hero (incl. **Download App** PWA install button),
  features, use cases and invite-code quick join
- **Email / password + Google authentication**, password recovery, 6-step signup
- **Spaces** — create, join by code or QR, approve join requests, chat with
  reactions, attachments (images via Cloudinary), files, links and announcements
- **People directory** with search, member profiles and private chat requests
- **Realtime private messaging** with E2E-encrypted payloads (Web Crypto)
- **Notification center** with unread badges (Firestore realtime)
- **Background push notifications** via FCM — works when the app is closed
- **PWA** — installable (with iOS "Add to Home Screen" guidance), offline shell
  via service worker, Firestore local persistence
- **Fast loading** — service worker v7 serves every shell asset, Firebase SDK
  chunk, Google Font and Cloudinary image from cache on repeat visits
  (cache-first; the cache version is bumped on each deploy to ship updates),
  fonts load in parallel (no render-blocking `@import`), below-fold images
  lazy-load
- **Dark / light theme**, responsive layout with mobile bottom navigation

## Structure (flat — no subfolders)

```
index.html · style.css · app.js · home.js
firebase.js · auth.js · spaces.js · chat.js · private-chat.js · chat-requests.js
people.js · profile.js · files.js · links.js · announcements.js · members.js
notifications.js · fcm-sender.js · cloudinary.js · encryption.js · qr.js · search.js
settings.js · utils.js
service-worker.js · manifest.webmanifest · firestore.rules
+ icons & illustrations (PNG / SVG at root)
```
