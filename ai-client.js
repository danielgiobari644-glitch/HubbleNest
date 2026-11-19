/**
 * HubbleNest AI Client — the shared intelligence layer for Bots, the
 * HubbleNest Helper and the Arcade's AI game builder.
 *
 * Architecture (honest, no placeholders):
 *  - The platform key lives ONCE in Firestore `config/ai` (saved by the
 *    project owner in Profile & Settings → AI configuration). One
 *    configuration powers games, bots and the helper.
 *  - Requests are real HTTPS round-trips to the configured model endpoint.
 *    Nothing is simulated; when no key is configured the caller gets a clear,
 *    actionable setup message instead of a fake answer.
 *  - EVERY failure is classified from Google's real response body
 *    (error.message + error.details[].reason) and turned into a precise,
 *    actionable, UI-safe message — an invalid/expired key can never again
 *    masquerade as a generic "connection problem".
 *  - Invalid or retired model names self-heal: the client transparently
 *    retries down a known-good model chain.
 *  - KEY FORMATS (2026 Google security upgrade): Google AI Studio now
 *    exclusively issues "AQ." Auth keys (Google's permanent replacement for
 *    classic "AIza" Traffic keys, which Google rejects outright since its
 *    staged shutdown completed). Both real formats are accepted; requests
 *    authenticate through the documented x-goog-api-key header, which works
 *    for every format and keeps the key out of URLs and proxy logs.
 *  - The provider stays an implementation detail: no provider name, model
 *    name or endpoint is ever rendered in normal user interfaces. UI strings
 *    only ever say "AI" (the admin configuration panel is the one exception:
 *    it names Gemini because the key is created there).
 *  - Upgrade path (documented, not pretended): this is a client-side
 *    integration because HubbleNest ships as a static app. Rate limiting is
 *    enforced client-side (per-device cooldowns + daily caps); a server-side
 *    proxy is the documented hardening step when one becomes available.
 */

import { db, doc, getDoc } from './firebase.js';

let cachedConfig = null;
let cachedAt = 0;
const CONFIG_TTL_MS = 5 * 60 * 1000;

/** Read the platform AI configuration (config/ai) with a short cache. */
export async function getAiRuntime() {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CONFIG_TTL_MS) return cachedConfig;
  let cfg = { apiKey: '', model: 'gemini-2.5-flash' };
  try {
    const snap = await getDoc(doc(db, 'config', 'ai'));
    if (snap.exists() && snap.data().apiKey) {
      cfg = {
        apiKey: String(snap.data().apiKey || '').trim(),
        model: String(snap.data().model || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'
      };
    }
  } catch (e) {
    console.warn('[HubbleNest] AI config not readable:', e?.code || e);
  }
  cachedConfig = cfg;
  cachedAt = now;
  return cfg;
}

/** Forget the cached runtime (called right after the admin saves a key). */
export function invalidateAiRuntimeCache() {
  cachedConfig = null;
  cachedAt = 0;
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
   Failure taxonomy — real causes, exact messages.
   Google's error body is parsed into { message, reason } and mapped:
     API_KEY_INVALID / "API key not valid"  → key-invalid
     API_KEY_SERVICE_BLOCKED / 403          → key-blocked
     404 NOT_FOUND (model)                  → model-missing  (self-heals)
     RESOURCE_EXHAUSTED / 429               → quota
     400 "Unknown name"/"Invalid JSON"      → retryable shape (self-heals)
     503 UNAVAILABLE                        → overloaded
   ---------------------------------------------------------------------- */

const AI_KEY_FIX = 'The admin can fix this once in Profile & Settings → AI configuration — free keys: aistudio.google.com/app/apikey.';

/* ----------------------------------------------------------------------
   Key validation — both REAL Google formats, no guessing:
     "AQ.…"   Auth key — what Google AI Studio now exclusively issues
              (Google's permanent security upgrade; contains dots).
     "AIza…"  classic Traffic key (~39 chars) — accepted while Google's
              staged retirement completes, but retired ones are rejected
              by Google outright, so a fresh "AQ." key is the reliable
              choice when an old key starts failing with 400 API_KEY_INVALID.
   ---------------------------------------------------------------------- */
const AI_KEY_PATTERN = /^(?:AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9._-]{20,})$/;

/** True when the string is a real Google AI Studio key (either format). */
export function isValidAiKey(key) {
  return AI_KEY_PATTERN.test(String(key || '').trim());
}

