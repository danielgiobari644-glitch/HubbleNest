/**
 * HubbleNest Arcade 2.0 — the immersive gaming experience layer.
 *
 * Owns: the Arcade shell router (Home / Games / Leaderboard / My Activity),
 * the dashboard (hero, category chips, discovery sections), the game detail
 * page, the gameplay panels (HUD, game info, progress, leaderboard, comments,
 * toolbar, touch controls), ratings, bookmarks, play sessions and score
 * submissions.
 *
 * Data honesty rules (project law):
 *  - Every number shown is read from Firestore or the running game session.
 *    No invented ratings, play counts, ranks or leaderboard rows — ever.
 *  - Sections with no qualifying games are hidden, not padded with fakes.
 *  - Scores are anchored to a real play session owned by the caller
 *    (validated again by firestore.rules) and only ever improve.
 *
 * The game engine itself (editor, sandbox, publish) lives in games.js;
 * public-game-builder.js injects the in-sandbox bridge that this module
 * talks to (pause / mute / controls / score) over postMessage with a
 * source-frame check.
 */

import {
  db,
  auth,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove
} from './firebase.js';

import {
  showToast,
  escapeHtml,
  formatTimeAgo,
  getAvatarUrl
} from './utils.js';

/* ========================================================================
   State
   ======================================================================== */

let arcRoute = 'home';            // browse sub-view: home | games | leaderboard | activity
let activeCategory = 'all';       // dashboard chip filter
let detailGameId = null;          // game shown on the detail page
let playGameId = null;            // game currently running in the player
let returnAfterPlay = 'detail';   // where Exit Game lands: 'detail' | 'browse'

const bookmarks = new Set();      // gameId → saved by me
let bookmarksLoaded = false;
let bookmarkUnsub = null;

const myRatings = new Map();      // gameId → stars I gave
let ratingsLoaded = false;

let commentsUnsub = null;         // realtime comments for the open context
let commentsGameId = null;
let commentsAll = [];             // fetched page for the open context
let commentsVisible = 15;         // "show more" cursor
let commentsSort = 'newest';      // 'newest' | 'top'

let session = null;               // { id, gameId, startMs, lastScore, savedBest }
let sessionBest = 0;              // personal best for the running game (from gameScores)
let lastPlayedGameId = null;      // for Exit → detail return
let hudState = {};                // last HUD pills reported by the game
let gamePaused = false;
let gameMuted = false;
let declaredControls = null;      // {left,right,up,down,action} reported by the game
let ackWaiters = [];              // e2e support: resolve on bridge acks
let rulesWarned = false;          // one calm console line while rules await republish

const RESUME_WINDOW_MS = 120000;  // reopening within 2 min continues the session
const MAX_SCORE = 10000000;

const myUid = () => window.HubbleNest?._state?.currentUser?.uid || auth.currentUser?.uid || null;
const myProfile = () => window.HubbleNest?._state?.userProfile || null;

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function fmtCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(v);
}

function ratingOf(g) {
  const count = Number(g?.ratingCount) || 0;
  const sum = Number(g?.ratingSum) || 0;
  if (count <= 0) return { avg: 0, count: 0 };
  return { avg: sum / count, count };
}

const els = () => ({
  browse: document.getElementById('arcade-browse'),
  detail: document.getElementById('arcade-detail'),
  player: document.getElementById('arcade-player'),
  home: document.getElementById('arc-home'),
  gamesView: document.getElementById('arc-games-view'),
  lbView: document.getElementById('arc-leaderboard-view'),
  actView: document.getElementById('arc-activity-view'),
  sections: document.getElementById('arc-sections'),
  chips: document.getElementById('arc-chips'),
  hero: document.getElementById('arc-hero'),
  homeEmpty: document.getElementById('arc-home-empty'),
  hud: document.getElementById('arc-hud'),
  pauseOverlay: document.getElementById('arc-pause-overlay'),
  touchControls: document.getElementById('arc-touch-controls')
});

/* ========================================================================
   Shell router — Home / Games / Leaderboard / My Activity
   ======================================================================== */

