/**
 * HubbleNest Safe Markdown Renderer (v32)
 *
 * Bots and AI helpers answer with Markdown-ish text (`**bold**`, bullets,
 * fenced code). Until v32 those markers were shown RAW because every bubble
 * ran through escapeHtml — members literally saw "```**Hello**```".
 *
 * This module renders REAL typography: bold, italics, bullet/numbered lists,
 * headings, inline code and fenced code blocks — safely:
 *
 *   1. The whole input is HTML-escaped FIRST (no injected markup can survive).
 *   2. Fenced code blocks are extracted to placeholders BEFORE inline rules,
 *      so `*` / `_` / `#` inside code are never reinterpreted.
 *   3. Only a tiny whitelist of generated tags is ever emitted — everything
 *      else in the string is inert text.
 */

const CODE_TOKEN = '\u0000MDCB%d\u0000'; // placeholder carved out of the text

/**
 * Render a Markdown-ish string to a safe HTML string.
 * Returned HTML contains ONLY: p, br, strong, em, code, pre, ul, ol, li,
 * h4, a (https-only links, rel hardened). Everything is escaped on the way in.
 */
export function renderMarkdown(raw) {
  const source = String(raw ?? '');
  if (!source.trim()) return escapeMinimal(source);

  /* ---- 1. Escape everything up front ---- */
  let text = escapeMinimal(source);

  /* ---- 2. Extract fenced code blocks (``` … ```) to placeholders ---- */
  const codeBlocks = [];
  text = text.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (m, lang, body) => {
    const idx = codeBlocks.push({ lang: String(lang || ''), body }) - 1;
    return CODE_TOKEN.replace('%d', idx);
  });
  // An unclosed fence at the end still renders as code (common AI output).
  text = text.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]+)$/g, (m, lang, body) => {
    const idx = codeBlocks.push({ lang: String(lang || ''), body }) - 1;
    return CODE_TOKEN.replace('%d', idx);
  });

  /* ---- 3. Split into lines and group lists/paragraphs ---- */
  const lines = text.split(/\r?\n/);
  const out = [];
  let listBuf = [];      // consecutive list items of the current run
  let listType = null;   // 'ul' | 'ol'

  const flushList = () => {
    if (listBuf.length) {
      out.push(`<${listType} class="md-list">` + listBuf.map(li => `<li>${li}</li>`).join('') + `</${listType}>`);
      listBuf = [];
      listType = null;
    }
  };

  for (const lineRaw of lines) {
    const line = lineRaw;

    // Standalone code-block placeholder line → emit the block.
    const tokenMatch = line.match(/^\u0000MDCB(\d+)\u0000$/);
    if (tokenMatch) {
      flushList();
      const block = codeBlocks[Number(tokenMatch[1])];
      const lang = block.lang ? `<span class="md-code-lang">${escapeMinimal(block.lang)}</span>` : '';
      out.push(`<div class="md-code">${lang}<pre>${block.body}</pre></div>`);
      continue;
    }

    // Bullet item: "- ", "* ", "• ", "– " (the asterisk form is the one bots emit).
    const ulMatch = line.match(/^\s*(?:[-*•–])\s+(.*)$/);
    // Numbered item: "1. " / "1) "
    const olMatch = line.match(/^\s*(\d{1,3})[.)]\s+(.*)$/);

    if (ulMatch) {
      if (listType === 'ol') flushList();
      listType = 'ul';
      listBuf.push(inlineMd(ulMatch[1]));
      continue;
    }
    if (olMatch) {
      if (listType === 'ul') flushList();
      listType = 'ol';
      listBuf.push(inlineMd(olMatch[2]));
      continue;
    }

    flushList();

    if (!line.trim()) continue; // blank line = paragraph separator

    // Headings: #, ##, ### → same visual level (h4) — bubbles don't need H1s.
    const hMatch = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (hMatch) {
      out.push(`<h4 class="md-heading">${inlineMd(hMatch[2])}</h4>`);
      continue;
    }
    out.push(`<p class="md-p">${inlineMd(line)}</p>`);
  }
  flushList();

  let html = out.join('');

  /* ---- 4. Restore code-block placeholders that ended up mid-paragraph ---- */
  html = html.replace(/\u0000MDCB(\d+)\u0000/g, (m, n) => {
    const block = codeBlocks[Number(n)];
    const lang = block.lang ? `<span class="md-code-lang">${escapeMinimal(block.lang)}</span>` : '';
    return `<div class="md-code">${lang}<pre>${block.body}</pre></div>`;
  });

  return html;
}

/**
 * Inline rules inside one already-escaped line: bold, italic, inline code,
 * bare https links. Order matters: code spans first (protect their content),
 * then bold+italic (***), then bold (**), then italic (*), then links.
 * A final asterisk-scrub guarantees no raw `**`/`***` run can ever reach the
 * screen — every emphasis form the bots emit lands as REAL typography.
 */
function inlineMd(s) {
  // Inline code `foo` — protect content from the emphasis rules below.
  const spans = [];
  s = s.replace(/`([^`\n]+)`/g, (m, body) => {
    const i = spans.push(body) - 1;
    return `\u0001${i}\u0001`;
  });

  const ITALIC_AFTER = '(?=$|[\\s).,!?:;<])';

  // Bold + italic: ***text*** (also ___text___) → REAL bold italic.
  s = s.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/___([^_\n]+?)___/g, '<strong><em>$1</em></strong>');

  // Bold: **text** (also __text__) — non-greedy so two bolds on one line
  // pair correctly and single `*` inside a bold span is allowed.
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* (single asterisk, not part of ** ) and _text_.
  // Content must not start/end with a space, so "2 * 3 * 4" math stays math.
  const italicRe = new RegExp('(^|[\\s(>])\\*([^\\s*][^*\\n]*?)\\*' + ITALIC_AFTER, 'g');
  s = s.replace(italicRe, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(>])_([^\s_][^_\n]*?)_(?=$|[\s).,!?:;<])/g, '$1<em>$2</em>');

  // Bare https links → real anchors (https only, no javascript: risk).
  s = s.replace(/(https:\/\/[^\s<>"')\]]+)/g, (m) => {
    const trailing = /[.,!?]$/.test(m) ? m.slice(-1) : '';
    const url = trailing ? m.slice(0, -1) : m;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
  });

  // Safety net — after all emphasis rules, any leftover asterisk run of 2+
  // (`****text****`, an unclosed `**`, …) collapses to a single asterisk and
  // gets one more italic pass, so the bot's emphasis is ALWAYS rendered,
  // never shown as raw stars. A lone `*` (real multiplication) is untouched.
  if (/\*{2,}/.test(s)) {
    s = s.replace(/\*{2,}/g, '*');
    s = s.replace(new RegExp('(^|[\\s(>])\\*([^\\s*][^*\\n]*?)\\*' + ITALIC_AFTER, 'g'), '$1<em>$2</em>');
  }

  // Restore code spans.
  s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => `<code class="md-inline">${spans[Number(i)]}</code>`);
  return s;
}

function escapeMinimal(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strip Markdown emphasis markers back to plain text — for contexts that
 * must stay plain (push notifications, previews, titles).
 * "**bold**" → "bold", "*it*" → "it", "- item" → "item".
 */
export function stripMarkdown(raw) {
  return String(raw ?? '')
    .replace(/```[a-zA-Z0-9_+-]*\n?/g, '')
    .replace(/^\s*[-*•–]\s+/gm, '')
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, '$1')
    .replace(/___([^_\n]+?)___/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*{2,}/g, '*');
}
