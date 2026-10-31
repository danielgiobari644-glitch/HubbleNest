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
  return `<!DOCTYPE html><html><head>${arcadeBridgeTag()}<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${safe(css)}</style></head><body>${safe(html)}
<script>${safe(js)}<\/script></body></html>`;
}

/* ========================================================================
   Arcade sandbox bridge — injected into EVERY game document (previews,
   the player and public pages) before any member code runs.

   What it gives games and the Arcade shell:
   - window.HN.postScore(n) / HN.gameOver(n) / HN.hud({...}) / HN.setControls
     — opt-in score/HUD/touch-control APIs reported to the parent via
     postMessage. Games that never call them simply show no HUD (no fake UI).
   - REAL pause/resume for rAF- and timer-driven games: while paused the
     bridge queues animation frames and freezes timeout callbacks.
   - REAL media mute: pauses/mutes audio+video elements and suspends
     AudioContext instances (including ones created later).
   - On-screen control buttons dispatch real KeyboardEvents into the game.

   The bridge grants NO privileges: no network, no storage, no parent access
   beyond postMessage. The parent validates every message's source frame.
   ======================================================================== */

const BRIDGE_BODY = `(function(){
'use strict';
var PAUSED=false, MUTED=false;
var rafQueue=[], timerQueue=[];
var _raf=window.requestAnimationFrame?window.requestAnimationFrame.bind(window):null;
var _setTimeout=window.setTimeout.bind(window);
var _setInterval=window.setInterval.bind(window);
var audioCtxs=[];
function post(msg){try{parent.postMessage(msg,'*');}catch(e){}}
if(_raf){window.requestAnimationFrame=function(cb){
  if(PAUSED){rafQueue.push(cb);return 0;}
  return _raf(function(ts){if(PAUSED){rafQueue.push(cb);return;}cb(ts);});};}
window.setTimeout=function(fn,d){var a=Array.prototype.slice.call(arguments,2);
  return _setTimeout(function(){if(PAUSED){timerQueue.push({fn:fn,a:a});return;}fn.apply(null,a);},d);};
window.setInterval=function(fn,d){var a=Array.prototype.slice.call(arguments,2);
  return _setInterval(function(){if(PAUSED){return;}fn.apply(null,a);},d);};
function doPause(){PAUSED=true;}
function doResume(){PAUSED=false;
  var q=rafQueue.slice();rafQueue.length=0;
  for(var i=0;i<q.length;i++){(function(cb){_raf(function(ts){if(PAUSED){rafQueue.push(cb);return;}cb(ts);});})(q[i]);}
  var tq=timerQueue.slice();timerQueue.length=0;
  for(var j=0;j<tq.length;j++){(function(it){_setTimeout(function(){if(PAUSED){timerQueue.push(it);return;}it.fn.apply(null,it.a);},0);})(tq[j]);}}
function mediaAll(){try{return document.querySelectorAll('audio,video');}catch(e){return [];}}
function doMute(){MUTED=true;
  mediaAll().forEach(function(el){try{el._hnM=el.muted;el.muted=true;el.pause();}catch(e){}});
  audioCtxs.forEach(function(c){try{c.suspend();}catch(e){}});}
function doUnmute(){MUTED=false;
  mediaAll().forEach(function(el){try{el.muted=el._hnM||false;}catch(e){}});
  audioCtxs.forEach(function(c){try{c.resume();}catch(e){}});}
function key(k,down){var ev;try{ev=new KeyboardEvent(down?'keydown':'keyup',{key:k,code:k==='Space'?'Space':k,keyCode:k==='Space'?32:k.indexOf('Arrow')===0?{ArrowLeft:37,ArrowRight:39,ArrowUp:38,ArrowDown:40}[k]:0,which:0,bubbles:true,cancelable:true});}catch(e){return;}
  try{(document.activeElement||document.body).dispatchEvent(ev);window.dispatchEvent(ev);}catch(e){}}
window.addEventListener('message',function(e){
  var d=e.data||{};
  if(d.type==='hn-ctl'){
    if(d.cmd==='pause')doPause();
    if(d.cmd==='resume')doResume();
    if(d.cmd==='mute')doMute();
    if(d.cmd==='unmute')doUnmute();
    post({type:'hn-ack',cmd:d.cmd||''});
  }else if(d.type==='hn-key'){key(String(d.key||''),!!d.down);}
});
try{window.addEventListener('error',function(e){post({type:'hn-err',message:String((e&&e.message)||'error').slice(0,220)});});}catch(e){}
try{
  var AC=window.AudioContext||window.webkitAudioContext;
  if(AC){function WrappedAC(){var c=new AC();audioCtxs.push(c);if(MUTED){try{c.suspend();}catch(e){}}return c;}
    WrappedAC.prototype=AC.prototype;try{Object.defineProperty(WrappedAC,'name',{value:AC.name});}catch(e){}
    if(window.AudioContext===AC)window.AudioContext=WrappedAC;
    if(window.webkitAudioContext===AC)window.webkitAudioContext=WrappedAC;}
}catch(e){}
try{new MutationObserver(function(){
  if(!MUTED)return;
  mediaAll().forEach(function(el){try{if(!el.paused){el.pause();el.muted=true;}}catch(e){}});
}).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
window.HN={
  postScore:function(n){post({type:'hn-score',score:Number(n)||0});},
  hud:function(o){if(o&&typeof o==='object')post({type:'hn-hud',hud:o});},
  gameOver:function(n){post({type:'hn-over',score:Number(n)||0});},
  setControls:function(c){var k={};if(c&&c.left)k.left=1;if(c&&c.right)k.right=1;if(c&&c.up)k.up=1;if(c&&c.down)k.down=1;if(c&&c.jump)k.jump=1;if(c&&c.action)k.action=1;post({type:'hn-controls',controls:k});},
  progress:function(p){post({type:'hn-progress',pct:Number(p)||0});}
};
})();`;

/** The bridge as a <script> tag for direct template injection. */
function arcadeBridgeTag() {
  return `<script>${BRIDGE_BODY}<\/script>`;
}

/** Inject the bridge into a full HTML document (multi-file projects). */
function injectBridge(html) {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, (m, attrs) => `<head${attrs}>${arcadeBridgeTag()}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, (m, attrs) => `<html${attrs}><head>${arcadeBridgeTag()}</head>`);
  }
  return `${arcadeBridgeTag()}${html}`;
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
  // Bridge goes in AFTER member code was neutralised so our own script
  // stays intact — it must run before any game code (it wraps rAF/timers).
  return injectBridge(neutralizeInlineScripts(html));
}

