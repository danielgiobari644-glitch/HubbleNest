/**
 * HubbleNest Utility Functions
 * Toasts, modal managers, date formatters, sanitizers, and SVG icons.
 */

/**
 * Toast Notification System
 */
export function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = type === 'success' 
    ? '✓' 
    : type === 'error' 
      ? '✕' 
      : type === 'warning' 
        ? '!' 
        : 'ℹ';

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Close">&times;</button>
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  const dismiss = () => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-hiding');
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 300);
  };

  const timer = setTimeout(dismiss, duration);

  toast.querySelector('.toast-close').addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}

/* ==========================================================================
   NOTIFICATION BANNERS — notifications that are genuinely VISIBLE.
   A new notification no longer only updates the bell badge and the dropdown:
   a rich banner card slides in (top-right on desktop, full-width on mobile)
   with a type icon, the title, the body and a live "new" pulse. Tapping the
   card opens the related view (chat, space, post, game); the ✕ dismisses.
   Used by the Firestore notifications listener (app open) and by the
   service worker's push-received bridge (push while the tab is focused).
   ========================================================================== */

const BANNER_ICONS = {
  private_message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  chat_request: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  chat_request_accepted: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 9 2 2 4-4"/>',
  feed_like: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  game_like: '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4"/>',
  feed_comment: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  space_added: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  space_joined: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  announcement: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  admin_message: '<path d="M12 2 4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3z"/><path d="m9 12 2 2 4-4"/>'
};

function bannerTone(type) {
  if (type === 'private_message' || type === 'chat_request' || type === 'chat_request_accepted') return 'nb-msg';
  if (type === 'feed_like' || type === 'game_like' || type === 'feed_comment') return 'nb-social';
  if (type === 'admin_message') return 'nb-admin';
  return 'nb-space';
}

let notifBannerContainer = null;

/**
 * Show one rich notification banner. Stacks up to 3; older ones dismiss.
 * @param {{id?: string, type?: string, title?: string, body?: string}} notif
 * @param {{onClick?: Function, duration?: number}} [opts]
 */
export function showNotificationBanner(notif, opts = {}) {
  if (!notif) return;
  if (!notifBannerContainer || !notifBannerContainer.isConnected) {
    notifBannerContainer = document.createElement('div');
    notifBannerContainer.id = 'notif-banner-container';
    notifBannerContainer.className = 'notif-banner-container';
    document.body.appendChild(notifBannerContainer);
  }

  // Never stack more than 3 live banners — the oldest yields.
  const live = notifBannerContainer.querySelectorAll('.notif-banner:not(.nb-leaving)');
  if (live.length >= 3) live[0].remove();

  const type = String(notif.type || '');
  const icon = BANNER_ICONS[type] || '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
  const tone = bannerTone(type);
  const duration = opts.duration || 6500;

  const card = document.createElement('div');
  card.className = `notif-banner ${tone}`;
  card.setAttribute('role', 'alert');
  card.innerHTML = `
    <span class="notif-banner-icon" aria-hidden="true">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
    </span>
    <span class="notif-banner-text">
      <b class="notif-banner-title">${escapeHtml(notif.title || 'Notification')}</b>
      <span class="notif-banner-body">${escapeHtml(notif.body || '')}</span>
    </span>
    <button type="button" class="notif-banner-close" aria-label="Dismiss">&times;</button>
    <span class="notif-banner-progress" aria-hidden="true"></span>
  `;

  const dismiss = () => {
    card.classList.add('nb-leaving');
    setTimeout(() => card.remove(), 260);
  };

  // Tap the card body (not the ✕) to open the related view.
  card.addEventListener('click', (ev) => {
    if (ev.target.closest('.notif-banner-close')) return;
    dismiss();
    if (typeof opts.onClick === 'function') {
      try { opts.onClick(); } catch (e) { /* navigation must never break rendering */ }
    }
  });
  card.querySelector('.notif-banner-close').addEventListener('click', dismiss);

  notifBannerContainer.appendChild(card);
  requestAnimationFrame(() => {
    card.classList.add('nb-visible');
    const bar = card.querySelector('.notif-banner-progress');
    if (bar) bar.style.animationDuration = `${duration}ms`;
  });
  setTimeout(dismiss, duration);
}

