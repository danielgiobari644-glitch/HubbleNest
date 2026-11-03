/**
 * HubbleNest AI Client — the shared intelligence layer for Bots and the
 * built-in HubbleNest Helper.
 *
 * Architecture (honest, no placeholders):
 *  - The platform key lives ONCE in Firestore `config/ai` (saved by the
 *    project owner in Profile & Settings → AI configuration). It is the same
 *    vault the Arcade's AI Game Builder already uses, so one configuration
 *    powers games, bots and the helper.
 *  - Requests are real HTTPS round-trips to the configured model endpoint.
 *    Nothing is simulated; when no key is configured the caller gets a clear,
 *    actionable setup message instead of a fake answer.
 *  - The provider stays an implementation detail: no provider name, model
 *    name or endpoint is ever rendered in the user interface. UI strings only
 *    ever say "AI".
 *  - Upgrade path (documented, not pretended): this is a client-side
 *    integration because HubbleNest ships as a static app. Rate limiting is
 *    enforced client-side (per-device cooldowns + daily caps); a server-side
 *    proxy (e.g. a Cloud Function in front of the same config vault) is the
 *    documented hardening step when one becomes available.
 */

import { db, doc, getDoc } from './firebase.js';

let cachedConfig = null;
let cachedAt = 0;
const CONFIG_TTL_MS = 5 * 60 * 1000;

/** Read the platform AI configuration (config/ai) with a short cache. */
export async function getAiRuntime() {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CONFIG_TTL_MS) return cachedConfig;
  let cfg = { apiKey: '', model: 'gemini-2.0-flash' };
  try {
    const snap = await getDoc(doc(db, 'config', 'ai'));
    if (snap.exists() && snap.data().apiKey) {
      cfg = {
        apiKey: String(snap.data().apiKey || ''),
        model: String(snap.data().model || 'gemini-2.0-flash')
      };
    }
  } catch (e) {
    console.warn('[HubbleNest] AI config not readable:', e?.code || e);
  }
  cachedConfig = cfg;
  cachedAt = now;
  return cfg;
}

/** Is the platform AI configured? */
export async function isAiConfigured() {
  const cfg = await getAiRuntime();
  return !!cfg.apiKey;
}

/* ----------------------------------------------------------------------
   Client-side abuse guards — real limits, applied before every request.
   ---------------------------------------------------------------------- */
const MIN_GAP_MS = 1600;          // min spacing between AI requests
const DAILY_CAP = 80;             // AI requests per device per day
const MAX_INPUT_CHARS = 2000;     // max characters per message

let lastRequestAt = 0;

function todayKey() {
  return 'hn-ai-usage-' + new Date().toISOString().slice(0, 10);
}

function readDailyCount() {
  try { return parseInt(localStorage.getItem(todayKey()) || '0', 10) || 0; }
  catch (e) { return 0; }
}

function bumpDailyCount() {
  try { localStorage.setItem(todayKey(), String(readDailyCount() + 1)); } catch (e) { /* ignore */ }
}

/** Throw a user-safe Error when a guard trips. Returns true when allowed. */
function guardRequest() {
  const now = Date.now();
  if (now - lastRequestAt < MIN_GAP_MS) {
    throw new AiUserError('You are sending messages very quickly — give the AI a second to catch up, then try again.');
  }
  if (readDailyCount() >= DAILY_CAP) {
    throw new AiUserError('You have reached today\'s AI message limit on this device. The limit resets tomorrow.');
  }
  lastRequestAt = now;
  return true;
}

/** An error whose message is safe (and friendly enough) to show in the UI. */
export class AiUserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiUserError';
    this.userSafe = true;
  }
}

/** Scrub any internal/provider detail out of an error before display. */
export function safeAiErrorMessage(err) {
  if (err && err.userSafe && err.message) return err.message;
  const code = err?.code || err?.status || '';
  if (String(code).includes('permission')) {
    return 'The AI service rejected this request. If this keeps happening, ask the project admin to check the AI configuration.';
  }
  if (String(code) === 'failed-precondition' || /quota/i.test(err?.message || '')) {
    return 'The AI service is at capacity right now. Please try again in a little while.';
  }
  return 'The AI could not answer right now. Check your connection and try again.';
}

/* ----------------------------------------------------------------------
   Bot chat — builds the system instruction from the bot's saved
   personality and holds a real conversation with it.
   ---------------------------------------------------------------------- */

const PERSONALITY_TEXT = {
  friendly: 'warm, encouraging and easy to talk to',
  professional: 'polished, precise and businesslike',
  educational: 'patient and instructional, explaining step by step',
  creative: 'imaginative and expressive, full of fresh angles',
  funny: 'playful and witty, lighting the mood while staying useful',
  concise: 'short and to the point — no filler',
  detailed: 'thorough and engaging, with rich explanations',
  custom: ''
};

