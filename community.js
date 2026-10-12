/**
 * HubbleNest Community Feed (Home)
 *
 * A real community feed backed by the feedPosts collection:
 *  - everyone posts text + Cloudinary attachments,
 *  - likes (likedBy uid array — O(1) liked-state for every viewer),
 *  - threaded comments per post (feedPosts/{id}/comments),
 *  - a transparent ranking algorithm ("For You") documented below and
 *    explained in-app via the "How ranking works" popover.
 *
 * THE ALGORITHM (deterministic, fully client-side, no dark patterns):
 *   score = recency + engagement + affinity - seenPenalty
 *   recency    = 50 · 0.5^(hoursSincePost / 12)   → 12-hour half-life
 *   engagement = min(60, likes·2 + comments·3)
 *   affinity   = +18 connected (an accepted DM or pending chat request)
 *                +12 author you recently liked/commented (local signal)
 *                +8  your own posts (easy to find, never buried)
 *   seenPenalty = 15 for posts you already saw in a previous session
 *
 * Everything is computed from REAL data: post counters from Firestore,
 * connections from your real chat requests/conversations, your engagement
 * history from your own like/comment actions on this device.
 */

import {
  db,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment
} from './firebase.js';

import { uploadToCloudinary, formatBytes } from './cloudinary.js';

import {
  showToast,
  escapeHtml,
  formatTimeAgo,
  getAvatarUrl,
  linkify
} from './utils.js';

import { handlePermissionError } from './firestore-doctor.js';

/* ========================================================================
   Module state
   ======================================================================== */

let feedUnsubscribe = null;
let commentsUnsubscribes = new Map(); // postId → unsub
let feedGeneration = 0;
let feedMode = 'foryou'; // 'foryou' | 'latest'
let postsCache = [];
let pendingAttachments = [];
let context = {
  userProfile: null,
  currentUserId: null,
  connections: new Set() // uids this user is connected to (requests / DMs)
};

const SEEN_KEY = 'hn-seen-posts';
const ENGAGED_KEY = 'hn-engaged-authors';
const MAX_RENDER = 40;

/* ========================================================================
   Small helpers
   ======================================================================== */

function readJsonList(key, cap) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw.slice(0, cap) : [];
  } catch (e) {
    return [];
  }
}

function writeJsonList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* storage full — non-fatal */ }
}

export function markAuthorEngaged(authorId) {
  if (!authorId) return;
  const list = readJsonList(ENGAGED_KEY, 100).filter(id => id !== authorId);
  list.unshift(authorId);
  writeJsonList(ENGAGED_KEY, list);
}

function markPostsSeen(postIds) {
  const prev = readJsonList(SEEN_KEY, 400);
  const set = new Set(prev);
  postIds.forEach(id => set.add(id));
  writeJsonList(SEEN_KEY, Array.from(set).slice(-400));
}

function postTimestamp(p) {
  if (p.createdAt?.seconds) return p.createdAt.seconds * 1000;
  if (p.createdAt?.toDate) return p.createdAt.toDate().getTime();
  if (typeof p.createdAt === 'number') return p.createdAt;
  return p.createdAtLocal || 0;
}

/**
 * THE RANKING ALGORITHM — exported so tests can verify it deterministically.
 * @param {Array} posts  raw post docs (must include createdAt, likedBy, commentCount)
 * @param {Object} opts  { mode, viewerId, connections:Set<string>, engagedAuthors:string[], seenIds:string[], now:number }
 */
export function rankPosts(posts, opts = {}) {
  const {
    mode = 'foryou',
    viewerId = null,
    connections = new Set(),
    engagedAuthors = [],
    seenIds = [],
    now = Date.now()
  } = opts;

  if (mode === 'latest') {
    return [...posts].sort((a, b) => postTimestamp(b) - postTimestamp(a));
  }

  const seen = new Set(seenIds);
  const engaged = new Set(engagedAuthors);

  const scored = posts.map(p => {
    const ageHours = Math.max(0, (now - postTimestamp(p)) / 3600000);
    const likes = Array.isArray(p.likedBy) ? p.likedBy.length : (p.likeCount || 0);
    const comments = p.commentCount || 0;

    const recency = 50 * Math.pow(0.5, ageHours / 12);
    const engagement = Math.min(60, likes * 2 + comments * 3);

    let affinity = 0;
    if (viewerId && p.authorId === viewerId) affinity += 8;
    if (p.authorId && connections.has(p.authorId)) affinity += 18;
    if (p.authorId && engaged.has(p.authorId)) affinity += 12;

    const seenPenalty = seen.has(p.id) ? 15 : 0;

    return {
      post: p,
      score: recency + engagement + affinity - seenPenalty,
      breakdown: { recency, engagement, affinity, seenPenalty }
    };
  });

  scored.sort((a, b) =>
    b.score - a.score || postTimestamp(b.post) - postTimestamp(a.post));

  return scored.map(s => s.post);
}

