/**
 * HubbleNest Bots — the AI bot creation & discovery platform inside HubbleNest.
 *
 * Marketplace (discover, search, filter, use) · Studio (create / update /
 * settings with live preview and test) · Conversation (real AI chat) ·
 * Public profile (ratings, reviews, sharing) · My Bots (management).
 *
 * Data model (Firestore):
 *   bots/{id}                     bot record (public docs discoverable;
 *                                 private docs are server-enforced owner-only)
 *   botRatings/{uid}_{botId}      one star rating per member per bot
 *   botComments/{id}              public reviews/comments on public bots
 *   botChats/{uid}_{botId}        a member's private conversation with a bot
 *     /messages/{id}                ...and its messages (owner-only access)
 *   botReports/{id}               abuse reports for comments
 *
 * Assets: bot logos and preview images live on Cloudinary (existing account),
 * or as built-in SVG template art — Firebase Storage is never used.
 * AI: the platform AI vault (config/ai — one-time admin setup) via ai-client.
 */

import {
  db, auth,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, limit, onSnapshot, serverTimestamp, increment, runTransaction,
  writeBatch, arrayUnion, arrayRemove, orderBy
} from './firebase.js';

import {
  showToast, escapeHtml, formatTimeAgo, getAvatarUrl
} from './utils.js';

import { uploadToCloudinary } from './cloudinary.js';

import {
  sendBotChatMessage, safeAiErrorMessage, AiUserError
} from './ai-client.js';

/* ======================================================================
   BOT CATEGORIES & CAPABILITIES
   ====================================================================== */

export const BOT_CATEGORIES = [
  'Education', 'Productivity', 'Writing', 'Creativity', 'Business', 'Coding',
  'Bible & Spiritual Study', 'Entertainment', 'Games', 'Personal Assistance', 'Other'
];

export const BOT_CAPABILITIES = [
  'Answer Questions', 'Generate Ideas', 'Help with Studies', 'Write & Rewrite Text',
  'Summarize Content', 'Creative Brainstorming', 'Explain Complex Topics',
  'Structured Responses', 'Custom Conversation Starters'
];

export const PERSONALITY_PRESETS = [
  { key: 'friendly',    label: 'Friendly & Helpful' },
  { key: 'professional',label: 'Professional' },
  { key: 'educational', label: 'Educational' },
  { key: 'creative',    label: 'Creative' },
  { key: 'funny',       label: 'Funny' },
  { key: 'concise',     label: 'Concise' },
  { key: 'detailed',    label: 'Detailed & Engaging' },
  { key: 'custom',      label: 'Custom Personality' }
];

/* ======================================================================
   LOGO & PREVIEW TEMPLATE ART (built-in, zero-upload options)
   Logo tiles are square; preview tiles are wide banners — two distinct,
   independently changeable assets. The defaults differ on purpose.
   ====================================================================== */

function tileDataUri({ glyph, c1, c2, w = 96, h = 96, radius = 26, fontSize = 44, decor = '' }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" rx="${radius}" fill="url(#g)"/>${decor}` +
    `<text x="50%" y="${h / 2}" dominant-baseline="central" text-anchor="middle" font-size="${fontSize}">${glyph}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function bannerDataUri({ c1, c2, glyph, glyphs = [] }) {
  const dots = [];
  let seed = 7;
  for (let i = 0; i < 26; i++) {
    seed = (seed * 16807) % 2147483647;
    const x = 18 + (seed % 284);
    seed = (seed * 16807) % 2147483647;
    const y = 12 + (seed % 96);
    const r = 1 + (seed % 22) / 10;
    dots.push(`<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="#ffffff" opacity="${(0.12 + (seed % 10) / 55).toFixed(2)}"/>`);
  }
  const rings = `<circle cx="272" cy="60" r="86" fill="none" stroke="#ffffff" stroke-opacity=".16" stroke-width="2"/>
    <circle cx="272" cy="60" r="60" fill="none" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>`;
  const gl = glyphs.map((g, i) =>
    `<text x="${252 + i * 0}" y="60" font-size="34" text-anchor="middle" dominant-baseline="central">${g}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="320" height="120" rx="20" fill="url(#g)"/>${dots.join('')}${rings}` +
    `<text x="272" y="62" font-size="40" text-anchor="middle" dominant-baseline="central">${glyph}</text>${gl}` +
    `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export const BOT_LOGO_TEMPLATES = {
  'robot-aqua': { label: 'Robo Buddy', url: tileDataUri({ glyph: '🤖', c1: '#155EFF', c2: '#7028FF' }) },
  'book':       { label: 'Study Book', url: tileDataUri({ glyph: '📖', c1: '#f59e0b', c2: '#ef4444' }) },
  'star':       { label: 'Bright Star', url: tileDataUri({ glyph: '⭐', c1: '#fbbf24', c2: '#f97316' }) },
  'game':       { label: 'Game On', url: tileDataUri({ glyph: '🎮', c1: '#7028FF', c2: '#d946ef' }) },
  'bulb':       { label: 'Idea Lamp', url: tileDataUri({ glyph: '💡', c1: '#f97316', c2: '#facc15' }) },
  'heart':      { label: 'Kind Heart', url: tileDataUri({ glyph: '💜', c1: '#d946ef', c2: '#f43f5e' }) },
  'code':       { label: 'Code Pal', url: tileDataUri({ glyph: '👩‍💻', c1: '#087CFF', c2: '#08D9FF' }) },
  'music':      { label: 'Music Muse', url: tileDataUri({ glyph: '🎵', c1: '#34d399', c2: '#087CFF' }) },
  'chat':       { label: 'Chatter', url: tileDataUri({ glyph: '💬', c1: '#0ea5e9', c2: '#6366f1' }) },
  'shield':     { label: 'Guardian', url: tileDataUri({ glyph: '🛡️', c1: '#64748b', c2: '#155EFF' }) }
};

export const BOT_PREVIEW_TEMPLATES = {
  'nebula':  { label: 'Nebula', url: bannerDataUri({ c1: '#7028FF', c2: '#155EFF', glyph: '🌌' }) },
  'aurora':  { label: 'Aurora', url: bannerDataUri({ c1: '#08D9FF', c2: '#7028FF', glyph: '🪐' }) },
  'orbit':   { label: 'Orbit', url: bannerDataUri({ c1: '#155EFF', c2: '#08D9FF', glyph: '🛰️' }) },
  'sunset':  { label: 'Sunset', url: bannerDataUri({ c1: '#f97316', c2: '#d946ef', glyph: '🌅' }) },
  'meadow':  { label: 'Meadow', url: bannerDataUri({ c1: '#34d399', c2: '#0ea5e9', glyph: '🌿' }) },
  'ember':   { label: 'Ember', url: bannerDataUri({ c1: '#ef4444', c2: '#facc15', glyph: '🔥' }) }
};

const DEFAULT_LOGO_KEY = 'robot-aqua';
const DEFAULT_PREVIEW_KEY = 'nebula'; // deliberately different from the logo default

export function botLogoUrl(bot) {
  if (!bot) return BOT_LOGO_TEMPLATES[DEFAULT_LOGO_KEY].url;
  if (bot.logoUrl) return bot.logoUrl;
  return (BOT_LOGO_TEMPLATES[bot.logoTemplate] || BOT_LOGO_TEMPLATES[DEFAULT_LOGO_KEY]).url;
}

export function botPreviewUrl(bot) {
  if (!bot) return BOT_PREVIEW_TEMPLATES[DEFAULT_PREVIEW_KEY].url;
  if (bot.previewUrl) return bot.previewUrl;
  return (BOT_PREVIEW_TEMPLATES[bot.previewTemplate] || BOT_PREVIEW_TEMPLATES[DEFAULT_PREVIEW_KEY]).url;
}

/* ======================================================================
   MODULE STATE
   ====================================================================== */

let publicUnsub = null;
let mineUnsub = null;
let publicBots = [];
let myBots = [];
let currentTab = 'popular';
let currentCategory = 'All';
let searchQuery = '';
let marketplaceLoaded = false;

let studioMode = 'create'; // create | update | settings
let editingBotId = null;
let studioSaving = false;
let studioDirty = false;
let studioTestBot = null;

let chatBot = null;
let chatBotId = null;
let chatIsTest = false;
let chatUnsub = null;
let chatSending = false;
let chatMessages = [];
let lastFailedMessage = null;

let profileBotId = null;
let profileUnsub = null;
let commentsUnsub = null;
let profileBot = null;

/* ======================================================================
   SMALL HELPERS
   ====================================================================== */

function el(id) { return document.getElementById(id); }

function ratingOf(bot) {
  const count = bot.ratingCount || 0;
  const sum = bot.ratingSum || 0;
  return count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
}

function compact(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

function starsHtml(avg, cls = '') {
  const full = Math.round(avg);
  return `<span class="bot-stars ${cls}" aria-label="${avg} out of 5 stars">${'★'.repeat(full)}${'☆'.repeat(Math.max(0, 5 - full))}</span>`;
}

function visibilityBadge(bot) {
  const pub = (bot.visibility || 'public') === 'public';
  return `<span class="bot-vis-badge ${pub ? 'bot-vis-public' : 'bot-vis-private'}">${pub
    ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M2.5 12h19"/><path d="M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18z"/></svg> Public'
    : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg> Private'}</span>`;
}

function isOwner(bot) {
  return auth?.currentUser && bot?.ownerUid === auth.currentUser.uid;
}

function newBotId() {
  const buf = new Uint8Array(9);
  crypto.getRandomValues(buf);
  return 'bot_' + Array.from(buf).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 17);
}

/** Studio dirty-state guard — warns before losing unsaved work. */
function confirmDirtyLeave() {
  if (!studioDirty) return true;
  const ok = window.confirm('You have unsaved bot changes. Leave without saving?');
  return ok;
}

function markStudioDirty() {
  studioDirty = true;
  const saveBtn = el('bot-save-btn');
  if (saveBtn && studioMode !== 'create') saveBtn.textContent = 'Save Changes •';
}

/* ======================================================================
   DATA SUBSCRIPTIONS
   ====================================================================== */

function ensureBotsListeners() {
  if (!auth.currentUser) return;
  if (!publicUnsub) {
    publicUnsub = onSnapshot(
      query(collection(db, 'bots'), where('visibility', '==', 'public')),
      (snap) => {
        publicBots = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderMarketplace();
        if (profileBotId) renderProfileFromCache();
      },
      (err) => {
        console.warn('[HubbleNest] bots listener:', err?.code || err);
        renderMarketplaceError(err);
      }
    );
  }
  if (!mineUnsub) {
    mineUnsub = onSnapshot(
      query(collection(db, 'bots'), where('ownerUid', '==', auth.currentUser.uid)),
      (snap) => {
        myBots = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderMarketplace();
        renderMyBotsList();
      },
      (err) => console.warn('[HubbleNest] my-bots listener:', err?.code || err)
    );
  }
}

function stopBotsListeners() {
  if (publicUnsub) { publicUnsub(); publicUnsub = null; }
  if (mineUnsub) { mineUnsub(); mineUnsub = null; }
  marketplaceLoaded = false;
}

/* ======================================================================
   MARKETPLACE (Reference Image 1)
   ====================================================================== */

export function openBotsMarketplace() {
  if (!confirmDirtyLeave()) return;
  stopStudioPreview();
  closeChatView();
  closeProfileView();
  studioDirty = false;

  state_currentView('bots');
  showView('view-bots');
  setActiveNav('nav-bots');

  ensureBotsListeners();
  marketplaceLoaded = true;
  renderMarketplace();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function marketplaceList() {
  let list;
  if (currentTab === 'mine') {
    list = myBots.slice();
  } else {
    list = publicBots.slice();
  }

  if (currentCategory !== 'All') {
    list = list.filter(b => (b.category || 'Other') === currentCategory);
  }
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(b =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.shortDescription || '').toLowerCase().includes(q) ||
      (b.description || '').toLowerCase().includes(q) ||
      (b.category || '').toLowerCase().includes(q)
    );
  }

  const t = (b) => (b.publishedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0);
  const used = (b) => (b.lastUsedAt?.toMillis?.() || 0);

  switch (currentTab) {
    case 'popular': list.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || t(b) - t(a)); break;
    case 'trending': list.sort((a, b) => used(b) - used(a) || (b.usageCount || 0) - (a.usageCount || 0)); break;
    case 'top': list.sort((a, b) => ratingOf(b) - ratingOf(a) || (b.ratingCount || 0) - (a.ratingCount || 0)); break;
    case 'latest': list.sort((a, b) => t(b) - t(a)); break;
    case 'mine': list.sort((a, b) => t(b) - t(a)); break;
  }
  return list;
}