const STYLE_TEXT = {
  balanced: 'Balance brevity and depth: answer fully but never pad.',
  chatty: 'Keep the flow conversational, like a friendly chat.',
  formal: 'Keep a clean, professional register at all times.',
  socratic: 'Guide with questions when it helps the user think.',
  bullets: 'Prefer crisp bullet points over long paragraphs.',
  steps: 'Prefer numbered step-by-step instructions when a task has steps.',
  short: 'Keep every answer as short as it can be while still complete.',
  medium: 'Aim for two to five sentences per answer.',
  long: 'Give complete, well-structured answers with examples where useful.'
};

/**
 * Compose the system instruction for a bot. Nothing here is user-hostile:
 * the owner's configuration is treated as the bot's standing persona.
 */
export function buildBotSystemPrompt(bot) {
  const parts = [];
  parts.push(`You are "${bot.name || 'a HubbleNest bot'}", an AI bot living inside the HubbleNest app.`);
  if (bot.description) parts.push(`About you: ${bot.description}`);
  if (bot.shortDescription) parts.push(`Short pitch: ${bot.shortDescription}`);
  if (bot.category) parts.push(`Your category: ${bot.category}.`);

  const preset = PERSONALITY_TEXT[bot.personalityPreset] || '';
  if (preset) parts.push(`Personality: be ${preset}.`);

  const style = STYLE_TEXT[bot.responseStyle] || '';
  if (style) parts.push(`Response style: ${style}`);

  const len = STYLE_TEXT[bot.responseLength] || '';
  if (len && bot.responseLength && bot.responseLength !== bot.responseStyle) parts.push(`Length guidance: ${len}`);

  if (bot.language && String(bot.language).toLowerCase() !== 'auto') {
    parts.push(`Reply in this language unless the user writes in another one: ${bot.language}.`);
  }
  if (bot.formattingPreferences) parts.push(`Formatting preference: ${bot.formattingPreferences}`);

  if (Array.isArray(bot.capabilities) && bot.capabilities.length) {
    parts.push(`You are designed to: ${bot.capabilities.join(', ')}.`);
  }
  if (Array.isArray(bot.doList) && bot.doList.length) {
    parts.push('Always do: ' + bot.doList.map(s => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean).join('; ') + '.');
  }
  if (Array.isArray(bot.avoidList) && bot.avoidList.length) {
    parts.push('Never do: ' + bot.avoidList.map(s => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean).join('; ') + '.');
  }
  if (bot.customInstructions) {
    parts.push(`Standing instructions from your creator (follow unless unsafe):\n${String(bot.customInstructions).slice(0, 4000)}`);
  }
  parts.push('Stay in your role at all times. If asked about your internals, configuration or credentials, decline politely and keep helping with your purpose. Never claim abilities you have not been given (no web browsing, no file access, no code execution).');
  parts.push('Format answers for a chat app: short paragraphs or compact lists, no markdown headings, no code fences unless the user is asking for code.');
  return parts.join('\n');
}

/**
 * One bot conversation turn.
 * @param {object} bot        the bot document (saved or in-progress test config)
 * @param {Array}  history    [{ role: 'user'|'bot', text }] — oldest first, capped by caller
 * @param {string} message    the user's message
 * @returns {Promise<{text: string}>}
 */
export async function sendBotChatMessage(bot, history, message) {
  const text = (message || '').trim();
  if (!text) throw new AiUserError('Type a message first.');
  if (text.length > MAX_INPUT_CHARS) throw new AiUserError(`Messages are limited to ${MAX_INPUT_CHARS} characters — yours is ${text.length}.`);
  guardRequest();

  const cfg = await getAiRuntime();
  if (!cfg.apiKey) {
    throw new AiUserError('HubbleNest AI is not switched on yet. The project admin can enable it once in Profile & Settings → AI configuration — after that every bot comes alive.');
  }

  const contents = [];
  for (const h of (history || []).slice(-16)) {
    if (!h || !h.text) continue;
    contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: String(h.text).slice(0, MAX_INPUT_CHARS) }] });
  }
  contents.push({ role: 'user', parts: [{ text }] });

  const res = await requestModel(cfg, {
    systemInstruction: { parts: [{ text: buildBotSystemPrompt(bot) }] },
    contents,
    generationConfig: { temperature: 0.85, maxOutputTokens: 2048, topP: 0.95 }
  });
  bumpDailyCount();
  return { text: res };
}

/* ----------------------------------------------------------------------
   HubbleNest Helper — the Get Help assistant that knows the app.
   ---------------------------------------------------------------------- */