function looksLikeModelMissing(status, message) {
  if (status === 404) return true;
  return /not found|not supported|unsupported/i.test(message || '');
}

function classifyModelFailure(status, apiMessage, reason) {
  const msg = String(apiMessage || '');
  const why = String(reason || '');
  if (status === 400 && (why === 'API_KEY_INVALID' || why === 'API_KEY_EXPIRED' || /api key not valid|api key expired/i.test(msg))) {
    return {
      kind: 'key-invalid',
      message: `The AI service rejected the saved key as invalid, expired or retired — Google has permanently retired the classic "AIza" Traffic keys, so old keys now fail with exactly this error. Create a fresh key (new keys are "AQ." Auth keys) — bots, Get Help and AI game creation all come back the moment it is saved. ${AI_KEY_FIX}`
    };
  }
  if (status === 401 || why === 'UNAUTHENTICATED' || /ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(`${why} ${msg}`)) {
    return {
      kind: 'auth-rejected',
      message: `The AI service rejected the saved key's credentials (401). Create a FRESH key at aistudio.google.com/app/apikey (new keys are "AQ." Auth keys, already restricted to the AI API) and save it in Profile & Settings → AI configuration. If a brand-new key is still rejected, create it inside a NEW AI Studio project — that is a known Google-side rollout issue. ${AI_KEY_FIX}`
    };
  }
  if (status === 403 || why === 'API_KEY_SERVICE_BLOCKED' || why === 'API_TARGET_BLOCKED' || /are blocked|permission denied/i.test(msg)) {
    return {
      kind: 'key-blocked',
      message: `The AI service blocked this app's key (the key is restricted, or the AI API is switched off for it). ${AI_KEY_FIX}`
    };
  }
  if (looksLikeModelMissing(status, msg)) {
    return {
      kind: 'model-missing',
      message: 'The configured AI model name does not exist. The admin should set the model to "gemini-2.5-flash" (or "gemini-flash-latest") in Profile & Settings → AI configuration.'
    };
  }
  if (status === 429 || why === 'RESOURCE_EXHAUSTED' || /quota/i.test(msg)) {
    return {
      kind: 'quota',
      message: 'The AI is at its request quota right now. HubbleNest automatically retried every model in the fallback chain — please try again in a little while.'
    };
  }
  if (status === 500 || why === 'INTERNAL') {
    return {
      kind: 'server',
      message: 'The AI service hit an internal error. HubbleNest automatically retried the other models — please try again.'
    };
  }
  if (status === 503 || why === 'UNAVAILABLE' || /overloaded|unavailable/i.test(msg)) {
    return {
      kind: 'overloaded',
      message: 'The AI is overloaded at the moment (Google-side demand spike). HubbleNest automatically retried every model in the fallback chain — give it a minute and try again.'
    };
  }
  if (status === 400 && /unknown name|invalid json payload|invalid value|invalid argument/i.test(msg)) {
    return {
      kind: 'bad-request-retryable',
      message: 'The AI rejected one of the request options — HubbleNest will retry it in a simpler form and on the fallback models automatically.'
    };
  }
  return {
    kind: 'unknown',
    message: `The AI could not answer right now (service error ${status || '—'}). Check your connection and try again; if it keeps failing, the admin should run "Test AI configuration" in Profile & Settings.`
  };
}

/** The last model-level failure/success — surfaced in the admin AI panel. */
let lastAiFailure = null;   // { at, kind, status, message, model }
let lastAiSuccess = null;   // { at, model, ms }

export function getLastAiFailure() { return lastAiFailure; }
export function getLastAiSuccess() { return lastAiSuccess; }
export function resetAiHealth() { lastAiFailure = null; lastAiSuccess = null; }

/* ----------------------------------------------------------------------
   Low-level model call (implementation detail — never surfaced raw in UI).
   ---------------------------------------------------------------------- */

const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite'
];

/** Transient service-side failures worth retrying on ANOTHER model. */
const RETRYABLE_KINDS = new Set(['overloaded', 'quota', 'server']);

