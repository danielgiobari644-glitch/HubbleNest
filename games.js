/**
 * HubbleNest Arcade — user-created web games
 *
 * Members write real HTML, CSS and JavaScript in the built-in editor, watch a
 * live preview as they type, then publish the game to the Arcade where ANY
 * member can play it instantly inside a locked-down sandboxed iframe.
 *
 * Security model:
 *  - The player iframe uses sandbox="allow-scripts allow-pointer-lock
 *    allow-modals" WITHOUT allow-same-origin. Games therefore run in an
 *    opaque origin: no access to cookies, localStorage, the HubbleNest DOM,
 *    Firestore, or Cloudinary credentials. They are pure computation.
 *  - `</script` sequences inside member code are neutralised before srcdoc
 *    assembly so the wrapper document can never be broken out of.
 *  - Game source lives in Firestore (games collection) capped well below
 *    the 1 MiB document limit by the editor's own validation.
 *
 * No templates that pretend to run, no fake play counts: publishing, plays,
 * likes and the leaderboard are all real Firestore writes.
 */

import {
  db,
  auth,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from './firebase.js';

import {
  showToast,
  escapeHtml,
  getAvatarUrl,
  handlePermissionError
} from './utils.js';

import { formatBytes, uploadToCloudinary } from './cloudinary.js';

// permission-denied guidance now lives in utils.js (Connection Doctor retired)
// (imported below from './utils.js' where the rest of utils come from)

import { buildSrcDocFromFiles, buildSrcDoc, detectLanguages, normalizeGamePath } from './public-game-builder.js';

import { generateGameCode, getAiConfig } from './ai-game-builder.js';
import { getLastAiFailure } from './ai-client.js';

/* ========================================================================
   State
   ======================================================================== */

let gamesUnsubscribe = null;
let gamesCache = [];
// v30 load-speed core: game SOURCE CODE lives in games/{id}/code/main so the
// Arcade's realtime browse list never carries every game's code (it used to
// re-download the whole collection's source on every play/like). Code is
// fetched once on demand (play/edit) and cached here; legacy games still
// storing code in the main doc are read through the fallback and migrated
// automatically when their own author opens them.
const fullGameCache = new Map(); // gameId → complete code data
const legacyMigrating = new Set();
let arcadeFilter = 'all'; // 'all' | 'mine'
let arcadeSearchTerm = '';   // topbar search (title / creator / category)
let arcadeCategory = '';     // '' = all categories
let arcadeSort = 'newest';   // newest | plays | likes | rating | az
let editingGameId = null; // null = creating new
let playerGameId = null;
let previewTimer = null;
let editorCoverUrl = null;   // Cloudinary URL of the game's cover image (own games can change it anytime)
let editorCoverBusy = false; // upload in flight — save waits for it
let editorLinkUrl = '';      // https URL when editing/restoring a LINK game

/* Multi-file game project (path → text content). Any code language: the
   files are stored verbatim in Firestore and served to the sandbox as
   data: URLs, so HTML/CSS/JS entry files can reference their siblings
   (scripts, stylesheets, JSON data, assets) with ordinary relative paths. */
let editorFiles = {};      // { 'src/main.js': '...content...' }
let editorEntry = null;    // 'index.html' or first .html file

const MAX_TOTAL_BYTES = 600 * 1024; // well under Firestore's 1 MiB doc cap
const MAX_FILE_COUNT = 150;
const MAX_SINGLE_FILE_BYTES = 300 * 1024;
const DRAFT_KEY = 'hn-arcade-draft';

/* ========================================================================
   Games created through LINKS
   ==========================
   A game whose source lives on another site (itch.io, a personal server,
   any public HTML5 game URL) is stored as kind:'link' + linkUrl + linkHost
   and plays LIVE inside the app's player. The framed page is cross-origin,
   so the browser's same-origin policy already walls it off from HubbleNest
   DOM/cookies/Firestore — the sandbox tokens only tune what the GAME may
   do on its own origin (storage, popups, fullscreen, gamepad).
   ======================================================================== */
const LINK_SANDBOX = 'allow-scripts allow-same-origin allow-pointer-lock allow-modals allow-forms allow-popups allow-popups-to-escape-sandbox';
const LINK_ALLOW = 'autoplay; fullscreen; gamepad *';
const CODE_SANDBOX = 'allow-scripts allow-pointer-lock allow-modals';
let playingLinkUrl = null; // set while an external game is open ("Open in new tab")

const els = () => ({
  grid: document.getElementById('arcade-grid'),
  browse: document.getElementById('arcade-browse'),
  editor: document.getElementById('arcade-editor'),
  player: document.getElementById('arcade-player')
});

/* ========================================================================
   Starter template — a REAL playable game (not a placeholder): Orbit Catch.
   Click / tap to catch falling stars before they land. 30-second rounds,
   local best score, speed ramps up. Pure HTML+CSS+JS, zero dependencies.
   ======================================================================== */

const STARTER_HTML = `<div id="stage">
  <div id="hud"><span id="score">0</span> caught · <span id="time">30</span>s left · best <span id="best">0</span></div>
  <div id="launcher"><button id="start">Play Orbit Catch</button><p>Tap or click a falling star to catch it. Miss three and the round ends early.</p></div>
</div>`;

const STARTER_CSS = `html,body{margin:0;height:100%;background:#0b1020;color:#eef2ff;font-family:system-ui,sans-serif;overflow:hidden;user-select:none}
#stage{position:relative;height:100vh}
#hud{position:absolute;top:10px;left:0;right:0;text-align:center;font-size:15px;letter-spacing:.4px;opacity:.9}
#launcher{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;text-align:center;padding:0 24px}
#launcher p{max-width:320px;opacity:.7;font-size:14px;line-height:1.5;margin:0}
#start{border:0;border-radius:999px;padding:12px 30px;font-size:16px;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,#5a5df0,#8b5cf6);box-shadow:0 8px 28px rgba(108,111,245,.35)}
.star{position:absolute;width:34px;height:34px;border-radius:50%;cursor:pointer;background:radial-gradient(circle at 35% 35%,#ffe9a8,#f6b73c);box-shadow:0 0 18px rgba(246,183,60,.8)}
.star.boom{animation:pop .18s ease forwards}
@keyframes pop{to{transform:scale(1.9);opacity:0}}
.bomb{background:radial-gradient(circle at 35% 35%,#ff8f8f,#c0392b);box-shadow:0 0 18px rgba(248,113,113,.8)}`;

const STARTER_JS = `function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{return localStorage.setItem(k,v)}catch(e){}}
var stage=document.getElementById('stage');
var launcher=document.getElementById('launcher');
var scoreEl=document.getElementById('score'),timeEl=document.getElementById('time'),bestEl=document.getElementById('best');
var best=Number(lsGet('orbit-best')||0);
bestEl.textContent=best;
var score=0,time=30,misses=0,running=false,spawner=null,lastTick=0;

function end(msg){running=false;clearInterval(spawner);
  document.querySelectorAll('.star').forEach(function(s){s.remove()});
  if(score>best){best=score;lsSet('orbit-best',String(best));bestEl.textContent=best;}
  launcher.style.display='flex';
  launcher.querySelector('p').textContent=msg+' Final score: '+score+'.';
  document.getElementById('start').textContent='Play again';}

function spawn(){
  var bad=Math.random()<0.22;
  var s=document.createElement('div');
  s.className='star'+(bad?' bomb':'');
  var size=30+Math.random()*14;
  s.style.width=s.style.height=size+'px';
  s.style.left=(6+Math.random()*88)+'vw';
  s.style.top='-40px';
  s.dataset.speed=String(2.2+Math.random()*1.6+(30-time)*0.06);
  stage.appendChild(s);
  s.addEventListener('pointerdown',function(ev){if(!running||s.dataset.done)return;s.dataset.done='1';
    if(s.classList.contains('bomb')){end('You caught a red bomb!');s.remove();return;}
    score++;scoreEl.textContent=score;s.classList.add('boom');setTimeout(function(){s.remove()},180);});
}

/* ONE animation loop drives every star. The old build gave each star its own
   setInterval but cleared the shared previous timer on every spawn, which
   froze earlier stars in mid-air; a single rAF loop keeps them all falling. */
function loop(ts){
  if(!running)return;
  if(!lastTick)lastTick=ts;
  var dt=Math.min((ts-lastTick)/16.66,3);lastTick=ts;
  var stars=document.querySelectorAll('.star');
  for(var i=0;i<stars.length;i++){
    var el=stars[i];if(el.dataset.done)continue;
    var y=parseFloat(el.style.top)||-40;
    y+=Number(el.dataset.speed||2)*dt;
    el.style.top=y+'px';
    if(y>window.innerHeight+40){el.dataset.done='1';
      if(!el.classList.contains('bomb')){misses++;if(misses>=3){end('Three slipped past.');}}
      el.remove();}
  }
  requestAnimationFrame(loop);
}

setInterval(function(){if(!running)return;time--;timeEl.textContent=time;if(time<=0){end('Time!');}},1000);

document.getElementById('start').addEventListener('click',function(){
  score=0;time=30;misses=0;running=true;lastTick=0;
  scoreEl.textContent='0';timeEl.textContent='30';
  launcher.style.display='none';
  spawner=setInterval(spawn,650);
  requestAnimationFrame(loop);
  spawn();});`;

/* buildSrcDoc (classic wrapper) and normalizeGamePath are shared with the
   public game pages — they live in public-game-builder.js and are imported
   above. Keeping ONE definition avoids drift between preview and player. */

/* ========================================================================
   Subscription
   ======================================================================== */

export function startArcade() {
  stopArcade();

  // Signed out (auth gate mid-boot): no listener — say what's needed instead
  if (!auth.currentUser) {
    const grid = els().grid;
    if (grid) {
      grid.innerHTML = `
        <div class="feed-empty">
          <div class="feed-empty-glyph">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="10.5" r="1"/></svg>
          </div>
          <h3 class="feed-empty-title">The Arcade is for members</h3>
          <p class="feed-empty-desc">Sign in to play community games and publish your own HTML/CSS/JS creations.</p>
        </div>`;
    }
    return;
  }

  const q = query(
    collection(db, 'games'),
    orderBy('createdAt', 'desc'),
    limit(60)
  );
  gamesUnsubscribe = onSnapshot(q, (snap) => {
    gamesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Re-attach any previously fetched full documents so opening a running
    // game, restarting it or editing it never loses the code because a
    // display-field snapshot (plays/likes) fired meanwhile.
    if (fullGameCache.size) {
      gamesCache = gamesCache.map((g) => {
        const full = fullGameCache.get(g.id);
        return full ? { ...full, ...g, _fullDoc: true } : g;
      });
    }
    // ALWAYS re-render on every snapshot — the old code only re-rendered in
    // 'mine' filter mode, so games published by other members never appeared
    // until the user left and reopened the Arcade (the "needs a refresh" bug).
    renderArcadeGrid();
    // Arcade 2.0 experience layer (dashboard sections, detail, play panels).
    window.HubbleNest?.onArcadeGamesUpdated?.();
    // Keep the open player's like button in sync with live like counts too.
    if (playerGameId) {
      const fresh = gamesCache.find(g => g.id === playerGameId);
      if (fresh) renderPlayerLike(fresh);
    }
  }, (err) => {
    console.error('Arcade listener error:', err);
    const grid = els().grid;
    if (grid) {
      grid.innerHTML = `<div class="feed-error-card">
        <div class="feed-error-title">The Arcade could not load</div>
        <div class="feed-error-desc">${escapeHtml(err.code || 'error')} — check your internet connection and sign-in state, then try again.</div>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.openArcadeView()">Try again</button></div>`;
    }
    if (err?.code === 'permission-denied') handlePermissionError('arcade');
  });
  renderArcadeGrid();
}

export function stopArcade() {
  window.HubbleNest?.stopArcadeExtras?.();
  gamesUnsubscribe?.();
  gamesUnsubscribe = null;
  gamesCache = [];
}

/** Live games snapshot for the Arcade experience layer (arcade.js). */
export function getGamesCache() { return gamesCache; }

/* ========================================================================
   Browse grid
   ======================================================================== */

export function setArcadeFilter(filter) {
  arcadeFilter = filter === 'mine' ? 'mine' : 'all';
  document.getElementById('arcade-tab-all')?.classList.toggle('feed-tab-active', arcadeFilter === 'all');
  document.getElementById('arcade-tab-mine')?.classList.toggle('feed-tab-active', arcadeFilter === 'mine');
  renderArcadeGrid();
}

export function setArcadeSearch(term) {
  arcadeSearchTerm = String(term || '').trim().toLowerCase();
  if (document.getElementById('arcade-grid')) renderArcadeGrid();
}

export function setArcadeCategory(cat) {
  arcadeCategory = String(cat || '').trim();
  if (document.getElementById('arcade-grid')) renderArcadeGrid();
}

export function setArcadeSort(sort) {
  const allowed = ['newest', 'plays', 'likes', 'rating', 'az'];
  arcadeSort = allowed.includes(sort) ? sort : 'newest';
  const sel = document.getElementById('arc-sort-select');
  if (sel && sel.value !== arcadeSort) sel.value = arcadeSort;
  if (document.getElementById('arcade-grid')) renderArcadeGrid();
}

function myUid() { return window.HubbleNest?._state?.currentUser?.uid || null; }

/** Sort helper honouring the games-list sort control. */
function sortGamesList(list) {
  const t = (g) => (g.updatedAt?.seconds || g.createdAt?.seconds || 0);
  switch (arcadeSort) {
    case 'plays': return [...list].sort((a, b) => (b.plays || 0) - (a.plays || 0));
    case 'likes': return [...list].sort((a, b) => (b.likedBy?.length || 0) - (a.likedBy?.length || 0));
    case 'rating': return [...list].sort((a, b) => {
      const ra = (a.ratingCount || 0) > 0 ? a.ratingSum / a.ratingCount : -1;
      const rb = (b.ratingCount || 0) > 0 ? b.ratingSum / b.ratingCount : -1;
      return rb - ra;
    });
    case 'az': return [...list].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
    default: return [...list].sort((a, b) => t(b) - t(a));
  }
}

/**
 * ONE card template shared by the games list AND every dashboard section
 * (arcade.js renders its sections through window.HubbleNest.arcGameCard).
 * Cards open the game DETAIL page; the Play button launches the real game.
 */
export function arcGameCard(g) {
  const uid = myUid();
  const liked = Array.isArray(g.likedBy) && uid && g.likedBy.includes(uid);
  const likes = Array.isArray(g.likedBy) ? g.likedBy.length : (g.likeCount || 0);
  const mine = g.authorId === uid;
  const sid = escapeHtml(g.id);
  const ratingCount = Number(g.ratingCount) || 0;
  const ratingAvg = ratingCount > 0 ? (Number(g.ratingSum) || 0) / ratingCount : 0;
  const plays = Number(g.plays) || 0;
  // Cover image when the author set one; gradient initials tile otherwise.
  const initials = String(g.title || 'Game').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || 'GN';
  const hue = Array.from(String(g.id || g.title || '')).reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const thumbInner = g.coverImage
    ? `<img src="${escapeHtml(g.coverImage)}" class="game-card-cover-img" alt="${escapeHtml(g.title || 'Game')} cover" loading="lazy" decoding="async" onerror="this.remove()"/>`
    : `<span class="game-thumb-initials">${escapeHtml(initials)}</span>`;
  return `
    <article class="game-card arc-card" data-game-card="${sid}" onclick="window.HubbleNest.openGameDetail('${sid}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')window.HubbleNest.openGameDetail('${sid}')">
      <div class="game-card-thumb ${g.coverImage ? 'game-card-thumb-photo' : ''}" ${g.coverImage ? '' : `style="background: linear-gradient(135deg, hsl(${hue} 62% 26%), hsl(${(hue + 46) % 360} 70% 16%));"`}>
        ${thumbInner}
        ${g.category ? `<span class="arc-card-cat">${escapeHtml(g.category)}</span>` : ''}
        ${g.fileCount > 0 ? `<span class="game-thumb-files" title="Multi-file project">${g.fileCount} files</span>` : ''}
        ${g.kind === 'link' && g.linkUrl ? `<span class="game-thumb-host" title="Plays live from ${escapeHtml(g.linkHost || 'its own site')}"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>${escapeHtml(g.linkHost || 'link')}</span>` : ''}
        <span class="arc-card-play-overlay">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg> Play
        </span>
      </div>
      <div class="game-card-body">
        <h3 class="game-card-title">${escapeHtml(g.title || 'Untitled game')}</h3>
        <p class="game-card-desc">${escapeHtml((g.description || '').slice(0, 110) || 'No description')}${(g.description || '').length > 110 ? '…' : ''}</p>
        <div class="game-card-meta">
          ${ratingCount > 0 ? `<span class="arc-card-rating" title="${ratingAvg.toFixed(1)} from ${ratingCount} rating${ratingCount === 1 ? '' : 's'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24" stroke="none"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${ratingAvg.toFixed(1)}</span>` : ''}
          <span class="game-plays" title="${plays} plays"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg> ${plays >= 1000 ? `${(plays / 1000).toFixed(1).replace(/\.0$/, '')}K` : plays}</span>
          <span class="arc-card-likes" title="${likes} likes"><svg width="12" height="12" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> ${likes || ''}</span>
        </div>
      </div>
      <footer class="game-card-actions" onclick="event.stopPropagation()">
        <span class="game-card-author"><img src="${getAvatarUrl(g.authorPhoto, g.authorName)}" alt="" loading="lazy" /> ${escapeHtml(g.authorName || 'Member')}</span>
        ${mine ? `<span class="arc-card-owner">
                    <button type="button" class="btn-ghost" style="color:var(--text-secondary);font-size:.75rem;" onclick="window.HubbleNest.openGameEditor('${sid}')">Edit</button>
                    <button type="button" class="btn-ghost" style="color:var(--status-danger);font-size:.75rem;" onclick="window.HubbleNest.gameDelete('${sid}')">Delete</button>
                  </span>`
               : `<button type="button" class="arc-card-play-btn" onclick="window.HubbleNest.openGamePlayer('${sid}')">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg> Play
                  </button>`}
      </footer>
    </article>`;
}

export function renderArcadeGrid() {
  const grid = els().grid;
  if (!grid) return;
  const uid = myUid();

  const term = arcadeSearchTerm;
  const matches = (g) => {
    if (arcadeFilter === 'mine' && g.authorId !== uid) return false;
    if (arcadeCategory && g.category !== arcadeCategory) return false;
    if (term) {
      const hay = `${g.title || ''} ${g.description || ''} ${g.authorName || ''} ${g.category || ''} ${g.linkHost || ''}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  };

  const list = sortGamesList(gamesCache.filter(matches));

  const countEl = document.getElementById('arcade-count');
  if (countEl) {
    const bits = [list.length === 1 ? '1 game' : `${list.length} games`];
    if (arcadeCategory) bits.push(`in ${arcadeCategory}`);
    if (term) bits.push(`matching "${arcadeSearchTerm}"`);
    countEl.textContent = bits.join(' ');
  }

  if (list.length === 0) {
    const filtered = arcadeFilter === 'mine' || arcadeCategory || term;
    grid.innerHTML = `
      <div class="feed-empty">
        <div class="feed-empty-glyph">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="10.5" r="1"/></svg>
        </div>
        <h3 class="feed-empty-title">${filtered ? 'No games match' : (arcadeFilter === 'mine' ? 'You haven\'t published a game yet' : 'The Arcade is empty — be the first')}</h3>
        <p class="feed-empty-desc">${filtered ? 'Try a different search or category — or create the game you were looking for.' : 'Write a game with HTML, CSS and JavaScript in the built-in editor, paste a link to any web game, or let AI build one from a prompt — anyone on HubbleNest can play it instantly.'}</p>
        <button type="button" class="btn btn-primary" onclick="window.HubbleNest.openGameEditor(null)">Create your first game</button>
        <button type="button" class="btn btn-secondary" onclick="window.HubbleNest.openGameEditor(null, { focusPane: 'link' })">Add a game by link</button>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(arcGameCard).join('');
}

/* ========================================================================
   Editor
   ======================================================================== */

export async function openGameEditor(gameId, opts = {}) {
  const { browse, editor, player } = els();
  if (!browse || !editor) return;

  player && (player.style.display = 'none');
  browse.style.display = 'none';
  document.getElementById('arcade-detail') && (document.getElementById('arcade-detail').style.display = 'none');
  editor.style.display = 'block';
  editingGameId = gameId;
  window.HubbleNest?.onArcadeEditorOpen?.();

  // The browse cache is field-masked (no code) — fetch the full document
  // before filling the editor tabs (instant for already-fetched games).
  const game = gameId ? await ensureFullGame(gameId) : null;

  const titleInput = document.getElementById('game-title-input');
  const descInput = document.getElementById('game-desc-input');
  const htmlTa = document.getElementById('game-code-html');
  const cssTa = document.getElementById('game-code-css');
  const jsTa = document.getElementById('game-code-js');
  const saveBtn = document.getElementById('game-save-btn');
  const editorHeading = document.getElementById('arcade-editor-heading');

  if (game) {
    if (editorHeading) editorHeading.textContent = 'Edit game';
    if (titleInput) titleInput.value = game.title || '';
    if (descInput) descInput.value = game.description || '';
    if (htmlTa) htmlTa.value = game.html || '';
    if (cssTa) cssTa.value = game.css || '';
    if (jsTa) jsTa.value = game.js || '';
    const catSel = document.getElementById('game-category-select');
    if (catSel) catSel.value = game.category || '';
    const pubInput = document.getElementById('game-public-input');
    if (pubInput) pubInput.checked = game.isPublic === true;
    editorFiles = (game.files && typeof game.files === 'object') ? { ...game.files } : {};
    editorEntry = game.entryPath || currentEntryCandidate();
    editorCoverUrl = game.coverImage || null;
    editorLinkUrl = (game.kind === 'link' && game.linkUrl) ? game.linkUrl : '';
    renderGameCoverPreview();
  } else {
    editorFiles = {};
    editorEntry = null;
    editorLinkUrl = '';
    if (editorHeading) editorHeading.textContent = 'Create a game';
    // Restore an unsaved local draft if present (real autosave, real restore)
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (draft) {
      if (titleInput) titleInput.value = draft.title || '';
      if (descInput) descInput.value = draft.description || '';
      if (htmlTa) htmlTa.value = draft.html ?? STARTER_HTML;
      if (cssTa) cssTa.value = draft.css ?? STARTER_CSS;
      if (jsTa) jsTa.value = draft.js ?? STARTER_JS;
      const catSel = document.getElementById('game-category-select');
      if (catSel) catSel.value = draft.category || '';
      editorFiles = (draft.files && typeof draft.files === 'object') ? { ...draft.files } : {};
      editorEntry = draft.entryPath || currentEntryCandidate();
      editorCoverUrl = draft.coverImage || null;
      editorLinkUrl = draft.linkUrl || '';
      if (draft.title || draft.html || draft.linkUrl || Object.keys(editorFiles).length) {
        showToast('Restored your unsaved draft from this device.', 'info');
      }
    } else {
      if (titleInput) titleInput.value = '';
      if (descInput) descInput.value = '';
      if (htmlTa) htmlTa.value = STARTER_HTML;
      if (cssTa) cssTa.value = STARTER_CSS;
      if (jsTa) jsTa.value = STARTER_JS;
      const catSel = document.getElementById('game-category-select');
      if (catSel) catSel.value = '';
      editorCoverUrl = null;
    }
    renderGameCoverPreview();
  }

  // Link box: existing link games restore their URL (drafts did above).
  const linkInput = document.getElementById('game-link-input');
  if (linkInput) linkInput.value = editorLinkUrl || '';
  updateGameLinkStatus();

  if (saveBtn) saveBtn.textContent = game ? 'Save changes' : 'Publish to Arcade';
  renderGameFilesPane();
  // Link games open on their Link tab; the hero's "Add a game by link" CTA
  // lands there too (opts.focusPane === 'link').
  const focusLink = opts?.focusPane === 'link' || (game && game.kind === 'link' && game.linkUrl);
  setCodePane(focusLink ? 'link' : 'html');
  // "Create with AI" entry points land with the prompt panel already open.
  if (opts?.ai) toggleAiPanel(true);
  scheduleGamePreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function closeGameEditor() {
  const { browse, editor } = els();
  if (editor) editor.style.display = 'none';
  if (browse) browse.style.display = 'block';
  editingGameId = null;
  editorCoverBusy = false;
  window.HubbleNest?.onArcadeEditorClose?.();
}

/* ------------------------------------------------------------------
   Game cover image — upload / replace / remove (author's own games)
   ------------------------------------------------------------------ */

function renderGameCoverPreview() {
  const wrap = document.getElementById('game-cover-preview');
  const removeBtn = document.getElementById('game-cover-remove');
  if (!wrap) return;
  if (editorCoverUrl) {
    wrap.innerHTML = `<img src="${escapeHtml(editorCoverUrl)}" alt="Game cover" onerror="this.parentElement.innerHTML='<span class=\"game-cover-placeholder\">🎨</span>'" />`;
  } else {
    wrap.innerHTML = `<span class="game-cover-placeholder">🎨</span>`;
  }
  if (removeBtn) removeBtn.style.display = editorCoverUrl ? 'inline-flex' : 'none';
}

/** Pick (or replace) the cover image of the game being edited. */
export async function handleGameCoverUpload(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Covers must be an image (PNG, JPG, WebP…).', 'warning');
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    showToast('Cover images are capped at 15 MB.', 'warning');
    return;
  }
  const statusEl = document.getElementById('game-cover-status');
  const input = document.getElementById('game-cover-input');
  editorCoverBusy = true;
  if (statusEl) statusEl.textContent = 'Uploading cover…';
  try {
    const res = await uploadToCloudinary(file, (pct) => {
      if (statusEl) statusEl.textContent = `Uploading cover… ${Math.round(pct)}%`;
    }, 15);
    editorCoverUrl = res.url;
    renderGameCoverPreview();
    if (statusEl) statusEl.textContent = 'Cover ready ✓ (saved when you publish)';
    showToast('Cover uploaded — press Publish / Save changes to apply it.', 'success', 3200);
    saveEditorDraft();
  } catch (err) {
    console.warn('Cover upload failed:', err);
    if (statusEl) statusEl.textContent = '';
    showToast(err.message || 'Could not upload the cover image.', 'error', 6000);
  } finally {
    editorCoverBusy = false;
    if (input) input.value = '';
  }
}

/** Remove the cover image of the game being edited. */
export function removeGameCover() {
  editorCoverUrl = null;
  renderGameCoverPreview();
  const statusEl = document.getElementById('game-cover-status');
  if (statusEl) statusEl.textContent = 'Cover removed — save to apply.';
  saveEditorDraft();
}

export function setCodePane(pane) {
  ['html', 'css', 'js', 'files', 'link'].forEach(p => {
    document.getElementById(`game-tab-${p}`)?.classList.toggle('feed-tab-active', p === pane);
    document.getElementById(`game-pane-${p}`)?.style.setProperty('display', p === pane ? 'block' : 'none');
  });
}

/* ------------------------------------------------------------------
   Games from links — validate + normalize the pasted URL
   ------------------------------------------------------------------ */

/** Read the link box: { ok, url, host } · { ok:false, empty:true } · { ok:false, error }. */
function readGameLink() {
  const raw = (document.getElementById('game-link-input')?.value || '').trim();
  if (!raw) return { ok: false, empty: true, error: '' };
  let u;
  try { u = new URL(raw); } catch (e) { return { ok: false, error: 'not-a-url' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'not-https' };
  if (!u.hostname.includes('.')) return { ok: false, error: 'not-a-url' };
  return { ok: true, url: u.href, host: u.hostname.replace(/^www\./, '') };
}

/** Inline validation line under the link box (+ auto-title from the URL slug). */
function updateGameLinkStatus() {
  const el = document.getElementById('game-link-status');
  const link = readGameLink();
  if (!el) return link;
  if (link.empty) { el.textContent = ''; el.className = 'game-link-status'; return link; }
  if (link.ok) {
    el.innerHTML = `✓ Will play live from <b>${escapeHtml(link.host)}</b> inside the app.`;
    el.className = 'game-link-status ok';
    // While the title is still empty, suggest one from the URL slug —
    // "neon-drift" becomes "Neon Drift". Deterministic, never invented.
    const titleInput = document.getElementById('game-title-input');
    if (titleInput && !titleInput.value.trim()) {
      const slug = decodeURIComponent((link.url.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').pop() || ''));
      const pretty = slug.replace(/[-_+.]+/g, ' ').trim().replace(/\s+/g, ' ');
      const fromTitle = pretty ? pretty.replace(/\b\w/g, c => c.toUpperCase()) : link.host;
      if (fromTitle) titleInput.value = fromTitle.slice(0, 80);
    }
  } else {
    el.innerHTML = link.error === 'not-https'
      ? '⚠ Only <b>https://</b> links can run inside the app — browsers block insecure frames.'
      : '⚠ That does not look like a full URL — paste something like <b>https://your-game.itch.io/neon-drift</b>.';
    el.className = 'game-link-status bad';
  }
  return link;
}

/** Editor input handler for the link box. */
export function onGameLinkInput() {
  updateGameLinkStatus();
  scheduleGamePreview();
}

/** Clear the link box — the game falls back to its code/files (if any). */
export function clearGameLink() {
  const input = document.getElementById('game-link-input');
  if (input) input.value = '';
  const el = document.getElementById('game-link-status');
  if (el) { el.textContent = 'Link cleared — this game will use its code/files again.'; el.className = 'game-link-status'; }
  scheduleGamePreview();
}

/** "Open in new tab" on the live-play note bar (escape hatch for sites
    that refuse to be framed — honest, never a fake blank frame). */
export function openLinkGameExternally() {
  if (!playingLinkUrl) return;
  window.open(playingLinkUrl, '_blank', 'noopener');
}

/** Toolbar + note-bar adjustments while an external game is open. */
function setPlayerLinkChrome(isLink, game) {
  playingLinkUrl = isLink ? (game?.linkUrl || null) : null;
  // Pause/Sound speak the internal game bridge over postMessage — an
  // external site does not understand it, so hide them instead of
  // pretending a random web game can be frozen from here.
  document.getElementById('arc-tool-pause')?.toggleAttribute('hidden', isLink);
  document.getElementById('arc-tool-sound')?.toggleAttribute('hidden', isLink);
  const note = document.getElementById('player-link-note');
  if (note) {
    note.hidden = !isLink;
    const txt = document.getElementById('player-link-note-text');
    if (txt && isLink) {
      txt.innerHTML = `Playing live from <b>${escapeHtml(game.linkHost || 'its own site')}</b> — if the frame stays blank, the site blocks embedding.`;
    }
  }
}

export function insertStarterGame() {
  const htmlTa = document.getElementById('game-code-html');
  const cssTa = document.getElementById('game-code-css');
  const jsTa = document.getElementById('game-code-js');
  if (!htmlTa || !cssTa || !jsTa) return;
  if ((htmlTa.value.trim() || cssTa.value.trim() || jsTa.value.trim()) &&
      !window.confirm('Replace the current code with the starter game? Your current code will be lost.')) {
    return;
  }
  const titleInput = document.getElementById('game-title-input');
  if (titleInput && !titleInput.value.trim()) titleInput.value = 'Orbit Catch';
  htmlTa.value = STARTER_HTML;
  cssTa.value = STARTER_CSS;
  jsTa.value = STARTER_JS;
  setCodePane('html');
  scheduleGamePreview();
  showToast('Starter game inserted — press Preview to play it right now.', 'success');
}

export function scheduleGamePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderGamePreview, 400);
  saveEditorDraft();
}

function saveEditorDraft() {
  if (editingGameId) return; // only autosave drafts for NEW games
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      title: document.getElementById('game-title-input')?.value || '',
      description: document.getElementById('game-desc-input')?.value || '',
      category: document.getElementById('game-category-select')?.value || '',
      html: document.getElementById('game-code-html')?.value || '',
      css: document.getElementById('game-code-css')?.value || '',
      js: document.getElementById('game-code-js')?.value || '',
      files: editorFiles,
      entryPath: editorEntry,
      coverImage: editorCoverUrl,
      linkUrl: document.getElementById('game-link-input')?.value || '',
      savedAt: Date.now()
    }));
  } catch (e) { /* quota — non-fatal */ }
}

