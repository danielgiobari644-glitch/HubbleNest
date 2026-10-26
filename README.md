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

**Public website & SEO:** this package ships a complete public site alongside
the app: `features.html`, `spaces.html`, `feed.html`, `games.html`,
`use-cases.html`, `for-schools.html`, `for-churches.html`, `for-teams.html`,
`for-communities.html`, `about.html`, `help.html`, `contact.html`,
`privacy.html`, `terms.html`, `community-guidelines.html` — plus dynamic
public routes (`post.html?id=…`, `game.html?id=…`, `space.html?id=…`,
`join.html`), a `404.html` clean-URL bridge and `sitemap.xml` / `robots.txt`
ready for Google Search Console. Only content whose author explicitly set
"Public on web" is ever reachable from the public pages — private posts,
Spaces, games, messages and member lists stay behind authentication and
Firestore rules, never behind robots.txt alone.

> **About the `content.js` console error** ("A listener indicated an
> asynchronous response…"): that message comes from a BROWSER EXTENSION, not
> from HubbleNest — this project ships no `content.js` at all. Verify by
> opening the app in an incognito window or with extensions disabled: the
> error disappears. No application code was changed for it.

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
closed)** — delivered through **Firebase Cloud Messaging**. Configuration is
**ONE-TIME and lives in Firestore, not in the code** — it survives every
re-upload of this zip, so you never paste keys into generated files again:

1. **In the app:** Profile & Settings → *"Off-App Push Notifications"*.
2. Paste the **Web Push certificate key** (Firebase Console → Project settings
   → Cloud Messaging → Web Push certificates → Generate key pair) and save.
3. Optional, for background delivery: paste the **service account client
   email + private key** (Firebase Console → Project settings → Service
   accounts → Generate new private key; use a dedicated account with only the
   *Firebase Cloud Messaging API Admin* role). Saved with the same button.
4. **Project-side (persists forever, never affected by redeploys):** enable the
   *Firebase Cloud Messaging API* (Google Cloud Console → APIs & Services →
   Library) and make sure your Web API key is not referrer-restricted away
   from `your-username.github.io`.
5. Press **Send a test push to this device** in Settings to verify end-to-end.

The first member to save the configuration becomes its owner in the Firestore
rules — only they can update it afterwards. The built-in VAPID constant in
`notifications.js` is a fallback for brand-new installs only; the Firestore
value always wins. To remove a test/old account: Firebase Console →
Authentication → delete the user, and Firestore → `users` → delete its
profile document.
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
files (or the app renders a MIX of old and new code):**
the shipped worker (v12) makes deploys converge by themselves:

- **index.html references versioned asset URLs** (`app.js?v=12`,
  `style.css?v=12`). Each release bumps `v=`, so a new deploy can never be
  satisfied by an old cached copy of those files.
- **The service worker fetches every precache asset with `cache: 'reload'`**
  during install, so the new cache version is built from the NETWORK, never
  from stale HTTP-cache bytes (GitHub Pages sends `Cache-Control:
  max-age=600`).
- **Navigations revalidate with `cache: 'reload'`** and shell assets
  revalidate with `cache: 'no-cache'` in the background, so one normal reload
  always pairs fresh HTML with fresh code.
- **The page auto-reloads once** when a newly installed worker takes over
  (`controllerchange`), so the classic "deployed but nothing changed, had to
  reload twice" is gone.

If a tab is STILL stuck on a worker from v8 or earlier (strict cache-first):
migrate it once: DevTools → Application → Service Workers → **Unregister**,
then hard-refresh (**Ctrl+Shift+R**). Note GitHub Pages itself caches files
for up to 10 minutes at its CDN edge — right after uploading a new zip, wait
a moment or hard-refresh before concluding a deploy didn't take.
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
in the console:** fixed in the current build — the app now only captures the
install event when it will actually show its own Install banner (bottom-left
on desktop, above the bottom nav on mobile). When the banner is suppressed
(already installed, or dismissed in the last 3 days) the event is left alone
so the browser's native install UI handles the prompt itself. If you still
see the note on an old cached copy, hard-refresh once (Ctrl+Shift+R).

