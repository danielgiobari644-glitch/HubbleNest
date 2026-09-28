# LinkRoom — Private Digital Classrooms

A premium, modern collaboration web application for classrooms, fellowships, study groups, teams, and private communities. Built with vanilla HTML/CSS/JavaScript on top of Supabase, Cloudinary, and the Web Crypto API.

> **Status:** This is a complete frontend + SQL schema + RLS policies + realtime subscriptions + genuine end-to-end encrypted private messaging. The build is production-shaped — you bring the credentials, run the SQL, deploy the static files, and LinkRoom runs.

---

## ✨ What's in the box

- **Authentication** — Email/password + Google OAuth (Supabase Auth, PKCE flow).
- **Profiles** — Picture, full name, username, bio, online/last-seen. Auto-created on signup; onboarding gate for first-time users.
- **Rooms** — Permanent or temporary (with expiration). Banner image, description, motto, category. Generate unique room code (`LR-XXXXXX`) and a scannable QR code on creation.
- **Join flow** — Join by code or by scanning a QR. Always requires **admin approval** — admins can preview applicant profiles (avatar, name, username, bio) and accept/decline.
- **Real-time chat** — Live room messaging with replies, emoji reactions, link auto-detection, image & file attachments, copy, delete (own), admin moderation. Paginated history.
- **End-to-end encrypted private messaging** — True client-side encryption using ECDH P-256 + AES-GCM-256 via the Web Crypto API. Supabase only ever stores ciphertext + IV. Private keys never leave the browser.
- **Files library** — Unified upload router automatically chooses Cloudinary (images/videos/audio/small docs) or Supabase Storage (large/exotic files). Categorized as Recent / Images / Videos / Audio / Documents / Other. Search, download, delete.
- **Links** — Auto-extracted from chat messages. Domain badges, title previews, one-tap open / copy.
- **Announcements** — Pinned & unpinned, with optional image. Admin-only create/edit/delete.
- **Members** — Avatars, roles, online dots. Admins see pending join requests inline.
- **Notifications** — Real-time. Covers join requests, approvals/declines, new announcements, file uploads, room expiring / expired, and more. Unread badge in sidebar + bottom nav.
- **Search** — Global member & room search (debounced, server-side ILIKE query). Contextual search inside Files.
- **Room settings** — Admin can rename, edit description, swap image, share QR / code / link, extend temporary rooms, delete rooms (with confirmation).
- **Responsive** — Dedicated mobile layout with bottom navigation, slide-out sidebar, and chat input that stays clear of the keyboard.
- **Themes** — Dark-first with a polished light theme toggle.
- **Accessibility** — Semantic HTML, ARIA labels, keyboard-friendly modals, visible focus rings, reduced-motion respected.
- **Security** — Row Level Security on every table. Helpers `is_room_member` / `is_room_admin` enforce access at the database layer. Frontend permission checks are convenience-only; a malicious user cannot gain admin by editing JS.

---

## 📁 Project structure

```
linkroom/
├── index.html              # Landing + auth page
├── app.html                # Main application shell
├── css/
│   └── style.css           # Complete design system
├── js/
│   ├── config.js           # ← EDIT THIS: add your Supabase anon key
│   ├── utils.js
│   ├── ui.js               # Toasts, modals, spinner
│   ├── crypto.js           # Web Crypto (ECDH + AES-GCM)
│   ├── supabase-client.js  # Data access layer
│   ├── storage.js          # Cloudinary + Supabase upload router
│   ├── auth.js             # Email/password + Google OAuth
│   ├── profile.js          # Onboarding + view/edit
│   ├── notifications.js    # Realtime notifications
│   ├── dashboard.js        # Room cards + stats
│   ├── rooms.js            # Create / join / QR / extend / delete
│   ├── chat.js             # Real-time room messaging
│   ├── private-chat.js     # E2E encrypted 1:1 messaging
│   ├── files.js            # File library
│   ├── links.js            # Auto-detected URL collection
│   ├── announcements.js    # Admin announcements
│   ├── members.js          # Member list + join request approvals
│   ├── search.js           # Global search
│   └── app.js              # Shell orchestrator
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql
│       ├── 002_security.sql
│       ├── 003_realtime.sql
│       ├── 004_notifications.sql
│       ├── 005_files.sql
│       ├── 006_private_messaging.sql
│       ├── 007_room_expiration.sql
│       └── 008_storage_policies.sql
└── README.md               # ← This file
```

