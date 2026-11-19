/**
 * HubbleNest Helper — the AI assistant behind "Get Help".
 *
 * A real conversational guide that knows every corner of the app and helps
 * members get things done and fix problems. Rendered in two places:
 *   1. The in-app slide-in drawer (dashboard "Get Help" quick action).
 *   2. Embedded on the public Help Centre page (help.html).
 *
 * The conversation lives on the device (session-scoped) — nothing about it is
 * stored in Firestore, and it is never shared. AI answers come from the same
 * platform AI configuration that powers Bots and the Arcade's game builder.
 */

import { auth, onAuthStateChanged } from './firebase.js';
import { sendHelperMessage, safeAiErrorMessage, isAiConfigured } from './ai-client.js';
import { escapeHtml } from './utils.js';
import { renderMarkdown } from './markdown.js';

const SESSION_KEY = 'hn-helper-thread-v1';

const STARTERS = [
  'How do I join a Space?',
  'How do friend requests work?',
  'How do I create my own AI bot?',
  'How do I publish a game?'
];

let drawerEl = null;
let fabEl = null;
let thread = loadThread();
let sending = false;
let pendingRetry = null;

function loadThread() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(-30);
    }
  } catch (e) { /* fresh thread */ }
  return [];
}

function saveThread() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(thread.slice(-30))); } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------
   Markup builder — one shared renderer for drawer + embedded mount
   ------------------------------------------------------------------ */
function chatShellHtml(opts = {}) {
  return `
    <div class="hnh-messages" role="log" aria-live="polite"></div>
    <div class="hnh-starters">
      ${STARTERS.map(s => `<button type="button" class="hnh-starter">${escapeHtml(s)}</button>`).join('')}
    </div>
    <div class="hnh-composer">
      <textarea class="hnh-input" rows="1" maxlength="2000" placeholder="${opts.embedded ? 'Ask anything about HubbleNest…' : 'Ask me anything about HubbleNest…'}" aria-label="Ask the HubbleNest Helper"></textarea>
      <button type="button" class="hnh-send" aria-label="Send">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
      </button>
    </div>
    <div class="hnh-foot">Answers are generated AI guidance — verify important steps in the app.</div>
  `;
}

function wireShell(root, opts = {}) {
  const messages = root.querySelector('.hnh-messages');
  const input = root.querySelector('.hnh-input');
  const sendBtn = root.querySelector('.hnh-send');

  const send = async () => {
    const text = (input.value || '').trim();
    if (!text || sending) return;
    input.value = '';
    autoGrow();
    pendingRetry = null;
    await pushUserMessage(text);
  };

  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', autoGrow);
  root.querySelectorAll('.hnh-starter').forEach(btn => {
    btn.addEventListener('click', () => { if (!sending) { pendingRetry = null; pushUserMessage(btn.textContent); } });
  });

  renderThread(messages, opts);

  if (opts.embedded) {
    onAuthStateChanged(auth, () => renderThread(messages, opts));
  }
}

async function pushUserMessage(text) {
  thread.push({ role: 'user', text });
  saveThread();
  rerenderAll();
  await respond();
}

async function respond() {
  sending = true;
  rerenderAll(true);
  try {
    const { text } = await sendHelperMessage(thread.slice(-14), thread[thread.length - 1]?.text || '');
    thread.push({ role: 'bot', text });
    pendingRetry = null;
  } catch (err) {
    const msg = safeAiErrorMessage(err);
    thread.push({ role: 'bot', text: msg, isError: true });
    pendingRetry = thread[thread.length - 2]?.text || null;
  } finally {
    sending = false;
    saveThread();
    rerenderAll();
  }
}

function retryLast() {
  if (!pendingRetry || sending) return;
  const text = pendingRetry;
  // drop the error bubble and retry the exact user message
  while (thread.length && thread[thread.length - 1].role === 'bot') thread.pop();
  pendingRetry = null;
  saveThread();
  rerenderAll();
  thread.push({ role: 'user', text });
  saveThread();
  rerenderAll();
  respond();
}

/* v34: the helper transcript renders INCREMENTALLY — each bubble is a tracked
   node with a content signature. Unchanged bubbles are never touched, entry
   animations play once, and the view only scrolls when it should. This kills
   the shake that a full innerHTML rebuild caused on every update. */

function hnhSig(m) {
  return `${m.role}|${m.isError ? 'e' : ''}|${m.text || ''}|${(m.isError && pendingRetry) ? 'r' : ''}`;
}