function renderGamePreview() {
  const frame = document.getElementById('game-preview-frame');
  if (!frame) return;
  const link = readGameLink();
  if (link.ok) {
    // The linked game plays live in the preview too — same frame the
    // published game will use, with the same external sandbox.
    frame.setAttribute('sandbox', LINK_SANDBOX);
    frame.removeAttribute('srcdoc');
    if (frame.src !== link.url) frame.src = link.url;
    return;
  }
  frame.setAttribute('sandbox', CODE_SANDBOX);
  frame.removeAttribute('src'); // a previous link preview must stop loading
  const entry = currentEntryCandidate();
  if (entry) {
    frame.srcdoc = buildSrcDocFromFiles(editorFiles, entry);
  } else {
    frame.srcdoc = buildSrcDoc(
      document.getElementById('game-code-html')?.value || '',
      document.getElementById('game-code-css')?.value || '',
      document.getElementById('game-code-js')?.value || ''
    );
  }
}

/* ------------------------------------------------------------------
   Editor files pane
   ------------------------------------------------------------------ */

function currentEntryCandidate() {
  if (editorEntry && (editorEntry in editorFiles)) return editorEntry;
  const paths = Object.keys(editorFiles);
  return paths.find(p => /(^|\/)index\.html?$/i.test(p)) || paths.find(p => /\.html?$/i.test(p)) || null;
}