const TAB_META = {
  popular: { label: 'Popular', note: 'most used community bots — ranked by real conversations started' },
  trending: { label: 'Trending', note: 'bots with the most recent genuine activity' },
  top: { label: 'Top Rated', note: 'highest average member ratings (real stored ratings only)' },
  latest: { label: 'Latest', note: 'newly published public bots, newest first' },
  mine: { label: 'My Bots', note: 'bots you created — public and private' }
};

export function botsSetTab(tab) {
  if (!TAB_META[tab]) return;
  currentTab = tab;
  document.querySelectorAll('.bots-tab').forEach(b => b.classList.remove('bots-tab-active'));
  el(`bots-tab-${tab}`)?.classList.add('bots-tab-active');
  renderMarketplace();
}

export function botsSetCategory(cat) {
  currentCategory = cat || 'All';
  renderMarketplace();
}

export function botsHandleSearch(raw) {
  searchQuery = raw || '';
  renderMarketplace();
}

export function botsRefresh() {
  renderMarketplace();
}

function renderMarketplaceError(err) {
  const grid = el('bots-grid');
  if (!grid) return;
  grid.innerHTML = `<div class="bots-state-card bots-state-error">
    <b>The marketplace could not load right now</b>
    <p>Check your internet connection and sign-in state, then try again. (${escapeHtml(err?.code || 'network error')})</p>
    <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.botsRetry()">Retry</button>
  </div>`;
  const empty = el('bots-empty');
  if (empty) empty.style.display = 'none';
}

export function botsRetry() {
  stopBotsListeners();
  ensureBotsListeners();
  renderMarketplace();
}

function renderMarketplace() {
  const grid = el('bots-grid');
  const empty = el('bots-empty');
  const note = el('bots-rank-note');
  if (!grid) return;

  if (!auth.currentUser) {
    grid.innerHTML = `<div class="bots-state-card"><b>Sign in to explore HubbleNest Bots</b>
      <p>Discover community bots, chat with them, rate them — or create your own.</p></div>`;
    if (empty) empty.style.display = 'none';
    return;
  }

  if (note) note.textContent = TAB_META[currentTab]?.note || '';

  const list = marketplaceList();

  if (list.length === 0) {
    grid.innerHTML = '';
    if (empty) {
      const mineEmpty = currentTab === 'mine';
      empty.style.display = 'block';
      empty.innerHTML = mineEmpty
        ? `<b>You haven't created a bot yet</b><p>Build your own AI bot with its own personality, logo and skills — it only takes a minute.</p>
           <button type="button" class="btn btn-primary" onclick="window.HubbleNest.openBotStudio('create')">Create your first bot</button>`
        : `<b>No bots here yet${searchQuery ? ' for that search' : ''}</b><p>${searchQuery
            ? 'Try a different name, topic or category — or create the bot this search is missing.'
            : 'Be the first: create a bot and the whole community will see it here.'}</p>
           <button type="button" class="btn btn-primary" onclick="window.HubbleNest.openBotStudio('create')">Create a Bot</button>`;
    }
    return;
  }

  if (empty) empty.style.display = 'none';

  grid.innerHTML = list.map(botCardHtml).join('');
}

function botCardHtml(bot) {
  const avg = ratingOf(bot);
  const mine = isOwner(bot);
  return `<article class="bot-card" data-bot-id="${escapeHtml(bot.id)}">
    <div class="bot-card-logo"><img src="${escapeHtml(botLogoUrl(bot))}" alt="" loading="lazy" /></div>
    <div class="bot-card-body">
      <div class="bot-card-titlerow">
        <h3 class="bot-card-name">${escapeHtml(bot.name || 'Unnamed bot')}</h3>
        <button type="button" class="bot-card-menu" aria-label="Bot options" onclick="window.HubbleNest.botsCardMenu('${escapeHtml(bot.id)}', event)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
        </button>
      </div>
      ${visibilityBadge(bot)}
      <p class="bot-card-desc">${escapeHtml(bot.shortDescription || '')}</p>
      <div class="bot-card-stats">
        <span class="bot-stat bot-stat-rating">${starsHtml(avg, 'bot-stars-sm')} <b>${avg > 0 ? avg.toFixed(1) : 'New'}</b>${bot.ratingCount ? ` <span class="bot-stat-sub">(${compact(bot.ratingCount)} ratings)</span>` : ''}</span>
        <span class="bot-stat-sep"></span>
        <span class="bot-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg> ${compact(bot.usageCount || 0)} uses</span>
        <span class="bot-stat-sep"></span>
        <span class="bot-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4.5 4V6A2.5 2.5 0 0 1 6 3.5h12.5A2.5 2.5 0 0 1 21 6Z"/></svg> ${compact(bot.commentCount || 0)} comments</span>
      </div>
      <button type="button" class="bot-use-btn" onclick="window.HubbleNest.botsUseBot('${escapeHtml(bot.id)}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5Z"/></svg>
        Use Bot
      </button>
    </div>
  </article>`;
}