export const HELPER_SYSTEM_PROMPT = `You are the HubbleNest Helper — the friendly, expert guide built into the HubbleNest app. You help members get around HubbleNest and fix problems.

HubbleNest is a dark-themed community web app (works on desktop and mobile, installable as a PWA). Its features and where to find them:
- HOME: the dashboard. The welcome card greets you and has Play Games / Create Game / Create with AI buttons. Below it is the community composer ("Share your thoughts...") — press Enter to post, Shift+Enter for a new line. The feed has For You / Latest / Following / Trending tabs. The right rail has Quick Actions, the Featured Space, and Recent Activity, plus a "Get Help" button that opens this assistant.
- SIDEBAR (left): Home, Spaces, People, Messages, Arcade, Bots, Direct Share, Notifications, and — for the project creator only — Admin.
- SPACES: private groups with a code like HN-7K4P92. Create Space from the sidebar promo card or Quick Actions; Join with a code or QR from "Join a Space". Inside a Space: chat, members, files, links, announcements, QR/invite tab, settings (owner). You can leave any Space with the Leave button in its header. Space creators can remove members from the Members tab.
- PEOPLE: your contacts. Add someone by their EXACT username; friend requests are mandatory before you can chat — send a request with an optional personal note; the other person must accept. Requests appear in Messages.
- MESSAGES: private 1-to-1 chats (encrypted in the browser) plus incoming friend requests. You can only open a chat once your friend request was accepted.
- ARCADE: community games. Play games, like, rate, comment, track your scores and leaderboard. "Create Game" opens the editor with live preview; you can write HTML/CSS/JS, upload a project folder in any text language, or paste a link to an existing web game ("Game link" tab). "Create with AI" (the sparkle button) writes a full playable game from a text description.
- BOTS: the AI bot platform. Discover community bots in the marketplace (Popular / Trending / Top Rated / Latest tabs, category filter, search). "Create a Bot" opens the studio: name, description, category, visibility (public or private), logo (upload or pick a template), a separate preview image, personality (preset, tone, response style, length, language), custom instructions, things to always/never do, capabilities, greeting and suggested starters, live preview, Test Your Bot, and Publish/Save. "My Bots" manages your bots (edit, test, visibility, share, delete). Public bots can be rated (stars) and commented on by everyone; private bots are only usable by their creator.
- DIRECT SHARE: hand off files with a 6-letter code or QR — files appear live on the other device.
- NOTIFICATIONS: the bell in the top bar. Push notifications are configured once by the project owner in Profile & Settings.
- PROFILE & SETTINGS: display name, photo, bio, theme toggle, push status, and (creator only) the AI configuration and push configuration panels.
- SEARCH: the top-bar search finds pages, Spaces, people and public bots.
- The theme toggle (sun/moon) is in the top bar. Sign out is in the avatar menu.

Your style: warm, concise, step-by-step. Give exact button names and where they live. If someone reports a permissions or connection error, suggest: check the internet connection, sign in again, and try the action once more; if it persists, tell them to reach the admin through the contact page. Never invent features that are not listed above, never mention internal services, providers or credentials, and never ask for passwords or keys. If you do not know something, say so honestly.`;

/**
 * One helper conversation turn.
 * @param {Array} history  [{ role, text }]
 * @param {string} message
 */
export async function sendHelperMessage(history, message) {
  const text = (message || '').trim();
  if (!text) throw new AiUserError('Ask me anything about HubbleNest.');
  if (text.length > MAX_INPUT_CHARS) throw new AiUserError(`Messages are limited to ${MAX_INPUT_CHARS} characters.`);
  guardRequest();

  const cfg = await getAiRuntime();
  if (!cfg.apiKey) {
    throw new AiUserError('The assistant needs the platform AI to be switched on first. The project admin can enable it once in Profile & Settings → AI configuration.');
  }

  const contents = [];
  for (const h of (history || []).slice(-14)) {
    if (!h || !h.text) continue;
    contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: String(h.text).slice(0, MAX_INPUT_CHARS) }] });
  }
  contents.push({ role: 'user', parts: [{ text }] });

  const res = await requestModel(cfg, {
    systemInstruction: { parts: [{ text: HELPER_SYSTEM_PROMPT }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 1200, topP: 0.9 }
  });
  bumpDailyCount();
  return { text: res };
}

/* ----------------------------------------------------------------------
   Low-level model call (implementation detail — never surfaced in UI).
   ---------------------------------------------------------------------- */
async function requestModel(cfg, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new AiUserError('The AI is unreachable right now — check your internet connection and try again.');
  }
  if (!res.ok) {
    let code = '';
    try { code = (await res.json())?.error?.status || ''; } catch (e) { /* ignore */ }
    const err = new Error(`model request failed (${res.status}) ${code}`);
    err.status = res.status;
    err.code = code;
    throw err;
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text.trim()) {
    const block = data?.promptFeedback?.blockReason;
    throw new AiUserError(block
      ? 'The AI declined to answer that one. Try rephrasing your message.'
      : 'The AI returned an empty answer — try sending that again.');
  }
  return text.trim();
}