/**
 * Escape raw HTML to prevent XSS
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Extract URLs from a string
 */
export function extractUrls(text) {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  const matches = text.match(urlRegex);
  if (!matches) return [];
  return Array.from(new Set(matches)).map(url => {
    try {
      const parsed = new URL(url);
      return {
        url,
        domain: parsed.hostname.replace(/^www\./, '')
      };
    } catch {
      return { url, domain: url };
    }
  });
}

/**
 * Convert URLs inside text into clickable links
 */
export function linkify(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
  return escaped.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link">${url}</a>`;
  });
}

/**
 * Format timestamp into relative or readable string
 */
export function formatTimeAgo(dateInput) {
  if (!dateInput) return '';
  const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 172800) return 'Yesterday';
  
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Format full date & time (e.g. Sep 28, 2026, 4:15 PM)
 */
export function formatDateTime(dateInput) {
  if (!dateInput) return '';
  const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * Format expiration countdown for temporary spaces
 */
export function formatExpiration(expiresAt) {
  if (!expiresAt) return null;
  const expDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
  const now = new Date();
  const diffMs = expDate - now;

  if (diffMs <= 0) {
    return { isExpired: true, text: 'Expired', urgent: true };
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (days > 1) {
    return { isExpired: false, text: `Expires in ${days} days`, urgent: false };
  }
  if (days === 1) {
    return { isExpired: false, text: `Expires tomorrow`, urgent: true };
  }
  if (hours >= 1) {
    return { isExpired: false, text: `Expires in ${hours} hours`, urgent: true };
  }
  const minutes = Math.floor(diffMs / (1000 * 60));
  return { isExpired: false, text: `Expires in ${Math.max(1, minutes)}m`, urgent: true };
}

/**
 * Copy text to clipboard with feedback
 */
export async function copyToClipboard(text, successMessage = 'Copied to clipboard') {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    showToast(successMessage, 'success');
    return true;
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    showToast('Failed to copy. Please copy manually.', 'error');
    return false;
  }
}

/**
 * Generate Avatar URL fallback with user initials
 */
export function getAvatarUrl(photoUrl, name = 'User') {
  if (photoUrl && photoUrl.trim()) return photoUrl;
  const initials = (name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100%25' height='100%25' fill='%231e293b'/><text x='50%25' y='54%25' font-family='system-ui, -apple-system, sans-serif' font-weight='600' font-size='38' fill='%2394a3b8' text-anchor='middle' dominant-baseline='middle'>${initials}</text></svg>`;
}

/**
 * Modal Manager
 */
export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.add('modal-active');
  document.body.classList.add('modal-open');
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('modal-active');
  if (!document.querySelector('.modal.modal-active')) {
    document.body.classList.remove('modal-open');
  }
}

/**
 * Close any active modal on Escape key
 */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const activeModal = document.querySelector('.modal.modal-active');
    if (activeModal) {
      closeModal(activeModal.id);
    }
  }
});

/**
 * Friendly handling of a Firestore permission-denied error (replaces the old
 * Connection Doctor auto-open): throttled, actionable guidance pointing at
 * the built-in Get Help assistant instead of a diagnostic panel.
 */
let lastPermErrAt = 0;
export function handlePermissionError(source) {
  const now = Date.now();
  if (now - lastPermErrAt < 20000) return;
  lastPermErrAt = now;
  console.warn('[HubbleNest] permission-denied in', source);
  showToast('That action was blocked — your connection or sign-in state may have dropped. Check both, try once more, or ask the Get Help assistant.', 'warning', 6500);
}