function rankingExplanationHtml() {
  return `
    <b>How "For You" works</b><br>
    Every post gets a transparent score, recalculated on your device:<br>
    • <b>Freshness</b> — newer posts score higher, decaying over ~12 hours.<br>
    • <b>Engagement</b> — likes and comments add up (capped so one viral post can't drown out everything).<br>
    • <b>Connection</b> — people you chat with, and authors you recently liked or commented on, rank higher for you.<br>
    • <b>Already seen</b> — posts you scrolled past in an earlier session sink slightly so new content surfaces.<br>
    No tracking, no ads, no hidden signals — switch to <b>Latest</b> any time for pure chronological order.
  `;
}

function getFileIconSvg(type, filename = '') {
  const t = (type || '').toLowerCase();
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const s = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  if (t.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" ${s}><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;
  }
  if (t.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" ${s}><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>`;
  }
  if (t.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" ${s}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  }
  return `<svg width="18" height="18" viewBox="0 0 24 24" ${s}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

/* ========================================================================
   Subscription lifecycle
   ======================================================================== */

export function startCommunityFeed(userProfile, currentUserId, connections = new Set()) {
  stopCommunityFeed();
  if (!userProfile || !currentUserId) return;

  feedGeneration++;
  const gen = feedGeneration;
  context = { userProfile, currentUserId, connections };

  // Newest 50 posts, sorted client-side by the algorithm for "For You".
  const q = query(collection(db, 'feedPosts'), orderBy('createdAt', 'desc'), limit(50));

  feedUnsubscribe = onSnapshot(q, (snap) => {
    if (gen !== feedGeneration) return; // stale listener (view switched)
    postsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFeed();
  }, (err) => {
    console.error('Community feed listener error:', err);
    const el = document.getElementById('home-feed');
    if (el && gen === feedGeneration) {
      el.innerHTML = `
        <div class="feed-error-card">
          <div class="feed-error-title">The community feed could not load</div>
          <div class="feed-error-desc">${escapeHtml(err.code || 'permission-denied')} — your Firebase rules need a refresh. The Connection Doctor can pinpoint it.</div>
          <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.runFirestoreDoctor()">Run Connection Doctor</button>
        </div>`;
    }
    if (err?.code === 'permission-denied' || String(err?.message || '').includes('permissions')) {
      handlePermissionError('community feed');
    }
  });
}

export function stopCommunityFeed() {
  feedGeneration++;
  feedUnsubscribe?.();
  feedUnsubscribe = null;
  commentsUnsubscribes.forEach(unsub => unsub());
  commentsUnsubscribes = new Map();
  postsCache = [];
  clearAllHomeAttachments();
}

/* ========================================================================
   Rendering
   ======================================================================== */

export function renderFeed() {
  const container = document.getElementById('home-feed');
  if (!container) return;

  // Tab active state
  document.getElementById('feed-tab-foryou')?.classList.toggle('feed-tab-active', feedMode === 'foryou');
  document.getElementById('feed-tab-latest')?.classList.toggle('feed-tab-active', feedMode === 'latest');

  if (postsCache.length === 0) {
    container.innerHTML = `
      <div class="feed-empty">
        <div class="feed-empty-glyph">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        </div>
        <h3 class="feed-empty-title">The community is waiting for its first post</h3>
        <p class="feed-empty-desc">Share what you're building, ask a question, or drop something that made you smile today. Everything you post here is real and visible to every HubbleNest member.</p>
      </div>`;
    return;
  }

  const ranked = rankPosts(postsCache, {
    mode: feedMode,
    viewerId: context.currentUserId,
    connections: context.connections,
    engagedAuthors: readJsonList(ENGAGED_KEY, 100),
    seenIds: readJsonList(SEEN_KEY, 400)
  }).slice(0, MAX_RENDER);

  markPostsSeen(ranked.slice(0, 12).map(p => p.id));

  container.innerHTML = ranked.map((p, idx) => renderPostCard(p, idx)).join('');
}

function renderAttachments(p) {
  const atts = Array.isArray(p.attachments) ? p.attachments : [];
  if (atts.length === 0) return '';
  const images = atts.filter(a => (a.resourceType || '').startsWith('image'));
  const others = atts.filter(a => !(a.resourceType || '').startsWith('image'));

  let html = '';
  if (images.length > 0) {
    html += `<div class="feed-att-grid feed-att-grid-${Math.min(images.length, 3)}">` +
      images.map(a => `
        <a class="feed-att-img" href="${a.url}" target="_blank" rel="noopener noreferrer">
          <img src="${a.url}" alt="${escapeHtml(a.originalFilename || 'Image')}" loading="lazy" decoding="async" />
        </a>`).join('') + `</div>`;
  }
  if (others.length > 0) {
    html += others.map(a => `
      <a class="feed-att-file" href="${a.url}" target="_blank" rel="noopener noreferrer">
        <span class="feed-att-file-icon">${getFileIconSvg(a.resourceType, a.originalFilename)}</span>
        <span class="feed-att-file-name">${escapeHtml(a.originalFilename || 'File')}</span>
        <span class="feed-att-file-size">${formatBytes(a.size || 0)}</span>
      </a>`).join('');
  }
  return html;
}

function renderPostCard(p, idx) {
  const isOwn = p.authorId === context.currentUserId;
  const liked = Array.isArray(p.likedBy) && context.currentUserId && p.likedBy.includes(context.currentUserId);
  const likeCount = Array.isArray(p.likedBy) ? p.likedBy.length : (p.likeCount || 0);
  const commentsOpen = commentsUnsubscribes.has(p.id);
  const safeId = escapeHtml(p.id);

  return `
    <article class="feed-post ${idx === 0 ? 'feed-post-first' : ''}" id="feed-post-${safeId}">
      <header class="feed-post-head">
        <button type="button" class="feed-post-avatar" onclick="window.HubbleNest.openUserCardModal('${escapeHtml(p.authorId || '')}')" aria-label="View profile">
          <img src="${getAvatarUrl(p.authorPhoto, p.authorName)}" class="avatar-img" alt="${escapeHtml(p.authorName || 'Member')}" loading="lazy" decoding="async" />
        </button>
        <div class="feed-post-meta">
          <span class="feed-post-name">${escapeHtml(p.authorName || 'Member')}</span>
          <span class="feed-post-sub">${escapeHtml(p.authorUsername ? '@' + p.authorUsername : '')} · ${formatTimeAgo(p.createdAt)}</span>
        </div>
        ${isOwn ? `
          <button type="button" class="feed-post-delete" title="Delete this post" aria-label="Delete post" onclick="window.HubbleNest.feedDeletePost('${safeId}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>` : ''}
      </header>

      ${p.text ? `<div class="feed-post-text">${linkify(p.text)}</div>` : ''}
      ${renderAttachments(p)}

      <footer class="feed-post-actions">
        <button type="button" class="feed-action ${liked ? 'feed-action-liked' : ''}" onclick="window.HubbleNest.feedToggleLike('${safeId}')" aria-pressed="${liked}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
          <span>${likeCount > 0 ? likeCount : 'Like'}</span>
        </button>
        <button type="button" class="feed-action ${commentsOpen ? 'feed-action-active' : ''}" onclick="window.HubbleNest.feedToggleComments('${safeId}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>${(p.commentCount || 0) > 0 ? p.commentCount : 'Comment'}</span>
        </button>
        ${feedMode === 'foryou' ? `<span class="feed-rank-chip" title="This post scored well for you just now">Ranked for you</span>` : ''}
      </footer>

      <div class="feed-comments" id="feed-comments-${safeId}" style="display: ${commentsOpen ? 'block' : 'none'};"></div>
    </article>`;
}

/* ========================================================================
   Posting
   ======================================================================== */

export async function handleHomePost() {
  const input = document.getElementById('home-composer-input');
  const text = input ? input.value.trim() : '';

  if (!text && pendingAttachments.length === 0) {
    showToast('Write something first, or attach a file — the community can\'t read minds yet.', 'info');
    return;
  }
  if (!context.userProfile || !context.currentUserId) {
    showToast('Sign in to post to the community.', 'error');
    return;
  }

  const sendBtn = document.getElementById('home-composer-send');
  if (sendBtn) { sendBtn.disabled = true; }

  try {
    const attachments = [];
    for (const file of pendingAttachments) {
      showToast(`Uploading ${file.name}…`, 'info', 2200);
      const res = await uploadToCloudinary(file, null, 100);
      attachments.push({
        url: res.url,
        resourceType: res.resourceType,
        originalFilename: res.originalFilename || file.name,
        size: res.bytes || file.size
      });
    }

    const post = {
      authorId: context.currentUserId,
      authorName: context.userProfile.displayName || 'Member',
      authorUsername: context.userProfile.username || 'user',
      authorPhoto: context.userProfile.photoURL || '',
      text: text,
      attachments,
      likedBy: [],
      likeCount: 0,
      commentCount: 0,
      createdAt: serverTimestamp(),
      createdAtLocal: Date.now() // local fallback until the server stamp lands
    };

    await addDoc(collection(db, 'feedPosts'), post);

    if (input) input.value = '';
    clearAllHomeAttachments();
    showToast('Posted to the community ✓', 'success');
  } catch (err) {
    console.error('Post failed:', err);
    showToast(err?.message?.includes('permission') || err?.code === 'permission-denied'
      ? 'The rules on your Firebase project block posting — run the Connection Doctor from the footer of this screen.'
      : (err.message || 'Could not post right now'), 'error');
    if (err?.code === 'permission-denied') handlePermissionError('feed composer');
  } finally {
    if (sendBtn) { sendBtn.disabled = false; }
  }
}

export function stageHomeAttachment(file, maxMB = 100) {
  if (!file) return;
  if (file.size > maxMB * 1024 * 1024) {
    showToast(`File exceeds the ${maxMB} MB limit`, 'error');
    return;
  }
  pendingAttachments.push(file);
  renderHomePendingAttachments();
}

export function removeHomeAttachment(index) {
  pendingAttachments.splice(index, 1);
  renderHomePendingAttachments();
}

export function clearAllHomeAttachments() {
  pendingAttachments = [];
  renderHomePendingAttachments();
  const img = document.getElementById('home-image-input');
  const docIn = document.getElementById('home-doc-input');
  if (img) img.value = '';
  if (docIn) docIn.value = '';
}

function renderHomePendingAttachments() {
  const area = document.getElementById('home-pending-attachments-area');
  const grid = document.getElementById('home-pending-attachments-grid');
  if (!area || !grid) return;

  if (pendingAttachments.length === 0) {
    area.style.display = 'none';
    grid.innerHTML = '';
    return;
  }

  grid.innerHTML = pendingAttachments.map((f, idx) => {
    const isImg = f.type && f.type.startsWith('image/');
    const thumb = isImg
      ? `<img src="${URL.createObjectURL(f)}" class="pending-thumb-img" alt="preview" />`
      : `<span style="color: var(--accent-primary);">${getFileIconSvg(f.type, f.name)}</span>`;
    return `
      <div class="pending-attachment-card">
        <div class="pending-card-thumb">${thumb}</div>
        <div class="pending-card-info">
          <div class="pending-card-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
          <div class="pending-card-size">${formatBytes(f.size)}</div>
        </div>
        <button type="button" class="pending-card-remove" onclick="window.HubbleNest.removeHomeAttachment(${idx})" title="Remove">✕</button>
      </div>`;
  }).join('');

  area.style.display = 'block';
}

/* ========================================================================
   Likes & comments
   ======================================================================== */

export async function feedToggleLike(postId) {
  const post = postsCache.find(p => p.id === postId);
  const uid = context.currentUserId;
  if (!post || !uid) return;

  const liked = Array.isArray(post.likedBy) && post.likedBy.includes(uid);
  try {
    await updateDoc(doc(db, 'feedPosts', postId), {
      likedBy: liked ? arrayRemove(uid) : arrayUnion(uid)
    });
    if (!liked && post.authorId && post.authorId !== uid) {
      markAuthorEngaged(post.authorId);
      addDoc(collection(db, 'notifications'), {
        userId: post.authorId,
        type: 'feed_like',
        title: 'New like on your post',
        body: `${context.userProfile?.displayName || 'A member'} liked your community post.`,
        senderId: uid,
        postId,
        isRead: false,
        createdAt: serverTimestamp()
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Like failed:', err);
    showToast('Could not save your like — check Connection Doctor if it repeats.', 'error');
  }
}

export function feedToggleComments(postId) {
  const panel = document.getElementById(`feed-comments-${postId}`);
  if (!panel) return;

  if (commentsUnsubscribes.has(postId)) {
    commentsUnsubscribes.get(postId)();
    commentsUnsubscribes.delete(postId);
    panel.style.display = 'none';
    renderFeed(); // refresh button states
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = `<div class="feed-comments-loading">Loading comments…</div>`;
  renderFeed(); // refresh button states

  const q = query(
    collection(db, 'feedPosts', postId, 'comments'),
    orderBy('createdAt', 'asc'),
    limit(80)
  );

  const unsub = onSnapshot(q, (snap) => {
    const comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCommentsPanel(postId, comments);
  }, (err) => {
    console.error('Comments listener error:', err);
    panel.innerHTML = `<div class="feed-comments-loading">Comments could not load (${escapeHtml(err.code || 'error')}).</div>`;
  });

  commentsUnsubscribes.set(postId, unsub);
}

function renderCommentsPanel(postId, comments) {
  const panel = document.getElementById(`feed-comments-${postId}`);
  if (!panel) return;

  const listHtml = comments.length === 0
    ? `<div class="feed-comments-empty">No comments yet — say something kind.</div>`
    : comments.map(c => `
        <div class="feed-comment">
          <img class="feed-comment-avatar" src="${getAvatarUrl(c.authorPhoto, c.authorName)}" alt="" loading="lazy" />
          <div class="feed-comment-body">
            <div class="feed-comment-head">
              <b>${escapeHtml(c.authorName || 'Member')}</b>
              <span>${formatTimeAgo(c.createdAt)}</span>
              ${c.authorId === context.currentUserId ? `
                <button type="button" class="feed-comment-del" title="Delete comment" onclick="window.HubbleNest.feedDeleteComment('${postId}', '${escapeHtml(c.id)}')">✕</button>` : ''}
            </div>
            <div class="feed-comment-text">${linkify(c.text || '')}</div>
          </div>
        </div>`).join('');

  panel.innerHTML = `
    <div class="feed-comments-list">${listHtml}</div>
    <div class="feed-comment-composer">
      <input type="text" id="feed-comment-input-${postId}" placeholder="Add a comment…" maxlength="600"
        onkeydown="if(event.key==='Enter') window.HubbleNest.feedSubmitComment('${postId}')" />
      <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.feedSubmitComment('${postId}')">Reply</button>
    </div>`;
}

export async function feedSubmitComment(postId) {
  const input = document.getElementById(`feed-comment-input-${postId}`);
  const text = input?.value.trim();
  if (!text) { showToast('Write a comment first.', 'info'); return; }
  if (!context.userProfile || !context.currentUserId) return;

  const post = postsCache.find(p => p.id === postId);
  try {
    await addDoc(collection(db, 'feedPosts', postId, 'comments'), {
      authorId: context.currentUserId,
      authorName: context.userProfile.displayName || 'Member',
      authorPhoto: context.userProfile.photoURL || '',
      text,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'feedPosts', postId), { commentCount: increment(1) });
    if (input) input.value = '';
    if (post?.authorId && post.authorId !== context.currentUserId) {
      markAuthorEngaged(post.authorId);
      addDoc(collection(db, 'notifications'), {
        userId: post.authorId,
        type: 'feed_comment',
        title: 'New comment on your post',
        body: `${context.userProfile.displayName || 'A member'} commented: ${text.slice(0, 80)}`,
        senderId: context.currentUserId,
        postId,
        isRead: false,
        createdAt: serverTimestamp()
      }).catch(() => {});
    }
  } catch (err) {
    console.error('Comment failed:', err);
    showToast('Could not post the comment — if this repeats, run Connection Doctor.', 'error');
  }
}

export async function feedDeleteComment(postId, commentId) {
  try {
    await deleteDoc(doc(db, 'feedPosts', postId, 'comments', commentId));
    await updateDoc(doc(db, 'feedPosts', postId), { commentCount: increment(-1) });
  } catch (err) {
    console.error('Comment delete failed:', err);
    showToast('Could not delete the comment.', 'error');
  }
}

export async function feedDeletePost(postId) {
  const post = postsCache.find(p => p.id === postId);
  if (!post || post.authorId !== context.currentUserId) return;
  if (!window.confirm('Delete this post permanently? Likes and comments go with it.')) return;
  try {
    await deleteDoc(doc(db, 'feedPosts', postId));
    showToast('Post deleted.', 'info');
  } catch (err) {
    console.error('Post delete failed:', err);
    showToast('Could not delete the post.', 'error');
  }
}

export function feedSetMode(mode) {
  if (mode !== 'foryou' && mode !== 'latest') return;
  feedMode = mode;
  renderFeed();
}

export function toggleRankingInfo() {
  const existing = document.getElementById('feed-ranking-popover');
  if (existing) { existing.remove(); return; }
  const anchor = document.getElementById('feed-ranking-info');
  if (!anchor) return;
  const pop = document.createElement('div');
  pop.id = 'feed-ranking-popover';
  pop.className = 'feed-ranking-popover';
  pop.innerHTML = rankingExplanationHtml();
  anchor.appendChild(pop);
  const dismiss = (e) => {
    if (!pop.contains(e.target) && e.target !== anchor) {
      pop.remove();
      document.removeEventListener('click', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('click', dismiss), 0);
}

/** Refresh the connection set used by the affinity signal (call after chat request changes). */
export function setFeedConnections(connections) {
  if (connections instanceof Set) context.connections = connections;
}