function sleepMs(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/**
 * Only Gemini 2.5 models accept the thinkingConfig { thinkingBudget } switch.
 * The Gemini 3.x family (gemini-3*, gemini-3.5-*) REJECTS it with
 * 400 INVALID_ARGUMENT "Request contains an invalid argument" — that exact
 * error was reported live against a gemini-3.5-flash-lite configuration.
 * 3.x models manage thinking on their own, so we simply send nothing.
 */
function isThinkingAwareModel(model) {
  return /gemini-2\.5/i.test(String(model || ''));
}

async function rawModelRequest(model, apiKey, body) {
  // Auth via the documented x-goog-api-key header — it is the one method
  // Google accepts for BOTH key formats (new "AQ." Auth keys and classic
  // "AIza" Traffic keys), and it keeps the key out of URLs, where proxies,
  // browser history and server logs would otherwise record it.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body)
    });
  } catch (e) {
    const err = new AiUserError('The AI is unreachable right now — check your internet connection and try again.');
    err.kind = 'network';
    throw err;
  }
  return res;
}

async function parseErrorResponse(res) {
  let apiMessage = '';
  let reason = '';
  try {
    const data = await res.json();
    apiMessage = data?.error?.message || '';
    const details = Array.isArray(data?.error?.details) ? data.error.details : [];
    for (const d of details) {
      if (d?.reason) { reason = d.reason; break; }
    }
  } catch (e) { /* body unreadable — fall through with empty strings */ }
  return { apiMessage, reason };
}

function extractAnswerText(data) {
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
}

function stripOptionalRequestFields(body) {
  // Keep only what every model version accepts: contents + systemInstruction.
  const minimal = { contents: body.contents };
  if (body.systemInstruction) minimal.systemInstruction = body.systemInstruction;
  if (body.generationConfig) {
    const gc = {};
    if (body.generationConfig.temperature !== undefined) gc.temperature = body.generationConfig.temperature;
    if (body.generationConfig.maxOutputTokens !== undefined) gc.maxOutputTokens = body.generationConfig.maxOutputTokens;
    minimal.generationConfig = gc;
  }
  return minimal;
}

/**
 * One classified round-trip to the model endpoint.
 * Throws AiUserError with the EXACT actionable reason on failure.
 * @returns {{ text: string, model: string }}
 */