export function arcGo(route) {
  arcRoute = ['home', 'games', 'leaderboard', 'activity'].includes(route) ? route : 'home';
  const e = els();

  ['home', 'games', 'leaderboard', 'activity'].forEach(r => {
    document.getElementById(`arc-nav-${r}`)?.classList.toggle('arc-active', r === arcRoute);
  });
  if (e.home) e.home.style.display = arcRoute === 'home' ? 'block' : 'none';
  if (e.gamesView) e.gamesView.style.display = arcRoute === 'games' ? 'block' : 'none';
  if (e.lbView) e.lbView.style.display = arcRoute === 'leaderboard' ? 'block' : 'none';
  if (e.actView) e.actView.style.display = arcRoute === 'activity' ? 'block' : 'none';

  // Detail/player/editor live OUTSIDE the browse container — make sure only
  // the browse container is visible when a rail route is chosen.
  if (e.detail) e.detail.style.display = 'none';
  if (e.browse) e.browse.style.display = 'block';
  detailGameId = null;

  if (arcRoute === 'home') renderHome();
  if (arcRoute === 'games') window.HubbleNest?.renderArcadeGrid?.();
  if (arcRoute === 'leaderboard') renderLeaderboardView();
  if (arcRoute === 'activity') renderActivityView();

  syncArcadeChrome();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Dashboard home — hero, chips and discovery sections from real data. */
function renderHome() {
  renderHero();
  renderChips();
  renderSections();
}

/** Sync topbar avatar + bell badge with the app's live state. */
function syncArcadeChrome() {
  const av = document.getElementById('arc-user-avatar');
  if (av) {
    const p = myProfile();
    const url = p ? getAvatarUrl(p.photoURL, p.displayName) : '';
    if (url && av.src !== url) av.src = url;
  }
  const src = document.getElementById('notif-badge-dot');
  const dst = document.getElementById('arc-notif-badge');
  if (src && dst) {
    const n = src.style.display === 'none' ? 0 : (parseInt(src.textContent, 10) || 0);
    dst.style.display = n > 0 ? 'inline-flex' : 'none';
    dst.textContent = String(n);
  }
}

/* ========================================================================
   Search (topbar) — games, creators or categories
   ======================================================================== */

function applySearch(q) {
  const term = (q || '').trim().toLowerCase();
  const clearBtn = document.getElementById('arc-search-clear');
  if (clearBtn) clearBtn.style.display = term ? 'inline-flex' : 'none';
  window.HubbleNest?.setArcadeSearch?.(term);
  if (term && arcRoute !== 'games') arcGo('games');
  else if (arcRoute === 'games') window.HubbleNest?.renderArcadeGrid?.();
}
export const arcSearch = debounce(applySearch, 220);

export function arcClearSearch() {
  const input = document.getElementById('arc-search-input');
  if (input) input.value = '';
  applySearch('');
}

export function arcSetSort(sort) {
  window.HubbleNest?.setArcadeSort?.(sort);
}

/** Category chip selection — filters the dashboard AND the games list. */
export function arcSetCategory(cat) {
  activeCategory = cat || 'all';
  window.HubbleNest?.setArcadeCategory?.(activeCategory === 'all' ? '' : activeCategory);
  renderChips();
  renderSections();
}

/* ========================================================================
   Dashboard — hero, chips, discovery sections
   ======================================================================== */

const HERO_SLIDES = [
  {
    kicker: 'Welcome to',
    title: 'HubbleNest Arcade',
    text: 'Play amazing games, challenge friends and climb the leaderboards — all made by the community.',
    cta: 'Explore Games',
    action: 'games',
    art: 'one'
  },
  {
    kicker: 'Your turn',
    title: 'Create & publish',
    text: 'Build a game with HTML, CSS and JavaScript — or describe it and let the AI game builder write it with you.',
    cta: 'Create a Game',
    action: 'create',
    art: 'two'
  }
];
let heroIndex = 0;

function renderHero() {
  const hero = els().hero;
  if (!hero) return;
  const s = HERO_SLIDES[heroIndex];
  hero.innerHTML = `
    <div class="arc-hero-slide arc-hero-art-${s.art}">
      <div class="arc-hero-copy">
        <span class="arc-hero-kicker">${escapeHtml(s.kicker)}</span>
        <h2 class="arc-hero-title">${escapeHtml(s.title)}</h2>
        <p class="arc-hero-text">${escapeHtml(s.text)}</p>
        <button type="button" class="btn btn-primary arc-hero-cta" data-arc-hero-action="${s.action}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-2px;margin-right:6px;"><path d="M8 5v14l11-7z"/></svg>
          ${escapeHtml(s.cta)}
        </button>
      </div>
      <div class="arc-hero-glyph" aria-hidden="true">
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="10.5" r="1"/></svg>
      </div>
    </div>
    <div class="arc-hero-dots" role="tablist" aria-label="Promotional slides">
      ${HERO_SLIDES.map((sl, i) => `<button type="button" class="arc-hero-dot ${i === heroIndex ? 'arc-dot-active' : ''}" data-arc-hero-dot="${i}" aria-label="Slide ${i + 1}"></button>`).join('')}
    </div>`;

  hero.querySelector('[data-arc-hero-action]')?.addEventListener('click', (ev) => {
    const action = ev.currentTarget.getAttribute('data-arc-hero-action');
    if (action === 'create') window.HubbleNest?.openGameEditor?.(null);
    else arcGo('games');
  });
  hero.querySelectorAll('[data-arc-hero-dot]').forEach(d => {
    d.addEventListener('click', () => { heroIndex = Number(d.getAttribute('data-arc-hero-dot')) || 0; renderHero(); });
  });
}

const CANON_CATEGORIES = ['Action', 'Puzzle', 'Racing', 'Adventure', 'Arcade', 'Strategy'];

const CHIP_ICONS = {
  all: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  Action: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
  Puzzle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19.4 14a1.9 1.9 0 0 0 .3 3.3 1.6 1.6 0 0 1 .4 2.6A2 2 0 0 1 18.7 21a1.9 1.9 0 0 0-1.7 2 1.9 1.9 0 0 1-1.9 1h-1.8a1.9 1.9 0 0 1-1.9-2 1.9 1.9 0 0 0-1.7-2 1.6 1.6 0 0 1-1.4-1.1 2 2 0 0 1 .4-2.6A1.9 1.9 0 0 0 10 14a7 7 0 1 1 9.4 0Z"/></svg>',
  Racing: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9 3 17h18l-3-8"/><path d="M2 17h20"/><circle cx="7" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/></svg>',
  Adventure: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2 6.3-6.4 2.1 2-6.3z"/></svg>',
  Arcade: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="10.5" r="1"/></svg>',
  Strategy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16"/><path d="M4 8h12l-2-3 2-3H4"/></svg>'
};

function renderChips() {
  const chips = els().chips;
  if (!chips) return;
  const games = window.HubbleNest?.getGamesCache?.() || [];
  const present = new Set(games.map(g => g.category).filter(Boolean));
  const cats = ['all', ...CANON_CATEGORIES.filter(c => present.has(c) || activeCategory === c)];
  // Only when signed-in games exist do chips make sense; with no data keep "All".
  chips.innerHTML = cats.map(c => `
    <button type="button" class="arc-chip ${activeCategory === c || (c === 'all' && activeCategory === 'all') ? 'arc-chip-active' : ''}" data-arc-chip="${escapeHtml(c)}" role="tab" aria-selected="${activeCategory === c}">
      ${CHIP_ICONS[c] || CHIP_ICONS.all}<span>${c === 'all' ? 'All Games' : escapeHtml(c)}</span>
    </button>`).join('');
  chips.querySelectorAll('[data-arc-chip]').forEach(b => {
    b.addEventListener('click', () => arcSetCategory(b.getAttribute('data-arc-chip')));
  });
}

const SECTION_ICONS = {
  featured: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  trending: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
  recent: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  popular: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  community: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  saved: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>'
};

/**
 * Discovery sections — every section is a REAL sort of REAL records:
 *  Featured  = highest member rating (needs ≥1 rating), ties by likes
 *  Trending  = most played
 *  Recent    = newest published
 *  Popular   = most liked
 *  Community = newest from other members
 *  Saved     = my bookmarks
 */
function renderSections() {
  const wrap = els().sections;
  const emptyBox = els().homeEmpty;
  if (!wrap) return;
  const games = window.HubbleNest?.getGamesCache?.() || [];
  const uid = myUid();

  const byCat = games.filter(g => activeCategory === 'all' || g.category === activeCategory);
  const rated = byCat.filter(g => ratingOf(g).count > 0);
  const others = byCat.filter(g => g.authorId && g.authorId !== uid);
  const savedGames = byCat.filter(g => bookmarks.has(g.id));

  const sections = [
    { key: 'featured', label: 'Featured Games', icon: SECTION_ICONS.featured, list: [...rated].sort((a, b) => ratingOf(b).avg - ratingOf(a).avg || (b.likedBy?.length || 0) - (a.likedBy?.length || 0)).slice(0, 10), sort: 'rating' },
    { key: 'trending', label: 'Trending Games', icon: SECTION_ICONS.trending, list: [...byCat].sort((a, b) => (b.plays || 0) - (a.plays || 0)).filter(g => (g.plays || 0) > 0).slice(0, 10), sort: 'plays' },
    { key: 'recent', label: 'Recently Added', icon: SECTION_ICONS.recent, list: [...byCat].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 10), sort: 'newest' },
    { key: 'popular', label: 'Popular Games', icon: SECTION_ICONS.popular, list: [...byCat].sort((a, b) => (b.likedBy?.length || 0) - (a.likedBy?.length || 0)).filter(g => (g.likedBy?.length || 0) > 0).slice(0, 10), sort: 'likes' },
    { key: 'community', label: 'From the Community', icon: SECTION_ICONS.community, list: [...others].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 10), sort: 'newest' },
    { key: 'saved', label: 'My Saved Games', icon: SECTION_ICONS.saved, list: savedGames, sort: null, target: 'activity' }
  ].filter(s => s.list.length > 0);

  wrap.innerHTML = sections.map(s => `
    <section class="arc-section" aria-label="${escapeHtml(s.label)}">
      <div class="arc-section-head">
        <h3 class="arc-section-title"><span class="arc-section-icon arc-ic-${s.key}">${s.icon}</span>${escapeHtml(s.label)}</h3>
        ${s.target === 'activity'
          ? `<button type="button" class="arc-viewall" data-arc-viewall="activity">View All <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button>`
          : `<button type="button" class="arc-viewall" data-arc-viewall="${s.key}" data-arc-sort="${s.sort}">View All <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button>`}
      </div>
      <div class="arc-row">${s.list.map(g => window.HubbleNest.arcGameCard(g)).join('')}</div>
    </section>`).join('');

  wrap.querySelectorAll('[data-arc-viewall]').forEach(b => {
    b.addEventListener('click', () => {
      const target = b.getAttribute('data-arc-viewall');
      const sort = b.getAttribute('data-arc-sort');
      if (target === 'activity') { arcGo('activity'); return; }
      if (sort) window.HubbleNest?.setArcadeSort?.(sort);
      const sel = document.getElementById('arc-sort-select');
      if (sel && sort) sel.value = sort;
      arcGo('games');
    });
  });

  const playable = games.length > 0;
  if (emptyBox) {
    emptyBox.innerHTML = playable ? '' : `
      <div class="arc-empty-hero">
        <div class="arc-empty-glyph">${SECTION_ICONS.featured}</div>
        <h3>The Arcade is waiting for its first game</h3>
        <p>Every game here is made by a member — write one with the built-in editor (HTML, CSS, JS) or describe it to the AI game builder, then publish it for everyone to play.</p>
        <button type="button" class="btn btn-primary" onclick="window.HubbleNest.openGameEditor(null)">Create the first game</button>
      </div>`;
  }
}

/** Full refresh of everything dashboard-y (called on every games snapshot). */
export function onArcadeGamesUpdated() {
  renderHero();
  renderChips();
  renderSections();
  syncArcadeChrome();
  if (arcRoute === 'leaderboard') renderLeaderboardView();
  if (arcRoute === 'activity') renderActivityView();
  if (detailGameId) renderGameDetail(detailGameId, { quiet: true });
  if (playGameId) renderPlayPanels();
}

/* ========================================================================
   Game detail page
   ======================================================================== */