function gameProjectBytes() {
  let total = 0;
  for (const content of Object.values(editorFiles)) total += content.length;
  total += (document.getElementById('game-code-html')?.value || '').length;
  total += (document.getElementById('game-code-css')?.value || '').length;
  total += (document.getElementById('game-code-js')?.value || '').length;
  return total;
}

export async function handleGameFilesUpload(fileList) {
  const incoming = Array.from(fileList || []);
  if (incoming.length === 0) return;

  let added = 0, skipped = 0;
  for (const file of incoming) {
    const path = normalizeGamePath(file.webkitRelativePath || file.name);
    if (!path) { skipped++; continue; }
    if (file.size > MAX_SINGLE_FILE_BYTES) {
      skipped++;
      showToast(`${path} is ${(file.size / 1024).toFixed(0)} KB — single files are capped at ${MAX_SINGLE_FILE_BYTES / 1024} KB.`, 'warning');
      continue;
    }
    try {
      const content = await file.text();
      if (content.includes('\u0000')) {
        skipped++;
        showToast(`${path} looks binary — game projects accept code/text files.`, 'warning');
        continue;
      }
      editorFiles[path] = content;
      added++;
    } catch (err) {
      skipped++;
      console.warn('Could not read', path, err);
    }
  }

  const count = Object.keys(editorFiles).length;
  if (count > MAX_FILE_COUNT) {
    showToast(`Game projects hold up to ${MAX_FILE_COUNT} files.`, 'warning');
  }
  editorEntry = currentEntryCandidate();

  if (added > 0) {
    showToast(`${added} file${added === 1 ? '' : 's'} added${skipped ? ` · ${skipped} skipped` : ''}. Entry: ${editorEntry || 'no .html file yet'}`, 'success', 4200);
  } else if (skipped > 0) {
    showToast('No usable code files were added.', 'warning');
  }

  renderGameFilesPane();
  scheduleGamePreview();
  const filesInput = document.getElementById('game-files-input');
  const folderInput = document.getElementById('game-folder-input');
  if (filesInput) filesInput.value = '';
  if (folderInput) folderInput.value = '';
}

