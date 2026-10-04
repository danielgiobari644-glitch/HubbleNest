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
(`chat-requests.js`, `app.js — Failed to accept request`), or
`@firebase/firestore: Uncaught Error in snapshot listener: ... Missing or
insufficient permissions` when opening a private chat:**
the published Firestore rules are older than the ones shipped in this package.
The app checks `getDoc()` on `chatRequests/{uidA_uidB}` and
`conversations/{id}` to see whether one already exists between two members —
when the document **does not exist yet**, the old rules dereference
`resource.data` on a null resource and deny the read, which surfaces as
"Missing or insufficient permissions" and blocks the whole flow. The same
class of bug hits the private-messages LISTENER when it opens a brand-new
conversation while its document is still being created (the SDK then logs
"Uncaught Error in snapshot listener" and the chat stays silently empty).
Fix (2 minutes, owner only):

1. Open **Firebase Console → Firestore Database → Rules**.
2. Replace the full contents with the **current** `firestore.rules` file from
   THIS package (the `chatRequests` and `conversations` blocks allow reading
   non-existent documents — they carry no data, so nothing is exposed; the
   `conversations/{id}/messages` read is null-safe the same way).
3. Click **Publish**. The request → accept → private-chat flow works
   immediately, no reload needed.

**After deploying a new build, an old service worker keeps serving stale
files (or logs "Failed to convert value to 'Response'"):**
the shipped worker (v9) uses **stale-while-revalidate** for all app files:
it responds instantly from cache and refreshes every asset in the background
on each load, so a redeploy normally reaches every browser after ONE normal
reload — no manual steps. If a tab is stuck on an older worker (v8 or
earlier used strict cache-first), migrate it once: DevTools → Application →
Service Workers → **Unregister**, then hard-refresh (**Ctrl+Shift+R**).
The fetch handler always resolves to a real `Response`, so the
"Failed to convert value to 'Response'" error can no longer occur.

**Web push notifications return 401 / "token-subscribe-failed" /
"Request is missing required authentication credential"
(`fcmregistrations.googleapis.com` → `Push notifications aren't working`):**
this is PROJECT-SIDE configuration, not an app bug. Two things must be true
before any browser can register for push, and both are owner-only fixes:

1. **The Firebase Cloud Messaging API must be enabled for the project**
   (the most common cause of the 401 above):
   - Open <https://console.cloud.google.com/apis/library/fcm.googleapis.com>
     and select the **hubblenest** project.
   - Click **Enable**. Also enable *Firebase Installations API* if it isn't
     already (<https://console.cloud.google.com/apis/library/firebaseinstallations.googleapis.com>).
2. **A Web Push certificate (VAPID key) must exist in THAT same project and
   be the key the app uses.** A key generated in a different Firebase
   project — or a deleted/regenerated certificate — always answers 401:
   - Firebase Console → ⚙️ **Project settings** → **Cloud Messaging** →
     **Web Push certificates** → **Generate key pair** (if none exists) and
     copy the 87-character key that starts with `B`.
   - Put it in **`notifications.js` → `DEFAULT_VAPID_PUBLIC_KEY`** (top of
     the file), or alternatively in the Firestore `config/push` document as
     the `publicKey` field. Redeploy/re-upload the changed file.
   - **Verify the running app actually uses your key:** with the app open,
     the console now prints e.g.
     `[HubbleNest] Web Push: using VAPID key BLeL1k63W4…sxYo (source:
     embedded constant)`. If the suffix does NOT match the key you pasted,
     the browser is running a stale cached copy of `notifications.js` —
     hard-refresh once (Ctrl+Shift+R), or unregister the old service worker
     (see the stale-service-worker entry above).
3. If your Google Cloud **Web API key** has restrictions (Google Cloud
   Console → APIs & Services → **Credentials** → the browser key used by
   `firebase.js`): either set *Application restrictions* → **None**, or add
   `danielgiobari644-glitch.github.io/*` to the allowed HTTP referrers and
   keep the FCM/Installations APIs allowed under *API restrictions*.
4. In the app, press **Turn on notifications** again — the device now
   registers successfully. (The app validates the key shape, logs a numbered
   fix list to the console on failure, and only shows the error toast when
   you explicitly opt in — never during silent background refreshes.)

**Google Sign-In popup closes instantly or logs
"Cross-Origin-Opener-Policy policy would block the window.closed call":**
GitHub Pages (and some hosts) send restrictive COOP headers. HubbleNest
automatically falls back to the full-page redirect sign-in, so this is handled.
Also make sure your domain is authorized: Firebase Console → Authentication →
Settings → **Authorized domains** → add `danielgiobari644-glitch.github.io`.

**"Banner not shown: beforeinstallpromptevent.preventDefault() called"
in the console:** the app intentionally captures the install event to show
its own **Install banner** (bottom-left on desktop, above the bottom nav on
mobile — visible on the landing page AND inside the app). Clicking
**Install** on that banner (or the hero **Download App** button) calls
`prompt()` on the captured event, which presents Chrome's install dialog —
exactly what the console note asks for. Until the user clicks Install, the
note may still appear once; it is informational, not an error, and every
site with custom install UI (Twitter, Spotify, GitHub) shows it.

**Landing page ("portfolio") visibility:** only **first-time visitors** see
the marketing landing page. As soon as a device has signed in once, future
visits boot through a branded splash straight into the app — or into the
sign-in view if the session expired — so returning members never see the
portfolio again (they can still reach it anytime via the account menu →
"Explore Landing Page").

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
- **Fast loading** — service worker v9 serves every shell asset, Firebase SDK
  chunk, Google Font and Cloudinary image instantly from cache on repeat
  visits (stale-while-revalidate: cached response first, background refresh
  keeps deploys fresh after one reload — no manual cache clearing), fonts
  load in parallel (no render-blocking `@import`), below-fold images
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
