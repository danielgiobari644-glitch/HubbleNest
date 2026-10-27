/**
 * HubbleNest shared multi-file game builder.
 *
 * Turns a member project (path → text content) into a sandbox-safe srcdoc:
 * relative references become data: URLs so the opaque-origin iframe can load
 * siblings. Used by BOTH the in-app Arcade and the public game pages.
 */

/* ==== Multi-file games — upload a folder / files in ANY coding language.
   Text files are stored verbatim; the player rewrites relative references
   to data: URLs so the sandboxed (opaque-origin) iframe can load siblings.
   ======================================================================== */

const FILE_MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
  mjs: 'text/javascript', cjs: 'text/javascript', json: 'application/json',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', xml: 'application/xml',
  yml: 'text/plain', yaml: 'text/plain', py: 'text/plain', ts: 'text/plain',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf'
};

const LANGUAGE_NAMES = {
  html: 'HTML', htm: 'HTML', css: 'CSS', js: 'JavaScript', mjs: 'JavaScript',
  cjs: 'JavaScript', ts: 'TypeScript', jsx: 'JavaScript (React)', tsx: 'TypeScript (React)',
  json: 'JSON', py: 'Python', java: 'Java', c: 'C', h: 'C header', cpp: 'C++',
  cc: 'C++', hpp: 'C++ header', cs: 'C#', php: 'PHP', rb: 'Ruby', go: 'Go',
  rs: 'Rust', lua: 'Lua', swift: 'Swift', kt: 'Kotlin', sh: 'Shell',
  sql: 'SQL', xml: 'XML', yml: 'YAML', yaml: 'YAML', md: 'Markdown', txt: 'Text'
};

/** Detected human languages for a file map → sorted unique names. */
export function detectLanguages(files) {
  const names = new Set();
  for (const path of Object.keys(files || {})) {
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (LANGUAGE_NAMES[ext]) names.add(LANGUAGE_NAMES[ext]);
  }
  return Array.from(names).sort();
}

function mimeForPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return FILE_MIME[ext] || 'text/plain';
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function dataUrlFor(path, content) {
  return `data:${mimeForPath(path)};charset=utf-8;base64,${utf8ToBase64(content)}`;
}

/** Normalise a project-relative path (backslashes, ./ and leading /). */
export function normalizeGamePath(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Classic single-file sandbox wrapper (HTML/CSS/JS editor fields).
 * Exported so both the Arcade editor and this module's multi-file builder
 * share one escaping rule for `</script`.
 */
export function buildSrcDoc(html, css, js) {
  // Neutralise script-closing sequences so member code can't break the wrapper.
  const safe = (s) => String(s || '').replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${safe(css)}</style></head><body>${safe(html)}
<script>${safe(js)}<\/script></body></html>`;
}

/** Resolve a relative reference against the entry file's directory. */
function resolveGameRef(ref, entryDir) {
  const clean = String(ref).trim();
  if (!clean || /^(https?:|data:|blob:|about:|mailto:|javascript:|#)/i.test(clean) || clean.startsWith('//')) return null;
  let p = clean.split('#')[0].split('?')[0];
  if (!p) return null;
  p = normalizeGamePath(p);
  const joined = p.startsWith('/') ? p.slice(1) : (entryDir ? `${entryDir}/${p}` : p);
  const stack = [];
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

/** Rewrite url(...) references inside one CSS file to data: URLs. */
function rewriteCssRefs(cssContent, dir, files) {
  return cssContent.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, ref) => {
    const resolved = resolveGameRef(ref, dir);
    if (resolved === null || !(resolved in files)) return m;
    return `url("${dataUrlFor(resolved, files[resolved])}")`;
  });
}

/**
 * Neutralise </script> sequences INSIDE inline <script> blocks only —
 * real closing tags must survive (uploaded games carry their own markup).
 */
function neutralizeInlineScripts(html) {
  return html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, open, body, close) =>
    `${open}${body.replace(/<\/script/gi, '<\\/script')}${close}`);
}

/**
 * Build a runnable srcdoc from a multi-file project.
 * @param {Object} files  { path → text content }
 * @param {string} entry  entry HTML path
 */
export function buildSrcDocFromFiles(files, entry) {
  const entryDir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '';
  let html = files[entry] || '';
  if (!html) return buildSrcDoc('<p>This game has no entry file.</p>', '', ''); // buildSrcDoc is defined in THIS module above

  // Pre-convert every non-entry file into a data URL, rewriting url() in CSS.
  const resolved = {};
  for (const [path, content] of Object.entries(files)) {
    if (path === entry) continue;
    resolved[path] = /\.css$/i.test(path)
      ? rewriteCssRefs(content, path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', files)
      : content;
  }

  // Rewrite relative src=/href= references that resolve to a project file.
  html = html.replace(/\b(src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, attr, _q, dq, sq) => {
    const ref = dq !== undefined ? dq : sq;
    const target = resolveGameRef(ref, entryDir);
    if (target === null || !(target in resolved)) return m;
    return `${attr}="${dataUrlFor(target, resolved[target])}"`;
  });

  // url() refs inside INLINE <style> blocks.
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, css) =>
    `<style${attrs}>${rewriteCssRefs(css, entryDir, resolved)}</style>`);

  // Full document provided by the member; wrap fragments in a basic shell.
  if (!/<html[\s>]/i.test(html)) {
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${html}</body></html>`;
  }
  return neutralizeInlineScripts(html);
}