**Private messages show "[Encrypted message - cannot be decrypted on this
device]" / `Decryption error: OperationError`:** this was the v1 encryption
scheme's fatal flaw — it paired a per-device ECDH private key (localStorage)
with a public key on the profile, so ANY drift (signing in on a second
device, clearing site data, regenerating keys on one device only) made the
two sides derive different keys and permanently orphaned every message.
The current build (v2) derives one AES-256-GCM key per CONVERSATION from a
random 256-bit seed stored on the conversation document (readable only by
participants under the security rules), so messages decrypt identically on
every device — sender included — and can never drift. Nothing to configure.
Messages written by the v1 scheme carry no scheme marker: they are
attempted with the legacy key path first (still readable where the old
keypair matches) and otherwise show the placeholder. New messages are
always readable for both participants.

**Login says "Incorrect email or password" (auth/invalid-credential):**
that is Firebase's exact answer for a wrong email OR wrong password —
the app now shows it inline on the sign-in card (and as a toast) instead of
leaving an uncaught promise error in the console. Double-check the address,
or use **Sign In with Google** if the account was created that way; the
"Forgot?" link sends a reset email.

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
- **Rich-text everywhere** — posts, comments, chat messages, Space
  descriptions and announcements render REAL formatting (bold, italic,
  underline, headings, lists, code blocks, safe links) via a sanitized
  formatter — never raw Markdown symbols. Composers carry a formatting
  toolbar; stored text stays plain and portable
- **Community feed (Home)** — multi-line posts with a compose toolbar,
  images/videos, like, comment, delete; a transparent ranking algorithm
  (recency + engagement + affinity) orders the For You tab, with a Latest tab
  and an in-app "How ranking works" guide; opt-in **Public on web** gives a
  post its own public page
- **Arcade** — write HTML/CSS/JS in the editor (live preview) or **upload
  files / a whole project folder in any coding language** (structure
  preserved, 600 KB cap). Projects with an HTML entry are playable in a
  locked sandbox; source-only projects (Python, Java, C, C++, C#, PHP, Ruby,
  Go, Rust, Lua…) are stored with a browsable file tree and an honest
  "cannot execute in a browser" note. Games can be published to a public page
- **Direct Share** — hand files of ANY type to another member with a
  6-character code or a scannable QR deep link; drag & drop, animated
  "Energy Transfer" progress tied to the real upload, radar-pulse receiver
  state, and live file lists on both sides
- **Spaces** — create, chat with reactions/attachments/files/links/
  announcements; **joining with a valid code is INSTANT (no approval)**;
  admins add members straight from their contacts and remove members
- **Contacts-first People** — the People page shows ONLY your contacts; add
  people by their exact username; contacts chat instantly with no request
  step (requests remain available for non-contacts from profiles)
- **Public website** — 15 SEO pages (features, spaces, feed, games, use
  cases, schools/churches/teams/communities, about, help, contact, privacy,
  terms, guidelines) + public post/game/space pages, 404 clean-URL router,
  sitemap.xml and robots.txt; only explicitly published content is public
- **Realtime private messaging** — payloads are AES-256-GCM encrypted in the
  browser with a per-conversation key (Web Crypto); ciphertext only in Firestore
- **Notification center** with unread badges (Firestore realtime)
- **Background push notifications** via FCM — works when the app is closed
- **Connection Doctor** — live self-diagnosis of Firestore rules with
  one-click fixes (run `window.HubbleNest.runFirestoreDoctor()` or from any
  permission-denied error card)
- **PWA** — installable (with iOS "Add to Home Screen" guidance), offline shell
  via service worker, Firestore local persistence
- **Fast loading & self-updating deploys** — service worker v13 serves every
  shell asset, Firebase SDK chunk, Google Font and Cloudinary image instantly
  from cache on repeat visits (stale-while-revalidate with no-cache
  revalidation), versioned asset URLs + a one-time auto-reload mean every
  deploy lands on the next page load with no manual cache clearing, fonts
  load in parallel (no render-blocking `@import`), below-fold images
  lazy-load
- **Dark / light theme**, responsive layout with mobile bottom navigation

## Structure (flat — no subfolders)

```
index.html · style.css · app.js
firebase.js · auth.js · spaces.js · chat.js · private-chat.js · chat-requests.js
people.js · profile.js · files.js · links.js · announcements.js · members.js
notifications.js · fcm-sender.js · cloudinary.js · encryption.js · qr.js · search.js
settings.js · utils.js
community.js · games.js · public-game-builder.js · direct-share.js
firestore-doctor.js · format.js · contacts.js · icons.js
service-worker.js · manifest.webmanifest · firestore.rules · README.md
public.css · sitemap.xml · robots.txt · 404.html · 15 public pages
+ icons & illustrations (PNG / SVG at root)
```
