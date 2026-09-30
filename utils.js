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