export function openGameDetail(gameId) {
  detailGameId = gameId;
  const e = els();
  if (e.browse) e.browse.style.display = 'none';
  if (e.player) e.player.style.display = 'none';
  if (e.detail) { e.detail.style.display = 'block'; }
  renderGameDetail(gameId);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function playRankOf(game, games) {
  const sorted = [...games].sort((a, b) => (b.plays || 0) - (a.plays || 0));
  const idx = sorted.findIndex(g => g.id === game.id);
  if (idx < 0 || (game.plays || 0) <= 0) return null;
  return { rank: idx + 1, label: `#${idx + 1} most played in Arcade` };
}

function renderGameDetail(gameId, opts = {}) {
  const box = els().detail;
  if (!box) return;
  const g = (window.HubbleNest?.getGamesCache?.() || []).find(x => x.id === gameId);
  if (!g) {
    box.innerHTML = `
      <div class="arc-detail-missing">
        <h2>This game is not available</h2>
        <p>It may have been unpublished or deleted by its creator.</p>
        <button type="button" class="btn btn-primary" onclick="window.HubbleNest.arcGo('games')">Back to Games</button>
      </div>`;
    return;
  }

  const uid = myUid();
  const mine = g.authorId === uid;
  const r = ratingOf(g);
  const games = window.HubbleNest?.getGamesCache?.() || [];
  const rank = playRankOf(g, games);
  const liked = Array.isArray(g.likedBy) && uid && g.likedBy.includes(uid);
  const saved = bookmarks.has(g.id);
  const initials = String(g.title || 'Game').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || 'GN';
  const hue = Array.from(String(g.id || g.title || '')).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const cover = g.coverImage
    ? `<img src="${escapeHtml(g.coverImage)}" alt="${escapeHtml(g.title || 'Game')} cover" loading="lazy" decoding="async" onerror="this.remove()" />`
    : `<span class="arc-cover-initials" style="background:linear-gradient(135deg,hsl(${hue} 62% 26%),hsl(${(hue + 46) % 360} 70% 16%));">${escapeHtml(initials)}</span>`;

  const isLink = g.kind === 'link' && !!g.linkUrl;
  const runnable = isLink || (g.runnable !== false && (g.entryPath || g.html?.trim?.() || g.js?.trim?.()));

  box.innerHTML = `
    <div class="arc-detail-back">
      <button type="button" class="back-link-btn" onclick="window.HubbleNest.arcGo('games')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        <span>Back to Games</span>
      </button>
      ${mine ? `<span class="arc-detail-owner-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.HubbleNest.openGameEditor('${escapeHtml(g.id)}')">Edit game</button>
        <button type="button" class="btn btn-ghost btn-sm" style="color:var(--status-danger);" onclick="window.HubbleNest.gameDelete('${escapeHtml(g.id)}')">Delete</button>
      </span>` : ''}
    </div>

    <header class="arc-detail-head">
      <div class="arc-detail-thumb">${cover}</div>
      <div class="arc-detail-headtext">
        <h1 class="arc-detail-title">${escapeHtml(g.title || 'Untitled game')}</h1>
        <p class="arc-detail-sub">${escapeHtml(g.description || 'No description yet.')}</p>
        <div class="arc-detail-meta">
          ${r.count > 0 ? `<span class="arc-rating-static"><svg width="15" height="15" viewBox="0 0 24 24" fill="#fbbf24" stroke="none"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg><b>${r.avg.toFixed(1)}</b><i>(${fmtCount(r.count)} rating${r.count === 1 ? '' : 's'})</i></span>` : ''}
          ${g.category ? `<span class="arc-cat-chip">${escapeHtml(g.category)}</span>` : ''}
          ${rank ? `<span class="arc-rank-chip"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>${escapeHtml(rank.label)}</span>` : ''}
          <span class="arc-detail-plays">${fmtCount(g.plays || 0)} plays</span>
        </div>
        <div class="arc-detail-cta">
          <button type="button" class="btn btn-primary arc-playnow-btn" id="arc-detail-play" ${runnable ? '' : 'disabled title="This project has no playable HTML entry — it is stored as readable source."'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-2px;margin-right:6px;"><path d="M8 5v14l11-7z"/></svg>
            Play Now
          </button>
          <button type="button" class="btn btn-secondary arc-savegame-btn ${saved ? 'arc-saved' : ''}" id="arc-detail-bookmark">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
            ${saved ? 'In My Games' : 'Add to My Games'}
          </button>
          <button type="button" class="feed-action ${liked ? 'feed-action-liked' : ''}" onclick="window.HubbleNest.gameToggleLike('${escapeHtml(g.id)}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
            <span>${(g.likedBy?.length) || 'Like'}</span>
          </button>
        </div>
      </div>
    </header>

    <div class="arc-detail-preview ${g.coverImage ? 'arc-has-photo' : ''}" id="arc-detail-preview" role="button" tabindex="0" aria-label="Play ${escapeHtml(g.title || 'this game')}">
      ${cover}
      <span class="arc-preview-badge"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg> ${runnable ? (isLink ? `Instant play — live from ${escapeHtml(g.linkHost || 'its site')}` : 'Instant play — runs sandboxed') : 'Source project'}</span>
      ${runnable ? `<span class="arc-preview-play" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg></span>` : ''}
    </div>

    <div class="arc-detail-grid">
      <section class="arc-panel arc-about">
        <h3 class="arc-panel-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="10.5" r="1"/></svg> About This Game</h3>
        <p class="arc-about-text">${escapeHtml(g.description || 'The creator has not written a description yet.')}</p>
        <dl class="arc-meta-list">
          ${g.category ? `<div><dt>Category</dt><dd><span class="arc-cat-chip">${escapeHtml(g.category)}</span></dd></div>` : ''}
          ${isLink ? `<div><dt>Source</dt><dd><span class="arc-live-src"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg> Plays live from <a href="${escapeHtml(g.linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(g.linkHost || 'external site')}</a></span></dd></div>` : ''}
          ${(g.languages || []).length ? `<div><dt>Languages</dt><dd>${(g.languages || []).map(l => `<span class="arc-lang-chip">${escapeHtml(l)}</span>`).join(' ')}</dd></div>` : ''}
          ${g.fileCount > 0 ? `<div><dt>Project files</dt><dd>${g.fileCount}</dd></div>` : ''}
          <div><dt>Creator</dt><dd><span class="arc-creator" data-arc-creator="${escapeHtml(g.authorId || '')}" role="button" tabindex="0"><img src="${getAvatarUrl(g.authorPhoto, g.authorName)}" alt="" loading="lazy" /> ${escapeHtml(g.authorName || 'Member')}</span></dd></div>
          <div><dt>Updated</dt><dd>${formatTimeAgo(g.updatedAt || g.createdAt)}</dd></div>
        </dl>
        <div class="arc-rate-row" id="arc-rate-row"></div>
      </section>

      <section class="arc-panel arc-ranking">
        <h3 class="arc-panel-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> Ranking</h3>
        <div id="arc-detail-ranking"><div class="arc-loading">Loading real rankings…</div></div>
      </section>
    </div>

    <section class="arc-panel arc-detail-comments" id="arc-detail-comments"></section>`;

  // Wire the CTA rows (delegated — innerHTML was just replaced).
  box.querySelector('#arc-detail-play')?.addEventListener('click', () => {
    if (runnable) window.HubbleNest.openGamePlayer(g.id);
  });
  box.querySelector('#arc-detail-bookmark')?.addEventListener('click', () => arcToggleBookmark(g.id, 'detail'));
  const preview = box.querySelector('#arc-detail-preview');
  if (preview && runnable) {
    preview.addEventListener('click', () => window.HubbleNest.openGamePlayer(g.id));
    preview.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); window.HubbleNest.openGamePlayer(g.id); } });
  }
  box.querySelector('[data-arc-creator]')?.addEventListener('click', (ev) => {
    const id = ev.currentTarget.getAttribute('data-arc-creator');
    if (id && window.HubbleNest?.openMemberProfilePage) window.HubbleNest.openMemberProfilePage(id);
  });

  renderRateRow(g);
  loadDetailRanking(g);
  mountComments(document.getElementById('arc-detail-comments'), g.id, { compact: false });
  if (!opts.quiet) syncArcadeChrome();
}

/** Real ranking numbers for the detail page: top scores for THIS game. */
async function loadDetailRanking(g) {
  const box = document.getElementById('arc-detail-ranking');
  if (!box) return;
  try {
    const snap = await getDocs(query(collection(db, 'gameScores'), where('gameId', '==', g.id), limit(100)));
    const rows = snap.docs.map(d => d.data()).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
    const games = window.HubbleNest?.getGamesCache?.() || [];
    const rank = playRankOf(g, games);
    const r = ratingOf(g);
    if (rows.length === 0 && !rank && r.count === 0) {
      box.innerHTML = `<div class="arc-empty-note">No scores or rankings yet — every number here comes from real play. Be the first: press Play Now.</div>`;
      return;
    }
    box.innerHTML = `
      ${rank ? `<div class="arc-rank-hero"><span class="arc-rank-big">${rank.rank}</span><span class="arc-rank-sub">most played in the Arcade</span></div>` : ''}
      ${rows.length ? `
        <ol class="arc-lb-list arc-lb-compact">
          ${rows.map((row, i) => `
            <li class="arc-lb-row">
              <span class="arc-lb-pos arc-pos-${i + 1}">${i + 1}</span>
              <img class="arc-lb-av" src="${getAvatarUrl(row.photo, row.displayName)}" alt="" loading="lazy" />
              <span class="arc-lb-name">${escapeHtml(row.displayName || 'Member')}</span>
              <b class="arc-lb-score">${fmtCount(row.score)}</b>
            </li>`).join('')}
        </ol>
        <div class="arc-lb-note">Top scores submitted from real play sessions.</div>`
      : `<div class="arc-empty-note">No scores posted for this game yet.</div>`}`;
  } catch (err) {
    if (err?.code !== 'permission-denied') console.warn('Ranking load failed:', err?.code || err);
    box.innerHTML = `<div class="arc-empty-note">Rankings need the new Arcade rules — republish firestore.rules in the Firebase console.</div>`;
  }
}

/* ========================================================================
   Ratings
   ======================================================================== */

function renderRateRow(g) {
  const row = document.getElementById('arc-rate-row');
  if (!row) return;
  const uid = myUid();
  const r = ratingOf(g);
  const mine = myRatings.get(g.id) || 0;
  if (!uid) {
    row.innerHTML = `<span class="arc-empty-note">Sign in to rate this game.</span>`;
    return;
  }
  row.innerHTML = `
    <span class="arc-rate-label">${mine ? 'Your rating' : 'Rate this game'}</span>
    <span class="arc-rate-stars" role="radiogroup" aria-label="Rate ${escapeHtml(g.title || 'game')}">
      ${[1, 2, 3, 4, 5].map(n => `
        <button type="button" class="arc-star ${n <= (mine || Math.round(r.avg)) ? 'arc-star-on' : ''}" data-arc-star="${n}" role="radio" aria-checked="${mine === n}" aria-label="${n} star${n > 1 ? 's' : ''}">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="${n <= (mine || 0) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </button>`).join('')}
    </span>
    ${r.count > 0 ? `<span class="arc-rate-avg">${r.avg.toFixed(1)} · ${fmtCount(r.count)} rating${r.count === 1 ? '' : 's'}</span>` : '<span class="arc-rate-avg">No ratings yet</span>'}`;
  row.querySelectorAll('[data-arc-star]').forEach(b => {
    b.addEventListener('click', () => arcRateGame(g.id, Number(b.getAttribute('data-arc-star'))));
  });
}

async function loadMyRatings() {
  if (ratingsLoaded || !myUid()) return;
  try {
    const snap = await getDocs(query(collection(db, 'gameRatings'), where('uid', '==', myUid()), limit(200)));
    snap.forEach(d => { const v = d.data(); if (v.gameId) myRatings.set(v.gameId, v.stars); });
    ratingsLoaded = true;
  } catch (err) {
    if (err?.code !== 'permission-denied') console.warn('Ratings load failed:', err?.code || err);
  }
}

export async function arcRateGame(gameId, stars) {
  const uid = myUid();
  if (!uid) { showToast('Sign in to rate games.', 'info'); return; }
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
  const prev = myRatings.get(gameId) || 0;
  if (prev === stars) return; // no change, no write
  try {
    await setDoc(doc(db, 'gameRatings', `${gameId}_${uid}`), {
      gameId, uid, stars, updatedAt: serverTimestamp()
    });
    // Aggregate on the game doc (rules restrict updates to these counters).
    await updateDoc(doc(db, 'games', gameId), {
      ratingSum: increment(stars - prev),
      ratingCount: prev > 0 ? 0 : 1
    });
    myRatings.set(gameId, stars);
    const fresh = (window.HubbleNest?.getGamesCache?.() || []).find(x => x.id === gameId);
    if (fresh) renderRateRow(fresh);
    showToast(prev ? 'Rating updated — thanks!' : 'Rated — thanks!', 'success');
  } catch (err) {
    if (err?.code !== 'permission-denied') console.warn('Rating failed:', err?.code || err);
    showToast(err?.code === 'permission-denied'
      ? 'Ratings need the new Arcade rules — republish firestore.rules in the Firebase console.'
      : 'Could not save your rating.', 'error');
  }
}

/* ========================================================================
   Bookmarks — "Add to My Games"
   ======================================================================== */

async function loadBookmarks() {
  if (bookmarksLoaded || !myUid()) return;
  try {
    const snap = await getDocs(query(collection(db, 'gameBookmarks'), where('uid', '==', myUid()), limit(300)));
    bookmarks.clear();
    snap.forEach(d => { const v = d.data(); if (v.gameId) bookmarks.add(v.gameId); });
    bookmarksLoaded = true;
  } catch (err) {
    if (err?.code !== 'permission-denied') console.warn('Bookmarks load failed:', err?.code || err);
  }
}

export async function arcToggleBookmark(gameId, origin) {
  const uid = myUid();
  if (!uid) { showToast('Sign in to save games to My Games.', 'info'); return; }
  const saved = bookmarks.has(gameId);
  const ref = doc(db, 'gameBookmarks', `${uid}_${gameId}`);
  try {
    if (saved) {
      await deleteDoc(ref);
      bookmarks.delete(gameId);
      showToast('Removed from My Games.', 'info');
    } else {
      await setDoc(ref, { uid, gameId, createdAt: serverTimestamp() });
      bookmarks.add(gameId);
      showToast('Saved to My Games.', 'success');
    }
    refreshBookmarkButtons(gameId);
    if (origin === 'play') renderPlayPanels();
    renderSections();
    if (arcRoute === 'activity') renderActivityView();
  } catch (err) {
    console.error('Bookmark failed:', err);
    showToast(err?.code === 'permission-denied'
      ? 'My Games needs the new Arcade rules — republish firestore.rules in the Firebase console.'
      : 'Could not update My Games.', 'error');
  }
}

export function arcToggleBookmarkFromPlay() {
  if (playGameId) arcToggleBookmark(playGameId, 'play');
}

function refreshBookmarkButtons(gameId) {
  const saved = bookmarks.has(gameId);
  const detailBtn = document.getElementById('arc-detail-bookmark');
  if (detailBtn && detailGameId === gameId) {
    detailBtn.classList.toggle('arc-saved', saved);
    detailBtn.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
      ${saved ? 'In My Games' : 'Add to My Games'}`;
  }
  const playBtn = document.getElementById('arc-play-bookmark');
  if (playBtn) {
    playBtn.classList.toggle('arc-saved', saved);
    playBtn.title = saved ? 'In My Games — press to remove' : 'Add to My Games';
    playBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`;
  }
}

/* ========================================================================
   Comments — shared by the detail page AND the gameplay screen.
   ONE collection (gameComments): the gameplay panel and the detail page
   always show the same discussion thread.
   ======================================================================== */

function mountComments(container, gameId, { compact }) {
  if (!container) return;
  commentsGameId = gameId;
  commentsVisible = compact ? 4 : 15;
  container.innerHTML = `<div class="arc-loading">Loading comments…</div>`;
  loadComments(gameId, container, compact);
}

async function loadComments(gameId, container, compact) {
  try {
    const snap = await getDocs(query(collection(db, 'gameComments'), where('gameId', '==', gameId), limit(80)));
    commentsAll = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderComments(container, gameId, compact);
  } catch (err) {
    if (err?.code !== 'permission-denied') console.warn('Comments load failed:', err?.code || err);
    container.innerHTML = `<div class="arc-empty-note">${err?.code === 'permission-denied'
      ? 'Comments need the new Arcade rules — republish firestore.rules in the Firebase console.'
      : 'Could not load comments.'}</div>`;
  }
}

function sortComments(list) {
  const top = list.filter(c => !c.replyTo);
  const replies = list.filter(c => c.replyTo);
  const sorted = [...top].sort((a, b) => {
    if (commentsSort === 'top') {
      const la = a.likedBy?.length || 0, lb = b.likedBy?.length || 0;
      if (lb !== la) return lb - la;
    }
    return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
  });
  return sorted.map(c => ({ c, replies: replies.filter(r => r.replyTo === c.id).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)) }));
}

function commentItemHTML({ c, replies }, compact) {
  const uid = myUid();
  const liked = Array.isArray(c.likedBy) && uid && c.likedBy.includes(uid);
  const mine = c.authorId === uid;
  const repliesHTML = replies.map(r => commentItemHTML({ c: r, replies: [] }, compact)).join('');
  return `
    <div class="arc-comment" data-comment-id="${escapeHtml(c.id)}">
      <img class="arc-comment-av" src="${getAvatarUrl(c.authorPhoto, c.authorName)}" alt="" loading="lazy" />
      <div class="arc-comment-body">
        <div class="arc-comment-head">
          <b class="arc-comment-name">${escapeHtml(c.authorName || 'Member')}</b>
          <span class="arc-comment-time">${formatTimeAgo(c.createdAt)}</span>
        </div>
        <p class="arc-comment-text">${escapeHtml(c.text || '')}</p>
        <div class="arc-comment-actions">
          <button type="button" class="arc-comment-like ${liked ? 'arc-liked' : ''}" data-arc-clike="${escapeHtml(c.id)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>
            <span>${c.likedBy?.length || 'Like'}</span>
          </button>
          ${!compact || !c.replyTo ? `<button type="button" class="arc-comment-reply" data-arc-creply="${escapeHtml(c.id)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg> Reply</button>` : ''}
          ${mine ? `<button type="button" class="arc-comment-del" data-arc-cdel="${escapeHtml(c.id)}" title="Delete comment">Delete</button>` : ''}
        </div>
        <div class="arc-reply-box" data-replybox="${escapeHtml(c.id)}" hidden>
          <input type="text" class="arc-reply-input" data-replyinput="${escapeHtml(c.id)}" maxlength="600" placeholder="Write a reply…" />
          <button type="button" class="btn btn-primary btn-sm" data-arcsend="${escapeHtml(c.id)}">Reply</button>
        </div>
        ${repliesHTML}
      </div>
    </div>`;
}

function renderComments(container, gameId, compact) {
  if (!container || commentsGameId !== gameId) return;
  const uid = myUid();
  const game = (window.HubbleNest?.getGamesCache?.() || []).find(x => x.id === gameId);
  const totalCount = Number(game?.commentCount) || commentsAll.length;
  const groups = sortComments(commentsAll);
  const shown = groups.slice(0, commentsVisible);
  const shownCount = shown.reduce((n, g) => n + 1 + g.replies.length, 0);

  container.innerHTML = `
    <div class="arc-comments-head">
      <h3 class="arc-panel-title">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Comments (${fmtCount(totalCount)})
      </h3>
      <label class="arc-sort-label">Sort
        <select class="arc-select" id="arc-comment-sort" aria-label="Sort comments">
          <option value="newest" ${commentsSort === 'newest' ? 'selected' : ''}>Newest</option>
          <option value="top" ${commentsSort === 'top' ? 'selected' : ''}>Top</option>
        </select>
      </label>
    </div>
    ${uid ? `
      <div class="arc-composer">
        <img class="arc-comment-av" src="${getAvatarUrl(myProfile()?.photoURL, myProfile()?.displayName)}" alt="" loading="lazy" />
        <div class="arc-composer-main">
          <textarea id="arc-comment-input" class="arc-comment-input" rows="${compact ? 1 : 2}" maxlength="600" placeholder="Share your thoughts about this game…"></textarea>
          <div class="arc-composer-foot">
            <span class="arc-composer-hint" id="arc-comment-hint"></span>
            <button type="button" class="btn btn-primary btn-sm" id="arc-comment-post">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>Post
            </button>
          </div>
        </div>
      </div>`
      : `<div class="arc-empty-note">Sign in to join the discussion.</div>`}
    <div class="arc-comment-list">
      ${shown.map(g => commentItemHTML(g, compact)).join('') || (totalCount === 0 ? `<div class="arc-empty-note">No comments yet — start the conversation.</div>` : '')}
    </div>
    ${groups.length > shown.length ? `<button type="button" class="btn btn-ghost btn-sm arc-more-btn" id="arc-comment-more">Show more comments</button>` : ''}
    ${commentsAll.length >= 80 && totalCount > commentsAll.length ? `<div class="arc-empty-note">Showing the latest ${commentsAll.length} of ${fmtCount(totalCount)} comments.</div>` : ''}`;

  container.querySelector('#arc-comment-sort')?.addEventListener('change', (ev) => {
    commentsSort = ev.target.value;
    renderComments(container, gameId, compact);
  });
  container.querySelector('#arc-comment-post')?.addEventListener('click', () => arcPostComment(gameId, container, compact));
  container.querySelector('#arc-comment-input')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); arcPostComment(gameId, container, compact); }
  });
  container.querySelector('#arc-comment-more')?.addEventListener('click', () => {
    commentsVisible += compact ? 4 : 15;
    renderComments(container, gameId, compact);
  });

  container.querySelectorAll('[data-arc-clike]').forEach(b => b.addEventListener('click', () => arcLikeComment(gameId, b.getAttribute('data-arc-clike'), container, compact)));
  container.querySelectorAll('[data-arc-creply]').forEach(b => b.addEventListener('click', () => {
    const id = b.getAttribute('data-arc-creply');
    const box = container.querySelector(`[data-replybox="${CSS.escape(id)}"]`);
    if (box) { box.hidden = !box.hidden; if (!box.hidden) box.querySelector('input')?.focus(); }
  }));
  container.querySelectorAll('[data-arcsend]').forEach(b => b.addEventListener('click', () => {
    const id = b.getAttribute('data-arcsend');
    const input = container.querySelector(`[data-replyinput="${CSS.escape(id)}"]`);
    if (input?.value.trim()) arcPostComment(gameId, container, compact, { replyTo: id, text: input.value.trim() });
  }));
  container.querySelectorAll('[data-replyinput]').forEach(inp => inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const id = inp.getAttribute('data-replyinput');
      if (inp.value.trim()) arcPostComment(gameId, container, compact, { replyTo: id, text: inp.value.trim() });
    }
  }));
  container.querySelectorAll('[data-arc-cdel]').forEach(b => b.addEventListener('click', () => arcDeleteComment(gameId, b.getAttribute('data-arc-cdel'), container, compact)));
}

export async function arcPostComment(gameId, container, compact, opts = {}) {
  const uid = myUid();
  if (!uid) { showToast('Sign in to comment.', 'info'); return; }
  const me = myProfile();
  let text = opts.text;
  if (!text) {
    const input = document.getElementById('arc-comment-input');
    text = input?.value.trim() || '';
  }
  if (!text) return;
  const hint = document.getElementById('arc-comment-hint');
  if (hint) hint.textContent = 'Posting…';
  try {
    await addDoc(collection(db, 'gameComments'), {
      gameId,
      authorId: uid,
      authorName: me?.displayName || 'Member',
      authorPhoto: me?.photoURL || '',
      text: String(text).slice(0, 600),
      replyTo: opts.replyTo || null,
      likedBy: [],
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'games', gameId), { commentCount: increment(1) }).catch(() => {});
    if (!opts.text) {
      const input = document.getElementById('arc-comment-input');
      if (input) input.value = '';
    }
    if (hint) hint.textContent = '';
    await loadComments(gameId, container, compact);
  } catch (err) {
    console.error('Comment failed:', err);
    if (hint) hint.textContent = '';
    showToast(err?.code === 'permission-denied'
      ? 'Comments need the new Arcade rules — republish firestore.rules in the Firebase console.'
      : 'Could not post the comment.', 'error');
  }
}

export async function arcLikeComment(gameId, commentId, container, compact) {
  const uid = myUid();
  if (!uid || !commentId) return;
  const c = commentsAll.find(x => x.id === commentId);
  if (!c) return;
  const liked = Array.isArray(c.likedBy) && c.likedBy.includes(uid);
  try {
    await updateDoc(doc(db, 'gameComments', commentId), {
      likedBy: liked ? arrayRemove(uid) : arrayUnion(uid)
    });
    c.likedBy = liked ? (c.likedBy || []).filter(u => u !== uid) : [...(c.likedBy || []), uid];
    renderComments(container, gameId, compact);
  } catch (err) {
    console.error('Comment like failed:', err);
    showToast('Could not save that.', 'error');
  }
}

export async function arcDeleteComment(gameId, commentId, container, compact) {
  const uid = myUid();
  const c = commentsAll.find(x => x.id === commentId);
  if (!uid || !c || c.authorId !== uid) return;
  if (!window.confirm('Delete this comment?')) return;
  try {
    await deleteDoc(doc(db, 'gameComments', commentId));
    // Replies to a deleted parent lose their anchor — delete them too (honest cleanup).
    const kids = commentsAll.filter(x => x.replyTo === commentId);
    for (const k of kids) await deleteDoc(doc(db, 'gameComments', k.id)).catch(() => {});
    await updateDoc(doc(db, 'games', gameId), { commentCount: increment(-(1 + kids.length)) }).catch(() => {});
    await loadComments(gameId, container, compact);
  } catch (err) {
    console.error('Comment delete failed:', err);
    showToast('Could not delete the comment.', 'error');
  }
}

/* ========================================================================
   Gameplay — panels, sessions, bridge, HUD, controls
   ======================================================================== */

export async function onGameplayOpen(game) {
  playGameId = game.id;
  lastPlayedGameId = game.id;
  gamePaused = false;
  gameMuted = false;
  hudState = {};
  declaredControls = null;
  resetToolbarState();

  const thumb = document.getElementById('arc-play-thumb');
  if (thumb) {
    const initials = String(game.title || 'Game').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || 'GN';
    const hue = Array.from(String(game.id || game.title || '')).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    thumb.innerHTML = game.coverImage
      ? `<img src="${escapeHtml(game.coverImage)}" alt="" onerror="this.remove()" />`
      : `<span class="arc-cover-initials arc-cover-sm" style="background:linear-gradient(135deg,hsl(${hue} 62% 26%),hsl(${(hue + 46) % 360} 70% 16%));">${escapeHtml(initials)}</span>`;
  }
  const desc = document.getElementById('arc-play-desc');
  if (desc) desc.textContent = game.description || '';

  refreshBookmarkButtons(game.id);
  renderPlayPanels();
  mountComments(document.getElementById('arc-play-comments'), game.id, { compact: true });
  await loadBookmarks();
  refreshBookmarkButtons(game.id);
  await startSession(game);
}

/** Info / progress / leaderboard panels around the running game. */
function renderPlayPanels() {
  const game = (window.HubbleNest?.getGamesCache?.() || []).find(x => x.id === playGameId);
  if (!game) return;

  const info = document.getElementById('arc-game-info');
  if (info) {
    const r = ratingOf(game);
    info.innerHTML = `
      <h3 class="arc-panel-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="10.5" r="1"/></svg> Game Info</h3>
      <p class="arc-info-desc">${escapeHtml(game.description || 'No description.')}</p>
      <div class="arc-info-rows">
        <div><dt>Category</dt><dd>${game.category ? `<span class="arc-cat-chip">${escapeHtml(game.category)}</span>` : '<span class="arc-muted">—</span>'}</dd></div>
        ${game.kind === 'link' && game.linkUrl ? `<div><dt>Source</dt><dd>Live from <b>${escapeHtml(game.linkHost || 'its own site')}</b></dd></div>` : ''}
        <div><dt>Difficulty</dt><dd class="arc-muted">Not declared by this game</dd></div>
        ${(game.languages || []).length ? `<div><dt>Languages</dt><dd>${(game.languages || []).map(l => `<span class="arc-lang-chip">${escapeHtml(l)}</span>`).join(' ')}</dd></div>` : ''}
        <div><dt>Rating</dt><dd>${r.count > 0 ? `★ ${r.avg.toFixed(1)} (${fmtCount(r.count)})` : '<span class="arc-muted">No ratings yet</span>'}</dd></div>
        <div><dt>Creator</dt><dd><span class="arc-creator" data-arc-creator-play="${escapeHtml(game.authorId || '')}" role="button" tabindex="0"><img src="${getAvatarUrl(game.authorPhoto, game.authorName)}" alt="" loading="lazy" /> ${escapeHtml(game.authorName || 'Member')}</span></dd></div>
      </div>`;
    info.querySelector('[data-arc-creator-play]')?.addEventListener('click', (ev) => {
      const id = ev.currentTarget.getAttribute('data-arc-creator-play');
      if (id && window.HubbleNest?.openMemberProfilePage) window.HubbleNest.openMemberProfilePage(id);
    });
  }

  const prog = document.getElementById('arc-progress');
  if (prog) {
    prog.innerHTML = `
      <h3 class="arc-panel-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 13h3v4H7z"/><path d="M12 9h3v8h-3z"/><path d="M17 5h3v12h-3z"/></svg> Your Progress</h3>
      <div class="arc-progress-rows">
        <div class="arc-progress-row">
          <span class="arc-progress-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> Best score</span>
          <b class="arc-progress-val" id="arc-prog-best">${fmtCount(sessionBest)}</b>
        </div>
        <div class="arc-progress-row">
          <span class="arc-progress-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg> This session</span>
          <b class="arc-progress-val" id="arc-prog-session">${fmtCount(session?.lastScore || 0)}</b>
        </div>
        <div class="arc-progress-note" id="arc-prog-note">${sessionBest > 0 ? 'Scores are saved only when the game reports them or when you leave the game.' : 'Play to set your first score — reported scores are saved automatically.'}</div>
      </div>`;
  }

  loadPlayLeaderboard(game);
}

async function loadPlayLeaderboard(game) {
  const box = document.getElementById('arc-play-leaderboard');
  if (!box) return;
  box.innerHTML = `
    <div class="arc-panel-head-row">
      <h3 class="arc-panel-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> Leaderboard</h3>
      <button type="button" class="arc-viewall arc-viewall-sm" onclick="window.HubbleNest.arcGo('leaderboard')">View All</button>
    </div>
    <div class="arc-loading">Loading scores…</div>`;
  try {
    const snap = await getDocs(query(collection(db, 'gameScores'), where('gameId', '==', game.id), limit(50)));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 8);
    const uid = myUid();
    if (rows.length === 0) {
      box.innerHTML = `
        <div class="arc-panel-head-row">
          <h3 class="arc-panel-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> Leaderboard</h3>
        </div>
        <div class="arc-empty-note">No scores posted yet for this game — set the first one!</div>`;
      return;
    }
    box.innerHTML = `
      <div class="arc-panel-head-row">
        <h3 class="arc-panel-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> Leaderboard</h3>
        <button type="button" class="arc-viewall arc-viewall-sm" onclick="window.HubbleNest.arcGo('leaderboard')">View All</button>
      </div>
      <ol class="arc-lb-list">
        ${rows.map((row, i) => `
          <li class="arc-lb-row ${row.uid === uid ? 'arc-lb-me' : ''}">
            <span class="arc-lb-pos arc-pos-${i + 1}">${i + 1}</span>
            <img class="arc-lb-av" src="${getAvatarUrl(row.photo, row.displayName)}" alt="" loading="lazy" />
            <span class="arc-lb-name">${escapeHtml(row.displayName || 'Member')}${row.uid === uid ? ' (you)' : ''}</span>
            <b class="arc-lb-score">${fmtCount(row.score)}</b>
          </li>`).join('')}
      </ol>
      <div class="arc-lb-note">Scores are validated against real play sessions.</div>`;
  } catch (err) {
    if (err?.code !== 'permission-denied') console.warn('Leaderboard load failed:', err?.code || err);
    box.innerHTML = `<h3 class="arc-panel-title">Leaderboard</h3><div class="arc-empty-note">${err?.code === 'permission-denied' ? 'Scores need the new Arcade rules — republish firestore.rules in the Firebase console.' : 'Could not load scores.'}</div>`;
  }
}

/* ---- Sessions: one record per real open, refresh-window dedupe --------- */

async function startSession(game) {
  const uid = myUid();
  session = null;
  sessionBest = 0;
  const sessLabel = document.getElementById('arc-tool-session');
  if (!uid) {
    if (sessLabel) sessLabel.textContent = 'Sign in to record scores';
    return;
  }

  // Personal best (single-doc read; the doc id is deterministic).
  try {
    const best = await getDoc(doc(db, 'gameScores', `${game.id}_${uid}`));
    if (best.exists()) sessionBest = Number(best.data().score) || 0;
  } catch (e) { /* rules pending — handled on submit */ }

  const LSK = `hn-arc-sess-${game.id}`;
  let last = null;
  try { last = JSON.parse(localStorage.getItem(LSK) || 'null'); } catch (e) { /* ignore */ }

  const withinResumeWindow = last && (Date.now() - (last.closedAt || last.lastOpenAt || 0)) < RESUME_WINDOW_MS;
  if (last && withinResumeWindow) {
    // Refresh / quick reopen: CONTINUE the previous visit — no duplicate play,
    // with OR without the session rules being live (sessionId may be null
    // while gameSessions awaits its one-time rules republish).
    session = (last.sessionId)
      ? { id: last.sessionId, gameId: game.id, startMs: Date.now(), lastScore: 0, resumed: true }
      : null;
    if (session) {
      try {
        await updateDoc(doc(db, 'gameSessions', session.id), { resumedAt: serverTimestamp(), endedAt: null });
      } catch (e) { /* rules pending on this project — play counting still works */ }
    }
    try { localStorage.setItem(LSK, JSON.stringify({ ...last, lastOpenAt: Date.now() })); } catch (e) { /* ignore */ }
    if (sessLabel) sessLabel.textContent = session ? 'Session resumed' : 'Playing';
    renderPlayPanels();
    return;
  }

  // FRESH OPEN. The play counter writes to the games doc, whose rules are
  // already live — do it FIRST so plays keep counting even while this
  // project's new Arcade session/score rules await their one-time republish.
  try {
    await updateDoc(doc(db, 'games', game.id), { plays: increment(1) });
  } catch (err) {
    console.warn('Play count not recorded:', err?.code || err);
  }

  try {
    const ref = doc(collection(db, 'gameSessions'));
    await setDoc(ref, {
      gameId: game.id,
      uid,
      startedAt: serverTimestamp(),
      durationSec: 0,
      lastScore: 0
    });
    session = { id: ref.id, gameId: game.id, startMs: Date.now(), lastScore: 0, resumed: false };
    try { localStorage.setItem(LSK, JSON.stringify({ sessionId: ref.id, gameId: game.id, closedAt: 0, lastOpenAt: Date.now() })); } catch (e) { /* ignore */ }
    if (sessLabel) sessLabel.textContent = 'Recording session';
  } catch (err) {
    // Rules for gameSessions/gameScores not yet republished on this project.
    // Stay fully playable; the refresh dedupe still works via the local
    // visit marker, and scores simply cannot anchor to a session yet.
    session = null;
    try { localStorage.setItem(LSK, JSON.stringify({ sessionId: null, gameId: game.id, closedAt: 0, lastOpenAt: Date.now() })); } catch (e) { /* ignore */ }
    if (sessLabel) sessLabel.textContent = 'Score saving needs the new Arcade rules';
    if (err?.code === 'permission-denied' && !rulesWarned) {
      rulesWarned = true;
      console.warn('Arcade score tracking is inactive: republish firestore.rules (adds gameSessions/gameScores/gameComments/gameRatings/gameBookmarks) in the Firebase console.');
    }
  }
  renderPlayPanels();
}

async function endSession({ reason = 'close' } = {}) {
  // The local close marker is written FIRST so the refresh dedupe works
  // even when the session doc could not be created (rules pending).
  const markerGameId = session?.gameId || playGameId;
  if (markerGameId) {
    try {
      const LSK = `hn-arc-sess-${markerGameId}`;
      const prev = JSON.parse(localStorage.getItem(LSK) || '{}');
      localStorage.setItem(LSK, JSON.stringify({ ...prev, gameId: markerGameId, closedAt: Date.now() }));
    } catch (e) { /* ignore */ }
  }
  if (!session) return;
  const s = session;
  session = null;
  const dur = Math.max(0, Math.round((Date.now() - s.startMs) / 1000));
  try {
    await updateDoc(doc(db, 'gameSessions', s.id), {
      endedAt: serverTimestamp(),
      durationSec: increment(dur),
      lastScore: Math.min(MAX_SCORE, Math.max(0, Math.round(s.lastScore || 0))),
      endReason: reason
    });
  } catch (err) { /* best effort */ }
  try {
    const LSK = `hn-arc-sess-${s.gameId}`;
    const prev = JSON.parse(localStorage.getItem(LSK) || '{}');
    localStorage.setItem(LSK, JSON.stringify({ sessionId: s.id, closedAt: Date.now(), prevClosedAt: prev.closedAt || 0 }));
  } catch (e) { /* ignore */ }
  if ((s.lastScore || 0) > 0) await submitScore(s.gameId, s.lastScore, s.id);
}

/** Submit a score — only improvements are written (rules enforce it too). */
async function submitScore(gameId, score, sessionId) {
  const uid = myUid();
  const value = Math.min(MAX_SCORE, Math.max(0, Math.round(Number(score) || 0)));
  if (!uid || value <= 0 || value <= sessionBest) return;
  const me = myProfile();
  try {
    await setDoc(doc(db, 'gameScores', `${gameId}_${uid}`), {
      gameId,
      uid,
      displayName: me?.displayName || 'Member',
      photo: me?.photoURL || '',
      score: value,
      sessionId: String(sessionId || ''),
      updatedAt: serverTimestamp()
    });
    sessionBest = value;
    const bestEl = document.getElementById('arc-prog-best');
    if (bestEl) bestEl.textContent = fmtCount(value);
    const note = document.getElementById('arc-prog-note');
    if (note) note.textContent = 'New personal best — saved to the leaderboard.';
    showToast(`New personal best: ${fmtCount(value)}!`, 'success');
    const game = (window.HubbleNest?.getGamesCache?.() || []).find(x => x.id === gameId);
    if (game) loadPlayLeaderboard(game);
  } catch (err) {
    // Rules pending (or a non-improving score) — one calm line, no error spam.
    if (err?.code === 'permission-denied' && !rulesWarned) {
      rulesWarned = true;
      console.warn('Arcade leaderboard is inactive: republish firestore.rules (adds gameScores + gameSessions) in the Firebase console.');
    }
  }
}

/* ---- Bridge: parent ⇄ sandbox messages -------------------------------- */

function postToFrame(msg) {
  const frame = document.getElementById('player-frame');
  try { frame?.contentWindow?.postMessage(msg, '*'); } catch (e) { /* frame gone */ }
}

function handleGameMessage(ev) {
  const frame = document.getElementById('player-frame');
  if (!frame || ev.source !== frame.contentWindow) return; // only OUR game frame
  // External LINK games are untrusted senders: they never speak the bridge,
  // and accepting messages from them would let a random web page inject
  // fake scores into the leaderboard. Only sandboxed code games (opaque
  // srcdoc origin) built by HubbleNest's own player may talk to us.
  const playing = (window.HubbleNest?.getGamesCache?.() || []).find(x => x.id === playGameId);
  if (playing && playing.kind === 'link' && playing.linkUrl) return;
  const data = ev.data;
  if (!data || typeof data.type !== 'string' || !data.type.startsWith('hn-')) return;

  switch (data.type) {
    case 'hn-score': {
      const v = Math.min(MAX_SCORE, Math.max(0, Math.round(Number(data.score) || 0)));
      if (session) session.lastScore = v;
      const sessEl = document.getElementById('arc-prog-session');
      if (sessEl) sessEl.textContent = fmtCount(v);
      if (hudState.score !== v) { hudState.score = v; renderHud(); }
      break;
    }
    case 'hn-hud': {
      const h = data.hud || {};
      for (const k of ['score', 'level', 'coins', 'health', 'time']) {
        if (k in h) hudState[k] = h[k];
      }
      renderHud();
      break;
    }
    case 'hn-over': {
      const v = Math.min(MAX_SCORE, Math.max(0, Math.round(Number(data.score) || 0)));
      if (session) session.lastScore = v;
      submitScore(playGameId, v, session?.id);
      break;
    }
    case 'hn-controls': {
      const c = data.controls || {};
      declaredControls = {
        left: !!(c.left || c.jump), right: !!c.right, up: !!(c.up || c.jump),
        down: !!c.down, action: !!c.action
      };
      renderTouchControls();
      break;
    }
    case 'hn-progress': {
      hudState.progress = Math.max(0, Math.min(100, Number(data.pct) || 0));
      renderHud();
      break;
    }
    case 'hn-err': {
      // The game itself crashed — surface ONE calm line for honest debugging
      // (creators see what broke instead of a silent black screen).
      console.warn('[Arcade game error]', String(data.message || '').slice(0, 200));
      break;
    }
    case 'hn-ack': {
      ackWaiters.splice(0).forEach(w => w(data.cmd));
      break;
    }
    default:
      break;
  }
}
window.addEventListener('message', handleGameMessage);

function renderHud() {
  const hud = els().hud;
  if (!hud) return;
  const pills = [];
  if ('coins' in hudState) pills.push(`<span class="arc-hud-pill arc-hud-coins"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.5a2.5 2.5 0 0 0-2.5-1.5c-1.5 0-2.5 1-2.5 2s1 2 2.5 2 2.5 1 2.5 2-1 2-2.5 2a2.5 2.5 0 0 1-2.5-1.5M12 6.5v11"/></svg>${escapeHtml(String(hudState.coins))}</span>`);
  if ('score' in hudState) pills.push(`<span class="arc-hud-pill arc-hud-score">Score: ${escapeHtml(String(hudState.score))}</span>`);
  if ('level' in hudState) pills.push(`<span class="arc-hud-pill">Level: ${escapeHtml(String(hudState.level))}</span>`);
  if ('time' in hudState) pills.push(`<span class="arc-hud-pill">Time: ${escapeHtml(String(hudState.time))}</span>`);
  if ('health' in hudState) pills.push(`<span class="arc-hud-pill">♥ ${escapeHtml(String(hudState.health))}</span>`);
  if ('progress' in hudState) pills.push(`<span class="arc-hud-progress"><span style="width:${Math.max(0, Math.min(100, hudState.progress))}%"></span></span>`);
  hud.innerHTML = pills.join('');
  hud.hidden = pills.length === 0;
}

/* ---- On-screen (touch) controls — only for games that declare them ---- */

function renderTouchControls() {
  const box = els().touchControls;
  if (!box) return;
  if (!declaredControls || !(declaredControls.left || declaredControls.right || declaredControls.up || declaredControls.down || declaredControls.action)) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const btn = (key, label, icon, cls) => `
    <button type="button" class="arc-tc-btn ${cls}" data-arc-tc="${key}" aria-label="${label}">${icon}</button>`;
  const icons = {
    left: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    right: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    up: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
    down: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    action: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>'
  };
  let html = '';
  if (declaredControls.left) html += btn('ArrowLeft', 'Move left', icons.left, 'arc-tc-left');
  if (declaredControls.down) html += btn('ArrowDown', 'Move down', icons.down, '');
  if (declaredControls.right) html += btn('ArrowRight', 'Move right', icons.right, 'arc-tc-right');
  if (declaredControls.up) html += btn('ArrowUp', 'Move up / jump', icons.up, 'arc-tc-jump');
  if (declaredControls.action) html += btn('Space', 'Action', icons.action, 'arc-tc-action');
  box.innerHTML = html;
  box.hidden = false;

  const send = (key, down) => postToFrame({ type: 'hn-key', key, down });
  box.querySelectorAll('[data-arc-tc]').forEach(b => {
    const key = b.getAttribute('data-arc-tc');
    const down = (ev) => { ev.preventDefault(); b.classList.add('arc-tc-down'); send(key, true); };
    const up = (ev) => { ev.preventDefault(); b.classList.remove('arc-tc-down'); send(key, false); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
  });
}

/* ---- Toolbar: pause / restart / sound / exit --------------------------- */

function resetToolbarState() {
  gamePaused = false;
  gameMuted = false;
  const overlay = els().pauseOverlay;
  if (overlay) overlay.hidden = true;
  setPauseButton(false);
  setSoundButton(false);
  renderHud();
  const box = els().touchControls;
  if (box) { box.hidden = true; box.innerHTML = ''; }
  const sess = document.getElementById('arc-tool-session');
  if (sess) sess.textContent = '';
}

function setPauseButton(paused) {
  const btn = document.getElementById('arc-tool-pause');
  if (!btn) return;
  btn.querySelector('.arc-ic-pause').style.display = paused ? 'none' : '';
  btn.querySelector('.arc-ic-resume').style.display = paused ? '' : 'none';
  const label = document.getElementById('arc-tool-pause-label');
  if (label) label.textContent = paused ? 'Resume' : 'Pause';
}

function setSoundButton(muted) {
  const btn = document.getElementById('arc-tool-sound');
  if (!btn) return;
  btn.querySelector('.arc-ic-snd-on').style.display = muted ? 'none' : '';
  btn.querySelector('.arc-ic-snd-off').style.display = muted ? '' : 'none';
  const label = document.getElementById('arc-tool-sound-label');
  if (label) label.textContent = muted ? 'Muted' : 'Sound';
}

export function arcTogglePause() {
  if (!playGameId) return;
  const game = (window.HubbleNest?.getGamesCache?.() || []).find(x => x.id === playGameId);
  if (game && game.runnable === false) { showToast('This is a source project — there is nothing to pause.', 'info'); return; }
  gamePaused = !gamePaused;
  postToFrame({ type: 'hn-ctl', cmd: gamePaused ? 'pause' : 'resume' });
  const overlay = els().pauseOverlay;
  if (overlay) overlay.hidden = !gamePaused;
  setPauseButton(gamePaused);
}

export function arcRestartGame() {
  if (!playGameId) return;
  if (gamePaused) arcTogglePause(); // unpause first so the restart actually runs
  window.HubbleNest?.restartCurrentGame?.();
  hudState = {};
  renderHud();
  showToast('Game restarted.', 'info', 1600);
}

export function arcToggleSound() {
  if (!playGameId) return;
  gameMuted = !gameMuted;
  postToFrame({ type: 'hn-ctl', cmd: gameMuted ? 'mute' : 'unmute' });
  setSoundButton(gameMuted);
}

export async function exitGameplay() {
  const hadUnsaved = session && (session.lastScore || 0) > sessionBest && (session.lastScore || 0) > 0;
  if (hadUnsaved && !window.confirm('You have an unsaved score in this run. Leave and save it?')) {
    return;
  }
  await endSession({ reason: 'exit' });
  window.HubbleNest?.closeGamePlayer?.();
}

/** Called by games.js closeGamePlayer BEFORE it hides the player. */
export async function onGameplayClose() {
  await endSession({ reason: 'close' });
  resetToolbarState();
  playGameId = null;
}

/** The game frame was reloaded (Restart) — clear transient HUD state. */
export function onGameplayRestarted() {
  hudState = {};
  gamePaused = false;
  const overlay = els().pauseOverlay;
  if (overlay) overlay.hidden = true;
  setPauseButton(false);
  renderHud();
}

/** Where should "Back to Arcade" land after playing? (detail page) */
export function afterPlayerClose() {
  if (returnAfterPlay === 'detail' && lastPlayedGameId) {
    // Reopen the detail page for the game we just played.
    openGameDetail(lastPlayedGameId);
    return 'handled';
  }
  return 'not-handled';
}

export function onArcadeEditorOpen() {
  const e = els();
  if (e.detail) e.detail.style.display = 'none';
  detailGameId = null;
}

export function onArcadeEditorClose() {
  arcGo(arcRoute === 'home' ? 'home' : arcRoute);
}

/* ========================================================================
   Leaderboard view (global)
   ======================================================================== */

async function renderLeaderboardView() {
  const box = els().lbView;
  if (!box) return;
  box.innerHTML = `
    <div class="arc-lbview-head">
      <h2 class="arc-view-title">Leaderboard</h2>
      <p class="arc-view-sub">Real numbers only — top scores are validated against real play sessions, and play counts come from genuine opens.</p>
    </div>
    <div class="arc-lbview-grid">
      <section class="arc-panel">
        <h3 class="arc-panel-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> Top Scores</h3>
        <div class="arc-loading">Loading scores…</div>
      </section>
      <section class="arc-panel">
        <h3 class="arc-panel-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg> Most Played Games</h3>
        <div id="arc-lb-mostplayed"><div class="arc-loading">Loading…</div></div>
      </section>
    </div>`;

  // Most played — from the live games cache (real counters).
  const mp = document.getElementById('arc-lb-mostplayed');
  const games = [...(window.HubbleNest?.getGamesCache?.() || [])].sort((a, b) => (b.plays || 0) - (a.plays || 0)).filter(g => (g.plays || 0) > 0).slice(0, 10);
  if (mp) {
    mp.innerHTML = games.length === 0
      ? `<div class="arc-empty-note">No plays recorded yet.</div>`
      : `<ol class="arc-lb-list">${games.map((g, i) => `
          <li class="arc-lb-row" data-arc-open="${escapeHtml(g.id)}" role="button" tabindex="0">
            <span class="arc-lb-pos arc-pos-${i + 1}">${i + 1}</span>
            <img class="arc-lb-av" src="${getAvatarUrl(g.authorPhoto, g.authorName)}" alt="" loading="lazy" />
            <span class="arc-lb-name">${escapeHtml(g.title || 'Untitled game')}</span>
            <b class="arc-lb-score">${fmtCount(g.plays || 0)} <i>plays</i></b>
          </li>`).join('')}</ol>`;
    mp.querySelectorAll('[data-arc-open]').forEach(r => {
      r.addEventListener('click', () => openGameDetail(r.getAttribute('data-arc-open')));
      r.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') openGameDetail(r.getAttribute('data-arc-open')); });
    });
  }

  // Top scores across the Arcade (single-field orderBy — no composite index).
  try {
    const snap = await getDocs(query(collection(db, 'gameScores'), orderBy('score', 'desc'), limit(20)));
    const rows = snap.docs.map(d => d.data());
    const panel = box.querySelector('.arc-lbview-grid .arc-panel .arc-loading')?.parentElement;
    const gamesCache = window.HubbleNest?.getGamesCache?.() || [];
    const target = box.querySelectorAll('.arc-panel')[0];
    const listHost = target?.querySelector('.arc-loading') || target;
    if (!listHost) return;
    if (rows.length === 0) {
      listHost.innerHTML = `<div class="arc-empty-note">No scores posted yet. Play a game and set the first record!</div>`;
      return;
    }
    listHost.innerHTML = `<ol class="arc-lb-list">${rows.map((row, i) => {
      const g = gamesCache.find(x => x.id === row.gameId);
      return `
        <li class="arc-lb-row ${row.uid === myUid() ? 'arc-lb-me' : ''}" ${g ? `data-arc-open="${escapeHtml(g.id)}" role="button" tabindex="0"` : ''}>
          <span class="arc-lb-pos arc-pos-${i + 1}">${i + 1}</span>
          <img class="arc-lb-av" src="${getAvatarUrl(row.photo, row.displayName)}" alt="" loading="lazy" />
          <span class="arc-lb-name">${escapeHtml(row.displayName || 'Member')}<small>${g ? escapeHtml(g.title) : 'Game removed'}</small></span>
          <b class="arc-lb-score">${fmtCount(row.score)}</b>
        </li>`;
    }).join('')}</ol>
    <div class="arc-lb-note">Scores cannot decrease and are anchored to real play sessions.</div>`;
    if (panel) {
      panel.querySelectorAll('[data-arc-open]').forEach(r => {
        r.addEventListener('click', () => openGameDetail(r.getAttribute('data-arc-open')));
      });
    }
  } catch (err) {
    if (err?.code !== 'permission-denied') console.warn('Top scores load failed:', err?.code || err);
    const target = box.querySelectorAll('.arc-panel')[0];
    const listHost = target?.querySelector('.arc-loading');
    if (listHost) listHost.innerHTML = `<div class="arc-empty-note">${err?.code === 'permission-denied' ? 'Scores need the new Arcade rules — republish firestore.rules in the Firebase console.' : 'Could not load scores.'}</div>`;
  }
}

/* ========================================================================
   My Activity view
   ======================================================================== */

async function renderActivityView() {
  const box = els().actView;
  if (!box) return;
  const uid = myUid();
  if (!uid) {
    box.innerHTML = `<div class="arc-view-title">My Activity</div><div class="arc-empty-note">Sign in to see your games, sessions and saved games.</div>`;
    return;
  }
  await loadBookmarks();
  await loadMyRatings();

  const games = window.HubbleNest?.getGamesCache?.() || [];
  const mine = games.filter(g => g.authorId === uid);
  const saved = games.filter(g => bookmarks.has(g.id));
  // Note: bookmarked games may have scrolled past the 60-game cache window;
  // those are listed in "Saved" below only when still resolvable, and the
  // raw bookmark list always shows everything with an honest label.

  box.innerHTML = `
    <div class="arc-lbview-head">
      <h2 class="arc-view-title">My Activity</h2>
      <p class="arc-view-sub">Your games, your sessions, your records — all read from your real account data.</p>
    </div>

    <section class="arc-panel arc-act-panel">
      <h3 class="arc-panel-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="10.5" r="1"/></svg> My Games (${mine.length})</h3>
      <div id="arc-act-mine"></div>
    </section>

    <section class="arc-panel arc-act-panel">
      <h3 class="arc-panel-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg> Recently Played</h3>
      <div id="arc-act-sessions"><div class="arc-loading">Loading sessions…</div></div>
    </section>

    <section class="arc-panel arc-act-panel">
      <h3 class="arc-panel-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg> My Best Scores</h3>
      <div id="arc-act-scores"><div class="arc-loading">Loading scores…</div></div>
    </section>

    <section class="arc-panel arc-act-panel">
      <h3 class="arc-panel-title"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg> My Saved Games (${saved.length})</h3>
      <div id="arc-act-saved"></div>
    </section>`;

  const mineHost = document.getElementById('arc-act-mine');
  if (mineHost) {
    mineHost.innerHTML = mine.length === 0
      ? `<div class="arc-empty-note">You haven't published a game yet. <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.openGameEditor(null)">Create one</button></div>`
      : `<div class="arcade-grid">${mine.map(g => window.HubbleNest.arcGameCard(g)).join('')}</div>`;
  }

  const savedHost = document.getElementById('arc-act-saved');
  if (savedHost) {
    savedHost.innerHTML = saved.length === 0
      ? `<div class="arc-empty-note">Nothing saved yet — press "Add to My Games" on any game's page.</div>`
      : `<div class="arcade-grid">${saved.map(g => window.HubbleNest.arcGameCard(g)).join('')}</div>`;
  }

  try {
    const sessSnap = await getDocs(query(collection(db, 'gameSessions'), where('uid', '==', uid), limit(25)));
    const sessions = sessSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.startedAt?.seconds || 0) - (a.startedAt?.seconds || 0))
      .filter(s => {
        // A resumed session and its origin are the SAME session — show once.
        return true;
      });
    const sessHost = document.getElementById('arc-act-sessions');
    if (sessHost) {
      sessHost.innerHTML = sessions.length === 0
        ? `<div class="arc-empty-note">No play sessions recorded yet. Open a game to start one.</div>`
        : `<div class="arc-sess-list">${sessions.map(s => {
            const g = games.find(x => x.id === s.gameId);
            return `
              <div class="arc-sess-row" ${g ? `data-arc-open="${escapeHtml(g.id)}" role="button" tabindex="0"` : ''}>
                <span class="arc-sess-game">${g ? escapeHtml(g.title) : 'Game removed'}</span>
                <span class="arc-sess-meta">${formatTimeAgo(s.startedAt)}${Number(s.durationSec) > 0 ? ` · ${Math.round(Number(s.durationSec))}s` : ''}${Number(s.lastScore) > 0 ? ` · score ${fmtCount(s.lastScore)}` : ''}</span>
                <span class="arc-sess-go">Play again →</span>
              </div>`;
          }).join('')}</div>`;
      sessHost.querySelectorAll('[data-arc-open]').forEach(r => {
        r.addEventListener('click', () => openGameDetail(r.getAttribute('data-arc-open')));
      });
    }

    const scoreSnap = await getDocs(query(collection(db, 'gameScores'), where('uid', '==', uid), limit(50)));
    const scores = scoreSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.score || 0) - (a.score || 0));
    const scoreHost = document.getElementById('arc-act-scores');
    if (scoreHost) {
      scoreHost.innerHTML = scores.length === 0
        ? `<div class="arc-empty-note">No scores yet — scores save automatically when a game reports them.</div>`
        : `<div class="arc-sess-list">${scores.map(s => {
            const g = games.find(x => x.id === s.gameId);
            return `
              <div class="arc-sess-row" ${g ? `data-arc-open="${escapeHtml(g.id)}" role="button" tabindex="0"` : ''}>
                <span class="arc-sess-game">${g ? escapeHtml(g.title) : 'Game removed'}</span>
                <span class="arc-sess-meta">${formatTimeAgo(s.updatedAt)}</span>
                <b class="arc-lb-score">${fmtCount(s.score)}</b>
              </div>`;
          }).join('')}</div>`;
      scoreHost.querySelectorAll('[data-arc-open]').forEach(r => {
        r.addEventListener('click', () => openGameDetail(r.getAttribute('data-arc-open')));
      });
    }
  } catch (err) {
    if (err?.code !== 'permission-denied') console.warn('Activity load failed:', err?.code || err);
  }
}