function hnhWelcomeNode(signedOut) {
  const div = document.createElement('div');
  div.className = 'hnh-welcome';
  div.innerHTML = signedOut
    ? `<div class="hnh-welcome-icon" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="5"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="1.4"/><path d="M9 13.5v2M15 13.5v2"/></svg>
      </div>
      <b>Hi, I'm the HubbleNest Helper</b>
      <p>Sign in to HubbleNest and ask me anything — joining Spaces, friend requests, the Arcade, Bots, Direct Share, troubleshooting and more.</p>`
    : `<div class="hnh-welcome-icon" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="5"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="1.4"/><path d="M9 13.5v2M15 13.5v2"/></svg>
      </div>
      <b>Hi, I'm the HubbleNest Helper</b>
      <p>I know every corner of this app — Spaces, friend requests, the Arcade, Bots, Direct Share, notifications and more. What can I explain or fix for you?</p>`;
  return div;
}

function hnhTypingNode() {
  const div = document.createElement('div');
  div.className = 'hnh-row hnh-row-bot';
  div.innerHTML = `<span class="hnh-bot-avatar" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="5"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="1.4"/></svg>
    </span><div class="hnh-bubble hnh-bubble-bot hnh-typing" aria-label="The helper is typing"><span></span><span></span><span></span></div>`;
  return div;
}

function hnhBubbleNode(m) {
  const div = document.createElement('div');
  // v32: real typography for helper answers (bold/italics/lists/code) —
  // error bubbles stay plain app copy.
  const retry = m.isError && pendingRetry ? `<button type="button" class="hnh-retry" data-hnh-retry="1">Try again</button>` : '';
  const body = m.isError ? escapeHtml(m.text) : renderMarkdown(m.text);
  div.innerHTML = m.role === 'user'
    ? `<div class="hnh-row hnh-row-user"><div class="hnh-bubble hnh-bubble-user hnh-enter">${escapeHtml(m.text)}</div></div>`
    : `<div class="hnh-row hnh-row-bot">
        <span class="hnh-bot-avatar" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="5"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="1.4"/><path d="M9 13.5v2M15 13.5v2"/></svg>
        </span>
        <div class="hnh-bubble hnh-bubble-bot md-markdown hnh-enter ${m.isError ? 'hnh-bubble-error' : ''}">${body}${retry}</div>
      </div>`;
  div.querySelectorAll('[data-hnh-retry]').forEach(b => b.addEventListener('click', retryLast));
  return div.firstElementChild;
}

function renderThread(container, opts = {}, typing = false) {
  if (!container) return;
  const signedOut = opts.embedded && auth?.currentUser == null;

  // Desired rows, in order.
  const rows = [];
  if (signedOut) rows.push({ key: 'welcome-out', sig: 'out', make: () => hnhWelcomeNode(true) });
  else if (thread.length === 0) rows.push({ key: 'welcome', sig: 'in', make: () => hnhWelcomeNode(false) });
  else thread.forEach((m, i) => rows.push({ key: 'm' + i, sig: hnhSig(m), make: () => hnhBubbleNode(thread[i]) }));
  if (typing) rows.push({ key: 'typing', sig: 't', make: hnhTypingNode });

  const listSig = rows.map(r => `${r.key}=${r.sig}`).join('##') + `|#${rows.length}`;
  const st = container._hnhState || (container._hnhState = { keys: new Map(), sig: '', count: -1 });
  if (listSig === st.sig) return;
  st.sig = listSig;

  const keys = st.keys;
  // 1) drop removed
  const wanted = new Set(rows.map(r => r.key));
  for (const [key, rec] of Array.from(keys)) {
    if (!wanted.has(key)) { rec.node.remove(); keys.delete(key); }
  }
  // 2) create/replace only new or changed rows
  for (const r of rows) {
    const rec = keys.get(r.key);
    if (rec && rec.sig === r.sig) continue;
    if (rec) rec.node.remove();
    keys.set(r.key, { node: r.make(), sig: r.sig });
  }
  // 3) enforce order, touching only misplaced nodes
  for (let i = 0; i < rows.length; i++) {
    const node = keys.get(rows[i].key)?.node;
    if (!node) continue;
    if (container.children[i] !== node) container.insertBefore(node, container.children[i] || null);
  }

  // Scroll: always chase the member's own message; otherwise only while
  // already near the bottom.
  const lastIsUser = rows.length && /^m\d+$/.test(rows[rows.length - 1].key)
    ? thread[Number(rows[rows.length - 1].key.slice(1))]?.role === 'user'
    : false;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 160;
  if (rows.length !== st.count || lastIsUser) {
    if (nearBottom || lastIsUser) container.scrollTop = container.scrollHeight;
  }
  st.count = rows.length;

  // starters only make sense on an empty thread
  const starters = container.parentElement?.querySelector('.hnh-starters');
  if (starters) starters.style.display = (thread.length === 0 && !signedOut) ? 'flex' : 'none';
}