export function removeGameFile(path) {
  delete editorFiles[path];
  editorEntry = currentEntryCandidate();
  renderGameFilesPane();
  scheduleGamePreview();
}

export function setGameEntry(path) {
  if (!(path in editorFiles)) return;
  editorEntry = path;
  renderGameFilesPane();
  scheduleGamePreview();
  showToast(`Entry file set to ${path}.`, 'info');
}

/** Index-based wrappers — safe against quotes/apostrophes in file paths. */
export function setGameEntryByIndex(idx) {
  const paths = Object.keys(editorFiles).sort();
  const p = paths[Number(idx)];
  if (p) setGameEntry(p);
}

export function removeGameFileByIndex(idx) {
  const paths = Object.keys(editorFiles).sort();
  const p = paths[Number(idx)];
  if (p) removeGameFile(p);
}

export function clearGameFiles() {
  if (Object.keys(editorFiles).length === 0) return;
  if (!window.confirm('Remove all uploaded project files from this game?')) return;
  editorFiles = {};
  editorEntry = null;
  renderGameFilesPane();
  scheduleGamePreview();
}

/* ==================================================================
   AI GAME BUILDER — create a complete game from a text prompt.
   Uses Gemini when a key is configured (Settings → AI Game Builder),
   and the built-in game-engine synthesizer otherwise. Both paths
   produce a REAL playable game in the editor with a live preview.
   ================================================================== */