export async function callGenerateContent(cfg, body, opts = {}) {
  const apiKey = String(cfg?.apiKey || '').trim();
  if (!apiKey) {
    throw new AiUserError('HubbleNest AI is not switched on yet. The project admin can enable it once in Profile & Settings → AI configuration.');
  }
  if (!isValidAiKey(apiKey)) {
    throw new AiUserError(`The saved AI key is not a valid Google AI Studio key. Google now issues "AQ." Auth keys (they start with "AQ."); classic keys started with "AIza" and are being retired. ${AI_KEY_FIX}`);
  }

  const configuredModel = String(cfg?.model || '').trim() || 'gemini-2.5-flash';
  const allowFallback = opts.allowModelFallback !== false;
  const chain = [configuredModel];
  if (allowFallback) {
    for (const m of MODEL_FALLBACK_CHAIN) {
      if (m !== configuredModel && chain.length < 5) chain.push(m);
    }
  }

  let lastClassified = null;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    // Two shapes per model: full body first, minimal body when the model
    // rejects an optional field (400 "Unknown name" / "Invalid JSON payload").
    for (let shape = 0; shape < 2; shape++) {
      const attemptBody = shape === 0 ? body : stripOptionalRequestFields(body);
      const res = await rawModelRequest(model, apiKey, attemptBody);

      if (res.ok) {
        let data = null;
        try { data = await res.json(); } catch (e) { /* treated as empty below */ }
        const text = extractAnswerText(data);
        if (!text.trim()) {
          const block = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
          lastAiFailure = { at: Date.now(), kind: 'empty', status: 200, model, message: block || 'empty answer' };
          throw new AiUserError(block && !/STOP/i.test(block)
            ? 'The AI declined to answer that one. Try rephrasing your message.'
            : 'The AI returned an empty answer — try sending that again.');
        }
        lastAiSuccess = { at: Date.now(), model, ms: opts._startedAt ? Math.round(performance.now() - opts._startedAt) : null };
        lastAiFailure = null;
        return { text: text.trim(), model };
      }

      const { apiMessage, reason } = await parseErrorResponse(res);
      const cls = classifyModelFailure(res.status, apiMessage, reason);
      lastClassified = { ...cls, status: res.status, model };

      // v30: transient pressure (overloaded / quota / 500) no longer kills the
      // request — after a short backoff the NEXT model in the chain is tried
      // for real, so one busy Google model can never take the AI down.
      if (RETRYABLE_KINDS.has(cls.kind) && i < chain.length - 1) {
        const wait = Math.min(2200, 650 * (i + 1));
        console.warn(`[HubbleNest] AI "${model}" is ${cls.kind} (${res.status}) — retrying with "${chain[i + 1]}" in ${wait}ms.`);
        await sleepMs(wait);
        break; // next model in chain
      }
      // A model name that does not exist → transparently try the next one.
      if (cls.kind === 'model-missing' && i < chain.length - 1) {
        console.warn(`[HubbleNest] AI model "${model}" not available (${res.status}) — retrying with "${chain[i + 1]}".`);
        break; // next model in chain
      }
      // An optional field the model does not know → retry same model, minimal shape.
      if (cls.kind === 'bad-request-retryable' && shape === 0) {
        console.warn(`[HubbleNest] AI rejected a request option (${apiMessage.slice(0, 120)}) — retrying with a minimal request shape.`);
        continue;
      }
      // v31: the request shape or the MODEL ITSELF can be the problem (a 400
      // "Request contains an invalid argument" from a model family that
      // rejects an option, e.g. thinkingConfig on Gemini 3.x). Key-wide
      // problems are worth stopping for — every other 400 moves to the NEXT
      // model in the chain instead of killing bots outright.
      const KEY_WIDE = (cls.kind === 'key-invalid' || cls.kind === 'auth-rejected' || cls.kind === 'key-blocked');
      if (!KEY_WIDE && i < chain.length - 1) {
        console.warn(`[HubbleNest] AI "${model}" rejected the request (${res.status} ${cls.kind}: ${apiMessage.slice(0, 120)}) — retrying with "${chain[i + 1]}".`);
        break; // next model in chain
      }
      // Everything else is final: report the exact cause.
      lastAiFailure = { at: Date.now(), kind: cls.kind, status: res.status, model, message: apiMessage.slice(0, 240) || cls.kind };
      console.warn(`[HubbleNest] AI request failed (${res.status} ${cls.kind}): ${apiMessage.slice(0, 180)}`);
      const err = new AiUserError(cls.message);
      err.kind = cls.kind;
      err.httpStatus = res.status;
      err.apiMessage = apiMessage;
      throw err;
    }
  }

  // The whole chain failed with transient pressure — report it honestly.
  if (lastClassified && RETRYABLE_KINDS.has(lastClassified.kind)) {
    lastAiFailure = { at: Date.now(), kind: lastClassified.kind, status: lastClassified.status, model: lastClassified.model, message: `all ${chain.length} fallback models ${lastClassified.kind}` };
    const err = new AiUserError(lastClassified.message);
    err.kind = lastClassified.kind;
    err.httpStatus = lastClassified.status;
    throw err;
  }

  // The whole chain was model-missing.
  lastAiFailure = { at: Date.now(), kind: 'model-missing', status: 404, model: configuredModel, message: 'no model in the fallback chain answered' };
  const err = new AiUserError(lastClassified?.message || 'The configured AI model name does not exist. The admin should set the model to "gemini-2.5-flash" in Profile & Settings → AI configuration.');
  err.kind = 'model-missing';
  throw err;
}

/**
 * Real configuration probe for the admin "Test AI configuration" button.
 * Sends a tiny genuine request and returns the exact verdict.
 * @param {{ apiKey?: string, model?: string }} [override]  test an unsaved key first
 * @returns {{ ok: boolean, model?: string, ms?: number, reply?: string, detail?: string }}
 */
