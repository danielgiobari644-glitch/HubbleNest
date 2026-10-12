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
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
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

import { handlePermissionError } from './firestore-doctor.js';

/* ========================================================================
   State
   ======================================================================== */

let gamesUnsubscribe = null;
let gamesCache = [];
let arcadeFilter = 'all'; // 'all' | 'mine'
let editingGameId = null; // null = creating new
let playerGameId = null;
let previewTimer = null;

const MAX_TOTAL_BYTES = 600 * 1024; // well under Firestore's 1 MiB doc cap
const DRAFT_KEY = 'hn-arcade-draft';

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
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
var stage=document.getElementById('stage');
var launcher=document.getElementById('launcher');
var scoreEl=document.getElementById('score'),timeEl=document.getElementById('time'),bestEl=document.getElementById('best');
var best=Number(lsGet('orbit-best')||0);
bestEl.textContent=best;
var score=0,time=30,misses=0,running=false,spawner=null,ticker=null;

function end(msg){running=false;clearInterval(spawner);clearInterval(ticker);
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
  stage.appendChild(s);
  var fall=(function(el){
    var y=-40,v=2.2+Math.random()*1.6+(30-time)*0.06;
    return function(){if(!running){return;}
      y+=v;el.style.top=y+'px';
      if(y>window.innerHeight+40&&!el.dataset.done){el.dataset.done='1';
        if(!el.classList.contains('bomb')){misses++;if(misses>=3){end('Three slipped past.');}}
        el.remove();}};
  })(s);
  s.addEventListener('pointerdown',function(ev){if(!running||s.dataset.done)return;s.dataset.done='1';
    if(s.classList.contains('bomb')){end('You caught a red bomb!');s.remove();return;}
    score++;scoreEl.textContent=score;s.classList.add('boom');setTimeout(function(){s.remove()},180);});
  setIntervalSafe(fall);}

function setIntervalSafe(fn){var id=setInterval(fn,16);var old=ticker;clearInterval(old);ticker=id;}

document.getElementById('start').addEventListener('click',function(){
  score=0;time=30;misses=0;running=true;
  scoreEl.textContent='0';timeEl.textContent='30';
  launcher.style.display='none';
  spawner=setInterval(spawn,650);
  ticker=setInterval(function(){time--;timeEl.textContent=time;if(time<=0){end('Time!');}},1000);
  spawn();});`;

function buildSrcDoc(html, css, js) {
  // Neutralise script-closing sequences so member code can't break the wrapper.
  const safe = (s) => String(s || '').replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${safe(css)}</style></head><body>${safe(html)}
<script>${safe(js)}<\/script></body></html>`;
}

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

  const q = query(collection(db, 'games'), orderBy('createdAt', 'desc'), limit(60));
  gamesUnsubscribe = onSnapshot(q, (snap) => {
    gamesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (arcadeFilter === 'mine') renderArcadeGrid();
  }, (err) => {
    console.error('Arcade listener error:', err);
    const grid = els().grid;
    if (grid) {
      grid.innerHTML = `<div class="feed-error-card">
        <div class="feed-error-title">The Arcade could not load</div>
        <div class="feed-error-desc">${escapeHtml(err.code || 'error')} — the Connection Doctor can pinpoint the exact rule to fix.</div>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.HubbleNest.runFirestoreDoctor()">Run Connection Doctor</button></div>`;
    }
    if (err?.code === 'permission-denied') handlePermissionError('arcade');
  });
  renderArcadeGrid();
}

export function stopArcade() {
  gamesUnsubscribe?.();
  gamesUnsubscribe = null;
  gamesCache = [];
}

/* ========================================================================
   Browse grid
   ======================================================================== */

export function setArcadeFilter(filter) {
  arcadeFilter = filter === 'mine' ? 'mine' : 'all';
  document.getElementById('arcade-tab-all')?.classList.toggle('feed-tab-active', arcadeFilter === 'all');
  document.getElementById('arcade-tab-mine')?.classList.toggle('feed-tab-active', arcadeFilter === 'mine');
  renderArcadeGrid();
}

function myUid() { return window.HubbleNest?._state?.currentUser?.uid || null; }