export function toggleAiPanel(force) {
  const panel = document.getElementById('game-ai-panel');
  if (!panel) return;
  const open = typeof force === 'boolean' ? force : panel.hasAttribute('hidden');
  if (open) {
    panel.removeAttribute('hidden');
    refreshAiPanelStatus();
    const ta = document.getElementById('game-ai-prompt');
    if (ta) ta.focus({ preventScroll: true });
  } else {
    panel.setAttribute('hidden', '');
  }
}

export async function refreshAiPanelStatus() {
  const el = document.getElementById('game-ai-status-line');
  if (!el) return;
  const cfg = await getAiConfig();
  if (!cfg.apiKey) {
    el.innerHTML = `Running on the <b>built-in game engine</b> — real playable games from your prompt, no key needed. For fully AI-written games the admin adds a key once in Profile &amp; Settings → AI configuration.`;
    return;
  }
  const fail = getLastAiFailure();
  el.innerHTML = fail
    ? `⚠ <b>The AI rejected the last request</b> (${escapeHtml(String(fail.message || fail.kind).slice(0, 110))}) — prompts fall back to the built-in engine until the admin fixes the AI configuration in Profile &amp; Settings.`
    : `✨ <b>AI connected</b> (${escapeHtml(cfg.model)}) — your prompts are written into full custom games.`;
}

function setEditorCode({ title, description, html, css, js }) {
  const t = document.getElementById('game-title-input');
  const d = document.getElementById('game-desc-input');
  const h = document.getElementById('game-code-html');
  const c = document.getElementById('game-code-css');
  const j = document.getElementById('game-code-js');
  if (t && title) t.value = title;
  if (d && description) d.value = description;
  if (h) h.value = html || '';
  if (c) c.value = css || '';
  if (j) j.value = js || '';
}