---

## 🚀 Setup (≈10 minutes)

### 1. Get your Supabase project ready

You should already have a Supabase project at `https://tfnkszxmojqnhrkejmye.supabase.co`. If you don't, create one at https://supabase.com.

### 2. Run the SQL migrations

In Supabase dashboard → **SQL Editor**, paste and run each migration in order:

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_security.sql
supabase/migrations/003_realtime.sql
supabase/migrations/004_notifications.sql
supabase/migrations/005_files.sql
supabase/migrations/006_private_messaging.sql
supabase/migrations/007_room_expiration.sql
supabase/migrations/008_storage_policies.sql
```

You can also run them all at once (they're idempotent for the most part).

### 3. Enable Google OAuth (optional but recommended)

In Supabase dashboard → **Authentication → Providers → Google**:

1. Toggle Google **ON**.
2. Create a Google OAuth client at https://console.cloud.google.com/apis/credentials (OAuth 2.0 Client ID, type: Web application).
3. Add Supabase's callback URL (shown in the dashboard) to **Authorized redirect URis**.
4. Paste the Google **Client ID** and **Client Secret** into Supabase.
5. Save.

### 4. Enable Realtime

In Supabase dashboard → **Database → Replication**:
- Ensure `supabase_realtime` publication includes all the tables listed in `003_realtime.sql` (running that migration does this automatically, but verify).

### 5. Create the Storage bucket

Either run `008_storage_policies.sql` (it creates the bucket `linkroom-files` and applies policies), or:

- Go to **Storage** in the dashboard.
- Create a bucket named `linkroom-files`.
- Mark it **private** (NOT public).
- Run `008_storage_policies.sql` to apply the RLS policies.

### 6. Configure Cloudinary

You already have:
- Cloud Name: `l5inkfvz`
- Upload Preset: `LinkRoom`

Verify in your Cloudinary dashboard → **Settings → Upload → Upload presets** that an **unsigned** preset named `LinkRoom` exists. If not, create one (resource type: `auto`, no transformations required).

> The frontend uses unsigned uploads only. Your Cloudinary **API Secret** is never exposed.

### 7. Fill in the Supabase anon key

Edit `js/config.js`:

```js
window.LINKROOM_CONFIG = {
  supabase: {
    url: 'https://tfnkszxmojqnhrkejmye.supabase.co',
    anonKey: 'YOUR_SUPABASE_ANON_KEY_HERE'  // ← paste your publishable anon key
  },
  cloudinary: {
    cloudName: 'l5inkfvz',
    uploadPreset: 'LinkRoom'
  },
  storage: { bucket: 'linkroom-files' },
  app: {
    name: 'LinkRoom',
    url: window.location.origin,    // ← set to your deployed domain in production
    maxFileSizeMb: 500
  }
};
```

Find the anon key in Supabase dashboard → **Project Settings → API → "anon public"**.

> ⚠️ Never paste your **service_role** key in frontend code. The anon key is safe; it only allows operations that pass RLS.

### 8. Run / Deploy

LinkRoom is 100% static. You can:

- **Local:** Just open `index.html` in a browser. (For Google OAuth redirect + QR scanning to work cleanly, you may want a local server: `python3 -m http.server 8080` in the project folder.)
- **Production:** Upload the entire `linkroom/` folder to any static host — Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3+CloudFront, Nginx, etc. Set `app.url` in `config.js` to your final domain so QR join links work correctly.

---

## 🔐 Cryptographic architecture

Private messaging is **genuinely** end-to-end encrypted. Here's the design:

### Keys
- Each user generates an **ECDH keypair** (curve: P-256) on first login, **in the browser**, via `crypto.subtle.generateKey`.
- The **public key** is exported as SPKI, base64-encoded, and stored in `profiles.public_key` (visible to other users via RLS).
- The **private key** is exported as PKCS#8, encrypted at rest with an AES-GCM-256 key derived (PBKDF2, 100K iterations) from a randomly-generated "vault key" persisted in `localStorage`, then stored in **IndexedDB**. The private key never transits the network.

### Sending a private message
1. Recipient's `public_key` → `crypto.subtle.importKey`.
2. **ECDH shared secret** derived locally via `crypto.subtle.deriveKey` → AES-GCM-256 key.
3. Plaintext (and optional attachment metadata) encrypted with a fresh 12-byte IV.
4. Only `ciphertext`, `iv`, `encrypted_meta`, `meta_iv` are inserted into `private_messages`. Supabase stores ciphertext only.

### Receiving a private message
1. Locally-imported private key + sender's public key → same shared AES-GCM key (ECDH symmetry).
2. Decrypt on the client.
3. Plaintext is rendered — it never existed on the server.

### What Supabase can see
- Who is talking to whom (conversation participants + timestamps).
- Ciphertext blobs and IVs — useless without the shared key.
- Whether you've marked a conversation as read.

### What Supabase cannot see
- Message plaintext.
- Attachment metadata (it's encrypted alongside the message body).
- Your private key (it never leaves the browser).

### Limitations & honest disclosure
- This is **not** "Signal-level" security. Specifically:
  - There is no **forward secrecy** — the same ECDH keypair is reused for all conversations with a given user. Compromise of a private key compromises the entire conversation history.
  - There is no **post-quantum** resistance.
  - The vault key in `localStorage` could be exfiltrated by an XSS attack; you should deploy a strict **Content Security Policy**.
- However, it IS genuine end-to-end encryption: the server cannot read your private messages without breaking AES-GCM-256 or ECDH on P-256.

To make this stronger:
- Replace the localStorage vault key with a **password-derived key** (PBKDF2/scrypt from a user-chosen passphrase).
- Rotate keys periodically and re-encrypt.
- Add per-message ephemeral keys for forward secrecy.

The API surface in `crypto.js` is small and well-documented — these upgrades are localized.

---

## 🧪 Testing the full flow

Once configured, test as a real user:

1. **Sign up** with email/password → confirm email → redirected to app.
2. **Google sign-in** → if no profile, onboarding gate appears. Complete it.
3. **Create a room** → QR + code modal pops. Copy the join link.
4. Open the join link in an incognito window → sign up as another user → request to join.
5. Back in the first account, go to the room → **Members** tab → approve the request.
6. The second user receives a notification. They can now enter the room.
7. Send messages with text, images, files. Try **replies** (hover a message → ↩), **reactions** (😀 on hover).
8. Start a **private conversation** from Members → 🔒 icon. Verify the message body in the Supabase `private_messages` table is ciphertext.
9. Try **deleting** your message, **removing** a member (admin), **extending** a temporary room.
10. Resize the window to mobile widths. Bottom nav appears. Sidebar slides in. Chat input stays usable.

---

## 🛡 Security checklist

- [x] RLS on every data table.
- [x] `is_room_member` / `is_room_admin` SQL helpers — authorization at DB layer.
- [x] Frontend never has service-role key.
- [x] Storage bucket is private; policies enforce membership.
- [x] Supabase Storage signed URLs used for private file access (10-minute expiry).
- [x] DOMPurify sanitizes all dynamic HTML (chat body, linkify output).
- [x] Linkify output escapes HTML before injecting anchors.
- [x] All sensitive actions require confirmation modals.
- [x] File size limits enforced client-side and (where practical) server-side.
- [x] QR join tokens are 32-char random hex (URL-safe, unguessable).
- [x] Room codes are 6-char alphanumeric (excluding ambiguous chars).
- [x] Supabase Auth PKCE flow.

### Recommended production hardening (beyond what's coded)
- Add a strict **Content-Security-Policy** header (e.g. `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; img-src 'self' https://res.cloudinary.com https://*.supabase.co data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.cloudinary.com;`).
- Turn on **Supabase rate-limiting** in the dashboard.
- Set up **pg_cron** to run `expire_temporary_rooms()` every hour.
- Consider signed Cloudinary uploads (via a Supabase Edge Function) for tighter asset control.

---

## 📜 License

You own this code. Use it, fork it, ship it. Attribution appreciated but not required.

---

## 🙏 Acknowledgements

Built with:
- [Supabase](https://supabase.com) — auth, postgres, realtime, storage.
- [Cloudinary](https://cloudinary.com) — media pipeline.
- [DOMPurify](https://github.com/cure53/DOMPurify) — XSS sanitization.
- [qrcode.js](https://github.com/soldair/node-qrcode) — client-side QR generation.
- [Inter](https://rsms.me/inter/) & [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) — typography.

---

**LinkRoom** — *rooms that bring people together.*