export function renderArcadeGrid() {
  const grid = els().grid;
  if (!grid) return;
  const uid = myUid();

  const list = gamesCache
    .filter(g => arcadeFilter !== 'mine' || g.authorId === uid)
    .sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));

  const countEl = document.getElementById('arcade-count');
  if (countEl) {
    countEl.textContent = list.length === 1 ? '1 game' : `${list.length} games`;
  }

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="feed-empty">
        <div class="feed-empty-glyph">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="10.5" r="1"/></svg>
        </div>
        <h3 class="feed-empty-title">${arcadeFilter === 'mine' ? 'You haven\'t published a game yet' : 'The Arcade is empty — be the first'}</h3>
        <p class="feed-empty-desc">Write a game with HTML, CSS and JavaScript in the built-in editor. It takes about two minutes with the starter template, and anyone on HubbleNest can play it instantly.</p>
        <button type="button" class="btn btn-primary" onclick="window.HubbleNest.openGameEditor(null)">Create your first game</button>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(g => {
    const liked = Array.isArray(g.likedBy) && uid && g.likedBy.includes(uid);
    const likes = Array.isArray(g.likedBy) ? g.likedBy.length : (g.likeCount || 0);
    const mine = g.authorId === uid;
    const sid = escapeHtml(g.id);
    return `
      <article class="game-card" onclick="window.HubbleNest.openGamePlayer('${sid}')">
        <div class="game-card-thumb">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/><circle cx="15.5" cy="13" r="1"/><circle cx="17.5" cy="10.5" r="1"/></svg>
        </div>
        <div class="game-card-body">
          <h3 class="game-card-title">${escapeHtml(g.title || 'Untitled game')}</h3>
          <p class="game-card-desc">${escapeHtml((g.description || '').slice(0, 110) || 'No description')}${(g.description || '').length > 110 ? '…' : ''}</p>
          <div class="game-card-meta">
            <span class="game-card-author"><img src="${getAvatarUrl(g.authorPhoto, g.authorName)}" alt="" loading="lazy" /> ${escapeHtml(g.authorName || 'Member')}</span>
            <span>${formatTimeAgo(g.updatedAt || g.createdAt)}</span>
          </div>
        </div>
        <footer class="game-card-actions" onclick="event.stopPropagation()">
          <button type="button" class="feed-action ${liked ? 'feed-action-liked' : ''}" onclick="window.HubbleNest.gameToggleLike('${sid}')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
            <span>${likes || 'Like'}</span>
          </button>
          <span class="game-plays">${g.plays || 0} plays</span>
          ${mine ? `<button type="button" class="btn-ghost" style="color:var(--text-secondary);font-size:.75rem;" onclick="window.HubbleNest.openGameEditor('${sid}')">Edit</button>
                    <button type="button" class="btn-ghost" style="color:var(--status-danger);font-size:.75rem;" onclick="window.HubbleNest.gameDelete('${sid}')">Delete</button>`
                 : `<span class="game-play-cta">▶ Play</span>`}
        </footer>
      </article>`;
  }).join('');
}

/* ========================================================================
   Editor
   ======================================================================== */

export function openGameEditor(gameId) {
  const { browse, editor, player } = els();
  if (!browse || !editor) return;

  player && (player.style.display = 'none');
  browse.style.display = 'none';
  editor.style.display = 'block';
  editingGameId = gameId;

  const game = gameId ? gamesCache.find(g => g.id === gameId) : null;

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
  } else {
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
      if (draft.title || draft.html) {
        showToast('Restored your unsaved draft from this device.', 'info');
      }
    } else {
      if (titleInput) titleInput.value = '';
      if (descInput) descInput.value = '';
      if (htmlTa) htmlTa.value = STARTER_HTML;
      if (cssTa) cssTa.value = STARTER_CSS;
      if (jsTa) jsTa.value = STARTER_JS;
    }
  }

  if (saveBtn) saveBtn.textContent = game ? 'Save changes' : 'Publish to Arcade';
  setCodePane('html');
  scheduleGamePreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function closeGameEditor() {
  const { browse, editor } = els();
  if (editor) editor.style.display = 'none';
  if (browse) browse.style.display = 'block';
  editingGameId = null;
}