/** Card overflow menu — ownership-aware actions. */
export function botsCardMenu(botId, event) {
  if (event) event.stopPropagation();
  closeBotMenu();
  const bot = findBotAnywhere(botId);
  if (!bot) return;
  const mine = isOwner(bot);
  const menu = document.createElement('div');
  menu.className = 'bot-pop-menu';
  menu.id = 'bot-pop-menu';
  const pub = (bot.visibility || 'public') === 'public';
  menu.innerHTML = `
    <button type="button" data-act="profile">View profile</button>
    ${mine ? `
      <button type="button" data-act="edit">Edit in Studio</button>
      <button type="button" data-act="test">Test bot</button>
      <button type="button" data-act="vis">${pub ? 'Make private' : 'Publish publicly'}</button>
      ${pub ? '<button type="button" data-act="share">Share bot</button>' : ''}
      <button type="button" class="bot-menu-danger" data-act="delete">Delete bot</button>
    ` : `
      <button type="button" data-act="share">Share bot</button>
      <button type="button" data-act="report">Report bot</button>
    `}
  `;
  document.body.appendChild(menu);
  const rect = (event?.currentTarget || document.body).getBoundingClientRect();
  const mw = 190;
  menu.style.left = Math.max(10, Math.min(window.innerWidth - mw - 10, rect.left - mw + 26)) + 'px';
  menu.style.top = Math.min(window.innerHeight - 220, rect.bottom + 6) + 'px';
  menu.addEventListener('click', (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    closeBotMenu();
    if (act === 'profile') openBotProfile(botId);
    if (act === 'edit') openBotStudio('update', botId);
    if (act === 'test') openBotChat(botId);
    if (act === 'vis') toggleBotVisibility(botId);
    if (act === 'share') shareBot(bot);
    if (act === 'delete') deleteBotWithConfirm(botId);
    if (act === 'report') reportBot(bot);
  });
  setTimeout(() => document.addEventListener('click', closeBotMenuOnce, { once: true }), 0);
}

function closeBotMenuOnce() { closeBotMenu(); }
function closeBotMenu() { document.getElementById('bot-pop-menu')?.remove(); }

function findBotAnywhere(botId) {
  return publicBots.find(b => b.id === botId) || myBots.find(b => b.id === botId) || null;
}

export function botsUseBot(botId) {
  const bot = findBotAnywhere(botId);
  if (!bot) { showToast('That bot is no longer available.', 'warning'); return; }
  openBotChat(botId);
}

export async function toggleBotVisibility(botId) {
  const bot = findBotAnywhere(botId);
  if (!bot || !isOwner(bot)) return;
  const pub = (bot.visibility || 'public') === 'public';
  const next = pub ? 'private' : 'public';
  try {
    const patch = { visibility: next, updatedAt: serverTimestamp() };
    if (next === 'public' && !bot.publishedAt) patch.publishedAt = serverTimestamp();
    await updateDoc(doc(db, 'bots', botId), patch);
    showToast(pub
      ? `"${bot.name}" is private now — only you can use it.`
      : `"${bot.name}" is live in the marketplace for everyone.`, 'success');
  } catch (err) {
    console.warn('[HubbleNest] visibility change failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'Only the bot\'s creator can change its visibility.'
      : 'Could not change visibility — try again.', 'error');
  }
}

export function shareBot(bot) {
  const url = `${location.origin}${location.pathname}#bot=${bot.id}`;
  const doToast = () => showToast('Bot link copied — anyone who opens it meets your bot.', 'success');
  if (navigator.share) {
    navigator.share({ title: `${bot.name} — a HubbleNest bot`, text: bot.shortDescription || '', url })
      .then(() => {}, () => {})
      .catch(() => {});
    return;
  }
  navigator.clipboard?.writeText(url).then(doToast).catch(() => {
    showToast(url, 'info', 8000);
  });
}

export function botsShareBotById(botId) {
  const bot = findBotAnywhere(botId);
  if (bot) shareBot(bot);
}

/** Live-preview "Share Bot" — shares the bot being edited once it exists. */
export function botStudioShare() {
  if (editingBotId) {
    const bot = findBotAnywhere(editingBotId);
    if (bot) { shareBot(bot); return; }
  }
  showToast('Save the bot first — then its public link is one tap away.', 'info');
}

export async function reportBot(bot) {
  if (!auth.currentUser) return;
  try {
    await addDoc(collection(db, 'botReports'), {
      kind: 'bot', botId: bot.id, botName: bot.name || '',
      reporterUid: auth.currentUser.uid,
      createdAt: serverTimestamp()
    });
    showToast('Report sent to the moderators. Thank you.', 'success');
  } catch (err) {
    showToast('Could not send the report — try again.', 'error');
  }
}

export async function deleteBotWithConfirm(botId) {
  const bot = findBotAnywhere(botId);
  if (!bot || !isOwner(bot)) return;
  if (!window.confirm(`Delete "${bot.name}" permanently? Its ratings, comments and chat history go with it. This cannot be undone.`)) return;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'bots', botId));
    // best-effort cleanup of related public records
    try {
      const cs = await getDocs(query(collection(db, 'botComments'), where('botId', '==', botId)));
      cs.forEach(d => batch.delete(d.ref));
      const rs = await getDocs(query(collection(db, 'botRatings'), where('botId', '==', botId)));
      rs.forEach(d => batch.delete(d.ref));
    } catch (e) { /* sub-collections cleaned opportunistically */ }
    await batch.commit();
    showToast(`"${bot.name}" was deleted.`, 'success');
    if (editingBotId === botId) { studioMode = 'create'; editingBotId = null; }
  } catch (err) {
    console.warn('[HubbleNest] bot delete failed:', err);
    showToast('Could not delete the bot — try again.', 'error');
  }
}

/* ======================================================================
   STUDIO — CREATE / UPDATE / SETTINGS (Reference Image 2)
   ====================================================================== */