/** Prompt → complete game in the classic editor triple (no files involved). */
export async function generateGameFromPrompt() {
  const promptEl = document.getElementById('game-ai-prompt');
  const statusEl = document.getElementById('game-ai-generate-status');
  const btn = document.getElementById('game-ai-generate');
  const prompt = (promptEl?.value || '').trim();
  if (!prompt) {
    showToast('Describe the game you want first — e.g. "a fast neon snake game with obstacles".', 'warning');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  if (statusEl) statusEl.textContent = 'Building your game…';
  try {
    const result = await generateGameCode(prompt);
    setEditorCode(result);
    editorEntry = null; // classic triple runs (files stay untouched)
    renderGameFilesPane();
    setCodePane('html');
    scheduleGamePreview();
    saveEditorDraft();
    if (statusEl) {
      statusEl.textContent = result.source === 'gemini'
        ? '✓ Game written by the AI exactly from your description — tweak anything, then Publish.'
        : '⚠ The AI was unavailable, so a starter template was built instead' +
          (result.fallbackReason ? ` — ${String(result.fallbackReason).slice(0, 130)}` : '') +
          '. It may not match every detail of your description — the admin can fix the AI in Profile & Settings → AI configuration, then generate again.';
    }
    if (result.source === 'gemini') {
      showToast('Game generated from your description — press Play in the live preview!', 'success', 4200);
    } else {
      showToast('AI unavailable — a starter template was built instead. See the note under the Generate button for the exact reason.', 'warning', 6500);
    }
  } catch (err) {
    console.error('AI game generation failed:', err);
    if (statusEl) statusEl.textContent = 'Generation failed: ' + (err.message || 'unknown error');
    showToast('Could not generate the game: ' + (err.message || 'unknown error'), 'error', 6000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate my game'; }
  }
}

/** Context from an uploaded non-web project so AI can scaffold a playable shell. */
function buildProjectContext() {
  const paths = Object.keys(editorFiles).sort();
  if (paths.length === 0) return '';
  const langs = detectLanguages(editorFiles);
  const codeExt = /\.(py|js|ts|java|c|cpp|h|hpp|cs|rb|go|rs|lua|php|swift|kt|m)$/i;
  const mainPath = paths.find((p) => codeExt.test(p)) || paths[0];
  const snippet = mainPath ? String(editorFiles[mainPath]).slice(0, 1400) : '';
  return `\n\nContext: the member also uploaded a code project (${(langs || []).join(', ') || 'source files'}): ${paths.slice(0, 12).join(', ')}.` +
    (snippet ? ` Main file ${mainPath} starts with:\n${snippet}` : '');
}

/**
 * Uploaded a Python/Java/… project with no HTML entry? One tap generates a
 * playable browser game INSPIRED BY the project and drops it in as
 * index.html + ai-game.css + ai-game.js alongside the original source files
 * (which remain browsable in the player). Uses Gemini when configured,
 * the built-in synthesizer otherwise.
 */
export async function scaffoldProjectWithAi() {
  const paths = Object.keys(editorFiles);
  if (paths.length === 0) {
    showToast('Upload your project files first, then generate the playable version.', 'info');
    return;
  }
  const btn = document.getElementById('game-ai-scaffold');
  const promptEl = document.getElementById('game-ai-prompt');
  const userPrompt = (promptEl?.value || '').trim();
  const langs = detectLanguages(editorFiles);
  const prompt = (userPrompt || 'Create a playable browser game inspired by this uploaded code project.') + buildProjectContext();
  if (btn) { btn.disabled = true; btn.textContent = 'Building…'; }
  try {
    const result = await generateGameCode(prompt);
    // The generated game becomes REAL files so the existing player/builder
    // machinery runs it — while the member's original sources stay listed.
    editorFiles['index.html'] = result.html + '\n<link rel="stylesheet" href="./ai-game.css">\n<script src="./ai-game.js"><\/script>';
    editorFiles['ai-game.css'] = result.css || '';
    editorFiles['ai-game.js'] = result.js || '';
    // If the uploaded project already had an index.html, the generated one wins.
    editorEntry = 'index.html';
    setEditorCode({ title: result.title, description: result.description, html: '', css: '', js: '' });
    renderGameFilesPane();
    setCodePane('files');
    scheduleGamePreview();
    saveEditorDraft();
    if (result.source === 'gemini') {
      showToast(`Playable version generated as index.html — your ${paths.length} source file${paths.length === 1 ? '' : 's'} stay${paths.length === 1 ? 's' : ''} in the project.`, 'success', 5200);
    } else {
      showToast(`Playable shell built by the built-in engine${result.fallbackReason ? ` — the AI was unavailable (${String(result.fallbackReason).slice(0, 80)})` : ''}. Your source files stay in the project.`, 'warning', 6500);
    }
  } catch (err) {
    console.error('AI scaffold failed:', err);
    showToast('Could not generate a playable version: ' + (err.message || 'unknown error'), 'error', 6000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Make it playable with AI'; }
  }
}

function renderGameFilesPane() {
  const pane = document.getElementById('game-files-list');
  const badge = document.getElementById('game-files-badge');
  const wrap = document.getElementById('game-pane-files');
  if (!pane) return;
  const paths = Object.keys(editorFiles).sort();
  if (badge) badge.textContent = paths.length ? `${paths.length}` : '';
  if (wrap) wrap.style.display = 'block';
  if (paths.length === 0) {
    pane.innerHTML = `<div class="game-files-empty">No project files uploaded yet — add a folder of code (HTML, CSS, JS, JSON, Python, any text language) and it runs from its own index.html.</div>`;
    return;
  }
  pane.innerHTML = paths.map((p, idx) => {
    const isEntry = p === editorEntry;
    const isHtml = /\.html?$/i.test(p);
    return `
      <div class="game-file-row ${isEntry ? 'game-file-entry' : ''}">
        <span class="game-file-path" title="${escapeHtml(p)}">${escapeHtml(p)}</span>
        <span class="game-file-size">${formatBytes(editorFiles[p].length)}</span>
        ${isEntry
          ? `<span class="game-file-entry-chip">Entry</span>`
          : (isHtml ? `<button type="button" class="btn-ghost game-file-btn" data-game-set-entry="${idx}">Set entry</button>` : '')}
        <button type="button" class="btn-ghost game-file-btn game-file-remove" title="Remove file" data-game-remove="${idx}">✕</button>
      </div>`;
  }).join('');

  // Delegated clicks resolved through INDEX lookups — file paths may contain
  // quotes or apostrophes that would break inline onclick="…'${p}'…" strings.
  if (wrap && !wrap.dataset.gameFilesWired) {
    wrap.dataset.gameFilesWired = '1';
    wrap.addEventListener('click', (ev) => {
      const setBtn = ev.target.closest('[data-game-set-entry]');
      if (setBtn) { setGameEntryByIndex(Number(setBtn.dataset.gameSetEntry)); return; }
      const rmBtn = ev.target.closest('[data-game-remove]');
      if (rmBtn) removeGameFileByIndex(Number(rmBtn.dataset.gameRemove));
    });
  }
}

export async function saveCurrentGame() {
  const title = document.getElementById('game-title-input')?.value.trim();
  const description = document.getElementById('game-desc-input')?.value.trim();
  const html = document.getElementById('game-code-html')?.value || '';
  const css = document.getElementById('game-code-css')?.value || '';
  const js = document.getElementById('game-code-js')?.value || '';
  const statusEl = document.getElementById('game-editor-status');
  const saveBtn = document.getElementById('game-save-btn');

  const me = window.HubbleNest?._state?.userProfile;
  const uid = myUid();
  if (!me || !uid) { showToast('Sign in to publish a game.', 'error'); return; }

  if (!title) { showToast('Give your game a title first.', 'warning'); return; }
  const entry = currentEntryCandidate();
  const total = gameProjectBytes();
  if (total > MAX_TOTAL_BYTES) {
    showToast(`Your game is ${(total / 1024).toFixed(0)} KB — the limit is ${MAX_TOTAL_BYTES / 1024} KB. Trim it down.`, 'error');
    return;
  }
  const hasClassic = html.trim() || js.trim();
  const hasFiles = Object.keys(editorFiles).length > 0;
  // A game link (Link tab) is a full third creation path: an https URL to a
  // playable HTML5 web game. It wins over code/files at play time.
  const link = readGameLink();
  if (!link.ok && !link.empty) {
    showToast(link.error === 'not-https'
      ? 'Game links must start with https:// — browsers block insecure frames.'
      : 'That game link is not a full URL — fix it or clear the Link tab.', 'warning');
    setCodePane('link');
    return;
  }
  const hasLink = link.ok;
  if (!hasLink && !hasClassic && !hasFiles) { showToast('Add a game link, some HTML or JavaScript — or upload your project files.', 'warning'); return; }
  // Source-only projects (no HTML entry) are WELCOME: they are stored and
  // shared as readable source. The player shows the file tree and explains
  // that the browser cannot execute e.g. Python without a real runtime. 

  // A cover upload still in flight finishes before the save (its URL lands
  // in the same write; no half-published covers).
  if (editorCoverBusy) {
    showToast('Finishing the cover upload…', 'info', 2200);
    const waitStart = Date.now();
    while (editorCoverBusy && Date.now() - waitStart < 20000) {
      await new Promise(r => setTimeout(r, 120));
    }
  }

  const existing = editingGameId ? gamesCache.find(g => g.id === editingGameId) : null;

  // v30 split: the game's SOURCE CODE goes to games/{id}/code/main, so the
  // realtime browse list only carries display fields (the old layout kept
  // every game's full source inside its main doc, and Firestore re-delivered
  // the entire collection's code on every play/like — the cause of slow
  // Arcade loads). entryPath/fileCount/languages stay on the main doc: the
  // list and detail views need them for routing and honest runnability.
  const codePayload = {
    html, css, js,
    files: hasFiles ? editorFiles : null
  };
  const payload = {
    title: title.slice(0, 80),
    description: description.slice(0, 300),
    category: (document.getElementById('game-category-select')?.value || '').slice(0, 40),
    isPublic: !!document.getElementById('game-public-input')?.checked,
    entryPath: hasFiles ? entry : null,
    fileCount: hasFiles ? Object.keys(editorFiles).length : 0,
    languages: hasFiles ? detectLanguages(editorFiles) : [],
    runnable: hasLink ? true : (hasFiles ? !!entry : !!(html.trim() || js.trim())),
    // Link games: kind:'link' + the normalized URL + display host. Code games
    // carry empty strings (stable doc shape — no field deletions needed).
    kind: hasLink ? 'link' : '',
    linkUrl: hasLink ? link.url : '',
    linkHost: hasLink ? link.host : '',
    coverImage: editorCoverUrl || null,
    authorId: uid,
    authorName: me.displayName || 'Member',
    authorPhoto: me.photoURL || '',
    updatedAt: serverTimestamp()
  };

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Publishing…'; }
  if (statusEl) { statusEl.textContent = 'Saving to Firestore…'; }

  try {
    let gameId = editingGameId;
    if (existing) {
      // Update + migrate: strip the legacy top-level code fields so this
      // game stops weighing the browse snapshot down from now on.
      await updateDoc(doc(db, 'games', existing.id), {
        ...payload,
        html: deleteField(),
        css: deleteField(),
        js: deleteField(),
        files: deleteField()
      });
      await setDoc(doc(db, 'games', existing.id, 'code', 'main'), codePayload);
    } else {
      payload.plays = 0;
      payload.likedBy = [];
      payload.createdAt = serverTimestamp();
      const ref = doc(collection(db, 'games'));
      await setDoc(ref, payload);
      await setDoc(doc(db, 'games', ref.id, 'code', 'main'), codePayload);
      gameId = ref.id;
    }
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    fullGameCache.delete(gameId); // the code changed — re-fetch on next open
    showToast(existing ? 'Game updated ✓' : 'Published to the Arcade ✓', 'success');
    if (statusEl) { statusEl.textContent = ''; }
    closeGameEditor();
    // Land on the game's detail page (falls back to the player if the
    // Arcade experience layer is unavailable).
    setTimeout(() => {
      if (window.HubbleNest?.openGameDetail) window.HubbleNest.openGameDetail(gameId);
      else openGamePlayer(gameId);
    }, 350);
  } catch (err) {
    console.error('Game save failed:', err);
    if (statusEl) { statusEl.textContent = ''; }
    showToast(err?.code === 'permission-denied'
      ? 'Saving the game was blocked by your Firebase security rules — check your sign-in state and try again.'
      : (err.message || 'Could not save the game.'), 'error');
    if (err?.code === 'permission-denied') handlePermissionError('arcade save');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = existing ? 'Save changes' : 'Publish to Arcade'; }
  }
}

export async function gameDelete(gameId) {
  const game = gamesCache.find(g => g.id === gameId);
  if (!game || game.authorId !== myUid()) return;
  if (!window.confirm(`Delete "${game.title}" permanently? Play counts and likes are lost too.`)) return;
  try {
    // v30: the source code lives in a subcollection doc — Firestore deletes
    // do NOT cascade, so remove it explicitly (legacy games have none).
    try { await deleteDoc(doc(db, 'games', gameId, 'code', 'main')); } catch (e) { /* no code doc — legacy layout */ }
    await deleteDoc(doc(db, 'games', gameId));
    showToast('Game deleted.', 'info');
    // If its detail page is open, return to the games list (nothing to show).
    if (window.HubbleNest?._state?.currentView === 'arcade' &&
        document.getElementById('arcade-detail')?.style.display === 'block') {
      window.HubbleNest?.arcGo?.('games');
    }
  } catch (err) {
    console.error('Game delete failed:', err);
    showToast('Could not delete the game.', 'error');
  }
}

/* ========================================================================
   Player
   ======================================================================== */

/**
 * v30 load-speed core: the browse list no longer carries game code (new and
 * re-saved games keep their source in games/{id}/code/main — see
 * saveCurrentGame), so before actually RUNNING or EDITING a game its code is
 * fetched once from the code doc, with a legacy fallback to top-level fields
 * for games published before v30. Restart/re-open are instant afterwards.
 */
async function ensureFullGame(gameId) {
  const cached = gamesCache.find(g => g.id === gameId);
  if (!cached) return null;
  if (cached._fullDoc || (cached.kind === 'link' && cached.linkUrl)) return cached;

  let full = null;
  let legacyLayout = false;
  try {
    const codeSnap = await getDoc(doc(db, 'games', gameId, 'code', 'main'));
    if (codeSnap.exists()) {
      full = { ...cached, ...codeSnap.data() };
    }
  } catch (err) {
    console.warn('Game code doc read failed:', err?.code || err);
  }
  if (!full) {
    try {
      const snap = await getDoc(doc(db, 'games', gameId));
      if (snap.exists()) {
        full = { ...cached, ...snap.data() };
        // A legacy game keeps its code in the main document.
        if (full.html !== undefined || full.js !== undefined || full.files !== undefined) legacyLayout = true;
      }
    } catch (err) {
      console.warn('Full game fetch failed:', err?.code || err);
    }
  }
  if (!full) return cached; // unreachable doc — play exactly what we have
  fullGameCache.set(gameId, full);
  const merged = { ...full, _fullDoc: true };
  gamesCache = gamesCache.map(g => (g.id === gameId ? merged : g));
  // Own legacy game opened → compact its storage once (author-only write).
  if (legacyLayout && cached.authorId && cached.authorId === auth.currentUser?.uid) {
    migrateLegacyGameCode(gameId, full);
  }
  return merged;
}

/**
 * Legacy migration: move top-level html/css/js into the code doc and strip
 * the heavy fields from the main doc, so the browse snapshot gets lighter
 * every time an author opens one of their own games.
 */
async function migrateLegacyGameCode(gameId, full) {
  if (legacyMigrating.has(gameId)) return;
  legacyMigrating.add(gameId);
  try {
    await setDoc(doc(db, 'games', gameId, 'code', 'main'), {
      html: full.html || '',
      css: full.css || '',
      js: full.js || '',
      files: full.files || null
    });
    await updateDoc(doc(db, 'games', gameId), {
      html: deleteField(),
      css: deleteField(),
      js: deleteField(),
      files: deleteField()
    });
    console.info('[HubbleNest] Game storage compacted (code moved to the code doc):', gameId);
  } catch (err) {
    // Rules pending or offline — the game stays fully playable either way.
    console.warn('Code compaction skipped:', err?.code || err);
  } finally {
    legacyMigrating.delete(gameId);
  }
}

/** In-frame placeholder while the real game document streams in. */
function playerLoadingDoc() {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'html,body{height:100%;margin:0;background:#0b1024;display:flex;align-items:center;justify-content:center}' +
    'div{font-family:system-ui,-apple-system,sans-serif;font-size:14px;letter-spacing:.03em;color:#8ea0c8;text-align:center}' +
    '@keyframes hn-p{0%{opacity:.35}50%{opacity:1}100%{opacity:.35}}span{animation:hn-p 1.15s ease-in-out infinite}' +
    '</style></head><body><div><span>Loading game\u2026</span></div></body></html>';
}

export async function openGamePlayer(gameId) {
  let game = gamesCache.find(g => g.id === gameId);
  if (!game) { showToast('That game is no longer available.', 'error'); return; }

  const { browse, editor, player } = els();
  editor && (editor.style.display = 'none');
  browse && (browse.style.display = 'none');
  document.getElementById('arcade-detail') && (document.getElementById('arcade-detail').style.display = 'none');
  if (!player) return;
  player.style.display = 'block';

  // Restore the iframe if a previous source-only game replaced it with a panel.
  const wrap = player.querySelector('.game-player-frame-wrap');
  if (wrap && !wrap.querySelector('iframe')) {
    delete wrap.dataset.sourcePanel;
    wrap.innerHTML = '<iframe id="player-frame" title="Playable game" sandbox="allow-scripts allow-pointer-lock allow-modals" allowfullscreen="true"></iframe>';
  }

  playerGameId = gameId;
  const isLink = game.kind === 'link' && !!game.linkUrl;
  const titleEl = document.getElementById('player-title');
  const metaEl = document.getElementById('player-meta');
  const frame = document.getElementById('player-frame');
  const likeBtn = document.getElementById('player-like-btn');
  const descEl = document.getElementById('arc-play-desc');

  if (titleEl) titleEl.textContent = game.title || 'Untitled game';
  if (descEl) descEl.textContent = game.description || '';
  if (metaEl) {
    metaEl.innerHTML = `by <b>${escapeHtml(game.authorName || 'Member')}</b> · ${game.plays || 0} plays`;
  }
  if (frame) {
    if (isLink) {
      // LIVE EXTERNAL PLAY — the game keeps running on its own host, framed
      // in-app. Cross-origin isolation protects HubbleNest; the sandbox
      // grants the game storage/popups/fullscreen on its OWN origin.
      frame.setAttribute('sandbox', LINK_SANDBOX);
      frame.setAttribute('allow', LINK_ALLOW);
      frame.setAttribute('allowfullscreen', 'true');
      frame.removeAttribute('srcdoc');
      frame.src = game.linkUrl;
    } else {
      frame.setAttribute('sandbox', CODE_SANDBOX);
      frame.removeAttribute('allow');
      frame.setAttribute('allowfullscreen', 'true');
      // The player shows instantly with a loading frame while the real
      // document (one single-doc read) streams in — no blank wait.
      frame.srcdoc = playerLoadingDoc();
      const full = await ensureFullGame(gameId);
      if (playerGameId !== gameId) return; // the member left before it arrived
      if (full.entryPath && full.files) {
        frame.srcdoc = buildSrcDocFromFiles(full.files, full.entryPath);
      } else if (full.files && !full.entryPath) {
        // SOURCE PROJECT (no HTML entry): honest state — show the file tree and
        // say plainly that the browser cannot execute these languages.
        frame.remove();
        renderSourceProjectPanel(full);
      } else if (!full.html && !full.js) {
        // Code could not be loaded at all (rules pending / connection): say so
        // honestly instead of showing a silent blank frame.
        frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
          'html,body{height:100%;margin:0;background:#0b1024;display:flex;align-items:center;justify-content:center}' +
          'div{font-family:system-ui,sans-serif;color:#8ea0c8;font-size:14px;text-align:center;max-width:420px;line-height:1.6}' +
          '</style></head><body><div><b style="color:#dbe4ff">This game\u2019s code could not be loaded.</b><br>' +
          'Check your connection, then reopen the game. If it keeps failing, the project admin must publish the latest firestore.rules.</div></body></html>';
      } else {
        frame.srcdoc = buildSrcDoc(full.html, full.css, full.js);
      }
    }
  }
  setPlayerLinkChrome(isLink, game);
  renderPlayerLike(game);
  if (metaEl && game.fileCount > 0) {
    const langs = (game.languages || []).map(l => `<span class="player-files-chip">${escapeHtml(l)}</span>`).join(' ');
    metaEl.innerHTML += ` · <span class="player-files-chip">${game.fileCount} project file${game.fileCount === 1 ? '' : 's'}</span> ${langs}`;
  }
  if (metaEl && isLink) {
    metaEl.innerHTML += ` · <span class="player-live-chip" title="This game runs live from its own website inside the app"><svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-.5px;"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg> LIVE from ${escapeHtml(game.linkHost || 'the web')}</span>`;
  }

  // Arcade 2.0 gameplay shell: HUD/toolbar/info/progress/leaderboard/comments
  // panels + the play session (which owns the play counter — one bump per
  // FRESH session, refreshes within the resume window do not inflate it).
  window.HubbleNest?.onGameplayOpen?.(game);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Restart the RUNNING game in place — no new session, no play bump. */
export function restartCurrentGame() {
  const game = playerGameId ? gamesCache.find(g => g.id === playerGameId) : null;
  if (!game) return;
  const frame = document.getElementById('player-frame');
  if (game.kind === 'link' && game.linkUrl) {
    frame.src = game.linkUrl; // re-assignment navigates the frame afresh
  } else if (game.entryPath && game.files) {
    frame.srcdoc = buildSrcDocFromFiles(game.files, game.entryPath);
  } else if (game.files && !game.entryPath) {
    return; // source-only project — nothing to restart
  } else if (game._fullDoc) {
    frame.srcdoc = buildSrcDoc(game.html, game.css, game.js);
  } else {
    // Masked cache (no code yet) — fetch it, then restart for real.
    ensureFullGame(game.id).then((full) => {
      if (playerGameId === game.id && full && !full.entryPath && !(full.files && !full.entryPath)) {
        frame.srcdoc = buildSrcDoc(full.html, full.css, full.js);
      }
    });
  }
  window.HubbleNest?.onGameplayRestarted?.();
}

function renderPlayerLike(game) {
  const btn = document.getElementById('player-like-btn');
  if (!btn) return;
  const uid = myUid();
  const liked = Array.isArray(game.likedBy) && uid && game.likedBy.includes(uid);
  const likes = Array.isArray(game.likedBy) ? game.likedBy.length : (game.likeCount || 0);
  btn.classList.toggle('feed-action-liked', !!liked);
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
    <span>${likes || 'Like'}</span>`;
}

/**
 * Source-only project view: real file tree + a clear explanation of what the
 * browser can and cannot run. Nothing fake is displayed.
 */
function renderSourceProjectPanel(game) {
  const wrap = document.querySelector('.game-player-frame-wrap');
  if (!wrap) return;
  const files = game.files || {};
  const paths = Object.keys(files).sort();
  wrap.innerHTML = `
    <div class="game-source-panel">
      <h3 class="game-source-title">Source project — ${paths.length} file${paths.length === 1 ? '' : 's'}</h3>
      <p class="game-source-note">
        This project has no HTML entry file, so there is nothing a browser can
        execute here: ${(game.languages || ['these languages']).join(', ')} need a
        real runtime or compiler. The complete source is stored safely on
        HubbleNest — browse the files below.
      </p>
      <div class="game-files-list">
        ${paths.map(p => `
          <div class="game-file-row">
            <span class="game-file-path" title="${escapeHtml(p)}">${escapeHtml(p)}</span>
            <span class="game-file-size">${formatBytes((files[p] || '').length)}</span>
          </div>`).join('')}
      </div>
    </div>`;
  // Reset the wrap so re-opening a runnable game rebuilds the iframe cleanly.
  wrap.dataset.sourcePanel = '1';
}

export function closeGamePlayer() {
  const { browse, player } = els();
  // Leaving the player ALWAYS ends any fullscreen/immersive session.
  clearImmersiveFallback();
  try {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } catch (e) { /* ignore */ }
  // End the play session and tear down gameplay panels FIRST (score submits
  // happen inside this hook — the frame is still alive here).
  window.HubbleNest?.onGameplayClose?.();
  if (player) {
    player.style.display = 'none';
    const f = document.getElementById('player-frame');
    if (f) {
      f.removeAttribute('srcdoc');
      f.src = 'about:blank'; // unload external games/audio for real
    }
  }
  setPlayerLinkChrome(false, null);
  playerGameId = null;
  // After playing, Exit lands on the game's detail page when available.
  if (window.HubbleNest?.afterPlayerClose?.() === 'handled') return;
  if (browse) browse.style.display = 'block';
}

/* ---- v30 REAL fullscreen — the running game itself, not the app shell -- */

let fsExitBtn = null;

function clearImmersiveFallback() {
  const wrap = document.querySelector('.game-player-frame-wrap');
  if (wrap) wrap.classList.remove('hn-viewport-full');
  document.body.classList.remove('hn-frame-immersive');
  if (fsExitBtn) { fsExitBtn.remove(); fsExitBtn = null; }
}

/** iOS Safari ships no element fullscreen API — immersive fallback instead. */
function enterImmersiveFallback(wrap) {
  wrap.classList.add('hn-viewport-full');
  document.body.classList.add('hn-frame-immersive');
  if (!fsExitBtn) {
    fsExitBtn = document.createElement('button');
    fsExitBtn.type = 'button';
    fsExitBtn.className = 'hn-fs-exit';
    fsExitBtn.setAttribute('aria-label', 'Exit fullscreen');
    fsExitBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg><span>Exit</span>';
    fsExitBtn.addEventListener('click', clearImmersiveFallback);
    wrap.appendChild(fsExitBtn);
  }
  showToast('Immersive mode — tap Exit to return.', 'info', 2600);
}

export function toggleGameFullscreen() {
  const wrap = document.querySelector('.game-player-frame-wrap');
  if (!wrap) return;
  const frame = document.getElementById('player-frame');

  // Immersive fallback active → leave it.
  if (wrap.classList.contains('hn-viewport-full')) { clearImmersiveFallback(); return; }

  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* ignore */ }
    return;
  }

  // Fullscreen the RUNNING GAME FRAME itself (the real game fills the
  // screen); the wrapper is the fallback when the frame refuses.
  const frameReq = frame ? (frame.requestFullscreen || frame.webkitRequestFullscreen) : null;
  const wrapReq = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
  if (!frameReq && !wrapReq) { enterImmersiveFallback(wrap); return; }

  try {
    if (frameReq) {
      const p = frameReq.call(frame);
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          if (wrapReq) {
            const p2 = wrapReq.call(wrap);
            if (p2 && typeof p2.catch === 'function') p2.catch(() => enterImmersiveFallback(wrap));
          } else {
            enterImmersiveFallback(wrap);
          }
        });
      }
    } else {
      const p = wrapReq.call(wrap);
      if (p && typeof p.catch === 'function') p.catch(() => enterImmersiveFallback(wrap));
    }
  } catch (e) {
    enterImmersiveFallback(wrap);
  }
}

export async function gameToggleLike(gameId) {
  const game = gamesCache.find(g => g.id === gameId);
  const uid = myUid();
  if (!game || !uid) return;
  const liked = Array.isArray(game.likedBy) && game.likedBy.includes(uid);
  try {
    await updateDoc(doc(db, 'games', gameId), {
      likedBy: liked ? arrayRemove(uid) : arrayUnion(uid)
    });
    if (!liked && game.authorId && game.authorId !== uid) {
      addDoc(collection(db, 'notifications'), {
        userId: game.authorId,
        type: 'game_like',
        title: 'Someone likes your game',
        body: `${window.HubbleNest?._state?.userProfile?.displayName || 'A member'} liked "${game.title}".`,
        senderId: uid,
        gameId,
        isRead: false,
        createdAt: serverTimestamp()
      }).catch(() => {});
    }
    const fresh = gamesCache.find(g => g.id === gameId);
    if (playerGameId === gameId) renderPlayerLike(fresh || game);
  } catch (err) {
    console.error('Game like failed:', err);
    showToast('Could not save your like.', 'error');
  }
}