export function setCodePane(pane) {
  ['html', 'css', 'js'].forEach(p => {
    document.getElementById(`game-tab-${p}`)?.classList.toggle('feed-tab-active', p === pane);
    document.getElementById(`game-pane-${p}`)?.style.setProperty('display', p === pane ? 'block' : 'none');
  });
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
      html: document.getElementById('game-code-html')?.value || '',
      css: document.getElementById('game-code-css')?.value || '',
      js: document.getElementById('game-code-js')?.value || '',
      savedAt: Date.now()
    }));
  } catch (e) { /* quota — non-fatal */ }
}

function renderGamePreview() {
  const frame = document.getElementById('game-preview-frame');
  if (!frame) return;
  frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock allow-modals');
  frame.srcdoc = buildSrcDoc(
    document.getElementById('game-code-html')?.value || '',
    document.getElementById('game-code-css')?.value || '',
    document.getElementById('game-code-js')?.value || ''
  );
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
  const total = html.length + css.length + js.length;
  if (total > MAX_TOTAL_BYTES) {
    showToast(`Your game is ${(total / 1024).toFixed(0)} KB — the limit is ${MAX_TOTAL_BYTES / 1024} KB. Trim it down.`, 'error');
    return;
  }
  if (!html.trim() && !js.trim()) { showToast('Add at least some HTML or JavaScript.', 'warning'); return; }

  const existing = editingGameId ? gamesCache.find(g => g.id === editingGameId) : null;

  const payload = {
    title: title.slice(0, 80),
    description: description.slice(0, 300),
    html, css, js,
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
      await updateDoc(doc(db, 'games', existing.id), payload);
    } else {
      payload.plays = 0;
      payload.likedBy = [];
      payload.createdAt = serverTimestamp();
      const ref = doc(collection(db, 'games'));
      await setDoc(ref, payload);
      gameId = ref.id;
    }
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    showToast(existing ? 'Game updated ✓' : 'Published to the Arcade ✓', 'success');
    if (statusEl) { statusEl.textContent = ''; }
    closeGameEditor();
    setTimeout(() => openGamePlayer(gameId), 350);
  } catch (err) {
    console.error('Game save failed:', err);
    if (statusEl) { statusEl.textContent = ''; }
    showToast(err?.code === 'permission-denied'
      ? 'The rules on your Firebase project block saving games — run Connection Doctor.'
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
    await deleteDoc(doc(db, 'games', gameId));
    showToast('Game deleted.', 'info');
  } catch (err) {
    console.error('Game delete failed:', err);
    showToast('Could not delete the game.', 'error');
  }
}

/* ========================================================================
   Player
   ======================================================================== */

export function openGamePlayer(gameId) {
  const game = gamesCache.find(g => g.id === gameId);
  if (!game) { showToast('That game is no longer available.', 'error'); return; }

  const { browse, editor, player } = els();
  editor && (editor.style.display = 'none');
  browse && (browse.style.display = 'none');
  if (!player) return;
  player.style.display = 'block';

  playerGameId = gameId;
  const titleEl = document.getElementById('player-title');
  const metaEl = document.getElementById('player-meta');
  const frame = document.getElementById('player-frame');
  const likeBtn = document.getElementById('player-like-btn');

  if (titleEl) titleEl.textContent = game.title || 'Untitled game';
  if (metaEl) {
    metaEl.innerHTML = `by <b>${escapeHtml(game.authorName || 'Member')}</b> · ${game.plays || 0} plays · ${formatTimeAgo(game.updatedAt || game.createdAt)}`;
  }
  if (frame) {
    frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock allow-modals');
    frame.srcdoc = buildSrcDoc(game.html, game.css, game.js);
  }
  renderPlayerLike(game);

  // Real play counter — one bump per open.
  updateDoc(doc(db, 'games', gameId), { plays: increment(1) }).catch((err) => {
    console.warn('Play count not recorded:', err?.code || err);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
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

export function closeGamePlayer() {
  const { browse, player } = els();
  if (player) { player.style.display = 'none'; const f = document.getElementById('player-frame'); if (f) f.removeAttribute('srcdoc'); }
  if (browse) browse.style.display = 'block';
  playerGameId = null;
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