export function openBotStudio(mode = 'create', botId = null) {
  if (!confirmDirtyLeave()) return;
  stopStudioPreview();
  closeChatView();
  closeProfileView();

  state_currentView('bot-studio');
  showView('view-bot-studio');
  setActiveNav('nav-bots');

  ensureBotsListeners();

  studioMode = ['create', 'update', 'settings'].includes(mode) ? mode : 'create';
  if (mode === 'update' && !botId) studioMode = 'update'; // picker list shows

  setStudioMode(studioMode, botId);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function bstGo(target) {
  switch (target) {
    case 'create': openBotStudio('create'); break;
    case 'mine': openBotStudio('update'); break;
    case 'explore': openBotsMarketplace(); botsSetTab('popular'); break;
    case 'top': openBotsMarketplace(); botsSetTab('top'); break;
    case 'trending': openBotsMarketplace(); botsSetTab('trending'); break;
  }
}

export function setStudioMode(mode, botId = null) {
  studioMode = mode;
  studioDirty = false;
  document.querySelectorAll('.bst-mode-btn').forEach(b => b.classList.remove('bst-mode-active'));
  el(`bst-mode-${mode}`)?.classList.add('bst-mode-active');

  const title = el('bst-title');
  const sub = el('bst-sub');
  if (title) title.textContent = 'Create or Update Your Bot';
  if (sub) sub.textContent = 'Bring your AI bot to life. You can create a new bot or update an existing one.';

  const formWrap = el('bst-form-wrap');
  const pickerWrap = el('bst-picker-wrap');
  const saveBtn = el('bot-save-btn');
  const cancelBtn = el('bot-cancel-edit-btn');

  if (mode === 'create') {
    editingBotId = null;
    resetStudioForm();
    if (pickerWrap) pickerWrap.style.display = 'none';
    if (formWrap) formWrap.style.display = 'block';
    if (saveBtn) { saveBtn.textContent = '🚀 Create Bot'; saveBtn.disabled = false; }
    if (cancelBtn) cancelBtn.style.display = 'none';
    renderStudioPreview();
  } else if (mode === 'update') {
    if (pickerWrap) pickerWrap.style.display = 'block';
    if (formWrap) formWrap.style.display = 'none';
    if (saveBtn) saveBtn.textContent = '🚀 Save Changes';
    renderMyBotsList();
  } else { // settings — same as update, but straight to the last-opened bot
    if (pickerWrap) pickerWrap.style.display = 'block';
    if (formWrap) formWrap.style.display = 'none';
    if (saveBtn) saveBtn.textContent = '🚀 Save Changes';
    renderMyBotsList();
  }
}

function resetStudioForm() {
  editingBotId = null;
  studioTestBot = null;
  const d = emptyDraft();
  d.name = el('bot-name-input') ? '' : '';
  setFormValues(d);
  studioDirty = false;
}

function emptyDraft() {
  return {
    name: '', shortDescription: '', description: '', category: 'Education',
    visibility: 'public', logoUrl: '', logoTemplate: DEFAULT_LOGO_KEY,
    previewUrl: '', previewTemplate: DEFAULT_PREVIEW_KEY,
    personalityPreset: 'friendly', responseStyle: 'balanced', responseLength: 'medium',
    language: 'Auto', formattingPreferences: '',
    customInstructions: '', doList: '', avoidList: '',
    greetingMessage: '', examplePrompts: '', capabilities: ['Answer Questions', 'Generate Ideas']
  };
}

function readFormIntoDraft() {
  const d = studioTestBot || emptyDraft();
  return {
    name: val('bot-name-input'),
    shortDescription: val('bot-short-desc-input'),
    description: val('bot-detail-desc-input'),
    category: val('bot-category-select') || 'Other',
    visibility: val('bot-visibility-select') || 'public',
    logoUrl: d.logoUrl || '',
    logoTemplate: d.logoTemplate || DEFAULT_LOGO_KEY,
    previewUrl: d.previewUrl || '',
    previewTemplate: d.previewTemplate || DEFAULT_PREVIEW_KEY,
    personalityPreset: val('bot-personality-select') || 'friendly',
    responseStyle: val('bot-response-style') || 'balanced',
    responseLength: val('bot-response-length') || 'medium',
    language: val('bot-language-select') || 'Auto',
    formattingPreferences: val('bot-formatting-input') || '',
    customInstructions: val('bot-custom-instructions') || '',
    doList: val('bot-do-input') || '',
    avoidList: val('bot-avoid-input') || '',
    greetingMessage: val('bot-greeting-input') || '',
    examplePrompts: val('bot-starters-input') || '',
    capabilities: readCapabilities()
  };
}

function val(id) { const e = el(id); return e ? String(e.value || '').trim() : ''; }

function setFormValues(d) {
  const set = (id, v) => { const e = el(id); if (e) e.value = v ?? ''; };
  set('bot-name-input', d.name);
  set('bot-short-desc-input', d.shortDescription);
  set('bot-detail-desc-input', d.description);
  set('bot-category-select', d.category);
  set('bot-visibility-select', d.visibility);
  set('bot-personality-select', d.personalityPreset);
  set('bot-response-style', d.responseStyle);
  set('bot-response-length', d.responseLength);
  set('bot-language-select', d.language);
  set('bot-formatting-input', d.formattingPreferences);
  set('bot-custom-instructions', d.customInstructions);
  set('bot-do-input', d.doList);
  set('bot-avoid-input', d.avoidList);
  set('bot-greeting-input', d.greetingMessage);
  set('bot-starters-input', d.examplePrompts);
  renderCapabilityChecks(d.capabilities || []);
  renderLogoPickers(d);
  renderStudioPreview(d);
}

function renderCapabilityChecks(selected) {
  const box = el('bot-caps-box');
  if (!box) return;
  const sel = new Set(selected);
  box.innerHTML = BOT_CAPABILITIES.map(c => `
    <label class="bot-cap"><input type="checkbox" value="${escapeHtml(c)}" ${sel.has(c) ? 'checked' : ''} onchange="window.HubbleNest.botStudioMarkDirty()" />
      <span class="bot-cap-check" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
      <span>${escapeHtml(c)}</span></label>`).join('');
  const customBox = el('bot-cap-custom-wrap');
  const customs = selected.filter(c => !BOT_CAPABILITIES.includes(c));
  if (customBox) {
    customBox.innerHTML = customs.map(c => `
      <label class="bot-cap bot-cap-custom"><input type="checkbox" value="${escapeHtml(c)}" checked onchange="window.HubbleNest.botStudioMarkDirty()" />
        <span class="bot-cap-check" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
        <span>${escapeHtml(c)}</span>
        <button type="button" class="bot-cap-x" aria-label="Remove ${escapeHtml(c)}" onclick="window.HubbleNest.botStudioRemoveCustomCap('${escapeHtml(c)}'); event.preventDefault();">×</button></label>`).join('');
  }
}

export function botStudioAddCustomCap() {
  const input = el('bot-cap-custom-input');
  const v = (input?.value || '').trim();
  if (!v) return;
  const wrap = el('bot-cap-custom-wrap');
  if (!wrap) return;
  if (wrap.innerHTML.includes(`value="${escapeHtml(v)}"`)) { input.value = ''; return; }
  const label = document.createElement('label');
  label.className = 'bot-cap bot-cap-custom';
  label.innerHTML = `<input type="checkbox" value="${escapeHtml(v)}" checked onchange="window.HubbleNest.botStudioMarkDirty()" />
    <span class="bot-cap-check" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
    <span>${escapeHtml(v)}</span>
    <button type="button" class="bot-cap-x" aria-label="Remove ${escapeHtml(v)}" onclick="window.HubbleNest.botStudioRemoveCustomCap('${escapeHtml(v)}'); event.preventDefault();">×</button>`;
  wrap.appendChild(label);
  input.value = '';
  markStudioDirty();
}

export function botStudioRemoveCustomCap(cap) {
  document.querySelectorAll('#bot-cap-custom-wrap .bot-cap-custom').forEach(l => {
    const cb = l.querySelector('input');
    if (cb && cb.value === cap) l.remove();
  });
  markStudioDirty();
}

function readCapabilities() {
  const caps = [];
  document.querySelectorAll('#bot-caps-box input[type="checkbox"], #bot-cap-custom-wrap input[type="checkbox"]').forEach(cb => {
    if (cb.checked && cb.value) caps.push(cb.value);
  });
  return caps;
}

/* ----- logo & preview pickers ----- */

function renderLogoPickers(d) {
  const logoImg = el('bot-logo-preview');
  if (logoImg) logoImg.src = d.logoUrl || BOT_LOGO_TEMPLATES[d.logoTemplate]?.url || BOT_LOGO_TEMPLATES[DEFAULT_LOGO_KEY].url;
  const prevImg = el('bot-previewimg-preview');
  if (prevImg) prevImg.src = d.previewUrl || BOT_PREVIEW_TEMPLATES[d.previewTemplate]?.url || BOT_PREVIEW_TEMPLATES[DEFAULT_PREVIEW_KEY].url;

  const lWrap = el('bot-logo-templates');
  if (lWrap) {
    lWrap.innerHTML = Object.entries(BOT_LOGO_TEMPLATES).map(([k, t]) => `
      <button type="button" class="bot-tpl ${(!d.logoUrl && d.logoTemplate === k) ? 'bot-tpl-active' : ''}"
        title="${escapeHtml(t.label)}" onclick="window.HubbleNest.botStudioPickLogoTemplate('${k}')">
        <img src="${t.url}" alt="${escapeHtml(t.label)}" />
      </button>`).join('') +
      `<button type="button" class="bot-tpl bot-tpl-upload" title="Upload your own logo" onclick="document.getElementById('bot-logo-input').click()">
        <span>⋯<br/><small>Upload</small></span></button>`;
  }
  const pWrap = el('bot-previewimg-templates');
  if (pWrap) {
    pWrap.innerHTML = Object.entries(BOT_PREVIEW_TEMPLATES).map(([k, t]) => `
      <button type="button" class="bot-tpl bot-tpl-wide ${(!d.previewUrl && d.previewTemplate === k) ? 'bot-tpl-active' : ''}"
        title="${escapeHtml(t.label)}" onclick="window.HubbleNest.botStudioPickPreviewTemplate('${k}')">
        <img src="${t.url}" alt="${escapeHtml(t.label)}" />
      </button>`).join('') +
      `<button type="button" class="bot-tpl bot-tpl-upload bot-tpl-wide" title="Upload your own preview image" onclick="document.getElementById('bot-previewimg-input').click()">
        <span>⋯<br/><small>Upload</small></span></button>`;
  }

  const lrm = el('bot-logo-remove');
  if (lrm) lrm.style.display = d.logoUrl ? 'inline-flex' : 'none';
  const prm = el('bot-previewimg-remove');
  if (prm) prm.style.display = d.previewUrl ? 'inline-flex' : 'none';
}

export function botStudioMarkDirty() {
  markStudioDirty();
  const d = readFormIntoDraft();
  renderStudioPreview(d);
}

export function botStudioPickLogoTemplate(key) {
  if (!BOT_LOGO_TEMPLATES[key]) return;
  const d = readFormIntoDraft();
  d.logoUrl = '';
  d.logoTemplate = key;
  studioTestBot = d;
  renderLogoPickers(d);
  renderStudioPreview(d);
  markStudioDirty();
}

export function botStudioPickPreviewTemplate(key) {
  if (!BOT_PREVIEW_TEMPLATES[key]) return;
  const d = readFormIntoDraft();
  d.previewUrl = '';
  d.previewTemplate = key;
  studioTestBot = d;
  renderLogoPickers(d);
  renderStudioPreview(d);
  markStudioDirty();
}

export async function botStudioUploadLogo(file) {
  await uploadStudioImage(file, 'logo');
}
export async function botStudioUploadPreview(file) {
  await uploadStudioImage(file, 'preview');
}

async function uploadStudioImage(file, kind) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast(kind === 'logo' ? 'Logos must be images (PNG, JPG, WebP or SVG).' : 'Preview images must be images (PNG, JPG, WebP or SVG).', 'warning');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('Images are capped at 2 MB — pick a smaller one.', 'warning');
    return;
  }
  const statusEl = el(kind === 'logo' ? 'bot-logo-status' : 'bot-previewimg-status');
  const d = readFormIntoDraft();
  const previous = kind === 'logo' ? { url: d.logoUrl, tpl: d.logoTemplate } : { url: d.previewUrl, tpl: d.previewTemplate };
  if (statusEl) statusEl.textContent = 'Uploading…';
  try {
    const res = await uploadToCloudinary(file, (pct) => {
      if (statusEl) statusEl.textContent = `Uploading… ${Math.round(pct)}%`;
    }, 2);
    const fresh = readFormIntoDraft();
    if (kind === 'logo') { fresh.logoUrl = res.url; fresh.logoTemplate = ''; }
    else { fresh.previewUrl = res.url; fresh.previewTemplate = ''; }
    studioTestBot = fresh;
    renderLogoPickers(fresh);
    renderStudioPreview(fresh);
    markStudioDirty();
    if (statusEl) statusEl.textContent = 'Uploaded ✓ — saved with the bot';
    showToast(`${kind === 'logo' ? 'Logo' : 'Preview image'} uploaded — press Create Bot / Save Changes to keep it.`, 'success', 3600);
  } catch (err) {
    console.warn('[HubbleNest] studio image upload failed:', err);
    // retain previous asset, offer retry
    studioTestBot = readFormIntoDraft();
    renderLogoPickers(studioTestBot);
    if (statusEl) statusEl.textContent = 'Upload failed — the previous image is kept. ';
    showToast((err.message || 'Upload failed.') + ' You can retry anytime.', 'error', 6000);
  }
}

