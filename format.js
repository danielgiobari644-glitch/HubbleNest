/**
 * HubbleNest Rich Text Formatter
 *
 * Turns member-written text into REAL rich text — never shows raw Markdown
 * symbols. `**bold**` renders as bold, `_italic_` as italic, `# Heading` as
 * an actual heading, `> quote` as a real blockquote, `- item` as a list and
 * fenced ``` blocks as real code blocks. Output is a vertical, multi-line,
 * scannable layout with proper spacing.
 *
 * SECURITY: every character of member input is HTML-escaped FIRST; the only
 * HTML in the output comes from this module's own whitelisted tags, so
 * injected markup can never execute. (The escaped text is what we pattern-
 * match against — `*`, `_`, `~` and backticks are unaffected by escaping.)
 */

import { escapeHtml } from './utils.js';

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/** Inline pass: bold, italic, strike, inline code, links. */
function renderInline(escapedText) {
  let text = escapedText;
  const codeSlots = [];

  // 1. `inline code` — protect the contents from further transformations.
  text = text.replace(/`([^`\n]+)`/g, (m, code) => {
    codeSlots.push(code);
    return `\u0000CODE${codeSlots.length - 1}\u0000`;
  });

  // 2. Bold (**…**), then bold (__…__).
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

  // 3. Italic (*…* single stars) and _…_ (not inside words — snake_case safe).
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/(^|[^\w\\])_([^_\n]+)_(?=$|[^\w])/g, '$1<em>$2</em>');

  // 4. Strikethrough ~~…~~ and underline ++…++.
  text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  text = text.replace(/\+\+([^+\n]+)\+\+/g, '<u>$1</u>');

  // 5. Links — LAST so tag attributes above are never touched.
  text = text.replace(URL_RE, (url) => {
    const trail = '';
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="rt-link">${url}</a>${trail}`;
  });

  // 6. Restore protected code spans.
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => `<code class="rt-code">${codeSlots[Number(i)]}</code>`);

  return text;
}

/**
 * Render member text as safe, real rich text with a vertical layout.
 * @param {string} raw
 * @returns {string} safe HTML wrapped in nothing (caller supplies container)
 */
export function renderRichText(raw) {
  if (!raw || !String(raw).trim()) return '';
  const source = String(raw).replace(/\r\n?/g, '\n');
  const lines = source.split('\n');

  const out = [];
  let para = [];          // current paragraph lines
  let list = null;        // null | 'ul' | 'ol'
  let quote = [];         // blockquote lines
  let pre = null;         // fenced code buffer

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p class="rt-p">${para.map((l) => renderInline(l)).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push(`<blockquote class="rt-quote">${quote.map((l) => renderInline(l)).join('<br>')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const rawLine of lines) {
    const line = rawLine; // already escaped below per-branch (escape once here)
    const esc = escapeHtml(line);

    // Fenced code blocks
    if (/^\s*```/.test(line)) {
      if (pre === null) { flushAll(); pre = []; }
      else { out.push(`<pre class="rt-pre"><code>${pre.join('\n')}</code></pre>`); pre = null; }
      continue;
    }
    if (pre !== null) { pre.push(esc); continue; }

    // Blank line = paragraph break
    if (!esc.trim()) { flushAll(); continue; }

    // Headings: # .. ###
    const h = esc.match(/^\s*(#{1,3})\s+(.*)$/);
    if (h) {
      flushAll();
      const level = h[1].length; // 1..3
      out.push(`<h${level + 3} class="rt-h rt-h${level}">${renderInline(h[2].trim())}</h${level + 3}>`);
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(esc)) { flushAll(); out.push('<hr class="rt-hr">'); continue; }

    // Blockquote
    const q = esc.match(/^\s*&gt;\s?(.*)$/); // '>' was escaped to &gt;
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
    flushQuote();

    // Lists (-, *, +) and ordered lists (1.)
    const ul = esc.match(/^\s*[-*+]\s+(.*)$/);
    const ol = esc.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (list !== 'ul') { flushList(); out.push('<ul class="rt-ul">'); list = 'ul'; }
      out.push(`<li>${renderInline(ul[1])}</li>`);
      continue;
    }
    if (ol) {
      flushPara();
      if (list !== 'ol') { flushList(); out.push('<ol class="rt-ol">'); list = 'ol'; }
      out.push(`<li>${renderInline(ol[1])}</li>`);
      continue;
    }
    flushList();

    para.push(esc);
  }

  // Close any fenced code block left open
  if (pre !== null) out.push(`<pre class="rt-pre"><code>${pre.join('\n')}</code></pre>`);
  flushAll();

  return out.join('');
}

/**
 * One-line plain preview (used for conversation snippets / notifications).
 * Rich markers are stripped so no symbols ever leak into previews.
 */
export function richTextPreview(raw, maxLen = 120) {
  if (!raw) return '';
  const flat = String(raw)
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/[*_~`#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > maxLen ? flat.slice(0, maxLen - 1).trimEnd() + '…' : flat;
}