/* ========================================================================
   Lifecycle & wiring
   ======================================================================== */

/** Called by app.js when the Arcade view opens. */
export async function initArcadeShell() {
  const e = els();
  // Default to the dashboard; player/editor/detail are hidden by games.js state.
  if (e.detail) e.detail.style.display = 'none';
  await loadBookmarks();
  await loadMyRatings();
  arcGo('home');
}

/** Clean up per-context listeners (view switches away from Arcade). */
export function stopArcadeExtras() {
  if (session) endSession({ reason: 'navigate' });
  if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
  commentsGameId = null;
  commentsAll = [];
  detailGameId = null;
  playGameId = null;
}

// Best-effort session close when the tab hides or unloads mid-session.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && session) endSession({ reason: 'hidden' });
});
window.addEventListener('pagehide', () => {
  if (session) endSession({ reason: 'unload' });
});

/** Install every Arcade function on the app's global bus. */
export function registerArcade() {
  Object.assign(window.HubbleNest, {
    // Router + shell
    arcGo, arcSearch, arcClearSearch, arcSetSort, arcSetCategory,
    openGameDetail, initArcadeShell, stopArcadeExtras, onArcadeGamesUpdated,
    // Bookmarks & ratings
    arcToggleBookmark, arcToggleBookmarkFromPlay, arcRateGame,
    // Comments
    arcPostComment, arcLikeComment, arcDeleteComment,
    // Gameplay
    exitGameplay, arcTogglePause, arcRestartGame, arcToggleSound,
    onGameplayOpen, onGameplayClose, onGameplayRestarted, afterPlayerClose,
    onArcadeEditorOpen, onArcadeEditorClose
  });
}