export async function probeAiConfig(override = {}) {
  let cfg;
  if (override && override.apiKey) {
    cfg = { apiKey: String(override.apiKey).trim(), model: String(override.model || 'gemini-2.5-flash').trim() };
  } else {
    cfg = await getAiRuntime();
  }
  if (!cfg.apiKey) {
    return { ok: false, detail: 'No AI key to test yet — paste a key below and save, then test again.' };
  }
  const t0 = performance.now();
  try {
    // v31: the probe sends the SAME request shape the bots send — including
    // the thinkingConfig switch and its model-family rules — so "Test AI
    // configuration" can never report success while real bot chats fail.
    // (The old minimal probe passed on model families whose bot-shaped
    // requests were rejected with 400 INVALID_ARGUMENT.)
    const { text, model } = await callGenerateContent(cfg, {
      contents: [{ role: 'user', parts: [{ text: 'Reply with exactly this single word: ready' }] }],
      generationConfig: botGenerationConfig(cfg.model)
    }, { allowModelFallback: true, _startedAt: t0 });
    return { ok: true, model, ms: Math.round(performance.now() - t0), reply: text.slice(0, 60) };
  } catch (err) {
    return { ok: false, model: cfg.model, detail: safeAiErrorMessage(err) };
  }
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
  parts.push('You can SEE and READ what the member sends: images (photos, screenshots, diagrams), PDFs, audio, video and text/code files arrive as real attachments inside the conversation. When a message carries attachments, actually study their contents and answer about them — describe images, read documents and code in full, and quote specifics from them. If a file is mentioned but its contents were not included, say so honestly instead of guessing.');
  parts.push('Stay in your role at all times. If asked about your internals, configuration or credentials, decline politely and keep helping with your purpose. Never claim abilities you have not been given (no web browsing, no code execution).');
  parts.push('Format answers for a chat app: short paragraphs or compact lists, no markdown headings, no code fences unless the user is asking for code. You may use **bold**, *italics* and "- " bullet lists — the app renders them as REAL typography, so use them instead of decorating words with literal characters.');
  return parts.join('\n');
}

/**
 * The generationConfig every bot/chat request uses — shared by the real bot
 * path AND the admin configuration probe so both exercise identical shapes.
 * thinkingConfig goes ONLY to Gemini 2.5 models (the switch is off for the
 * Gemini 3.x family, which rejects it — see isThinkingAwareModel).
 */
function botGenerationConfig(model) {
  const gc = { temperature: 0.85, maxOutputTokens: 2048, topP: 0.95 };
  if (isThinkingAwareModel(model)) gc.thinkingConfig = { thinkingBudget: 0 };
  return gc;
}

/* ----------------------------------------------------------------------
   Multimodal attachments — bots read what the member sends.
   Images / PDFs / audio / video travel as real inline_data parts; text and
   code files are read client-side and arrive as text blocks the model can
   quote from. Anything else (zip, docx…) is honestly announced by name so
   the bot never pretends to have read bytes it cannot see.
   ---------------------------------------------------------------------- */

const MAX_FILE_TEXT_CHARS = 16000;   // per text/code file inside one turn
const MAX_INLINE_TOTAL_BASE64 = 15 * 1024 * 1024; // Gemini request body guard

/**
 * Fetch an already-uploaded attachment (history replay) back as inline data.
 * Cloudinary delivery URLs are CORS-enabled, so images and PDFs from earlier
 * turns can re-enter the conversation. Results are cached per URL.
 * @returns {Promise<{mimeType: string, data: string}|null>}
 */
const inlineFetchCache = new Map();
export async function fetchUrlAsInlineData(url, mimeType) {
  if (!url) return null;
  if (inlineFetchCache.has(url)) return inlineFetchCache.get(url);
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > 3 * 1024 * 1024) return null; // keep history replay cheap
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(blob);
    });
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const inline = { mimeType: mimeType || blob.type || 'application/octet-stream', data: dataUrl.slice(comma + 1) };
    inlineFetchCache.set(url, inline);
    return inline;
  } catch (e) {
    return null;
  }
}

function attachmentLabel(a) {
  return String(a?.name || a?.originalFilename || 'a file');
}

/**
 * One bot conversation turn — text plus any real attachments.
 * @param {object} bot        the bot document (saved or in-progress test config)
 * @param {Array}  history    [{ role:'user'|'bot', text, inlineParts?, attNotes? }] — oldest first
 * @param {string} message    the user's message (may be empty when files are attached)
 * @param {object} [opts]     { attachments: [{ inline?: {mimeType,data}, textBlock?: string,
 *                             name?: string, mime?: string }] }
 * @returns {Promise<{text: string}>}
 */
