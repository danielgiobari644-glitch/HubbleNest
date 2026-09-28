/* =============================================================
   LinkRoom — Utilities
   ============================================================= */

window.Utils = (function () {
  'use strict';

  // ---------- DOM helpers ----------
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class')      node.className = v;
        else if (k === 'text')  node.textContent = v;
        else if (k === 'html')  node.innerHTML = window.DOMPurify ? DOMPurify.sanitize(v) : v;
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset' && typeof v === 'object') {
          Object.assign(node.dataset, v);
        } else if (k === 'style' && typeof v === 'object') {
          Object.assign(node.style, v);
        } else {
          node.setAttribute(k, v === true ? '' : v);
        }
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
      else if (c instanceof Node) node.appendChild(c);
    }
    return node;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  // ---------- Date & time formatting ----------
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const opts = { hour: '2-digit', minute: '2-digit' };
    if (sameDay) return d.toLocaleTimeString([], opts);
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], opts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function fmtDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function relativeTime(ts) {
    if (!ts) return '';
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return fmtDate(ts);
  }

  function fmtRemaining(expiresAt) {
    if (!expiresAt) return '';
    const ms = new Date(expiresAt) - Date.now();
    if (ms <= 0) return 'Expired';
    const sec = Math.floor(ms / 1000);
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    if (days > 0)  return `Expires in ${days}d ${hours}h`;
    if (hours > 0) return `Expires in ${hours}h ${mins}m`;
    return `Expires in ${mins}m`;
  }

  // ---------- File helpers ----------
  function humanBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n = bytes, i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function fileExt(name) {
    if (!name) return '';
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  }

  function fileCategory(mime, name) {
    const m = (mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'images';
    if (m.startsWith('video/')) return 'videos';
    if (m.startsWith('audio/')) return 'audio';
    const docTypes = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain','text/csv','application/rtf','application/vnd.oasis.opendocument.text'];
    if (docTypes.includes(m)) return 'documents';
    return 'other';
  }

  function fileIcon(mime, name) {
    const cat = fileCategory(mime, name);
    const map = {
      images: '🖼', videos: '🎬', audio: '🎵', documents: '📄', other: '📦'
    };
    return map[cat] || '📄';
  }

  function downloadUrl(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name || '';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- String helpers ----------
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function linkify(text) {
    if (!text) return '';
    const escaped = escapeHtml(text);
    const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
    return escaped.replace(urlRegex, (url) => {
      const href = url.replace(/&amp;/g, '&');
      const label = url.length > 60 ? url.slice(0,57) + '…' : url;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
    });
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0,2).map(w => w[0] || '').join('').toUpperCase();
  }

  // ---------- Validators ----------
  function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
  function validUsername(s) { return /^[a-zA-Z0-9_]{3,24}$/.test(s); }

  // ---------- ID & codes ----------
  function uid() { return 'lr_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

  // ---------- Class toggles ----------
  function toggleClass(node, cls, force) {
    if (!node) return;
    if (force === undefined) node.classList.toggle(cls);
    else if (force) node.classList.add(cls);
    else node.classList.remove(cls);
  }

  // ---------- Debounce ----------
  function debounce(fn, wait, immediate) {
    let t;
    return function (...args) {
      const ctx = this;
      const callNow = immediate && !t;
      clearTimeout(t);
      t = setTimeout(() => { fn.apply(ctx, args); t = null; }, wait);
      if (callNow) fn.apply(ctx, args);
    };
  }

  // ---------- Clipboard ----------
  async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      return true;
    } catch { return false; }
  }

  // ---------- Storage (with prefix) ----------
  const LS_PREFIX = 'linkroom:';
  const ls = {
    get(k, def) {
      try { const v = localStorage.getItem(LS_PREFIX + k); return v ? JSON.parse(v) : (def !== undefined ? def : null); }
      catch { return def; }
    },
    set(k, v) { try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(LS_PREFIX + k); } catch {} }
  };

  // ---------- Color avatar ----------
  const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#f59e0b','#10b981','#06b6d4','#0ea5e9','#3b82f6'];
  function colorFor(seed) {
    let h = 0;
    const s = String(seed || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  // ---------- Avatar URL helper ----------
  function avatarFor(user) {
    if (!user) return null;
    if (user.avatar_url) return user.avatar_url;
    return null; // caller can use placeholder
  }

  // ---------- Generate random alphanumeric code ----------
  function randomCode(len = 6) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
    return s;
  }

  function randomToken(len = 32) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
    return s;
  }

  return {
    el, $, $$, clear,
    fmtTime, fmtDate, fmtDateTime, relativeTime, fmtRemaining,
    humanBytes, fileExt, fileCategory, fileIcon, downloadUrl,
    escapeHtml, linkify, initials,
    validEmail, validUsername,
    uid, toggleClass, debounce, copy,
    ls, colorFor, avatarFor, randomCode, randomToken
  };
})();