function rerenderAll(typing = false) {
  document.querySelectorAll('.hnh-shell').forEach(shell => {
    renderThread(shell.querySelector('.hnh-messages'), shell.dataset.embedded === '1' ? { embedded: true } : {}, typing);
  });
}

/* ------------------------------------------------------------------
   In-app drawer (index.html)
   ------------------------------------------------------------------ */
export function ensureHelpAssistantDom() {
  if (drawerEl && document.body.contains(drawerEl)) return;
  drawerEl = document.createElement('aside');
  drawerEl.className = 'hnh-drawer';
  drawerEl.id = 'hn-helper-drawer';
  drawerEl.setAttribute('role', 'dialog');
  drawerEl.setAttribute('aria-label', 'HubbleNest Helper');
  drawerEl.innerHTML = `
    <div class="hnh-head">
      <span class="hnh-head-icon" aria-hidden="true">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="5"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="1.4"/><path d="M9 13.5v2M15 13.5v2"/></svg>
      </span>
      <div class="hnh-head-text">
        <b>HubbleNest Helper</b>
        <span>AI guide for everything in the app</span>
      </div>
      <button type="button" class="hnh-clear" title="Start a fresh conversation" aria-label="Clear conversation">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
      </button>
      <button type="button" class="hnh-close" title="Close" aria-label="Close the helper">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
    <div class="hnh-shell"></div>
  `;
  document.body.appendChild(drawerEl);
  const shell = drawerEl.querySelector('.hnh-shell');
  shell.innerHTML = chatShellHtml();
  wireShell(shell);

  drawerEl.querySelector('.hnh-close').addEventListener('click', closeHelpAssistant);
  drawerEl.querySelector('.hnh-clear').addEventListener('click', () => {
    thread = [];
    pendingRetry = null;
    saveThread();
    rerenderAll();
  });
}

export function openHelpAssistant() {
  ensureHelpAssistantDom();
  drawerEl.classList.add('hnh-open');
  const input = drawerEl.querySelector('.hnh-input');
  setTimeout(() => input && input.focus({ preventScroll: true }), 260);
}

export function closeHelpAssistant() {
  if (drawerEl) drawerEl.classList.remove('hnh-open');
}

export function toggleHelpAssistant() {
  if (drawerEl && drawerEl.classList.contains('hnh-open')) closeHelpAssistant();
  else openHelpAssistant();
}

/* ------------------------------------------------------------------
   Embedded mount (help.html and any public page)
   ------------------------------------------------------------------ */
export function mountHelpAssistant(container, opts = {}) {
  if (!container) return;
  container.classList.add('hnh-embedded');
  container.innerHTML = `
    <div class="hnh-embed-head">
      <span class="hnh-head-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="5"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="1.4"/><path d="M9 13.5v2M15 13.5v2"/></svg>
      </span>
      <div class="hnh-head-text">
        <b>Ask the HubbleNest Helper</b>
        <span>An AI that knows the app inside out</span>
      </div>
      <button type="button" class="hnh-clear" title="Start a fresh conversation" aria-label="Clear conversation">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
      </button>
    </div>
    <div class="hnh-shell" data-embedded="1"></div>
  `;
  const shell = container.querySelector('.hnh-shell');
  shell.innerHTML = chatShellHtml({ embedded: true });
  wireShell(shell, { embedded: true });
  container.querySelector('.hnh-clear').addEventListener('click', () => {
    thread = [];
    pendingRetry = null;
    saveThread();
    rerenderAll();
  });
}

/** Small floating action button for pages that want one. */
export function installHelperFab() {
  if (fabEl) return;
  fabEl = document.createElement('button');
  fabEl.type = 'button';
  fabEl.className = 'hnh-fab';
  fabEl.setAttribute('aria-label', 'Open the HubbleNest Helper');
  fabEl.title = 'Get Help — HubbleNest Helper';
  fabEl.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="8" width="16" height="12" rx="5"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="1.4"/><path d="M9 13.5v2M15 13.5v2"/></svg>`;
  fabEl.addEventListener('click', toggleHelpAssistant);
  document.body.appendChild(fabEl);
}