export async function sendBotChatMessage(bot, history, message, opts = {}) {
  const text = (message || '').trim();
  const atts = Array.isArray(opts.attachments) ? opts.attachments : [];
  if (!text && atts.length === 0) throw new AiUserError('Type a message first.');
  if (text.length > MAX_INPUT_CHARS) throw new AiUserError(`Messages are limited to ${MAX_INPUT_CHARS} characters — yours is ${text.length}.`);
  guardRequest();

  const cfg = await getAiRuntime();
  if (!cfg.apiKey) {
    throw new AiUserError('HubbleNest AI is not switched on yet. The project admin can enable it once in Profile & Settings → AI configuration — after that every bot comes alive.');
  }

  const contents = [];
  for (const h of (history || []).slice(-16)) {
    if (!h) continue;
    const hParts = [];
    const hText = String(h.text || '').trim();
    if (hText) hParts.push({ text: hText.slice(0, MAX_INPUT_CHARS) });
    if (Array.isArray(h.inlineParts)) {
      for (const p of h.inlineParts) {
        if (p && p.inlineData && p.inlineData.data) hParts.push({ inlineData: p.inlineData });
      }
    }
    if (h.attNotes) hParts.push({ text: String(h.attNotes).slice(0, 1200) });
    if (hParts.length) contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: hParts });
  }

  const userParts = [{ text: text || '(sent you attachment(s) — see below)' }];
  let inlineBytes = 0;
  for (const a of atts) {
    if (a.inline && a.inline.data) {
      inlineBytes += a.inline.data.length;
      if (inlineBytes <= MAX_INLINE_TOTAL_BASE64) {
        userParts.push({ inlineData: { mimeType: a.inline.mimeType || 'application/octet-stream', data: a.inline.data } });
        continue;
      }
      userParts.push({ text: `[Attachment "${attachmentLabel(a)}" was too large to include this turn — you can see only its name.]` });
    } else if (a.textBlock) {
      userParts.push({ text: String(a.textBlock) });
    } else {
      userParts.push({ text: `[The member attached "${attachmentLabel(a)}" (${a.mime || 'file'}) — its contents were not included, so you know only its name and type. Never pretend to have read it.]` });
    }
  }
  contents.push({ role: 'user', parts: userParts });

  const res = await callGenerateContent(cfg, {
    systemInstruction: { parts: [{ text: buildBotSystemPrompt(bot) }] },
    contents,
    generationConfig: botGenerationConfig(cfg.model)
  });
  bumpDailyCount();
  return { text: res.text };
}

/* ----------------------------------------------------------------------
   Bot IMAGE GENERATION — bots can paint, for real.
   Native Gemini image models answer with an image part (inlineData) inside
   the same generateContent protocol; the last resort is theImagen predict
   endpoint. The chain self-heals across models exactly like the text chain,
   and every failure is classified into the same friendly, model-blind copy.
   ---------------------------------------------------------------------- */

const IMAGE_MODEL_CHAIN = [
  'gemini-2.5-flash-image',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.5-flash-image-preview'
];
const IMAGEN_MODEL = 'imagen-3.0-generate-002';