export function botStudioRemoveLogo() {
  const d = readFormIntoDraft();
  d.logoUrl = '';
  d.logoTemplate = DEFAULT_LOGO_KEY;
  studioTestBot = d;
  renderLogoPickers(d);
  renderStudioPreview(d);
  markStudioDirty();
  const s = el('bot-logo-status'); if (s) s.textContent = '';
}

export function botStudioRemovePreview() {
  const d = readFormIntoDraft();
  d.previewUrl = '';
  d.previewTemplate = DEFAULT_PREVIEW_KEY;
  studioTestBot = d;
  renderLogoPickers(d);
  renderStudioPreview(d);
  markStudioDirty();
  const s = el('bot-previewimg-status'); if (s) s.textContent = '';
}

/* ----- live preview panel ----- */

let previewTimer = null;
function schedulePreviewRefresh() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const d = readFormIntoDraft();
    renderStudioPreview(d);
  }, 120);
}
export function stopStudioPreview() { clearTimeout(previewTimer); }

function renderStudioPreview(draft = null) {
  const d = draft || readFormIntoDraft();
  const img = el('bp-logo');
  if (img) img.src = d.logoUrl || BOT_LOGO_TEMPLATES[d.logoTemplate]?.url || BOT_LOGO_TEMPLATES[DEFAULT_LOGO_KEY].url;
  const name = el('bp-name');
  if (name) name.textContent = d.name || 'Your Bot';
  const vis = el('bp-vis');
  if (vis) {
    vis.className = 'bp-badge ' + (d.visibility === 'public' ? 'bp-badge-public' : 'bp-badge-private');
    vis.textContent = d.visibility === 'public' ? 'Public' : 'Private';
  }
  const cat = el('bp-category');
  if (cat) cat.textContent = d.category || 'Other';
  const pers = el('bp-personality');
  if (pers) pers.textContent = PERSONALITY_PRESETS.find(p => p.key === d.personalityPreset)?.label || 'Friendly & Helpful';
  const desc = el('bp-desc');
  if (desc) desc.textContent = d.shortDescription || d.description || 'Give your bot a short description and it will show up right here.';
  const caps = el('bp-caps');
  if (caps) {
    const list = (d.capabilities || []).slice(0, 3);
    caps.innerHTML = list.map(c => `<span class="bp-chip">${escapeHtml(c)}</span>`).join('');
    caps.style.display = list.length ? 'flex' : 'none';
  }
  const cover = el('bp-cover');
  if (cover) cover.src = d.previewUrl || BOT_PREVIEW_TEMPLATES[d.previewTemplate]?.url || BOT_PREVIEW_TEMPLATES[DEFAULT_PREVIEW_KEY].url;
  const rate = el('bp-rating');
  if (rate) {
    if (editingBotId) {
      const bot = findBotAnywhere(editingBotId);
      const avg = bot ? ratingOf(bot) : 0;
      rate.style.display = (bot && bot.ratingCount) ? 'inline-flex' : 'none';
      if (bot && bot.ratingCount) rate.innerHTML = `★ ${avg.toFixed(1)} (${compact(bot.ratingCount)})`;
    } else {
      rate.style.display = 'none';
    }
  }
}

/* ----- save / edit flows ----- */

export async function botStudioSave() {
  if (studioSaving) return;
  if (!auth.currentUser) { showToast('Sign in first.', 'info'); return; }

  const d = readFormIntoDraft();

  // validation — honest, specific, inline
  const problems = [];
  if (!d.name) problems.push(['bot-name-input', 'Give your bot a name.']);
  if (d.name.length > 60) problems.push(['bot-name-input', 'Names are capped at 60 characters.']);
  if (!d.shortDescription) problems.push(['bot-short-desc-input', 'Add a short description — it shows on the bot card.']);
  if (d.shortDescription.length > 160) problems.push(['bot-short-desc-input', 'Short descriptions are capped at 160 characters.']);
  if (problems.length) {
    showToast(problems[0][1], 'warning', 4200);
    el(problems[0][0])?.focus();
    el(problems[0][0])?.classList.add('bot-field-error');
    setTimeout(() => el(problems[0][0])?.classList.remove('bot-field-error'), 2400);
    return;
  }

  const saveBtn = el('bot-save-btn');
  const statusEl = el('bot-save-status');
  studioSaving = true;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = editingBotId ? 'Saving…' : 'Creating…'; }
  if (statusEl) statusEl.textContent = '';

  const profile = window.HubbleNest?._state?.userProfile;
  const base = {
    name: d.name,
    shortDescription: d.shortDescription,
    description: d.description,
    category: d.category,
    visibility: d.visibility,
    logoUrl: d.logoUrl,
    logoTemplate: d.logoTemplate,
    previewUrl: d.previewUrl,
    previewTemplate: d.previewTemplate,
    personalityPreset: d.personalityPreset,
    responseStyle: d.responseStyle,
    responseLength: d.responseLength,
    language: d.language,
    formattingPreferences: d.formattingPreferences,
    customInstructions: d.customInstructions.slice(0, 4000),
    doList: splitList(d.doList).slice(0, 12),
    avoidList: splitList(d.avoidList).slice(0, 12),
    greetingMessage: d.greetingMessage.slice(0, 500),
    examplePrompts: splitList(d.examplePrompts).slice(0, 5),
    capabilities: d.capabilities.slice(0, 12),
    updatedAt: serverTimestamp()
  };

  try {
    if (editingBotId) {
      const existing = findBotAnywhere(editingBotId) || await (async () => {
        const s = await getDoc(doc(db, 'bots', editingBotId));
        return s.exists() ? { id: s.id, ...s.data() } : null;
      })();
      if (!existing) throw new Error('This bot no longer exists.');
      if (existing.ownerUid !== auth.currentUser.uid) {
        throw Object.assign(new Error('Only the bot\'s creator can edit it.'), { code: 'permission-denied' });
      }
      const patch = { ...base };
      if (d.visibility === 'public' && !existing.publishedAt) patch.publishedAt = serverTimestamp();
      await updateDoc(doc(db, 'bots', editingBotId), patch);
      showToast(`Saved — "${d.name}" is up to date.`, 'success');
      studioDirty = false;
      if (saveBtn) saveBtn.textContent = '🚀 Save Changes';
    } else {
      const id = newBotId();
      await setDoc(doc(db, 'bots', id), {
        ...base,
        ownerUid: auth.currentUser.uid,
        ownerUsername: profile?.username || '',
        ownerDisplayName: profile?.displayName || profile?.username || 'Member',
        usageCount: 0, ratingSum: 0, ratingCount: 0, commentCount: 0,
        createdAt: serverTimestamp(),
        ...(d.visibility === 'public' ? { publishedAt: serverTimestamp() } : {})
      });
      editingBotId = id;
      studioDirty = false;
      showToast(`"${d.name}" is ready${d.visibility === 'public' ? ' and live in the marketplace' : ' — private for now'}.`, 'success', 4500);
      // load the freshly created bot into update mode for further tweaks
      setStudioMode('update');
      botLoadForEdit(id, { silent: true });
    }
    if (statusEl) statusEl.textContent = 'All changes saved ✓';
  } catch (err) {
    console.warn('[HubbleNest] bot save failed:', err);
    const msg = err?.code === 'permission-denied'
      ? 'Only the bot\'s creator can save changes to it.'
      : (err.message || 'Could not save the bot — check your connection and try again.');
    showToast(msg, 'error', 6000);
    if (statusEl) statusEl.textContent = '';
  } finally {
    studioSaving = false;
    if (saveBtn) saveBtn.disabled = false;
  }
}