function imageSystemPrompt(bot) {
  const name = String(bot?.name || 'this bot');
  const persona = String(bot?.description || bot?.systemPrompt || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  return [
    `You are ${name}, an AI bot on HubbleNest, and you can now GENERATE IMAGES.`,
    persona ? `Stay in character: ${persona}.` : '',
    'Generate exactly ONE image that matches the member\'s latest request, in a style that fits your persona and their words.',
    'If the request is unsafe to depict, do not generate it and briefly explain why in words.',
    'Keep any text reply to at most one short sentence — the image is the answer.'
  ].filter(Boolean).join(' ');
}

/**
 * One image-generation turn for a bot.
 * @param {object} bot      the bot document (persona feeds the image style)
 * @param {Array}  history  text-only context entries [{role, text, attNotes?}]
 * @param {string} prompt   what to paint
 * @returns {Promise<{ images: Array<{mimeType: string, data: string}>, text: string }>}
 */
export async function generateBotImage(bot, history, prompt) {
  const text = String(prompt || '').trim();
  if (!text) throw new AiUserError('Describe the image you want first.');
  if (text.length > MAX_INPUT_CHARS) throw new AiUserError(`Image descriptions are limited to ${MAX_INPUT_CHARS} characters — yours is ${text.length}.`);
  guardRequest();

  const cfg = await getAiRuntime();
  if (!cfg.apiKey) {
    throw new AiUserError('HubbleNest AI is not switched on yet. The project admin can enable it once in Profile & Settings → AI configuration — after that every bot comes alive.');
  }
  const apiKey = cfg.apiKey;

  const contents = [];
  for (const h of (history || []).slice(-10)) {
    if (!h) continue;
    const t = [h.text, h.attNotes].filter(Boolean).join(' ').trim();
    if (t) contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: t.slice(0, 800) }] });
  }
  contents.push({ role: 'user', parts: [{ text }] });

  const sys = imageSystemPrompt(bot);
  let lastClassified = null;

  for (const model of IMAGE_MODEL_CHAIN) {
    // Two shapes per model: with persona instruction first, minimal when the
    // model rejects the optional field (same self-heal as the text chain).
    for (let shape = 0; shape < 2; shape++) {
      const body = {
        contents,
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], temperature: 0.8 }
      };
      if (shape === 0) body.systemInstruction = { parts: [{ text: sys }] };

      const res = await rawModelRequest(model, apiKey, body);
      if (res.ok) {
        let data = null;
        try { data = await res.json(); } catch (e) { /* treated as empty below */ }
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const images = parts
          .filter(p => p.inlineData && /^image\//i.test(String(p.inlineData.mimeType || '')))
          .map(p => ({ mimeType: p.inlineData.mimeType, data: p.inlineData.data }));
        const reply = parts.map(p => p.text || '').join('').trim();
        if (images.length) {
          bumpDailyCount();
          lastAiSuccess = { at: Date.now(), model, ms: null };
          lastAiFailure = null;
          return { images, text: reply, model };
        }
        const block = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
        if (block && !/STOP|MAX_TOKENS/i.test(String(block))) {
          throw new AiUserError('The image request was declined by the safety filters — try describing it differently.');
        }
        if (reply) return { images: [], text: reply }; // the model answered in words only
        lastClassified = { kind: 'empty', status: 200, model, message: 'no image in response' };
        break; // next model
      }

      const { apiMessage, reason } = await parseErrorResponse(res);
      const cls = classifyModelFailure(res.status, apiMessage, reason);
      lastClassified = { ...cls, status: res.status, model };
      if (cls.kind === 'bad-request-retryable' && shape === 0) continue; // retry same model, minimal shape
      const KEY_WIDE = (cls.kind === 'key-invalid' || cls.kind === 'auth-rejected' || cls.kind === 'key-blocked');
      if (KEY_WIDE) {
        const err = new AiUserError(cls.message);
        err.kind = cls.kind;
        throw err; // the key is the problem — no model will help
      }
      console.warn(`[HubbleNest] image model "${model}" unavailable (${res.status} ${cls.kind}) — trying the next one.`);
      break; // next model in the image chain
    }
  }

  // Last resort: theImagen predict endpoint (different protocol, same key).
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        instances: [{ prompt: text }],
        parameters: { sampleCount: 1, personGeneration: 'allow_adult' }
      })
    });
    if (res.ok) {
      const data = await res.json();
      const pred = (data?.predictions || [])[0];
      if (pred?.bytesBase64Encoded) {
        bumpDailyCount();
        lastAiSuccess = { at: Date.now(), model: IMAGEN_MODEL, ms: null };
        lastAiFailure = null;
        return { images: [{ mimeType: pred?.mimeType || 'image/png', data: pred.bytesBase64Encoded }], text: '', model: IMAGEN_MODEL };
      }
    } else {
      const { apiMessage, reason } = await parseErrorResponse(res);
      const cls = classifyModelFailure(res.status, apiMessage, reason);
      lastClassified = { ...cls, status: res.status, model: IMAGEN_MODEL };
      if (cls.kind === 'quota' || cls.kind === 'overloaded') {
        throw new AiUserError('The image service is at capacity right now — give it a minute and try again.');
      }
    }
  } catch (e) {
    if (e instanceof AiUserError) throw e;
    /* fall through to the honest final message */
  }

  lastAiFailure = {
    at: Date.now(), kind: lastClassified?.kind || 'image-failed',
    status: lastClassified?.status || 0, model: 'image-chain',
    message: lastClassified?.message || 'no image model answered'
  };
  throw new AiUserError('The image service could not create that image right now. Please try again in a little while.');
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

  const generationConfig = { temperature: 0.6, maxOutputTokens: 1200, topP: 0.9 };
  if (isThinkingAwareModel(cfg.model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const res = await callGenerateContent(cfg, {
    systemInstruction: { parts: [{ text: HELPER_SYSTEM_PROMPT }] },
    contents,
    generationConfig
  });
  bumpDailyCount();
  return { text: res.text };
}