function splitList(raw) {
  return String(raw || '')
    .split(/\r?\n|;/)
    .map(s => s.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function botStudioCancelEdit() {
  if (!confirmDirtyLeave()) return;
  setStudioMode('update');
}

export function botLoadForEdit(botId, opts = {}) {
  const source = findBotAnywhere(botId);
  const apply = (bot) => {
    if (!bot) return;
    if (!isOwner(bot) && !window.HubbleNest?._state?.isAdmin) {
      showToast('Only the bot\'s creator can edit it.', 'warning');
      return;
    }
    editingBotId = botId;
    studioTestBot = null;
    const d = {
      name: bot.name || '',
      shortDescription: bot.shortDescription || '',
      description: bot.description || '',
      category: bot.category || 'Other',
      visibility: bot.visibility || 'public',
      logoUrl: bot.logoUrl || '',
      logoTemplate: bot.logoTemplate || DEFAULT_LOGO_KEY,
      previewUrl: bot.previewUrl || '',
      previewTemplate: bot.previewTemplate || DEFAULT_PREVIEW_KEY,
      personalityPreset: bot.personalityPreset || 'friendly',
      responseStyle: bot.responseStyle || 'balanced',
      responseLength: bot.responseLength || 'medium',
      language: bot.language || 'Auto',
      formattingPreferences: bot.formattingPreferences || '',
      customInstructions: bot.customInstructions || '',
      doList: (bot.doList || []).join('\n'),
      avoidList: (bot.avoidList || []).join('\n'),
      greetingMessage: bot.greetingMessage || '',
      examplePrompts: (bot.examplePrompts || []).join('\n'),
      capabilities: bot.capabilities || []
    };
    setFormValues(d);
    studioDirty = false;
    const pickerWrap = el('bst-picker-wrap');
    const formWrap = el('bst-form-wrap');
    if (pickerWrap) pickerWrap.style.display = 'none';
    if (formWrap) formWrap.style.display = 'block';
    const cancelBtn = el('bot-cancel-edit-btn');
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    const saveBtn = el('bot-save-btn');
    if (saveBtn) { saveBtn.textContent = '🚀 Save Changes'; saveBtn.disabled = false; }
    renderStudioPreview(d);
    if (!opts.silent) showToast(`Editing "${bot.name}" — changes apply when you save.`, 'info', 3200);
  };

  if (source) { apply(source); return; }
  getDoc(doc(db, 'bots', botId)).then(s => {
    if (s.exists()) apply({ id: s.id, ...s.data() });
    else showToast('That bot could not be found.', 'warning');
  }).catch(err => {
    showToast(err?.code === 'permission-denied'
      ? 'This bot is private — only its creator can open it.'
      : 'Could not load that bot.', 'error');
  });
}

/* ----- My Bots management list (Studio picker + management actions) ----- */

function renderMyBotsList() {
  const list = el('bot-mybots-list');
  if (!list) return;
  if (!auth.currentUser) { list.innerHTML = '<div class="bot-mybots-empty">Sign in to see your bots.</div>'; return; }
  if (myBots.length === 0) {
    list.innerHTML = `<div class="bot-mybots-empty"><b>No bots yet</b>
      <p>Your bots live here — create your first one and manage everything from this list.</p>
      <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.setStudioMode('create')">Create your first bot</button></div>`;
    return;
  }
  const sorted = myBots.slice().sort((a, b) =>
    (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0));
  list.innerHTML = sorted.map(b => {
    const avg = ratingOf(b);
    const updated = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
    return `<div class="bot-mybots-row">
      <img class="bot-mybots-logo" src="${escapeHtml(botLogoUrl(b))}" alt="" />
      <div class="bot-mybots-info">
        <b>${escapeHtml(b.name || 'Unnamed bot')}</b>
        <p>${escapeHtml(b.shortDescription || '')}</p>
        <div class="bot-mybots-meta">
          ${visibilityBadge(b)}
          <span>Updated ${updated ? formatTimeAgo(new Date(updated)) : 'just now'}</span>
          <span>· ${compact(b.usageCount || 0)} uses</span>
          ${b.ratingCount ? `<span>· ★ ${avg.toFixed(1)} (${compact(b.ratingCount)})</span>` : ''}
        </div>
      </div>
      <div class="bot-mybots-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.HubbleNest.botLoadForEdit('${escapeHtml(b.id)}')">Edit</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.HubbleNest.openBotChat('${escapeHtml(b.id)}')">Test</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.HubbleNest.toggleBotVisibility('${escapeHtml(b.id)}')">${(b.visibility || 'public') === 'public' ? 'Make private' : 'Publish'}</button>
        ${(b.visibility || 'public') === 'public' ? `<button type="button" class="btn btn-secondary btn-sm" onclick="window.HubbleNest.botsShareBotById('${escapeHtml(b.id)}')">Share</button>` : ''}
        <button type="button" class="btn btn-danger btn-sm" onclick="window.HubbleNest.deleteBotWithConfirm('${escapeHtml(b.id)}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

/* ======================================================================
   SHARED VIEW PLUMBING (mirrors app.js view switching)
   ====================================================================== */

function showView(viewId) {
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active-view'));
  document.getElementById(viewId)?.classList.add('active-view');
}

function setActiveNav(navId) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.getElementById(navId)?.classList.add('active');
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
}

function state_currentView(name) {
  try { window.HubbleNest._state.currentView = name; } catch (e) { /* state not ready yet */ }
}

/* ======================================================================
   AI CONVERSATION (bot chat + test mode)
   ====================================================================== */

export function openBotChat(botId, opts = {}) {
  closeChatView();
  const testBot = opts.testConfig || null;

  const begin = (bot) => {
    chatBot = bot;
    chatBotId = testBot ? null : botId;
    chatIsTest = !!testBot;
    chatMessages = [];
    lastFailedMessage = null;

    state_currentView('bot-chat');
    showView('view-bot-chat');
    setActiveNav('nav-bots');

    const logo = el('bot-chat-logo');
    if (logo) logo.src = botLogoUrl(bot);
    const name = el('bot-chat-name');
    if (name) name.textContent = (bot.name || 'Bot') + (chatIsTest ? ' — Test' : '');
    const desc = el('bot-chat-desc');
    if (desc) desc.textContent = bot.shortDescription || bot.description || '';
    const badge = el('bot-chat-mode-badge');
    if (badge) {
      if (chatIsTest) {
        badge.style.display = 'inline-flex';
        badge.textContent = 'Test mode — nothing is saved until you press Save';
      } else {
        badge.style.display = 'none';
      }
    }
    const shareBtn = el('bot-chat-share');
    if (shareBtn) {
      const canShare = (bot.visibility || 'public') === 'public' && !chatIsTest;
      shareBtn.style.display = canShare ? 'inline-flex' : 'none';
      shareBtn.onclick = () => shareBot(bot);
    }

    // suggested starters
    const starters = el('bot-chat-starters');
    const prompts = (bot.examplePrompts || []).slice(0, 4);
    if (starters) {
      starters.innerHTML = prompts.map(p => `<button type="button" class="bot-chat-starter" onclick="window.HubbleNest.botChatUseSuggested(this.textContent)">${escapeHtml(p)}</button>`).join('');
      starters.style.display = prompts.length ? 'flex' : 'none';
    }

    renderChatMessages();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (!chatIsTest) {
      registerBotUse(botId);
      subscribeChatMessages();
    }
  };

  if (testBot) { begin(testBot); return; }

  const known = findBotAnywhere(botId);
  if (known) {
    if ((known.visibility || 'public') !== 'public' && !isOwner(known)) {
      showToast('This bot is private — only its creator can use it.', 'warning');
      return;
    }
    begin(known);
    return;
  }
  getDoc(doc(db, 'bots', botId)).then(s => {
    if (!s.exists()) { showToast('That bot no longer exists.', 'warning'); return; }
    const bot = { id: s.id, ...s.data() };
    if ((bot.visibility || 'public') !== 'public' && !isOwner(bot)) {
      showToast('This bot is private — only its creator can use it.', 'warning');
      return;
    }
    begin(bot);
  }).catch(err => {
    showToast(err?.code === 'permission-denied'
      ? 'This bot is private — only its creator can open it.'
      : 'Could not open that bot.', 'error');
  });
}

/** Studio "Test Your Bot" — a real AI conversation with the unsaved draft. */
export function botStudioTest() {
  const d = readFormIntoDraft();
  if (!d.name) { showToast('Give your bot a name first — then test away.', 'warning'); el('bot-name-input')?.focus(); return; }
  openBotChat(null, { testConfig: { ...d, id: '__test__' } });
}

/** A "use" = starting a first conversation with a bot (resume never recounts). */
async function registerBotUse(botId) {
  if (!auth.currentUser) return;
  try {
    const chatRef = doc(db, 'botChats', `${auth.currentUser.uid}_${botId}`);
    const snap = await getDoc(chatRef);
    if (snap.exists()) return;
    await setDoc(chatRef, {
      uid: auth.currentUser.uid, botId, createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'bots', botId), {
      usageCount: increment(1),
      lastUsedAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('[HubbleNest] usage tracking skipped:', err?.code || err);
  }
}

function subscribeChatMessages() {
  if (chatUnsub) { chatUnsub(); chatUnsub = null; }
  if (chatIsTest || !auth.currentUser || !chatBotId) return;
  chatUnsub = onSnapshot(
    query(collection(db, 'botChats', `${auth.currentUser.uid}_${chatBotId}`, 'messages'), limit(80)),
    (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
      chatMessages = rows;
      renderChatMessages();
    },
    (err) => console.warn('[HubbleNest] bot chat listener:', err?.code || err)
  );
}

export function closeChatView() {
  if (chatUnsub) { chatUnsub(); chatUnsub = null; }
  chatBot = null; chatBotId = null; chatIsTest = false; chatMessages = []; chatSending = false;
}

export function botChatUseSuggested(text) {
  const input = el('bot-chat-input');
  if (input) { input.value = text; input.focus(); }
  botChatSend();
}

export function botChatKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    botChatSend();
  }
}

export function botChatNew() {
  if (chatIsTest) {
    chatMessages = [];
    renderChatMessages();
    return;
  }
  clearConversationRemote(true);
}

export function botChatClear() {
  clearConversationRemote(false);
}

async function clearConversationRemote(silent) {
  if (chatIsTest) { chatMessages = []; renderChatMessages(); return; }
  if (!auth.currentUser || !chatBotId) return;
  try {
    const msgs = await getDocs(collection(db, 'botChats', `${auth.currentUser.uid}_${chatBotId}`, 'messages'));
    const batch = writeBatch(db);
    msgs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    chatMessages = [];
    renderChatMessages();
    if (!silent) showToast('Conversation cleared.', 'success');
  } catch (err) {
    if (!silent) showToast('Could not clear the conversation — try again.', 'error');
  }
}

export async function botChatSend(retryText = null) {
  const input = el('bot-chat-input');
  const text = (retryText !== null ? retryText : (input?.value || '')).trim();
  if (!text || chatSending || !chatBot) return;
  if (text.length > 2000) { showToast('Messages are limited to 2000 characters.', 'warning'); return; }
  if (input) input.value = '';

  const userMsg = { role: 'user', text, createdAt: new Date(), pending: true };
  chatMessages.push(userMsg);
  renderChatMessages();
  chatSending = true;
  renderChatMessages(true);

  try {
    const history = chatMessages
      .filter(m => !m.pending && !m.isError && m.role)
      .slice(-16)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'bot', text: m.text }));

    const { text: answer } = await sendBotChatMessage(chatBot, history, text);
    userMsg.pending = false;
    const botMsg = { role: 'bot', text: answer, createdAt: new Date() };
    lastFailedMessage = null;

    if (chatIsTest) {
      chatMessages.push(botMsg);
    } else {
      // persist both turns for this member's private history
      const col = collection(db, 'botChats', `${auth.currentUser.uid}_${chatBotId}`, 'messages');
      await addDoc(col, { role: 'user', text, createdAt: serverTimestamp() });
      await addDoc(col, { role: 'bot', text: answer, createdAt: serverTimestamp() });
    }
  } catch (err) {
    userMsg.pending = false;
    const msg = safeAiErrorMessage(err);
    chatMessages.push({ role: 'bot', text: msg, isError: true, createdAt: new Date() });
    lastFailedMessage = text;
    if (err instanceof AiUserError && /limit/i.test(msg)) { /* counters honest */ }
  } finally {
    chatSending = false;
    renderChatMessages();
  }
}

function renderChatMessages(typing = false) {
  const wrap = el('bot-chat-messages');
  if (!wrap) return;
  let html = '';
  const greeting = chatBot?.greetingMessage;
  if (chatMessages.length === 0 && greeting) {
    html += `<div class="bot-msg-row bot-msg-bot"><img class="bot-msg-avatar" src="${escapeHtml(botLogoUrl(chatBot))}" alt="" />
      <div class="bot-msg bot-msg-greet">${escapeHtml(greeting)}</div></div>`;
  }
  html += chatMessages.map(m => {
    if (m.role === 'user') {
      return `<div class="bot-msg-row bot-msg-user"><div class="bot-msg bot-msg-user-bubble">${escapeHtml(m.text)}</div></div>`;
    }
    return `<div class="bot-msg-row bot-msg-bot"><img class="bot-msg-avatar" src="${escapeHtml(botLogoUrl(chatBot))}" alt="" />
      <div class="bot-msg ${m.isError ? 'bot-msg-error' : ''}">${escapeHtml(m.text)}</div></div>`;
  }).join('');
  if (typing) {
    html += `<div class="bot-msg-row bot-msg-bot"><img class="bot-msg-avatar" src="${escapeHtml(botLogoUrl(chatBot))}" alt="" />
      <div class="bot-msg bot-msg-typing" aria-label="The bot is typing"><span></span><span></span><span></span></div></div>`;
  }
  if (chatMessages.length === 0 && !greeting && !typing) {
    html = `<div class="bot-chat-empty">Say hello — ${escapeHtml(chatBot?.name || 'this bot')} is listening.</div>`;
  }
  wrap.innerHTML = html;
  wrap.scrollTop = wrap.scrollHeight;
  const retryBtn = document.getElementById('bot-chat-retry');
  if (retryBtn) retryBtn.style.display = lastFailedMessage && !chatSending ? 'inline-flex' : 'none';
}

export function botChatRetry() {
  if (lastFailedMessage) botChatSend(lastFailedMessage);
}

/* ======================================================================
   PUBLIC BOT PROFILE (ratings, comments, sharing)
   ====================================================================== */

export function openBotProfile(botId) {
  if (!confirmDirtyLeave()) return;
  stopStudioPreview();
  closeChatView();
  closeProfileView();
  profileBotId = botId;

  state_currentView('bot-profile');
  showView('view-bot-profile');
  setActiveNav('nav-bots');

  const cached = findBotAnywhere(botId);
  if (cached) { profileBot = cached; renderProfile(); }

  if (profileUnsub) profileUnsub();
  profileUnsub = onSnapshot(doc(db, 'bots', botId), (snap) => {
    if (!snap.exists()) {
      showToast('That bot no longer exists.', 'warning');
      openBotsMarketplace();
      return;
    }
    profileBot = { id: snap.id, ...snap.data() };
    renderProfile();
  }, (err) => {
    showToast(err?.code === 'permission-denied'
      ? 'This bot is private — only its creator can open it.'
      : 'Could not open that bot.', 'error');
  });

  subscribeComments(botId);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeProfileView() {
  if (profileUnsub) { profileUnsub(); profileUnsub = null; }
  if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
  profileBotId = null; profileBot = null;
}

function renderProfileFromCache() {
  if (profileBotId && profileBot) renderProfile();
}

function renderProfile() {
  const bot = profileBot;
  if (!bot) return;
  const isPub = (bot.visibility || 'public') === 'public';

  const bg = el('botprof-bg');
  if (bg) bg.src = botPreviewUrl(bot);
  const logo = el('botprof-logo');
  if (logo) logo.src = botLogoUrl(bot);
  const name = el('botprof-name');
  if (name) name.textContent = bot.name || 'Unnamed bot';
  const creator = el('botprof-creator');
  if (creator) {
    const av = getAvatarUrl(null, bot.ownerDisplayName || bot.ownerUsername || 'Member');
    creator.innerHTML = `<img src="${av}" alt="" />
      <span>by <b>@${escapeHtml(bot.ownerUsername || bot.ownerDisplayName || 'member')}</b></span>`;
  }
  const badges = el('botprof-badges');
  if (badges) {
    const avg = ratingOf(bot);
    badges.innerHTML = `
      ${visibilityBadge(bot)}
      <span class="bp-badge bp-badge-cat">${escapeHtml(bot.category || 'Other')}</span>
      ${bot.ratingCount ? `<span class="bp-badge bp-badge-rating">★ ${avg.toFixed(1)} (${compact(bot.ratingCount)})</span>` : ''}
      <span class="bp-badge">${compact(bot.usageCount || 0)} uses</span>`;
  }
  const desc = el('botprof-desc');
  if (desc) desc.textContent = bot.description || bot.shortDescription || '';
  const useBtn = el('botprof-use');
  if (useBtn) {
    const usable = isPub || isOwner(bot);
    useBtn.style.display = usable ? 'inline-flex' : 'none';
    useBtn.onclick = () => openBotChat(bot.id);
  }
  const visNote = el('botprof-privnote');
  if (visNote) visNote.style.display = (!isPub && !isOwner(bot)) ? 'block' : 'none';

  // rating widget — one rating per member, editable
  const starWrap = el('botprof-stars');
  if (starWrap) {
    const summary = el('botprof-rating-summary');
    if (summary) {
      if (!isPub) { summary.textContent = 'Private bots do not take public ratings.'; }
      else if (!bot.ratingCount) { summary.textContent = 'No ratings yet — be the first!'; }
      else { summary.textContent = `${ratingOf(bot).toFixed(1)} average from ${bot.ratingCount} real rating${bot.ratingCount === 1 ? '' : 's'}`; }
    }
    if (isPub && auth.currentUser) {
      starWrap.style.display = 'inline-flex';
      getDoc(doc(db, 'botRatings', `${auth.currentUser.uid}_${bot.id}`)).then(s => {
        const mine = s.exists() ? s.data().stars : 0;
        paintStars(mine);
      }).catch(() => paintStars(0));
    } else {
      starWrap.style.display = 'none';
    }
  }

  const shareBtn = el('botprof-share');
  if (shareBtn) {
    shareBtn.style.display = isPub ? 'inline-flex' : 'none';
    shareBtn.onclick = () => shareBot(bot);
  }
  const editBtn = el('botprof-edit');
  if (editBtn) {
    editBtn.style.display = isOwner(bot) ? 'inline-flex' : 'none';
    editBtn.onclick = () => openBotStudio('update', bot.id);
  }

  renderRelatedBots(bot);
  renderProfileCommentsShell(bot);
}

function paintStars(active) {
  const starWrap = el('botprof-stars');
  if (!starWrap) return;
  starWrap.innerHTML = [1, 2, 3, 4, 5].map(n =>
    `<button type="button" class="botprof-star ${n <= active ? 'botprof-star-on' : ''}" data-star="${n}"
      aria-label="Rate ${n} star${n > 1 ? 's' : ''}" onclick="window.HubbleNest.botProfileRate(${n})">★</button>`).join('');
}

export async function botProfileRate(stars) {
  if (!profileBot || !auth.currentUser) return;
  if ((profileBot.visibility || 'public') !== 'public') return;
  if (!(stars >= 1 && stars <= 5)) return;
  try {
    const ratingId = `${auth.currentUser.uid}_${profileBot.id}`;
    const botRef = doc(db, 'bots', profileBot.id);
    const result = await runTransaction(db, async (tx) => {
      const botSnap = await tx.get(botRef);
      if (!botSnap.exists()) throw new Error('Bot is gone.');
      const d = botSnap.data();
      let sum = d.ratingSum || 0, count = d.ratingCount || 0;
      const existing = await tx.get(doc(db, 'botRatings', ratingId));
      if (existing.exists()) {
        const prev = existing.data().stars || 0;
        sum = sum - prev + stars;
      } else {
        sum = sum + stars;
        count = count + 1;
      }
      tx.set(doc(db, 'botRatings', ratingId), {
        uid: auth.currentUser.uid, botId: profileBot.id, stars, updatedAt: serverTimestamp()
      });
      tx.update(botRef, { ratingSum: sum, ratingCount: count });
      return { count };
    });
    paintStars(stars);
    const summary = el('botprof-rating-summary');
    if (summary) summary.textContent = `Thanks! Your ${stars}-star rating is counted (${result.count} total).`;
  } catch (err) {
    console.warn('[HubbleNest] rating failed:', err);
    showToast('Could not save your rating — try again.', 'error');
  }
}

/* ----- comments ----- */

function subscribeComments(botId) {
  if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
  commentsUnsub = onSnapshot(
    query(collection(db, 'botComments'), where('botId', '==', botId), limit(50)),
    (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      renderComments(rows);
    },
    (err) => console.warn('[HubbleNest] comments listener:', err?.code || err)
  );
}

function renderProfileCommentsShell(bot) {
  const composer = el('botprof-comment-composer');
  if (composer) {
    const isPub = (bot.visibility || 'public') === 'public';
    composer.style.display = isPub ? 'block' : 'none';
  }
}

function renderComments(rows) {
  const list = el('botprof-comments-list');
  const count = el('botprof-comments-count');
  if (count) count.textContent = String(rows.length);
  if (!list) return;
  if (rows.length === 0) {
    list.innerHTML = '<div class="bot-comments-empty">No reviews yet — start the conversation.</div>';
    return;
  }
  list.innerHTML = rows.map(c => {
    const mine = auth.currentUser && c.authorId === auth.currentUser.uid;
    const liked = auth.currentUser && Array.isArray(c.likedBy) && c.likedBy.includes(auth.currentUser.uid);
    const when = c.createdAt?.toDate ? formatTimeAgo(c.createdAt.toDate()) : '';
    return `<div class="bot-comment" id="bot-comment-${escapeHtml(c.id)}">
      <img class="bot-comment-avatar" src="${escapeHtml(c.authorPhoto || getAvatarUrl(null, c.authorName || 'Member'))}" alt="" />
      <div class="bot-comment-main">
        <div class="bot-comment-head">
          <b>${escapeHtml(c.authorName || 'Member')}</b>
          <span class="bot-comment-when">${escapeHtml(when)}</span>
          ${c.editedAt ? '<span class="bot-comment-edited">(edited)</span>' : ''}
        </div>
        <p class="bot-comment-text" id="bot-comment-text-${escapeHtml(c.id)}">${escapeHtml(c.text)}</p>
        <div class="bot-comment-actions">
          <button type="button" class="bot-comment-act ${liked ? 'bot-comment-liked' : ''}" onclick="window.HubbleNest.botProfileLikeComment('${escapeHtml(c.id)}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.5-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.5 4.04 3 5.5l7 7Z"/></svg>
            ${(c.likedBy || []).length || ''}
          </button>
          ${mine ? `<button type="button" class="bot-comment-act" onclick="window.HubbleNest.botProfileEditComment('${escapeHtml(c.id)}')">Edit</button>` : ''}
          ${mine ? `<button type="button" class="bot-comment-act" onclick="window.HubbleNest.botProfileDeleteComment('${escapeHtml(c.id)}')">Delete</button>` : ''}
          ${!mine && auth.currentUser ? `<button type="button" class="bot-comment-act" onclick="window.HubbleNest.botProfileReportComment('${escapeHtml(c.id)}')">Report</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

export async function botProfileSubmitComment() {
  const input = el('botprof-comment-input');
  const text = (input?.value || '').trim();
  if (!profileBot || !auth.currentUser) { showToast('Sign in to review this bot.', 'info'); return; }
  if ((profileBot.visibility || 'public') !== 'public') return;
  if (!text) { showToast('Write a short review first.', 'warning'); return; }
  if (text.length > 600) { showToast('Reviews are capped at 600 characters.', 'warning'); return; }
  try {
    const profile = window.HubbleNest?._state?.userProfile;
    await addDoc(collection(db, 'botComments'), {
      botId: profileBot.id,
      authorId: auth.currentUser.uid,
      authorName: profile?.displayName || profile?.username || 'Member',
      authorPhoto: profile?.photoURL || '',
      text,
      likedBy: [],
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'bots', profileBot.id), { commentCount: increment(1) });
    if (input) input.value = '';
    showToast('Review posted — thank you!', 'success');
  } catch (err) {
    console.warn('[HubbleNest] comment failed:', err);
    showToast('Could not post the review — try again.', 'error');
  }
}

export async function botProfileLikeComment(commentId) {
  if (!auth.currentUser) return;
  const ref = doc(db, 'botComments', commentId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const liked = (snap.data().likedBy || []).includes(auth.currentUser.uid);
    await updateDoc(ref, { likedBy: liked ? arrayRemove(auth.currentUser.uid) : arrayUnion(auth.currentUser.uid) });
  } catch (err) {
    showToast('Could not update that — try again.', 'error');
  }
}

export async function botProfileEditComment(commentId) {
  const textEl = el(`bot-comment-text-${commentId}`);
  if (!textEl) return;
  const current = textEl.textContent || '';
  const next = window.prompt('Edit your review (600 characters max):', current);
  if (next === null) return;
  const clean = next.trim();
  if (!clean || clean === current) return;
  if (clean.length > 600) { showToast('Reviews are capped at 600 characters.', 'warning'); return; }
  try {
    await updateDoc(doc(db, 'botComments', commentId), { text: clean, editedAt: serverTimestamp() });
  } catch (err) {
    showToast('Could not save the edit — try again.', 'error');
  }
}

export async function botProfileDeleteComment(commentId) {
  if (!window.confirm('Delete this review?')) return;
  try {
    await deleteDoc(doc(db, 'botComments', commentId));
    if (profileBot) await updateDoc(doc(db, 'bots', profileBot.id), { commentCount: increment(-1) });
  } catch (err) {
    showToast('Could not delete the review — try again.', 'error');
  }
}

export async function botProfileReportComment(commentId) {
  if (!auth.currentUser) return;
  try {
    await addDoc(collection(db, 'botReports'), {
      kind: 'comment', commentId, botId: profileBot?.id || '',
      reporterUid: auth.currentUser.uid,
      createdAt: serverTimestamp()
    });
    showToast('Report sent to the moderators. Thank you.', 'success');
  } catch (err) {
    showToast('Could not send the report — try again.', 'error');
  }
}

function renderRelatedBots(bot) {
  const wrap = el('botprof-related');
  if (!wrap) return;
  const cat = bot.category || 'Other';
  const related = publicBots
    .filter(b => b.id !== bot.id && (b.category || 'Other') === cat)
    .slice(0, 4);
  if (related.length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'grid';
  wrap.innerHTML = related.map(b => `
    <button type="button" class="bot-related-card" onclick="window.HubbleNest.openBotProfile('${escapeHtml(b.id)}')">
      <img src="${escapeHtml(botLogoUrl(b))}" alt="" />
      <div><b>${escapeHtml(b.name || 'Bot')}</b><span>${escapeHtml(b.shortDescription || '')}</span></div>
    </button>`).join('');
}

/* ======================================================================
   DEEP LINK (#bot=ID) — used by shared bot links
   ====================================================================== */

export function handleBotDeepLink() {
  const m = (window.location.hash || '').match(/^#bot=([A-Za-z0-9_-]+)/);
  if (m) {
    openBotProfile(m[1]);
    return true;
  }
  if (/^#bots\b/i.test(window.location.hash || '')) {
    openBotsMarketplace();
    return true;
  }
  return false;
}

/* ======================================================================
   CLEANUP (called on sign-out)
   ====================================================================== */

export function stopAllBotsActivity() {
  stopBotsListeners();
  closeChatView();
  closeProfileView();
}

